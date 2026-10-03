import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { GPU_QUERY, formatMiB, parseGpuLine } from './lib/gpu.js';
import { KINDS, formatRate, isLinkUp, summarize } from './lib/network.js';
import { RESOURCES, formatPercent, levelFor } from './lib/psi.js';
import { SystemSampler } from './lib/sampler.js';

const REFRESH_SECONDS = 2;
const TITLES = { io: 'Disk', cpu: 'CPU', memory: 'Memory' };
const NET_LABEL = { wifi: 'Wi-Fi', ethernet: 'Ethernet' };
// Color classes a badge can have: pressure levels, and "net" for a connected
// network interface.
const STATES = ['ok', 'warn', 'crit', 'net'];
// Left to right in the top bar. Each one is its own button with its own menu.
const BADGES = [
    ['io', 'Disk'],
    ['cpu', 'CPU'],
    ['memory', 'Memory'],
    ['gpu', 'GPU'],
    ['wifi', 'Wi-Fi'],
    ['ethernet', 'Ethernet'],
];

function windows(stats) {
    if (!stats) return 'n/a';
    return [stats.avg10, stats.avg60, stats.avg300].map((v) => formatPercent(v ?? 0)).join('  ·  ');
}

// Keeps ONE long-running `nvidia-smi -l` process and reads its output lines
// asynchronously, instead of spawning a new process every refresh.
class GpuMonitor {
    constructor(onUpdate) {
        this._onUpdate = onUpdate;
    }

    start() {
        this._cancellable = new Gio.Cancellable();
        try {
            this._proc = Gio.Subprocess.new(
                [
                    'nvidia-smi',
                    `--query-gpu=${GPU_QUERY}`,
                    '--format=csv,noheader,nounits',
                    '-l',
                    String(REFRESH_SECONDS),
                ],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            );
        } catch (_e) {
            this._proc = null; // nvidia-smi not installed
            this._onUpdate(null);
            return;
        }

        this._stream = new Gio.DataInputStream({ base_stream: this._proc.get_stdout_pipe() });
        this._readLine();
    }

    stop() {
        this._cancellable?.cancel();
        this._proc?.force_exit();
        this._cancellable = null;
        this._stream = null;
        this._proc = null;
    }

    _readLine() {
        this._stream.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (stream, result) => {
            try {
                const [line] = stream.read_line_finish_utf8(result);
                if (line === null) {
                    // process exited
                    this._onUpdate(null);
                    return;
                }
                this._onUpdate(parseGpuLine(line));
                this._readLine();
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) this._onUpdate(null);
            }
        });
    }
}

// One top-bar badge with its own menu, so clicking a badge shows only that
// badge's details.
const Badge = GObject.registerClass(
    class Badge extends PanelMenu.Button {
        _init(title, extraClass = null) {
            super._init(0.0, title, false);
            this.add_style_class_name('psi-button');

            this._pill = new St.Label({
                text: `${title}: …`,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'psi-pill',
            });
            if (extraClass) this._pill.add_style_class_name(extraClass);
            this.add_child(this._pill);

            this._headingItem = new PopupMenu.PopupMenuItem('', { reactive: false });
            this._headingItem.label.add_style_class_name('psi-header');
            this.menu.addMenuItem(this._headingItem);
            this._bodyItem = new PopupMenu.PopupMenuItem('', { reactive: false });
            this.menu.addMenuItem(this._bodyItem);
        }

        // `state` is one of STATES (the badge color), or null for none.
        setContent({ text, state = null, heading, body }) {
            this._pill.set_text(text);
            for (const name of STATES) this._pill.remove_style_class_name(`psi-${name}`);
            if (state) this._pill.add_style_class_name(`psi-${state}`);
            this._headingItem.label.set_text(heading);
            this._bodyItem.label.set_text(body);
        }
    },
);

// The value shown inside each pill: how much of the resource is in use.
function usageOf(resource, { cpuUsage, mem, disks }) {
    if (resource === 'cpu') return cpuUsage;
    if (resource === 'memory') return mem ? (100 * mem.usedMiB) / mem.totalMiB : null;

    const busy = disks.map((d) => d.rates?.busyPercent).filter((v) => v !== undefined);
    return busy.length > 0 ? Math.max(...busy) : null;
}

function describeDisks(disks) {
    if (disks.length === 0) return 'no disks found';

    return disks
        .map((disk) => {
            const where = disk.mounts.length > 0 ? disk.mounts.join(', ') : 'not mounted';
            const speed = disk.rates
                ? `busy ${formatPercent(disk.rates.busyPercent, 1)}  ·  reads ${disk.rates.readMBs.toFixed(1)} MB/s  ·  writes ${disk.rates.writeMBs.toFixed(1)} MB/s`
                : 'measuring…';
            return `${disk.name}  ·  ${disk.model}  ·  ${disk.sizeGiB} GiB\n  mounted on: ${where}\n  ${speed}`;
        })
        .join('\n');
}

// Heading and body of the menu of the Disk, CPU and Memory badges.
function pressureDetails(resource, snapshot) {
    const { psi, instant, cores, cpuUsage, mem, disks } = snapshot;
    const headings = {
        io: 'Disk (I/O)  ·  number = busiest disk',
        cpu: `CPU  ·  number = usage, ${cores} cores`,
        memory: 'Memory  ·  number = RAM in use',
    };
    const heading = headings[resource];

    const data = psi[resource];
    if (!data) return { heading, body: 'n/a' };

    const now = instant[resource];
    const lines = [
        'color = pressure (time stalled waiting):',
        `  some  ${windows(data.some)}`,
        `  full   ${windows(data.full)}`,
        `  now (${REFRESH_SECONDS}s): ${now === null ? 'measuring…' : formatPercent(now, 3)}`,
    ];

    if (resource === 'io') {
        const busiest = disks
            .filter((d) => d.rates)
            .sort((a, b) => b.rates.busyPercent - a.rates.busyPercent)[0];
        if (busiest)
            lines.push(
                `  busiest: ${busiest.name} (${formatPercent(busiest.rates.busyPercent, 1)})`,
            );
        lines.push('', 'Disks  (busy % and speed, per disk):', describeDisks(disks));
    }

    if (resource === 'cpu' && cpuUsage !== null)
        lines.push(`  usage: ${formatPercent(cpuUsage, 1)} of ${cores} cores`);

    if (resource === 'memory' && mem) {
        const usedPercent = (100 * mem.usedMiB) / mem.totalMiB;
        lines.push(
            `  RAM in use: ${formatMiB(mem.usedMiB)} of ${formatMiB(mem.totalMiB)} (${formatPercent(usedPercent, 0)})`,
            `  swap: ${formatMiB(mem.swapUsedMiB)} of ${formatMiB(mem.swapTotalMiB)}`,
        );
    }
    return { heading, body: lines.join('\n') };
}

// "link up, no IPv4 address" is what an interface turned off from the network
// menu looks like while its cable is still plugged in.
function describeStatus(item) {
    if (item.connected) return 'connected';
    return isLinkUp(item.state) ? 'link up, no IPv4 address' : item.state;
}

function describeInterfaces(interfaces) {
    return interfaces
        .map((item) => {
            const facts = [item.name, NET_LABEL[item.kind], describeStatus(item)];
            if (item.speedMbps) facts.push(`link ${item.speedMbps} Mb/s`);
            if (item.signal)
                facts.push(`signal ${item.signal.levelDbm} dBm (quality ${item.signal.quality})`);

            const rates =
                item.rxRate === null
                    ? 'measuring…'
                    : `↓ ${formatRate(item.rxRate)}  ↑ ${formatRate(item.txRate)}`;
            return `${facts.join('  ·  ')}\n  ${rates}`;
        })
        .join('\n');
}

export default class PsiMonitorExtension extends Extension {
    enable() {
        this._badges = {};
        BADGES.forEach(([key, title], index) => {
            const badge = new Badge(title, key === 'gpu' ? 'psi-gpu' : null);
            // One role per badge. The explicit index keeps them in this order,
            // left to right, ahead of the other items on the right side.
            Main.panel.addToStatusArea(`${this.uuid}-${key}`, badge, index, 'right');
            this._badges[key] = badge;
        });
        // Shown only once an interface of that kind exists.
        for (const kind of KINDS) this._badges[kind].visible = false;

        this._sampler = new SystemSampler();
        this._refresh();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });

        this._gpu = new GpuMonitor((gpu) => this._showGpu(gpu));
        this._gpu.start();
    }

    disable() {
        this._gpu?.stop();
        this._gpu = null;

        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        this._sampler = null;
        for (const badge of Object.values(this._badges ?? {})) badge.destroy();
        this._badges = null;
    }

    _refresh() {
        if (this._badges) this._render(this._sampler.sample());
    }

    _render(snapshot) {
        for (const resource of RESOURCES) {
            // The number is what you expect to read (usage); the color is the
            // kernel's pressure verdict (green/yellow/red).
            const pressure = snapshot.psi[resource]?.some?.avg10;
            const usage = usageOf(resource, snapshot);
            this._badges[resource].setContent({
                text: `${TITLES[resource]}: ${usage === null ? '…' : formatPercent(usage, 1)}`,
                state: pressure === undefined ? null : levelFor(pressure),
                ...pressureDetails(resource, snapshot),
            });
        }

        // Network has no pressure metric: the badge shows speed, and is teal
        // while the interface is connected and gray ("off") otherwise.
        for (const kind of KINDS) {
            const group = snapshot.net.filter((item) => item.kind === kind);
            const badge = this._badges[kind];
            badge.visible = group.length > 0;
            if (group.length === 0) continue;

            const label = NET_LABEL[kind];
            const { up, rxRate, txRate } = summarize(group);
            let text;
            if (!up) text = `${label}: off`;
            else if (rxRate === null) text = `${label}: …`;
            else text = `${label} ↓ ${formatRate(rxRate)} ↑ ${formatRate(txRate)}`;

            badge.setContent({
                text,
                state: up ? 'net' : null,
                heading: `${label}  ·  number = download and upload speed`,
                body: describeInterfaces(group),
            });
        }
    }

    _showGpu(gpu) {
        // The nvidia-smi callback can fire after disable().
        if (!this._badges) return;
        this._badges.gpu.setContent({
            text: gpu ? `GPU: ${Math.round(gpu.util)}%` : 'GPU: n/a',
            heading: 'GPU  ·  current usage, not pressure',
            body: gpu
                ? `Usage ${Math.round(gpu.util)}%  ·  VRAM ${formatMiB(gpu.memUsedMiB)} / ${formatMiB(gpu.memTotalMiB)}  ·  ${Math.round(gpu.tempC)}°C`
                : 'nvidia-smi unavailable',
        });
    }
}
