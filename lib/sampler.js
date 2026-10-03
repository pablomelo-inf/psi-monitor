import GLib from 'gi://GLib';

import {RESOURCES, instantPercent, parsePressure} from './psi.js';
import {
    cpuUsagePercent,
    diskRates,
    mountsByDisk,
    parseCpuStat,
    parseDiskstats,
    parseMeminfo,
} from './system.js';

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : null;
    } catch (_e) {
        return null; // file missing or not readable
    }
}

// Reads PSI, CPU, memory and per-disk counters and turns consecutive reads
// into rates. Holds the previous sample; the first call has no rates yet.
export class SystemSampler {
    constructor() {
        this._prev = null;
        this._diskInfo = new Map();
        this._cores = GLib.get_num_processors();
    }

    sample() {
        const time = GLib.get_monotonic_time(); // microseconds
        const prev = this._prev;
        const elapsedUs = prev ? time - prev.time : 0;

        const psi = {};
        const instant = {};
        for (const resource of RESOURCES) {
            const text = readText(`/proc/pressure/${resource}`);
            psi[resource] = text ? parsePressure(text) : null;
            instant[resource] = prev
                ? instantPercent(prev.psi[resource]?.some?.total, psi[resource]?.some?.total, elapsedUs)
                : null;
        }

        const cpu = parseCpuStat(readText('/proc/stat') ?? '');
        const diskstats = parseDiskstats(readText('/proc/diskstats') ?? '');
        const mounts = mountsByDisk(readText('/proc/mounts') ?? '');

        const disks = Object.keys(diskstats).sort().map(name => ({
            name,
            ...this._info(name),
            mounts: mounts[name] ?? [],
            rates: prev ? diskRates(prev.diskstats[name], diskstats[name], elapsedUs / 1000) : null,
        }));

        this._prev = {time, psi, cpu, diskstats};

        return {
            psi,
            instant,
            cores: this._cores,
            cpuUsage: prev ? cpuUsagePercent(prev.cpu, cpu) : null,
            mem: parseMeminfo(readText('/proc/meminfo') ?? ''),
            disks,
        };
    }

    _info(name) {
        if (!this._diskInfo.has(name)) {
            const model = (readText(`/sys/block/${name}/device/model`) ?? '').trim();
            const sectors = Number((readText(`/sys/block/${name}/size`) ?? '0').trim());
            this._diskInfo.set(name, {
                model: model || 'disk',
                sizeGiB: Math.round((sectors * 512) / 1073741824),
            });
        }
        return this._diskInfo.get(name);
    }
}
