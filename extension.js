import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {GPU_QUERY, formatMiB, parseGpuLine} from './lib/gpu.js';
import {RESOURCES, formatPercent, levelFor} from './lib/psi.js';
import {SystemSampler} from './lib/sampler.js';

const REFRESH_SECONDS = 2;
const LEVELS = ['ok', 'warn', 'crit'];
const SHORT = {io: 'Disco', cpu: 'CPU', memory: 'Memória'};

function windows(stats) {
    if (!stats)
        return 'n/a';
    return [stats.avg10, stats.avg60, stats.avg300]
        .map(v => formatPercent(v ?? 0))
        .join('  ·  ');
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
            this._proc = Gio.Subprocess.new([
                'nvidia-smi',
                `--query-gpu=${GPU_QUERY}`,
                '--format=csv,noheader,nounits',
                '-l', String(REFRESH_SECONDS),
            ], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (_e) {
            this._proc = null; // nvidia-smi not installed
            this._onUpdate(null);
            return;
        }

        this._stream = new Gio.DataInputStream({base_stream: this._proc.get_stdout_pipe()});
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
                if (line === null) { // process exited
                    this._onUpdate(null);
                    return;
                }
                this._onUpdate(parseGpuLine(line));
                this._readLine();
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    this._onUpdate(null);
            }
        });
    }
}

const PsiIndicator = GObject.registerClass(
class PsiIndicator extends PanelMenu.Button {
    _init(uuid) {
        super._init(0.0, uuid, false);

        this._box = new St.BoxLayout({
            style_class: 'psi-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pills = {};
        for (const resource of RESOURCES)
            this._pills[resource] = this._addPill(`${SHORT[resource]}: …`);
        this._gpuPill = this._addPill('GPU: …');
        this._gpuPill.add_style_class_name('psi-gpu');
        this.add_child(this._box);

        this._addHeader('% do tempo parado esperando  (10s  ·  60s  ·  5min)');
        this._rows = {};
        for (const resource of RESOURCES) {
            this._rows[resource] = new PopupMenu.PopupMenuItem('', {reactive: false});
            this.menu.addMenuItem(this._rows[resource]);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addHeader('Discos  (ocupação e velocidade, por disco)');
        this._disksRow = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._disksRow);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addHeader('GPU  (uso atual, não é pressão)');
        this._gpuRow = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._gpuRow);
    }

    _addPill(text) {
        const pill = new St.Label({
            text,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'psi-pill',
        });
        this._box.add_child(pill);
        return pill;
    }

    _addHeader(text) {
        const header = new PopupMenu.PopupMenuItem(text, {reactive: false});
        header.label.add_style_class_name('psi-header');
        this.menu.addMenuItem(header);
    }

    update(snapshot) {
        for (const resource of RESOURCES) {
            // The number is what you expect to read (usage); the color is the
            // kernel's pressure verdict (green/yellow/red), see `_describe`.
            const pressure = snapshot.psi[resource]?.some?.avg10;
            const usage = this._usage(resource, snapshot);
            const pill = this._pills[resource];

            this._setLevel(pill, pressure === undefined ? null : levelFor(pressure));
            pill.set_text(`${SHORT[resource]}: ${usage === null ? '…' : formatPercent(usage, 1)}`);
            this._rows[resource].label.set_text(this._describe(resource, snapshot));
        }
        this._disksRow.label.set_text(this._describeDisks(snapshot.disks));
    }

    // The value shown inside each pill: how much of the resource is in use.
    _usage(resource, {cpuUsage, mem, disks}) {
        if (resource === 'cpu')
            return cpuUsage;
        if (resource === 'memory')
            return mem ? (100 * mem.usedMiB) / mem.totalMiB : null;

        const busy = disks.map(d => d.rates?.busyPercent).filter(v => v !== undefined);
        return busy.length > 0 ? Math.max(...busy) : null;
    }

    _describe(resource, snapshot) {
        const {psi, instant, cores, cpuUsage, mem, disks} = snapshot;
        const data = psi[resource];
        const titles = {
            io: 'Disco (I/O)  ·  número = disco mais ocupado',
            cpu: `CPU  ·  número = uso, ${cores} núcleos`,
            memory: 'Memória  ·  número = RAM em uso',
        };
        if (!data)
            return `${titles[resource]}: n/a`;

        const now = instant[resource];
        const lines = [
            titles[resource],
            '  cor = pressão (tempo parado esperando):',
            `  some  ${windows(data.some)}`,
            `  full   ${windows(data.full)}`,
            `  agora (${REFRESH_SECONDS}s): ${now === null ? 'medindo…' : formatPercent(now, 3)}`,
        ];

        if (resource === 'io') {
            const busiest = disks.filter(d => d.rates).sort((a, b) => b.rates.busyPercent - a.rates.busyPercent)[0];
            if (busiest)
                lines.push(`  mais ocupado: ${busiest.name} (${formatPercent(busiest.rates.busyPercent, 1)})`);
        }

        if (resource === 'cpu' && cpuUsage !== null)
            lines.push(`  uso: ${formatPercent(cpuUsage, 1)} de ${cores} núcleos`);

        if (resource === 'memory' && mem) {
            const usedPercent = (100 * mem.usedMiB) / mem.totalMiB;
            lines.push(`  RAM em uso: ${formatMiB(mem.usedMiB)} de ${formatMiB(mem.totalMiB)} (${formatPercent(usedPercent, 0)})`);
            lines.push(`  swap: ${formatMiB(mem.swapUsedMiB)} de ${formatMiB(mem.swapTotalMiB)}`);
        }
        return lines.join('\n');
    }

    _describeDisks(disks) {
        if (disks.length === 0)
            return 'nenhum disco encontrado';

        return disks.map(disk => {
            const where = disk.mounts.length > 0 ? disk.mounts.join(', ') : 'não montado';
            const speed = disk.rates
                ? `ocupado ${formatPercent(disk.rates.busyPercent, 1)}  ·  lê ${disk.rates.readMBs.toFixed(1)} MB/s  ·  escreve ${disk.rates.writeMBs.toFixed(1)} MB/s`
                : 'medindo…';
            return `${disk.name}  ·  ${disk.model}  ·  ${disk.sizeGiB} GiB\n  montado em: ${where}\n  ${speed}`;
        }).join('\n');
    }

    updateGpu(gpu) {
        if (!gpu) {
            this._gpuPill.set_text('GPU: n/a');
            this._gpuRow.label.set_text('nvidia-smi indisponível');
            return;
        }
        this._gpuPill.set_text(`GPU: ${Math.round(gpu.util)}%`);
        this._gpuRow.label.set_text(
            `Uso ${Math.round(gpu.util)}%  ·  VRAM ${formatMiB(gpu.memUsedMiB)} / ${formatMiB(gpu.memTotalMiB)}  ·  ${Math.round(gpu.tempC)}°C`);
    }

    _setLevel(pill, level) {
        for (const name of LEVELS)
            pill.remove_style_class_name(`psi-${name}`);
        if (level)
            pill.add_style_class_name(`psi-${level}`);
    }
});

export default class PsiMonitorExtension extends Extension {
    enable() {
        this._indicator = new PsiIndicator(this.uuid);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._sampler = new SystemSampler();
        this._refresh();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });

        this._gpu = new GpuMonitor(gpu => this._indicator?.updateGpu(gpu));
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
        this._indicator?.destroy();
        this._indicator = null;
    }

    _refresh() {
        this._indicator?.update(this._sampler.sample());
    }
}
