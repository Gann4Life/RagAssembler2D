const LAYOUT_KEY = 'ragassembler.layout';

/**
 * Reads the stored dock layout. Never validates its content.
 * @returns {{ value: unknown } | { error: 'missing' | 'unavailable' | 'parse' }}
 */
export function loadLayout() {
  let raw;
  try {
    raw = globalThis.localStorage.getItem(LAYOUT_KEY);
  } catch {
    return { error: 'unavailable' };
  }
  if (raw === null) return { error: 'missing' };
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return { error: 'parse' };
  }
}

/**
 * Stores the dock layout as JSON.
 * @param {object} layout
 * @returns {boolean} `false` when storage is unavailable or full.
 */
export function saveLayout(layout) {
  try {
    globalThis.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

/**
 * Forgets the stored dock layout. Silent when storage is unavailable.
 * @returns {void}
 */
export function clearLayout() {
  try {
    globalThis.localStorage.removeItem(LAYOUT_KEY);
  } catch {
    return;
  }
}
