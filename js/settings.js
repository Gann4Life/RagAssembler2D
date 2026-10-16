import { Emitter } from '../lib/emitter.js';

/**
 * @typedef {'grid.visible'|'grid.size'|'grid.subdivisions'|'snap.grid'|'display.mode'
 *   |'overlay.names'|'overlay.centers'|'overlay.contacts'|'gizmo.pivot'} SettingKey
 */

/** Version of the stored settings record. */
export const SETTINGS_VERSION = 1;

/**
 * Editor settings: type, default and range per key. `grid.size` is in meters; `gizmo.pivot` is the Select tool's
 * pivot mode for several objects (`'center'` or `'last'` selected).
 * @type {Readonly<Record<SettingKey, Readonly<{ type: 'boolean'|'number'|'integer'|'enum', default: *, min?: number, max?: number, enum?: ReadonlyArray<string>, unit?: string }>>>}
 */
export const SETTING_SPECS = Object.freeze({
  'grid.visible': Object.freeze({ type: 'boolean', default: true }),
  'grid.size': Object.freeze({ type: 'number', default: 1, min: 0.01, max: 100, unit: 'm' }),
  'grid.subdivisions': Object.freeze({ type: 'integer', default: 10, min: 1, max: 20 }),
  'snap.grid': Object.freeze({ type: 'boolean', default: false }),
  'display.mode': Object.freeze({ type: 'enum', default: 'both', enum: Object.freeze(['shapes', 'sprites', 'both']) }),
  'overlay.names': Object.freeze({ type: 'boolean', default: false }),
  'overlay.centers': Object.freeze({ type: 'boolean', default: false }),
  'overlay.contacts': Object.freeze({ type: 'boolean', default: false }),
  'gizmo.pivot': Object.freeze({ type: 'enum', default: 'center', enum: Object.freeze(['center', 'last']) }),
});

const KEYS = Object.keys(SETTING_SPECS);

function requireSpec(key) {
  if (!Object.hasOwn(SETTING_SPECS, key)) throw new Error(`Unknown setting "${key}"`);
  return SETTING_SPECS[key];
}

function problemOf(spec, value) {
  switch (spec.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be a boolean';
    case 'enum':
      return spec.enum.includes(value) ? null : `must be one of ${spec.enum.join(', ')}`;
    default: {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a finite number';
      if (spec.type === 'integer' && !Number.isInteger(value)) return 'must be an integer';
      if (value < spec.min || value > spec.max) return `must be within ${spec.min}–${spec.max}`;
      return null;
    }
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readStored(record, key) {
  const [group, name] = key.split('.');
  const section = record[group];
  if (!isPlainObject(section) || !Object.hasOwn(section, name)) return { missing: true };
  return { value: section[name] };
}

/**
 * Editor settings store, per browser and not undoable. Emits `settings` with `{ key, value, previous }`
 * when a value changes. Has no storage access.
 */
export class Settings {
  #values = new Map(KEYS.map((key) => [key, SETTING_SPECS[key].default]));
  #emitter = new Emitter();

  /**
   * Reads a setting.
   * @param {SettingKey} key Setting key.
   * @returns {*} Current value.
   * @throws {Error} When the key is unknown.
   */
  get(key) {
    requireSpec(key);
    return this.#values.get(key);
  }

  /**
   * Changes a setting and emits `settings` when the value differs from the current one.
   * @param {SettingKey} key Setting key.
   * @param {*} value New value, valid for the key's spec.
   * @returns {void}
   * @throws {Error} When the key is unknown.
   * @throws {RangeError} When the value is invalid for the key.
   */
  set(key, value) {
    const problem = problemOf(requireSpec(key), value);
    if (problem) throw new RangeError(`Setting "${key}" ${problem}, got ${JSON.stringify(value)}`);
    const previous = this.#values.get(key);
    if (Object.is(previous, value)) return;
    this.#values.set(key, value);
    this.#emitter.emit('settings', Object.freeze({ key, value, previous }));
  }

  /**
   * Builds the record to store: `{ version, grid: { visible, size, subdivisions }, snap: { grid }, display: { mode },
   * overlay: { names, centers, contacts }, gizmo: { pivot } }`.
   * @returns {object} Plain JSON record.
   */
  toJSON() {
    const record = { version: SETTINGS_VERSION };
    for (const key of KEYS) {
      const [group, name] = key.split('.');
      record[group] ??= {};
      record[group][name] = this.#values.get(key);
    }
    return record;
  }

  /**
   * Subscribes to `settings`.
   * @param {'settings'} type Event type.
   * @param {(payload: { key: SettingKey, value: *, previous: * }) => void} fn Listener.
   * @returns {() => void} Function that unsubscribes the listener.
   */
  on(type, fn) {
    return this.#emitter.on(type, fn);
  }

  /**
   * Unsubscribes a listener.
   * @param {'settings'} type Event type.
   * @param {(payload: { key: SettingKey, value: *, previous: * }) => void} fn Listener.
   * @returns {void}
   */
  off(type, fn) {
    this.#emitter.off(type, fn);
  }

  /**
   * Builds settings from a stored record, field by field. A missing field takes its default; an invalid one
   * takes its default with a warning. A record that is not an object or has another version is ignored with a
   * warning. `undefined` gives the defaults without warnings. Emits nothing.
   * @param {unknown} record Stored record, as returned by `toJSON`.
   * @returns {{ settings: Settings, warnings: string[] }} Restored settings and warning messages.
   */
  static restore(record) {
    const settings = new Settings();
    const warnings = [];
    if (record === undefined) return { settings, warnings };
    if (!isPlainObject(record)) {
      warnings.push('Stored settings ignored: not an object');
      return { settings, warnings };
    }
    if (record.version !== SETTINGS_VERSION) {
      warnings.push(`Stored settings ignored: unsupported version ${JSON.stringify(record.version)}`);
      return { settings, warnings };
    }
    for (const key of KEYS) {
      const stored = readStored(record, key);
      if (stored.missing) continue;
      const problem = problemOf(SETTING_SPECS[key], stored.value);
      if (problem) warnings.push(`Stored setting "${key}" ignored: ${problem}`);
      else settings.#values.set(key, stored.value);
    }
    return { settings, warnings };
  }
}
