// Which badges the top bar shows. Pure logic, no GNOME imports, so it is
// unit-tested with plain Node (`make test`).

// [key, title], left to right in the top bar.
export const BADGES = [
    ['io', 'Disk'],
    ['cpu', 'CPU'],
    ['memory', 'Memory'],
    ['gpu', 'GPU'],
    ['wifi', 'Wi-Fi'],
    ['ethernet', 'Ethernet'],
];

// At least one of these stays visible: the "Show in top bar" options live in
// the badge menus, so with none left there would be no way to bring the others
// back. The remaining badges depend on hardware that may be absent.
const ALWAYS_AVAILABLE = ['io', 'cpu', 'memory'];

const KEYS = BADGES.map(([key]) => key);

/**
 * Clean up the stored list: known keys only, no duplicates, and never every
 * always-available badge hidden at once (in that case they are shown again).
 *
 * @param {string[]} stored
 * @returns {string[]}
 */
export function sanitizeHidden(stored) {
    const hidden = [...new Set(stored)].filter((key) => KEYS.includes(key));
    const allGone = ALWAYS_AVAILABLE.every((key) => hidden.includes(key));
    return allGone ? hidden.filter((key) => !ALWAYS_AVAILABLE.includes(key)) : hidden;
}

/** @param {string[]} hidden @param {string} key */
export function isShown(hidden, key) {
    return !hidden.includes(key);
}

/**
 * Whether the user may hide this badge right now.
 *
 * @param {string[]} hidden
 * @param {string} key
 */
export function canHide(hidden, key) {
    if (!ALWAYS_AVAILABLE.includes(key)) return true;
    return ALWAYS_AVAILABLE.some((other) => other !== key && !hidden.includes(other));
}

/**
 * The hidden list after showing or hiding one badge. Hiding is ignored when it
 * would leave no always-available badge visible.
 *
 * @param {string[]} hidden
 * @param {string} key
 * @param {boolean} shown
 * @returns {string[]}
 */
export function setShown(hidden, key, shown) {
    if (shown) return hidden.filter((other) => other !== key);
    if (hidden.includes(key) || !canHide(hidden, key)) return hidden;
    return [...hidden, key];
}
