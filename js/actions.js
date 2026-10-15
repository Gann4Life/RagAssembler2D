/**
 * Action identifier shared by the header, hotkeys and menus, e.g. `undo`, `panel:inspector`, `reset-layout`.
 * @typedef {string} ActionId
 */

/**
 * @typedef {object} ActionSpec
 * @property {() => void} run Performs the action.
 * @property {() => boolean} [isEnabled] Whether the action can run now; defaults to always.
 * @property {() => (string|null)} [reason] Why the action is disabled, or `null` when only state disables it.
 * @property {boolean} [repeatable] Whether a held hotkey repeats the action.
 */

const NOT_BUILT = 'not available yet';

/**
 * Registry of the editor actions. Unregistered actions are disabled with the reason `'not available yet'`.
 */
export class ActionRegistry {
  #specs = new Map();

  /**
   * Registers an action.
   * @param {ActionId} id Action id.
   * @param {ActionSpec} spec Action behavior.
   * @returns {void}
   * @throws {Error} When the id is already registered, empty, or the spec has no `run` function.
   */
  register(id, spec) {
    if (typeof id !== 'string' || id === '') throw new TypeError('An action id must be a non-empty string');
    if (typeof spec?.run !== 'function') throw new TypeError(`Action "${id}" needs a run function`);
    if (this.#specs.has(id)) throw new Error(`Action "${id}" is already registered`);
    this.#specs.set(id, Object.freeze({ ...spec }));
  }

  /**
   * Whether an action is registered.
   * @param {ActionId} id Action id.
   * @returns {boolean}
   */
  has(id) {
    return this.#specs.has(id);
  }

  /**
   * Whether an action is registered and enabled.
   * @param {ActionId} id Action id.
   * @returns {boolean}
   */
  isEnabled(id) {
    const spec = this.#specs.get(id);
    if (!spec) return false;
    return spec.isEnabled ? Boolean(spec.isEnabled()) : true;
  }

  /**
   * Why an action is disabled: `'not available yet'` when unregistered, the spec's reason while disabled,
   * else `null`.
   * @param {ActionId} id Action id.
   * @returns {string|null}
   */
  reason(id) {
    const spec = this.#specs.get(id);
    if (!spec) return NOT_BUILT;
    if (this.isEnabled(id)) return null;
    return spec.reason ? (spec.reason() ?? null) : null;
  }

  /**
   * Whether a held hotkey repeats the action; `false` when unregistered.
   * @param {ActionId} id Action id.
   * @returns {boolean}
   */
  isRepeatable(id) {
    return this.#specs.get(id)?.repeatable === true;
  }

  /**
   * Runs a registered, enabled action.
   * @param {ActionId} id Action id.
   * @returns {boolean} Whether the action ran.
   */
  run(id) {
    if (!this.isEnabled(id)) return false;
    this.#specs.get(id).run();
    return true;
  }
}
