import { Emitter } from '../../lib/emitter.js';

/**
 * @typedef {object} SelectionState
 * @property {ReadonlyArray<number>} objects Selected root, sprite asset, body, shape, joint and clip uids, in selection order.
 * @property {ReadonlyArray<number>} timeline Selected key and event uids, in selection order.
 * @property {'objects'|'timeline'} focus List shown by the inspector.
 */

const LIST_OF_TYPE = Object.freeze({
  root: 'objects',
  spriteAsset: 'objects',
  body: 'objects',
  shape: 'objects',
  joint: 'objects',
  clip: 'objects',
  key: 'timeline',
  event: 'timeline',
});

const EMPTY = Object.freeze([]);

/**
 * Editor selection: two uid lists and the focused list. Not undoable. Prunes removed nodes on model `change`
 * and clears on `reset`. Emits `selection` with a {@link SelectionState} once per call that changed it.
 */
export class Selection {
  #model;
  #emitter = new Emitter();
  #lists = { objects: EMPTY, timeline: EMPTY };
  #focus = 'objects';

  /**
   * Creates an empty selection and subscribes to the model's `change` and `reset` events.
   * @param {import('./model.js').Model} model Document model.
   */
  constructor(model) {
    this.#model = model;
    model.on('change', ({ changes }) => {
      const removed = new Set(changes.filter((change) => change.kind === 'remove').map((change) => change.uid));
      if (removed.size === 0) return;
      this.#update(
        {
          objects: this.#lists.objects.filter((uid) => !removed.has(uid)),
          timeline: this.#lists.timeline.filter((uid) => !removed.has(uid)),
        },
        this.#focus,
      );
    });
    model.on('reset', () => this.#update({ objects: EMPTY, timeline: EMPTY }, 'objects'));
  }

  /**
   * Selected object uids.
   * @returns {ReadonlyArray<number>}
   */
  get objects() {
    return this.#lists.objects;
  }

  /**
   * Selected key and event uids.
   * @returns {ReadonlyArray<number>}
   */
  get timeline() {
    return this.#lists.timeline;
  }

  /**
   * List shown by the inspector.
   * @returns {'objects'|'timeline'}
   */
  get focus() {
    return this.#focus;
  }

  /**
   * Current state.
   * @returns {Readonly<SelectionState>}
   */
  get state() {
    return Object.freeze({ objects: this.#lists.objects, timeline: this.#lists.timeline, focus: this.#focus });
  }

  /**
   * Replaces the list the uids belong to and focuses it. An empty array clears both lists, like `clear`.
   * @param {number[]} uids Uids of one list.
   * @returns {void}
   * @throws {Error} When a uid is unknown, of a type that cannot be selected, or the uids mix both lists.
   */
  set(uids) {
    const list = this.#listOf(uids);
    if (list === null) {
      this.clear();
      return;
    }
    this.#update({ ...this.#lists, [list]: Object.freeze([...new Set(uids)]) }, list);
  }

  /**
   * Appends uids to their list, skipping those already selected, and focuses it. An empty array does nothing.
   * @param {number[]} uids Uids of one list.
   * @returns {void}
   * @throws {Error} When a uid is unknown, of a type that cannot be selected, or the uids mix both lists.
   */
  add(uids) {
    const list = this.#listOf(uids);
    if (list === null) return;
    this.#update({ ...this.#lists, [list]: Object.freeze([...new Set([...this.#lists[list], ...uids])]) }, list);
  }

  /**
   * Removes uids from both lists; focus does not move. Uids that are not selected are ignored.
   * @param {number[]} uids Uids to deselect.
   * @returns {void}
   */
  remove(uids) {
    const drop = new Set(uids);
    this.#update(
      {
        objects: this.#lists.objects.filter((uid) => !drop.has(uid)),
        timeline: this.#lists.timeline.filter((uid) => !drop.has(uid)),
      },
      this.#focus,
    );
  }

  /**
   * Adds the uid to its list, or removes it when selected, and focuses that list.
   * @param {number} uid Uid to toggle.
   * @returns {void}
   * @throws {Error} When the uid is unknown or of a type that cannot be selected.
   */
  toggle(uid) {
    const list = this.#listOf([uid]);
    const current = this.#lists[list];
    const next = current.includes(uid) ? current.filter((item) => item !== uid) : [...current, uid];
    this.#update({ ...this.#lists, [list]: Object.freeze(next) }, list);
  }

  /**
   * Empties both lists; focus does not move.
   * @returns {void}
   */
  clear() {
    this.#update({ objects: EMPTY, timeline: EMPTY }, this.#focus);
  }

  /**
   * Whether a uid is selected in either list.
   * @param {number} uid Node uid.
   * @returns {boolean}
   */
  has(uid) {
    return this.#lists.objects.includes(uid) || this.#lists.timeline.includes(uid);
  }

  /**
   * Subscribes to `selection` events.
   * @param {'selection'} type Event type.
   * @param {(state: Readonly<SelectionState>) => void} fn Listener.
   * @returns {() => void} Function that unsubscribes the listener.
   */
  on(type, fn) {
    return this.#emitter.on(type, fn);
  }

  /**
   * Unsubscribes a listener.
   * @param {'selection'} type Event type.
   * @param {(state: Readonly<SelectionState>) => void} fn Listener.
   * @returns {void}
   */
  off(type, fn) {
    this.#emitter.off(type, fn);
  }

  #listOf(uids) {
    if (!Array.isArray(uids)) throw new TypeError('Selection expects an array of uids');
    let list = null;
    for (const uid of uids) {
      const node = this.#model.get(uid);
      if (!node) throw new Error(`Unknown node uid ${uid}`);
      const nodeList = LIST_OF_TYPE[node.type];
      if (!nodeList) throw new Error(`A ${node.type} cannot be selected`);
      if (list !== null && list !== nodeList) throw new Error('A selection call cannot mix objects and timeline items');
      list = nodeList;
    }
    return list;
  }

  #update(lists, focus) {
    const objects = sameList(lists.objects, this.#lists.objects) ? this.#lists.objects : Object.freeze([...lists.objects]);
    const timeline = sameList(lists.timeline, this.#lists.timeline) ? this.#lists.timeline : Object.freeze([...lists.timeline]);
    const changed = objects !== this.#lists.objects || timeline !== this.#lists.timeline || focus !== this.#focus;
    if (!changed) return;
    this.#lists = { objects, timeline };
    this.#focus = focus;
    this.#emitter.emit('selection', this.state);
  }
}

function sameList(a, b) {
  return a.length === b.length && a.every((uid, index) => uid === b[index]);
}
