import GLib from 'gi://GLib';

import { KINDS, classifyInterface, parseWireless, ratePerSecond } from './network.js';
import { RESOURCES, instantPercent, parsePressure } from './psi.js';
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

// The set of network interfaces rarely changes and the Wi-Fi signal moves
// slowly, so they are refreshed every few samples (1 sample = 2 s). Reading
// /proc/net/wireless is the costliest read of all: the kernel asks the driver.
const INTERFACE_SCAN_EVERY = 10;
const SIGNAL_READ_EVERY = 5;

function readNumber(path) {
    const text = readText(path);
    return text === null ? NaN : parseInt(text, 10);
}

// Reads PSI, CPU, memory, per-disk and per-network-interface counters and turns
// consecutive reads into rates. Holds the previous sample; the first call has
// no rates yet.
export class SystemSampler {
    constructor() {
        this._prev = null;
        this._diskInfo = new Map();
        this._interfaceKinds = new Map();
        this._physical = [];
        this._signals = {};
        this._netCounters = {};
        this._samples = 0;
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
                ? instantPercent(
                      prev.psi[resource]?.some?.total,
                      psi[resource]?.some?.total,
                      elapsedUs,
                  )
                : null;
        }

        const cpu = parseCpuStat(readText('/proc/stat') ?? '');
        const diskstats = parseDiskstats(readText('/proc/diskstats') ?? '');
        const mounts = mountsByDisk(readText('/proc/mounts') ?? '');

        const disks = Object.keys(diskstats)
            .sort()
            .map((name) => ({
                name,
                ...this._info(name),
                mounts: mounts[name] ?? [],
                rates: prev
                    ? diskRates(prev.diskstats[name], diskstats[name], elapsedUs / 1000)
                    : null,
            }));

        const net = this._networkInterfaces(elapsedUs / 1e6);

        this._prev = { time, psi, cpu, diskstats };

        return {
            psi,
            instant,
            cores: this._cores,
            cpuUsage: prev ? cpuUsagePercent(prev.cpu, cpu) : null,
            mem: parseMeminfo(readText('/proc/meminfo') ?? ''),
            disks,
            net,
        };
    }

    // Physical Wi-Fi and Ethernet interfaces only: Docker bridges, veth pairs
    // and VPNs would count the same traffic twice. Counters come straight from
    // /sys/class/net/<name>/statistics, so only these interfaces are read.
    _networkInterfaces(elapsedSeconds) {
        if (this._samples % INTERFACE_SCAN_EVERY === 0) this._physical = this._scanInterfaces();
        if (
            this._samples % SIGNAL_READ_EVERY === 0 &&
            this._physical.some((i) => i.kind === 'wifi')
        )
            this._signals = parseWireless(readText('/proc/net/wireless') ?? '');
        this._samples++;

        const counters = {};
        const interfaces = [];
        for (const { name, kind } of this._physical) {
            const base = `/sys/class/net/${name}`;
            const rxBytes = readNumber(`${base}/statistics/rx_bytes`);
            const txBytes = readNumber(`${base}/statistics/tx_bytes`);
            if (Number.isNaN(rxBytes) || Number.isNaN(txBytes)) continue; // just unplugged

            const before = this._netCounters[name];
            counters[name] = { rxBytes, txBytes };
            interfaces.push({
                name,
                kind,
                state: (readText(`${base}/operstate`) ?? '').trim() || 'unknown',
                speedMbps: kind === 'ethernet' ? this._linkSpeed(name) : null,
                signal: this._signals[name] ?? null,
                rxRate: ratePerSecond(before?.rxBytes, rxBytes, elapsedSeconds),
                txRate: ratePerSecond(before?.txBytes, txBytes, elapsedSeconds),
            });
        }
        this._netCounters = counters;
        return interfaces;
    }

    _scanInterfaces() {
        let dir;
        try {
            dir = GLib.Dir.open('/sys/class/net', 0);
        } catch (_e) {
            return [];
        }

        const found = [];
        let name;
        while ((name = dir.read_name()) !== null) {
            const kind = this._kindOf(name);
            if (KINDS.includes(kind)) found.push({ name, kind });
        }
        dir.close();
        return found.sort((a, b) => a.name.localeCompare(b.name));
    }

    _kindOf(name) {
        if (!this._interfaceKinds.has(name)) {
            const base = `/sys/class/net/${name}`;
            let linkTarget = '';
            try {
                linkTarget = GLib.file_read_link(base);
            } catch (_e) {
                // keep it empty: the interface is then treated as non-virtual
            }
            const wireless =
                GLib.file_test(`${base}/wireless`, GLib.FileTest.IS_DIR) ||
                GLib.file_test(`${base}/phy80211`, GLib.FileTest.IS_DIR);
            this._interfaceKinds.set(name, classifyInterface({ name, linkTarget, wireless }));
        }
        return this._interfaceKinds.get(name);
    }

    // Negotiated link speed in Mb/s; the kernel reports -1 or fails when the
    // link is down.
    _linkSpeed(name) {
        const speed = Number((readText(`/sys/class/net/${name}/speed`) ?? '').trim());
        return speed > 0 ? speed : null;
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
