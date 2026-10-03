import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { BADGES, canHide, isShown, sanitizeHidden, setShown } from './lib/badges.js';
import { GPU_QUERY, formatMiB, parseGpuLine } from './lib/gpu.js';
import { KINDS, formatRate, isLinkUp, summarize } from './lib/network.js';
import { RESOURCES, formatPercent, levelFor } from './lib/psi.js';
import { SystemSampler } from './lib/sampler.js';

const REFRESH_SECONDS = 2;
const SYSTEM_NVIDIA_SMI = '/usr/bin/nvidia-smi';
const TITLES = { io: 'Disk', cpu: 'CPU', memory: 'Memory' };
const NET_LABEL = { wifi: 'Wi-Fi', ethernet: 'Ethernet' };
// Color classes a badge can have: pressure levels, and "net" for a connected
// network interface.
const STATES = ['ok', 'warn', 'crit', 'net'];

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
        // The session PATH can list user-writable folders (such as
        // ~/.local/bin) before /usr/bin, so use the system binary when it exists.
        const nvidiaSmi = GLib.file_test(SYSTEM_NVIDIA_SMI, GLib.FileTest.IS_EXECUTABLE)
            ? SYSTEM_NVIDIA_SMI
            : 'nvidia-smi';
        try {
            this._proc = Gio.Subprocess.new(
                [
                    nvidiaSmi,
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
// badge's details. Right-clicking opens a second, small menu with just the
// "Show in top bar" options; the same options end the normal menu.
const Badge = GObject.registerClass(
    class Badge extends PanelMenu.Button {
        _init(title, extraClass, onToggle, onSelectAll) {
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

            this._toggles = []; // { key, item } of both menus
            this._selectAllItems = [];
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._addToggles(this.menu, onToggle, onSelectAll);

            // Registered with the panel's menu manager so only one menu is open.
            this._optionsMenu = new PopupMenu.PopupMenu(this, 0.0, St.Side.TOP);
            this._optionsMenu.actor.add_style_class_name('panel-menu');
            Main.uiGroup.add_child(this._optionsMenu.actor);
            this._optionsMenu.actor.hide();
            Main.panel.menuManager.addMenu(this._optionsMenu);
            this._addToggles(this._optionsMenu, onToggle, onSelectAll);
        }

        _addToggles(menu, onToggle, onSelectAll) {
            const header = new PopupMenu.PopupMenuItem('Show in top bar', { reactive: false });
            header.label.add_style_class_name('psi-header');
            menu.addMenuItem(header);

            for (const [key, title] of BADGES) {
                const item = new PopupMenu.PopupMenuItem(title);
                item.connect('activate', () => onToggle(key));
                menu.addMenuItem(item);
                this._toggles.push({ key, item });
            }

            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const selectAll = new PopupMenu.PopupMenuItem('Select all');
            selectAll.connect('activate', () => onSelectAll());
            menu.addMenuItem(selectAll);
            this._selectAllItems.push(selectAll);
        }

        // Check marks for both menus, and the rule that the last always
        // available badge cannot be hidden.
        setChecks(hidden) {
            for (const { key, item } of this._toggles) {
                const shown = isShown(hidden, key);
                item.setOrnament(shown ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
                item.setSensitive(shown ? canHide(hidden, key) : true);
            }
            for (const item of this._selectAllItems) item.setSensitive(hidden.length > 0);
        }

        // `state` is one of STATES (the badge color), or null for none.
        setContent({ text, state = null, heading, body }) {
            this._pill.set_text(text);
            for (const name of STATES) this._pill.remove_style_class_name(`psi-${name}`);
            if (state) this._pill.add_style_class_name(`psi-${state}`);
            this._headingItem.label.set_text(heading);
            this._bodyItem.label.set_text(body);
        }

        vfunc_event(event) {
            const secondary =
                event.type() === Clutter.EventType.BUTTON_PRESS &&
                event.get_button() === Clutter.BUTTON_SECONDARY;
            if (!secondary) return super.vfunc_event(event);

            this.menu.close();
            this._optionsMenu.toggle();
            return Clutter.EVENT_STOP;
        }

        _onDestroy() {
            Main.panel.menuManager.removeMenu(this._optionsMenu);
            this._optionsMenu.destroy();
            super._onDestroy();
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
        this._settings = this.getSettings();
        this._hidden = sanitizeHidden(this._settings.get_strv('hidden-badges'));
        // Whether the hardware behind a badge exists. They stay hidden until
        // it is known, whatever the setting says.
        this._present = { gpu: false, wifi: false, ethernet: false };

        this._badges = {};
        BADGES.forEach(([key, title], index) => {
            const badge = new Badge(
                title,
                key === 'gpu' ? 'psi-gpu' : null,
                (k) => this._toggle(k),
                () => this._selectAll(),
            );
            // One role per badge. The explicit index keeps them in this order,
            // left to right, ahead of the other items on the right side.
            Main.panel.addToStatusArea(`${this.uuid}-${key}`, badge, index, 'right');
            this._badges[key] = badge;
        });

        this._settingsId = this._settings.connect('changed::hidden-badges', () => {
            this._hidden = sanitizeHidden(this._settings.get_strv('hidden-badges'));
            this._applyHidden();
        });

        this._sampler = new SystemSampler();
        this._refresh();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });

        this._applyHidden();
    }

    disable() {
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = null;
        }
        this._settings = null;

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

    // Menu click: flip one badge in the stored list. The settings signal then
    // updates everything, so it also reacts to changes made elsewhere (dconf).
    _toggle(key) {
        const next = setShown(this._hidden, key, !isShown(this._hidden, key));
        const unchanged =
            next.length === this._hidden.length && next.every((k) => this._hidden.includes(k));
        if (!unchanged) this._settings.set_strv('hidden-badges', next);
    }

    _selectAll() {
        if (this._hidden.length > 0) this._settings.set_strv('hidden-badges', []);
    }

    _applyHidden() {
        for (const [key] of BADGES) {
            this._badges[key].setChecks(this._hidden);
            this._updateVisibility(key);
        }
        this._syncGpu();
    }

    _updateVisibility(key) {
        const present = key in this._present ? this._present[key] : true;
        this._badges[key].visible = isShown(this._hidden, key) && present;
    }

    // nvidia-smi only runs while the GPU badge is shown.
    _syncGpu() {
        const wanted = isShown(this._hidden, 'gpu');
        if (wanted && !this._gpu) {
            this._gpu = new GpuMonitor((gpu) => this._showGpu(gpu));
            this._gpu.start();
        } else if (!wanted && this._gpu) {
            this._gpu.stop();
            this._gpu = null;
            this._present.gpu = false;
            this._updateVisibility('gpu');
        }
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
            this._present[kind] = group.length > 0;
            this._updateVisibility(kind);
            if (group.length === 0) continue;

            const label = NET_LABEL[kind];
            const { up, rxRate, txRate } = summarize(group);
            let text;
            if (!up) text = `${label}: off`;
            else if (rxRate === null) text = `${label}: …`;
            else text = `${label} ↓ ${formatRate(rxRate)} ↑ ${formatRate(txRate)}`;

            this._badges[kind].setContent({
                text,
                state: up ? 'net' : null,
                heading: `${label}  ·  number = download and upload speed`,
                body: describeInterfaces(group),
            });
        }
    }

    // gpu is null when nvidia-smi is not installed: the badge then stays hidden.
    _showGpu(gpu) {
        // The nvidia-smi callback can fire after disable() or after hiding.
        if (!this._badges || !this._gpu) return;

        this._present.gpu = gpu !== null;
        this._updateVisibility('gpu');
        if (!gpu) return;

        this._badges.gpu.setContent({
            text: `GPU: ${Math.round(gpu.util)}%`,
            heading: 'GPU  ·  current usage, not pressure',
            body: `Usage ${Math.round(gpu.util)}%  ·  VRAM ${formatMiB(gpu.memUsedMiB)} / ${formatMiB(gpu.memTotalMiB)}  ·  ${Math.round(gpu.tempC)}°C`,
        });
    }
}
