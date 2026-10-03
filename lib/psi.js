// Pure helpers for Linux PSI (/proc/pressure/*). No GNOME imports, so this
// module can be unit-tested with plain Node (`make test`).

export const RESOURCES = ['io', 'cpu', 'memory'];

export const DEFAULT_THRESHOLDS = {warn: 5, crit: 20};

/**
 * Parse the content of /proc/pressure/<resource>.
 *
 * Example input:
 *   some avg10=0.00 avg60=0.00 avg300=0.12 total=158597974
 *   full avg10=0.00 avg60=0.00 avg300=0.11 total=146872772
 *
 * @param {string} text
 * @returns {{some: object, full: object|null}|null} null if no "some" line.
 */
export function parsePressure(text) {
    const result = {some: null, full: null};

    for (const line of text.split('\n')) {
        const match = line.trim().match(/^(some|full)\s+(.+)$/);
        if (!match)
            continue;

        const fields = {};
        for (const pair of match[2].split(/\s+/)) {
            const [key, value] = pair.split('=');
            const number = Number(value);
            if (key && Number.isFinite(number))
                fields[key] = number;
        }
        result[match[1]] = fields;
    }

    return result.some ? result : null;
}

/**
 * Map a pressure percentage to a severity level.
 *
 * @param {number} percent
 * @param {{warn: number, crit: number}} [thresholds]
 * @returns {'ok'|'warn'|'crit'}
 */
export function levelFor(percent, thresholds = DEFAULT_THRESHOLDS) {
    if (percent >= thresholds.crit)
        return 'crit';
    if (percent >= thresholds.warn)
        return 'warn';
    return 'ok';
}

/**
 * The kernel only exposes 2 decimals in avgNN, so finer values come from
 * `instantPercent` below.
 *
 * @param {number} percent
 * @param {number} [digits]
 */
export function formatPercent(percent, digits = 2) {
    return `${percent.toFixed(digits)}%`;
}

/**
 * Stall percentage over the interval between two reads of the cumulative
 * `total` counter (microseconds spent stalled).
 *
 * @param {number|undefined} prevTotalUs
 * @param {number|undefined} curTotalUs
 * @param {number} elapsedUs wall-clock microseconds between the two reads
 * @returns {number|null}
 */
export function instantPercent(prevTotalUs, curTotalUs, elapsedUs) {
    if (!Number.isFinite(prevTotalUs) || !Number.isFinite(curTotalUs) || !(elapsedUs > 0))
        return null;
    return Math.max(0, Math.min(100, (100 * (curTotalUs - prevTotalUs)) / elapsedUs));
}
