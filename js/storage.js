const LAYOUT_KEY = 'ragassembler.layout';
const SETTINGS_KEY = 'ragassembler.settings';

function load(key) {
  let raw;
  try {
    raw = globalThis.localStorage.getItem(key);
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

function save(key, value) {
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the stored dock layout. Never validates its content.
 * @returns {{ value: unknown } | { error: 'missing' | 'unavailable' | 'parse' }}
 */
export function loadLayout() {
  return load(LAYOUT_KEY);
}

/**
 * Stores the dock layout as JSON.
 * @param {object} layout
 * @returns {boolean} `false` when storage is unavailable or full.
 */
export function saveLayout(layout) {
  return save(LAYOUT_KEY, layout);
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

/**
 * Reads the stored editor settings record. Never validates its content.
 * @returns {{ value: unknown } | { error: 'missing' | 'unavailable' | 'parse' }}
 */
export function loadSettings() {
  return load(SETTINGS_KEY);
}

/**
 * Stores the editor settings record as JSON.
 * @param {object} record Record from `Settings#toJSON`.
 * @returns {boolean} `false` when storage is unavailable or full.
 */
export function saveSettings(record) {
  return save(SETTINGS_KEY, record);
}
