// Pure helpers for network interfaces (/proc/net/wireless, /sys/class/net). No GNOME imports, so they are
// unit-tested with plain Node (`make test`).

export const KINDS = ['wifi', 'ethernet'];

/**
 * Signal info of wireless interfaces from /proc/net/wireless.
 *
 * @param {string} text contents of /proc/net/wireless
 * @returns {Object<string, {quality: number, levelDbm: number}>}
 */
export function parseWireless(text) {
    const interfaces = {};
    for (const line of text.split('\n')) {
        const match = line.match(/^\s*([^:\s]+):\s+\S+\s+(-?\d+)\.?\s+(-?\d+)\.?\s/);
        if (!match) continue;

        let levelDbm = Number(match[3]);
        // Some drivers print the level as an unsigned byte (e.g. 193 = -63 dBm).
        if (levelDbm > 0) levelDbm -= 256;
        interfaces[match[1]] = { quality: Number(match[2]), levelDbm };
    }
    return interfaces;
}

/**
 * Decide what an interface is, from what the kernel exposes about it.
 * Virtual interfaces (Docker bridges, veth pairs, VPNs...) live under
 * /sys/devices/virtual/ and must not be counted.
 *
 * @param {{name: string, linkTarget?: string, wireless?: boolean}} info
 *   `linkTarget` is what the /sys/class/net/<name> symlink points to.
 * @returns {'wifi'|'ethernet'|'virtual'|'loopback'}
 */
export function classifyInterface({ name, linkTarget = '', wireless = false }) {
    if (name === 'lo') return 'loopback';
    if (linkTarget.includes('/virtual/')) return 'virtual';
    return wireless ? 'wifi' : 'ethernet';
}

/**
 * Whether /sys/class/net/<name>/operstate means the link is usable.
 * "unknown" is reported by some drivers that do not track the state.
 *
 * @param {string} state
 */
export function isLinkUp(state) {
    return state === 'up' || state === 'unknown';
}

/**
 * Names of the interfaces that have an IPv4 route, from /proc/net/route.
 *
 * An interface turned off from the desktop's network menu keeps its physical
 * link up while the cable is plugged in, and the kernel can even keep stale
 * IPv6 addresses on it. The IPv4 routes do disappear, so they tell whether an
 * interface is really in use. Link-local routes (169.254.0.0/16, what an
 * interface gets when DHCP fails) do not count.
 *
 * @param {string} text contents of /proc/net/route
 * @returns {Set<string>}
 */
export function interfacesWithIpv4(text) {
    const names = new Set();
    for (const line of text.split('\n').slice(1)) {
        // Iface Destination Gateway Flags RefCnt Use Metric Mask ...
        const fields = line.trim().split(/\s+/);
        if (fields.length < 8) continue;

        const linkLocal =
            fields[1].toUpperCase() === '0000FEA9' && fields[7].toUpperCase() === '0000FFFF';
        if (!linkLocal) names.add(fields[0]);
    }
    return names;
}

/**
 * Whether an interface is in use: its link is up and it has an IPv4 route.
 *
 * @param {string} state contents of /sys/class/net/<name>/operstate
 * @param {boolean|null} [hasIpv4] null when the routes could not be read, in
 *   which case only the link state is used
 */
export function isConnected(state, hasIpv4 = null) {
    return isLinkUp(state) && (hasIpv4 ?? true);
}

/**
 * Bytes per second between two counter readings.
 *
 * @param {number|undefined} prevBytes
 * @param {number|undefined} curBytes
 * @param {number} elapsedSeconds
 * @returns {number|null} null when there is no usable previous reading. A
 *   counter that went backwards (reset, wrap-around) counts as 0.
 */
export function ratePerSecond(prevBytes, curBytes, elapsedSeconds) {
    if (!Number.isFinite(prevBytes) || !Number.isFinite(curBytes) || !(elapsedSeconds > 0))
        return null;
    return Math.max(0, (curBytes - prevBytes) / elapsedSeconds);
}

/**
 * Human readable rate in decimal units (1 KB = 1000 B), as network tools do.
 *
 * @param {number} bytesPerSecond
 */
export function formatRate(bytesPerSecond) {
    const b = bytesPerSecond;
    if (b < 1000) return `${Math.round(b)} B/s`;
    if (b < 1e6) {
        const kb = b / 1e3;
        return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB/s`;
    }
    if (b < 1e9) return `${(b / 1e6).toFixed(1)} MB/s`;
    return `${(b / 1e9).toFixed(2)} GB/s`;
}

/**
 * Combine every interface of one kind into the numbers a single badge shows.
 *
 * @param {Array<{connected: boolean, rxRate: number|null, txRate: number|null}>} group
 * @returns {{up: boolean, rxRate: number|null, txRate: number|null}}
 *   Rates cover only the connected interfaces; null until a rate exists.
 */
export function summarize(group) {
    const active = group.filter((item) => item.connected);
    if (active.length === 0) return { up: false, rxRate: null, txRate: null };

    const total = (key) =>
        active.some((item) => item[key] === null)
            ? null
            : active.reduce((sum, item) => sum + item[key], 0);
    return { up: true, rxRate: total('rxRate'), txRate: total('txRate') };
}
