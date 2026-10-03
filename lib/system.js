// Pure parsers for system counters (/proc/meminfo, /proc/stat, /proc/diskstats,
// /proc/mounts). No GNOME imports, so they are unit-tested with plain Node.

// Whole disks only (skip partitions, loop, dm-*, sr*).
const WHOLE_DISK = /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/;

/**
 * @param {string} text contents of /proc/meminfo
 * @returns {{totalMiB: number, usedMiB: number, swapTotalMiB: number, swapUsedMiB: number}|null}
 */
export function parseMeminfo(text) {
    const kib = {};
    for (const line of text.split('\n')) {
        const match = line.match(/^(\w+):\s+(\d+)/);
        if (match)
            kib[match[1]] = Number(match[2]);
    }
    if (kib.MemTotal === undefined || kib.MemAvailable === undefined)
        return null;

    const swapTotal = kib.SwapTotal ?? 0;
    const swapFree = kib.SwapFree ?? 0;
    return {
        totalMiB: kib.MemTotal / 1024,
        usedMiB: (kib.MemTotal - kib.MemAvailable) / 1024,
        swapTotalMiB: swapTotal / 1024,
        swapUsedMiB: (swapTotal - swapFree) / 1024,
    };
}

/**
 * Aggregate CPU counters from the first line of /proc/stat.
 * "busy" excludes idle and iowait.
 *
 * @param {string} text
 * @returns {{busy: number, total: number}|null}
 */
export function parseCpuStat(text) {
    const line = text.split('\n').find(l => l.startsWith('cpu '));
    if (!line)
        return null;

    // user nice system idle iowait irq softirq steal
    const fields = line.trim().split(/\s+/).slice(1, 9).map(Number);
    if (fields.length < 5 || fields.some(n => !Number.isFinite(n)))
        return null;

    const idle = fields[3] + fields[4];
    const total = fields.reduce((sum, n) => sum + n, 0);
    return {busy: total - idle, total};
}

/**
 * @param {{busy: number, total: number}|null} prev
 * @param {{busy: number, total: number}|null} cur
 * @returns {number|null} CPU usage in percent between the two samples
 */
export function cpuUsagePercent(prev, cur) {
    if (!prev || !cur)
        return null;
    const total = cur.total - prev.total;
    if (total <= 0)
        return null;
    return Math.max(0, Math.min(100, (100 * (cur.busy - prev.busy)) / total));
}

/**
 * @param {string} text contents of /proc/diskstats
 * @returns {Object<string, {sectorsRead: number, sectorsWritten: number, ioTicksMs: number}>}
 */
export function parseDiskstats(text) {
    const disks = {};
    for (const line of text.split('\n')) {
        const f = line.trim().split(/\s+/);
        if (f.length < 14 || !WHOLE_DISK.test(f[2]))
            continue;
        disks[f[2]] = {
            sectorsRead: Number(f[5]),
            sectorsWritten: Number(f[9]),
            ioTicksMs: Number(f[12]),
        };
    }
    return disks;
}

/**
 * Busy time and throughput of one disk between two samples.
 *
 * @returns {{busyPercent: number, readMBs: number, writeMBs: number}|null}
 */
export function diskRates(prev, cur, dtMs) {
    if (!prev || !cur || !(dtMs > 0))
        return null;

    const seconds = dtMs / 1000;
    const perSecond = (a, b) => Math.max(0, ((b - a) * 512) / 1e6 / seconds);
    return {
        busyPercent: Math.max(0, Math.min(100, (100 * (cur.ioTicksMs - prev.ioTicksMs)) / dtMs)),
        readMBs: perSecond(prev.sectorsRead, cur.sectorsRead),
        writeMBs: perSecond(prev.sectorsWritten, cur.sectorsWritten),
    };
}

/**
 * "/dev/sda6" -> "sda", "/dev/nvme0n1p2" -> "nvme0n1". Anything else
 * (device-mapper, loop, tmpfs...) -> null.
 */
export function diskOfDevice(source) {
    const match = source.match(/^\/dev\/((?:sd|vd|xvd)[a-z]+)\d+$/) ??
        source.match(/^\/dev\/(nvme\d+n\d+)p\d+$/) ??
        source.match(/^\/dev\/(mmcblk\d+)p\d+$/);
    return match ? match[1] : null;
}

/**
 * @param {string} text contents of /proc/mounts
 * @returns {Object<string, string[]>} disk name -> mount points
 */
export function mountsByDisk(text) {
    const result = {};
    for (const line of text.split('\n')) {
        const [source, target] = line.split(' ');
        const disk = source ? diskOfDevice(source) : null;
        if (!disk || !target)
            continue;
        const mounts = (result[disk] ??= []);
        if (!mounts.includes(target))
            mounts.push(target);
    }
    return result;
}
