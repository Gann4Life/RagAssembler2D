/**
 * Action identifier shared by the header, hotkeys and menus, e.g. `undo`, `panel:inspector`, `reset-layout`.
 * @typedef {string} ActionId
 */

/**
 * @typedef {object} ActionSpec
 * @property {() => void} run Performs the action.
 * @property {() => boolean} [isEnabled] Whether the action can run now; defaults to always.
 * @property {() => (string|null)} [reason] Why the action is disabled, or `null` to give no reason (a drag, scrub or
 *   confirmation in progress).
 * @property {boolean} [repeatable] Whether a held hotkey repeats the action.
 */

const NOT_BUILT = 'not available yet';

/**
 * Registry of the editor actions. Unregistered actions are disabled with the reason `'not available yet'`.
 */
export class ActionRegistry {
  #specs = new Map();
  #refused;
  #quiet;

  /**
   * @param {{ refused?: ((text: string) => void)|null, quiet?: () => boolean }} [options] `refused` receives
   *   "*Label*: *reason*" when a labelled run is refused with a reason (the status line); `quiet` silences it while
   *   it returns `true` (a drag, scrub or confirmation in progress).
   * @throws {TypeError} When `refused` is neither `null` nor a function, or `quiet` is not a function.
   */
  constructor({ refused = null, quiet = () => false } = {}) {
    if (refused !== null && typeof refused !== 'function') throw new TypeError('refused must be a function');
    if (typeof quiet !== 'function') throw new TypeError('quiet must be a function');
    this.#refused = refused;
    this.#quiet = quiet;
  }

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
   * Runs a registered, enabled action. A disabled one changes nothing; given a `label` and a reason, it reports
   * "*Label*: *reason*" through the `refused` option unless `quiet` holds.
   * @param {ActionId} id Action id.
   * @param {{ label?: string|null }} [options] Label of the control or hotkey that asked, for the report.
   * @returns {boolean} Whether the action ran.
   */
  run(id, { label = null } = {}) {
    if (!this.isEnabled(id)) {
      this.#report(id, label);
      return false;
    }
    this.#specs.get(id).run();
    return true;
  }

  #report(id, label) {
    if (this.#refused === null || typeof label !== 'string' || label === '' || this.#quiet()) return;
    const reason = this.reason(id);
    if (reason !== null) this.#refused(`${label}: ${reason}`);
  }
}
