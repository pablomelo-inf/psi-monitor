// Pure helpers for NVIDIA GPU stats from `nvidia-smi --query-gpu=... --format=csv,noheader,nounits`.
// No GNOME imports, so this is unit-tested with plain Node (`make test`).

export const GPU_QUERY = [
    'utilization.gpu',
    'utilization.memory',
    'memory.used',
    'memory.total',
    'temperature.gpu',
].join(',');

/**
 * Parse one CSV line, e.g. "32, 25, 1052, 12288, 60".
 *
 * @param {string} line
 * @returns {{util: number, memUtil: number, memUsedMiB: number, memTotalMiB: number, tempC: number}|null}
 *   null for malformed lines or "[N/A]" fields.
 */
export function parseGpuLine(line) {
    const parts = line.split(',').map(part => Number(part.trim()));
    if (parts.length !== 5 || parts.some(n => !Number.isFinite(n)))
        return null;

    const [util, memUtil, memUsedMiB, memTotalMiB, tempC] = parts;
    return {util, memUtil, memUsedMiB, memTotalMiB, tempC};
}

/** @param {number} mib */
export function formatMiB(mib) {
    return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GiB` : `${Math.round(mib)} MiB`;
}
