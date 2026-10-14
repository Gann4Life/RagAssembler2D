/**
 * Synchronous event emitter. Listeners run in subscription order with one payload argument.
 */
export class Emitter {
  #listeners = new Map();

  /**
   * Subscribes a listener. A function is registered at most once per type.
   * @param {string} type Event type.
   * @param {(payload: *) => void} fn Listener.
   * @returns {() => void} Function that unsubscribes the listener.
   * @throws {TypeError} When `fn` is not a function.
   */
  on(type, fn) {
    if (typeof fn !== 'function') throw new TypeError(`Listener for "${type}" must be a function`);
    let list = this.#listeners.get(type);
    if (!list) {
      list = [];
      this.#listeners.set(type, list);
    }
    if (!list.includes(fn)) list.push(fn);
    return () => this.off(type, fn);
  }

  /**
   * Unsubscribes a listener. Does nothing when it is not registered.
   * @param {string} type Event type.
   * @param {(payload: *) => void} fn Listener.
   * @returns {void}
   */
  off(type, fn) {
    const list = this.#listeners.get(type);
    if (!list) return;
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
    if (list.length === 0) this.#listeners.delete(type);
  }

  /**
   * Calls every listener of `type` with `payload`, over a copy of the listener list.
   * Every listener runs even if one throws.
   * @param {string} type Event type.
   * @param {*} [payload] Value passed to each listener.
   * @returns {void}
   * @throws {*} The first error thrown by a listener, after the last listener ran.
   */
  emit(type, payload) {
    const list = this.#listeners.get(type);
    if (!list) return;
    let failed = false;
    let firstError;
    for (const fn of [...list]) {
      try {
        fn(payload);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
    if (failed) throw firstError;
  }

  /**
   * Removes every listener of every type.
   * @returns {void}
   */
  clear() {
    this.#listeners.clear();
  }
}
