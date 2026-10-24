import { Emitter } from '../../lib/emitter.js';

/**
 * Number of undo steps kept by default (`DESIGN.md` §1).
 * @type {number}
 */
export const HISTORY_LIMIT = 200;

/**
 * Undoable user operation. `run` validates its preconditions, throws before mutating when they fail,
 * and mutates the model only through the transaction.
 * @typedef {object} Command
 * @property {string} label Name shown for the undo step.
 * @property {(tx: Transaction) => *} run Applies the operation; its return value is returned by `execute`.
 */

/**
 * Mutation interface handed to `Command.run`. Each call is applied immediately, so `run` reads its own writes.
 * @typedef {object} Transaction
 * @property {import('../model/model.js').Model} model Model to read from.
 * @property {(uid: number, path: string, value: *) => void} set Sets a prop at a dotted path; `undefined` removes it.
 * @property {(parentUid: number, collection: string, index: number|undefined, snapshot: import('../model/model.js').NodeSnapshot) => number} add
 *   Inserts a subtree (appends when `index` is `undefined`) and returns the uid of its top node.
 * @property {(uid: number) => void} remove Removes a node and its subtree.
 * @property {(uid: number, parentUid: number, collection: string, index: number|undefined) => void} move
 *   Moves a node to another slot (appends when `index` is `undefined`).
 */

/**
 * Snapshot of the command stack, emitted with the `history` event.
 * @typedef {object} HistoryState
 * @property {boolean} canUndo An undo step exists, or an open gesture has changes.
 * @property {boolean} canRedo A redo step exists and no gesture is open.
 * @property {string|null} undoLabel Label of what undo would act on.
 * @property {string|null} redoLabel Label of what redo would act on.
 * @property {boolean} dirty The model differs from the saved state.
 * @property {boolean} gesture A gesture is open.
 */

function jsonEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
}

function inverseOf(op) {
  switch (op.op) {
    case 'set':
      return { op: 'set', uid: op.uid, path: op.path, value: op.previous };
    case 'add':
      return { op: 'remove', uid: op.snapshot.uid };
    case 'remove':
      return { op: 'add', snapshot: op.snapshot, parent: op.parent, collection: op.collection, index: op.index };
    default:
      return { op: 'move', uid: op.uid, to: op.from };
  }
}

function inversesOf(ops) {
  return ops.map(inverseOf).reverse();
}

function snapshotContains(snapshot, uid) {
  if (snapshot.uid === uid) return true;
  return Object.values(snapshot.children ?? {}).some((list) => list.some((child) => snapshotContains(child, uid)));
}

function pathsOverlap(a, b) {
  return a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

function mergeTarget(ops, op) {
  for (let index = ops.length - 1; index >= 0; index--) {
    const other = ops[index];
    if (other.op === 'set' && other.uid === op.uid) {
      if (other.path === op.path) return index;
      if (pathsOverlap(other.path, op.path)) return -1;
    } else if ((other.op === 'add' || other.op === 'remove') && snapshotContains(other.snapshot, op.uid)) {
      return -1;
    }
  }
  return -1;
}

function isNetNoop(ops) {
  return ops.every((op) => op.op === 'set' && jsonEqual(op.previous, op.value));
}

function sameState(a, b) {
  return Object.keys(a).every((key) => a[key] === b[key]);
}

/**
 * Command stack with transactions, gestures and a saved point. The only caller of `model.applyOps` and
 * `model.batch`. Clears itself on the model's `reset` event. Emits `history` with a {@link HistoryState}.
 */
export class History {
  #model;
  #limit;
  #emitter = new Emitter();
  #undo = [];
  #redo = [];
  #base = {};
  #saved = this.#base;
  #gesture = null;
  #busy = false;
  #applied = false;
  #generation = 0;
  #finalize = null;
  #last;

  /**
   * Creates an empty history for a model and subscribes to its `change` and `reset` events.
   * @param {import('../model/model.js').Model} model Document model.
   * @param {{ limit?: number, finalize?: ((tx: Transaction, ops: ReadonlyArray<object>) => void)|null }} [options]
   *   `limit`: maximum number of undo steps (positive integer). `finalize`: runs at the end of every new undo step,
   *   with the step's applied operations, and writes through `tx` into the same step: after a command executed
   *   outside a gesture (in its batch), and when a gesture with changes ends (in a batch of its own). Never on undo,
   *   redo, cancelled gestures or commands inside a gesture.
   * @throws {RangeError} When `limit` is not a positive integer.
   * @throws {TypeError} When `finalize` is given and is not a function.
   */
  constructor(model, { limit = HISTORY_LIMIT, finalize = null } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`History limit must be a positive integer, got ${limit}`);
    if (finalize !== null && typeof finalize !== 'function') throw new TypeError('finalize must be a function');
    this.#model = model;
    this.#limit = limit;
    this.#finalize = finalize;
    model.on('change', () => {
      this.#applied = true;
    });
    model.on('reset', ({ cause }) => this.#onReset(cause));
    this.#last = this.#computeState();
  }

  /**
   * Current state.
   * @returns {Readonly<HistoryState>}
   */
  get state() {
    return this.#computeState();
  }

  /**
   * Whether undo would act.
   * @returns {boolean}
   */
  get canUndo() {
    return this.#computeState().canUndo;
  }

  /**
   * Whether redo would act.
   * @returns {boolean}
   */
  get canRedo() {
    return this.#computeState().canRedo;
  }

  /**
   * Whether the model differs from the saved state.
   * @returns {boolean}
   */
  get dirty() {
    return this.#computeState().dirty;
  }

  /**
   * Whether a gesture is open.
   * @returns {boolean}
   */
  get inGesture() {
    return this.#gesture !== null;
  }

  /**
   * Runs a command inside one model batch (one `change` event) and records it as an undo step, or appends
   * it to the open gesture. An execution without effective changes records nothing.
   * @param {Command} command Command to run.
   * @returns {*} The value returned by `command.run`.
   * @throws {Error} When another history call is in progress, the command is malformed or `run` throws (the
   *   model is reverted and nothing is recorded); a model listener error is rethrown after recording.
   */
  execute(command) {
    this.#enter();
    let listenerError = null;
    let result;
    try {
      if (typeof command?.run !== 'function' || typeof command.label !== 'string') {
        throw new TypeError('A command needs a string label and a run function');
      }
      const kept = [];
      const tx = this.#transaction(kept);
      let returned = false;
      const generation = this.#generation;
      this.#applied = false;
      try {
        this.#model.batch(() => {
          result = command.run(tx.api);
          if (this.#finalize !== null && this.#gesture === null && kept.length > 0) this.#finalize(tx.api, [...kept]);
          returned = true;
        });
      } catch (error) {
        if (!returned) throw error;
        listenerError = { error };
      } finally {
        tx.close();
      }
      if (this.#applied && generation === this.#generation) this.#record(command.label, kept);
    } finally {
      this.#busy = false;
    }
    this.#publish(listenerError);
    return result;
  }

  /**
   * Undoes the top step, or only cancels the open gesture when there is one.
   * @returns {boolean} `false` when there was nothing to undo or cancel.
   * @throws {Error} When another history call is in progress; a model listener error is rethrown after the stacks are updated.
   */
  undo() {
    this.#enter();
    let listenerError = null;
    let acted = false;
    try {
      if (this.#gesture) {
        listenerError = this.#cancelOpenGesture();
        acted = true;
      } else if (this.#undo.length > 0) {
        const entry = this.#undo.at(-1);
        const generation = this.#generation;
        listenerError = this.#applyRecorded(inversesOf(entry.ops), 'undo');
        if (generation === this.#generation) this.#redo.push(this.#undo.pop());
        acted = true;
      }
    } finally {
      this.#busy = false;
    }
    this.#publish(listenerError);
    return acted;
  }

  /**
   * Re-applies the top redo step without running its command again, so ids and uids are identical.
   * Does nothing while a gesture is open.
   * @returns {boolean} `false` when there was nothing to redo or a gesture is open.
   * @throws {Error} When another history call is in progress; a model listener error is rethrown after the stacks are updated.
   */
  redo() {
    this.#enter();
    let listenerError = null;
    let acted = false;
    try {
      if (!this.#gesture && this.#redo.length > 0) {
        const entry = this.#redo.at(-1);
        const generation = this.#generation;
        listenerError = this.#applyRecorded(entry.ops, 'redo');
        if (generation === this.#generation) this.#undo.push(this.#redo.pop());
        acted = true;
      }
    } finally {
      this.#busy = false;
    }
    this.#publish(listenerError);
    return acted;
  }

  /**
   * Opens a gesture: commands executed until it ends become one undo step.
   * @returns {void}
   * @throws {Error} When a gesture is already open or another history call is in progress.
   */
  beginGesture() {
    this.#enter();
    try {
      if (this.#gesture) throw new Error('A gesture is already open');
      this.#gesture = { label: null, ops: [] };
    } finally {
      this.#busy = false;
    }
    this.#publish(null);
  }

  /**
   * Closes the open gesture and records it as one undo step, unless it is empty or only sets values back
   * to where they were.
   * @returns {boolean} `true` when a step was recorded; `false` otherwise or when no gesture is open.
   * @throws {Error} When a gesture is open and another history call is in progress.
   */
  endGesture() {
    if (!this.#gesture) return false;
    this.#enter();
    let recorded = false;
    let failure = null;
    try {
      const pending = this.#gesture;
      this.#gesture = null;
      if (!isNetNoop(pending.ops)) {
        failure = this.#finalizeGesture(pending.ops);
        this.#push(pending);
        recorded = true;
      }
    } finally {
      this.#busy = false;
    }
    this.#publish(failure);
    return recorded;
  }

  /**
   * Reverts the open gesture (cause `cancel`) and records nothing.
   * @returns {boolean} `true` when a gesture was open.
   * @throws {Error} When a gesture is open and another history call is in progress; a model listener error is
   *   rethrown after the gesture is closed.
   */
  cancelGesture() {
    if (!this.#gesture) return false;
    this.#enter();
    let listenerError = null;
    try {
      listenerError = this.#cancelOpenGesture();
    } finally {
      this.#busy = false;
    }
    this.#publish(listenerError);
    return true;
  }

  /**
   * Marks the current state as saved, so `dirty` is `false` until it changes.
   * @returns {void}
   * @throws {Error} When another history call is in progress.
   */
  markSaved() {
    this.#enter();
    this.#saved = this.#currentToken();
    this.#busy = false;
    this.#publish(null);
  }

  /**
   * Marks the current state as unsaved, so `dirty` is `true` until a later `markSaved` or reset. Used when loading
   * changed the document after reading it.
   * @returns {void}
   * @throws {Error} When another history call is in progress.
   */
  markUnsaved() {
    this.#enter();
    this.#saved = null;
    this.#busy = false;
    this.#publish(null);
  }

  /**
   * Subscribes to `history` events.
   * @param {'history'} type Event type.
   * @param {(state: Readonly<HistoryState>) => void} fn Listener.
   * @returns {() => void} Function that unsubscribes the listener.
   */
  on(type, fn) {
    return this.#emitter.on(type, fn);
  }

  /**
   * Unsubscribes a listener.
   * @param {'history'} type Event type.
   * @param {(state: Readonly<HistoryState>) => void} fn Listener.
   * @returns {void}
   */
  off(type, fn) {
    this.#emitter.off(type, fn);
  }

  #enter() {
    if (this.#busy) throw new Error('Another history call is in progress');
    this.#busy = true;
  }

  #transaction(kept) {
    let open = true;
    const model = this.#model;
    const apply = (op) => {
      if (!open) throw new Error('The transaction is closed');
      const [applied] = model.applyOps([op]);
      kept.push(applied);
      return applied;
    };
    const api = Object.freeze({
      model,
      set(uid, path, value) {
        apply({ op: 'set', uid, path, value });
      },
      add(parentUid, collection, index, snapshot) {
        return apply({ op: 'add', snapshot, parent: parentUid, collection, index }).snapshot.uid;
      },
      remove(uid) {
        apply({ op: 'remove', uid });
      },
      move(uid, parentUid, collection, index) {
        apply({ op: 'move', uid, to: { parent: parentUid, collection, index } });
      },
    });
    return {
      api,
      close() {
        open = false;
      },
    };
  }

  #applyRecorded(ops, cause) {
    if (ops.length === 0) return null;
    this.#applied = false;
    try {
      this.#model.applyOps(ops, cause);
      return null;
    } catch (error) {
      if (!this.#applied) throw error;
      return { error };
    }
  }

  #finalizeGesture(ops) {
    if (this.#finalize === null) return null;
    const added = [];
    const tx = this.#transaction(added);
    let returned = false;
    let failure = null;
    try {
      this.#model.batch(() => {
        this.#finalize(tx.api, [...ops]);
        returned = true;
      });
    } catch (error) {
      failure = { error };
      if (!returned) added.length = 0;
    } finally {
      tx.close();
    }
    for (const op of added) this.#mergeInto(ops, op);
    return failure;
  }

  #cancelOpenGesture() {
    const pending = this.#gesture;
    this.#gesture = null;
    try {
      return this.#applyRecorded(inversesOf(pending.ops), 'cancel');
    } catch (error) {
      this.#gesture = pending;
      throw error;
    }
  }

  #record(label, ops) {
    if (this.#gesture) {
      if (this.#gesture.label === null) this.#gesture.label = label;
      for (const op of ops) this.#mergeInto(this.#gesture.ops, op);
    } else {
      this.#push({ label, ops });
    }
  }

  #mergeInto(ops, op) {
    const index = op.op === 'set' ? mergeTarget(ops, op) : -1;
    if (index >= 0) ops[index] = Object.freeze({ ...ops[index], value: op.value });
    else ops.push(op);
  }

  #push(entry) {
    this.#undo.push(Object.freeze({ label: entry.label, ops: Object.freeze([...entry.ops]) }));
    this.#redo = [];
    while (this.#undo.length > this.#limit) this.#base = this.#undo.shift();
    if (this.#saved !== null && this.#saved !== this.#base && !this.#undo.includes(this.#saved)) this.#saved = null;
  }

  #currentToken() {
    return this.#undo.at(-1) ?? this.#base;
  }

  #gestureHasChanges() {
    return this.#gesture !== null && !isNetNoop(this.#gesture.ops);
  }

  #computeState() {
    const gestureChanges = this.#gestureHasChanges();
    const gesture = this.#gesture !== null;
    return Object.freeze({
      canUndo: this.#undo.length > 0 || gestureChanges,
      canRedo: this.#redo.length > 0 && !gesture,
      undoLabel: gestureChanges ? this.#gesture.label : (this.#undo.at(-1)?.label ?? null),
      redoLabel: gesture ? null : (this.#redo.at(-1)?.label ?? null),
      dirty: gestureChanges || this.#currentToken() !== this.#saved,
      gesture,
    });
  }

  #onReset(cause) {
    this.#generation++;
    this.#gesture = null;
    this.#undo = [];
    this.#redo = [];
    this.#base = {};
    this.#saved = cause === 'recover' ? null : this.#base;
    this.#publish(null);
  }

  #publish(failure) {
    const state = this.#computeState();
    let emitFailure = null;
    if (!sameState(state, this.#last)) {
      this.#last = state;
      try {
        this.#emitter.emit('history', state);
      } catch (error) {
        emitFailure = { error };
      }
    }
    if (failure) throw failure.error;
    if (emitFailure) throw emitFailure.error;
  }
}
