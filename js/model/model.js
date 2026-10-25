import { Emitter } from '../../lib/emitter.js';
import { defaultsOf } from '../../lib/schema.js';

/**
 * @typedef {'root'|'spriteAsset'|'body'|'shape'|'joint'|'clip'|'track'|'key'|'event'} NodeType
 */

/**
 * @typedef {object} Node
 * @property {number} uid Session identity, never serialized or reused.
 * @property {NodeType} type Node type.
 * @property {number|null} parent Parent uid, `null` for the root.
 * @property {string|null} collection Collection of the parent holding the node, `null` for the root.
 * @property {Readonly<object>} props Frozen file record fields, in meters, radians and Y up.
 */

/**
 * @typedef {object} NodeSnapshot
 * @property {number} [uid] Session identity; assigned by the model when absent.
 * @property {NodeType} type Node type.
 * @property {object} props File record fields without child collections.
 * @property {Object<string, NodeSnapshot[]>} [children] Child snapshots per collection.
 */

/**
 * @typedef {{ kind: 'add', uid: number, type: NodeType, parent: number, collection: string, index: number }
 *   | { kind: 'remove', uid: number, type: NodeType, parent: number, collection: string, index: number }
 *   | { kind: 'set', uid: number, type: NodeType, path: string, value: *, previous: * }
 *   | { kind: 'move', uid: number, type: NodeType,
 *       from: { parent: number, collection: string, index: number },
 *       to: { parent: number, collection: string, index: number } }} Change
 */

/**
 * Primitive operation. Inputs may leave out the fields the model derives (`previous`, `index`,
 * remove `snapshot`/`parent`/`collection`, move `from`, snapshot uids); `applyOps` returns them filled.
 * @typedef {{ op: 'set', uid: number, path: string, value: *, previous?: * }
 *   | { op: 'add', snapshot: NodeSnapshot, parent: number, collection: string, index?: number }
 *   | { op: 'remove', uid?: number, snapshot?: NodeSnapshot, parent?: number, collection?: string, index?: number }
 *   | { op: 'move', uid: number, from?: { parent: number, collection: string, index: number },
 *       to: { parent: number, collection: string, index?: number } }} Op
 */

/** Uid of the root node. */
export const ROOT_UID = 1;

const COLLECTIONS = Object.freeze({
  root: Object.freeze({ sprites: 'spriteAsset', bodies: 'body', joints: 'joint', clips: 'clip' }),
  spriteAsset: Object.freeze({}),
  body: Object.freeze({ fixtures: 'shape' }),
  shape: Object.freeze({}),
  joint: Object.freeze({}),
  clip: Object.freeze({ tracks: 'track', events: 'event' }),
  track: Object.freeze({ keys: 'key' }),
  key: Object.freeze({}),
  event: Object.freeze({}),
});

const ID_PREFIXES = new Set(['b', 'f', 'j', 's']);
const GENERATED_ID = /^([bfjs])_(\d+)$/;
const CHANGE_CAUSES = new Set(['do', 'undo', 'redo', 'cancel']);
const RESET_CAUSES = new Set(['new', 'load', 'recover']);

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function frozenCopy(value) {
  return value === undefined ? undefined : deepFreeze(structuredClone(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
}

function splitPath(path) {
  if (typeof path !== 'string' || path === '') throw new Error('Property path must be a non-empty string');
  const segments = path.split('.');
  if (segments.includes('')) throw new Error(`Invalid property path "${path}"`);
  return segments;
}

function readPath(props, segments) {
  let value = props;
  for (const segment of segments) {
    if (!isPlainObject(value) || !Object.hasOwn(value, segment)) return undefined;
    value = value[segment];
  }
  return value;
}

function writePath(props, segments, value, path) {
  const [head, ...rest] = segments;
  const copy = { ...props };
  if (rest.length === 0) {
    if (value === undefined) delete copy[head];
    else copy[head] = value;
  } else {
    const inner = Object.hasOwn(props, head) ? props[head] : {};
    if (!isPlainObject(inner)) throw new Error(`Cannot set "${path}": "${head}" is not an object`);
    copy[head] = writePath(inner, rest, value, path);
  }
  return Object.freeze(copy);
}

function defaultRootProps() {
  const { meta, units, preview } = defaultsOf('document');
  return { ...defaultsOf('root'), meta, units, preview };
}

/**
 * The empty document: a root with schema defaults and no children.
 * @returns {NodeSnapshot} A new root snapshot per call.
 */
export function emptyRootSnapshot() {
  return { type: 'root', props: defaultRootProps() };
}

function checkSlotIndex(index, length, label) {
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new RangeError(`${label} index ${index} is outside 0..${length}`);
  }
}

/**
 * Editor document model: a tree of nodes in file units, mutated only through
 * `applyOps` (history) and `reset` (model I/O). Emits `change` and `reset`.
 */
export class Model {
  #nodes = new Map();
  #ids = new Map();
  #idCounters = new Map();
  #nextUid = ROOT_UID + 1;
  #emitter = new Emitter();
  #openBatch = null;
  #revision = 0;

  /**
   * Counter that grows before every `change` and `reset` event; unchanged by operations without effective changes.
   * @returns {number}
   */
  get revision() {
    return this.#revision;
  }

  /**
   * Creates a model holding a new, empty document with schema defaults.
   */
  constructor() {
    this.#install(this.#buildTree(emptyRootSnapshot(), null, null, 'root'));
  }

  /**
   * Returns a node.
   * @param {number} uid Node uid.
   * @returns {Readonly<Node>|null} Frozen node, or `null` when no node has this uid.
   */
  get(uid) {
    const record = this.#nodes.get(uid);
    if (!record) return null;
    const { type, parent, collection, props } = record;
    return Object.freeze({ uid, type, parent, collection, props });
  }

  /**
   * Reads a prop value.
   * @param {number} uid Node uid.
   * @param {string} path Dotted path, e.g. `limits.upper`.
   * @returns {*} Frozen value, or `undefined` when the path does not exist.
   * @throws {Error} When the uid is unknown or the path is invalid.
   */
  prop(uid, path) {
    return readPath(this.#require(uid).props, splitPath(path));
  }

  /**
   * Lists the child uids of a collection, in order.
   * @param {number} uid Parent uid.
   * @param {string} collection Collection name, e.g. `bodies`.
   * @returns {ReadonlyArray<number>} Frozen uid list.
   * @throws {Error} When the uid is unknown or the node type has no such collection.
   */
  children(uid, collection) {
    const record = this.#require(uid);
    const list = record.children[collection];
    if (!list) throw new Error(`A ${record.type} has no "${collection}" collection`);
    return list;
  }

  /**
   * Maps a file id (`root`, `b_…`, `f_…`, `j_…`, `s_…`) to the uid of the node that holds it.
   * @param {string} id File id.
   * @returns {number|null} Uid of the first node with this id, or `null`.
   */
  uidOf(id) {
    return this.#ids.get(id)?.[0] ?? null;
  }

  /**
   * Finds a clip by its `key`.
   * @param {string} key Clip key.
   * @returns {number|null} Clip uid, or `null`.
   */
  clipByKey(key) {
    return this.children(ROOT_UID, 'clips').find((uid) => this.#nodes.get(uid).props.key === key) ?? null;
  }

  /**
   * Allocates a new file id `<prefix>_<n>`, with `n` above every id of that prefix seen in the session.
   * @param {'b'|'f'|'j'|'s'} prefix Kind prefix: body, shape (fixture), joint or sprite asset.
   * @returns {string} New id, never returned before in this session.
   * @throws {Error} When the prefix is not one of `b`, `f`, `j`, `s`.
   */
  nextId(prefix) {
    if (!ID_PREFIXES.has(prefix)) throw new Error(`Unknown id prefix "${prefix}"`);
    const n = (this.#idCounters.get(prefix) ?? 0) + 1;
    this.#idCounters.set(prefix, n);
    return `${prefix}_${n}`;
  }

  /**
   * Subscribes to `change` (`{ changes, cause }`) or `reset` (`{ cause }`).
   * @param {'change'|'reset'} type Event type.
   * @param {(payload: object) => void} fn Listener.
   * @returns {() => void} Function that unsubscribes the listener.
   */
  on(type, fn) {
    return this.#emitter.on(type, fn);
  }

  /**
   * Unsubscribes a listener.
   * @param {'change'|'reset'} type Event type.
   * @param {(payload: object) => void} fn Listener.
   * @returns {void}
   */
  off(type, fn) {
    this.#emitter.off(type, fn);
  }

  /**
   * Applies a batch of operations atomically and emits one `change` event with the effective changes.
   * If an operation throws, the batch is reverted, nothing is emitted and the error is rethrown.
   * Reserved for `js/commands/history.js`.
   * @param {Op[]} ops Operations, applied in order.
   * @param {'do'|'undo'|'redo'|'cancel'} [cause] Reported in the `change` event.
   * @returns {ReadonlyArray<Op>} The applied operations with every derived field filled.
   * @throws {Error} When an operation is invalid; listener errors are rethrown after the batch is applied.
   */
  applyOps(ops, cause = 'do') {
    if (!CHANGE_CAUSES.has(cause)) throw new Error(`Unknown change cause "${cause}"`);
    if (!Array.isArray(ops)) throw new TypeError('applyOps expects an array of operations');
    if (this.#openBatch && cause !== 'do') throw new Error('Only the "do" cause is allowed inside a batch');
    const applied = [];
    const changes = [];
    try {
      for (const op of ops) applied.push(this.#apply(op, changes));
    } catch (error) {
      this.#revert(applied);
      throw error;
    }
    if (this.#openBatch) {
      this.#openBatch.ops.push(...applied);
      this.#openBatch.changes.push(...changes);
    } else if (changes.length > 0) {
      this.#revision += 1;
      this.#emitter.emit('change', Object.freeze({ changes: Object.freeze(changes), cause }));
    }
    return Object.freeze(applied);
  }

  /**
   * Runs `fn` with change emission deferred, then emits one `change` (cause `do`) with every effective change.
   * If `fn` throws, every operation applied inside is reverted in reverse order, nothing is emitted and
   * the error is rethrown. Reserved for `js/commands/history.js`.
   * @param {() => void} fn Callback that calls `applyOps` with cause `do`.
   * @returns {Readonly<{ ops: ReadonlyArray<Op>, changes: ReadonlyArray<Change> }>} Applied operations and effective changes.
   * @throws {Error} When a batch is already open or `fn` throws; listener errors are rethrown after the batch is applied.
   */
  batch(fn) {
    if (this.#openBatch) throw new Error('Batches cannot be nested');
    const open = { ops: [], changes: [] };
    this.#openBatch = open;
    try {
      fn();
    } catch (error) {
      try {
        this.#revert(open.ops);
      } finally {
        this.#openBatch = null;
      }
      throw error;
    }
    this.#openBatch = null;
    const result = Object.freeze({ ops: Object.freeze(open.ops), changes: Object.freeze(open.changes) });
    if (result.changes.length > 0) {
      this.#revision += 1;
      this.#emitter.emit('change', Object.freeze({ changes: result.changes, cause: 'do' }));
    }
    return result;
  }

  #revert(applied) {
    for (const op of [...applied].reverse()) this.#apply(this.#inverse(op), []);
  }

  /**
   * Replaces the whole document and emits `reset`. Every node but the root gets a fresh uid.
   * Reserved for `js/model/io.js`.
   * @param {NodeSnapshot} snapshot Root snapshot.
   * @param {'new'|'load'|'recover'} [cause] Reported in the `reset` event.
   * @returns {void}
   * @throws {Error} When the snapshot is not a valid root tree; the model is left unchanged.
   */
  reset(snapshot, cause = 'new') {
    if (this.#openBatch) throw new Error('Cannot reset inside a batch');
    if (!RESET_CAUSES.has(cause)) throw new Error(`Unknown reset cause "${cause}"`);
    if (snapshot?.type !== 'root') throw new Error('reset expects a root snapshot');
    const records = this.#buildTree(snapshot, null, null, 'root');
    this.#nodes.clear();
    this.#ids.clear();
    this.#install(records);
    this.#revision += 1;
    this.#emitter.emit('reset',Object.freeze({ cause }));
  }

  #require(uid) {
    const record = this.#nodes.get(uid);
    if (!record) throw new Error(`Unknown node uid ${uid}`);
    return record;
  }

  #allocateUid() {
    return this.#nextUid++;
  }

  #build(snapshot, parent, collection, mode, out, claimed) {
    if (!isPlainObject(snapshot) || !Object.hasOwn(COLLECTIONS, snapshot.type)) {
      throw new Error(`Invalid node snapshot type "${snapshot?.type}"`);
    }
    const props = frozenCopy(snapshot.props ?? {});
    if (!isPlainObject(props)) throw new Error('Node props must be an object');
    for (const name of Object.keys(COLLECTIONS[snapshot.type])) {
      if (Object.hasOwn(props, name)) throw new Error(`A ${snapshot.type} cannot hold "${name}" in props`);
    }
    const uid = mode === 'root' ? ROOT_UID : this.#snapshotUid(snapshot, mode, claimed);
    const record = { uid, type: snapshot.type, parent, collection, props, children: {} };
    out.push(record);
    const collections = COLLECTIONS[snapshot.type];
    const given = snapshot.children ?? {};
    for (const name of Object.keys(given)) {
      if (!Object.hasOwn(collections, name)) throw new Error(`A ${snapshot.type} has no "${name}" collection`);
    }
    const childMode = mode === 'root' ? 'fresh' : mode;
    for (const [name, childType] of Object.entries(collections)) {
      const items = given[name] ?? [];
      if (!Array.isArray(items)) throw new Error(`Collection "${name}" must be an array`);
      const uids = items.map((item) => {
        if (item?.type !== childType) throw new Error(`Collection "${name}" holds ${childType} nodes, not "${item?.type}"`);
        return this.#build(item, uid, name, childMode, out, claimed).uid;
      });
      record.children[name] = Object.freeze(uids);
    }
    return record;
  }

  #buildTree(snapshot, parent, collection, mode) {
    const records = [];
    this.#build(snapshot, parent, collection, mode, records, new Set());
    return records;
  }

  #snapshotUid(snapshot, mode, claimed) {
    if (mode === 'fresh' || snapshot.uid === undefined) return this.#allocateUid();
    const { uid } = snapshot;
    if (!Number.isInteger(uid) || uid <= ROOT_UID || this.#nodes.has(uid) || claimed.has(uid)) {
      throw new Error(`Snapshot uid ${uid} is invalid or already in use`);
    }
    claimed.add(uid);
    this.#nextUid = Math.max(this.#nextUid, uid + 1);
    return uid;
  }

  #install(records) {
    for (const record of records) {
      this.#nodes.set(record.uid, record);
      this.#registerId(record);
      this.#noteIds(record.props);
    }
  }

  #registerId(record) {
    const { id } = record.props;
    if (typeof id !== 'string') return;
    const holders = this.#ids.get(id);
    if (holders) holders.push(record.uid);
    else this.#ids.set(id, [record.uid]);
  }

  #unregisterId(record) {
    const { id } = record.props;
    const holders = this.#ids.get(id);
    if (!holders) return;
    const index = holders.indexOf(record.uid);
    if (index >= 0) holders.splice(index, 1);
    if (holders.length === 0) this.#ids.delete(id);
  }

  #noteIds(value) {
    if (typeof value === 'string') {
      const match = GENERATED_ID.exec(value);
      if (!match) return;
      const n = Number(match[2]);
      if (Number.isSafeInteger(n) && n > (this.#idCounters.get(match[1]) ?? 0)) this.#idCounters.set(match[1], n);
    } else if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) this.#noteIds(item);
    }
  }

  #subtree(uid, order) {
    const record = this.#nodes.get(uid);
    const result = order === 'pre' ? [record] : [];
    for (const list of Object.values(record.children)) {
      for (const child of list) result.push(...this.#subtree(child, order));
    }
    if (order === 'post') result.push(record);
    return result;
  }

  #indexOf(record) {
    return this.#nodes.get(record.parent).children[record.collection].indexOf(record.uid);
  }

  #slotChange(kind, record) {
    const { uid, type, parent, collection } = record;
    return Object.freeze({ kind, uid, type, parent, collection, index: this.#indexOf(record) });
  }

  #snapshotOf(uid) {
    const record = this.#nodes.get(uid);
    const children = {};
    for (const [name, list] of Object.entries(record.children)) {
      children[name] = Object.freeze(list.map((child) => this.#snapshotOf(child)));
    }
    return Object.freeze({ uid, type: record.type, props: record.props, children: Object.freeze(children) });
  }

  #setChildren(parentUid, collection, list) {
    this.#nodes.get(parentUid).children[collection] = Object.freeze(list);
  }

  #childType(parentRecord, collection) {
    const childType = COLLECTIONS[parentRecord.type][collection];
    if (!childType) throw new Error(`A ${parentRecord.type} has no "${collection}" collection`);
    return childType;
  }

  #apply(op, changes) {
    switch (op?.op) {
      case 'set':
        return this.#applySet(op, changes);
      case 'add':
        return this.#applyAdd(op, changes);
      case 'remove':
        return this.#applyRemove(op, changes);
      case 'move':
        return this.#applyMove(op, changes);
      default:
        throw new Error(`Unknown operation "${op?.op}"`);
    }
  }

  #inverse(op) {
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

  #applySet({ uid, path, value }, changes) {
    const record = this.#require(uid);
    const segments = splitPath(path);
    if (Object.hasOwn(COLLECTIONS[record.type], segments[0])) {
      throw new Error(`Cannot set "${path}": "${segments[0]}" is a child collection of a ${record.type}`);
    }
    const isId = segments[0] === 'id';
    if (isId && record.type === 'root') throw new Error('The root id cannot change');
    const next = frozenCopy(value);
    const previous = readPath(record.props, segments);
    const props = writePath(record.props, segments, next, path);
    if (isId) this.#unregisterId(record);
    record.props = props;
    if (isId) this.#registerId(record);
    this.#noteIds(next);
    if (!jsonEqual(previous, next)) {
      changes.push(Object.freeze({ kind: 'set', uid, type: record.type, path, value: next, previous }));
    }
    return Object.freeze({ op: 'set', uid, path, value: next, previous });
  }

  #applyAdd({ snapshot, parent, collection, index }, changes) {
    const parentRecord = this.#require(parent);
    const childType = this.#childType(parentRecord, collection);
    if (snapshot?.type !== childType) throw new Error(`Collection "${collection}" holds ${childType} nodes`);
    const siblings = parentRecord.children[collection];
    const at = index ?? siblings.length;
    checkSlotIndex(at, siblings.length, 'Add');
    const records = this.#buildTree(snapshot, parent, collection, 'restore');
    this.#install(records);
    this.#setChildren(parent, collection, siblings.toSpliced(at, 0, records[0].uid));
    for (const record of records) changes.push(this.#slotChange('add', record));
    return Object.freeze({ op: 'add', snapshot: this.#snapshotOf(records[0].uid), parent, collection, index: at });
  }

  #applyRemove(op, changes) {
    const uid = op.uid ?? op.snapshot?.uid;
    if (uid === ROOT_UID) throw new Error('The root cannot be removed');
    const record = this.#require(uid);
    const { parent, collection } = record;
    const index = this.#indexOf(record);
    const snapshot = this.#snapshotOf(uid);
    const records = this.#subtree(uid, 'post');
    for (const item of records) changes.push(this.#slotChange('remove', item));
    this.#setChildren(parent, collection, this.#nodes.get(parent).children[collection].toSpliced(index, 1));
    for (const item of records) {
      this.#unregisterId(item);
      this.#nodes.delete(item.uid);
    }
    return Object.freeze({ op: 'remove', snapshot, parent, collection, index });
  }

  #applyMove({ uid, to }, changes) {
    if (uid === ROOT_UID) throw new Error('The root cannot be moved');
    const record = this.#require(uid);
    const target = this.#require(to?.parent);
    if (this.#childType(target, to.collection) !== record.type) {
      throw new Error(`Collection "${to.collection}" cannot hold a ${record.type}`);
    }
    for (let ancestor = target; ancestor; ancestor = this.#nodes.get(ancestor.parent)) {
      if (ancestor.uid === uid) throw new Error('A node cannot move into its own subtree');
    }
    const from = Object.freeze({ parent: record.parent, collection: record.collection, index: this.#indexOf(record) });
    const sameList = from.parent === to.parent && from.collection === to.collection;
    const source = this.#nodes.get(from.parent).children[from.collection].toSpliced(from.index, 1);
    const destination = sameList ? source : target.children[to.collection];
    const at = to.index ?? destination.length;
    checkSlotIndex(at, destination.length, 'Move');
    const slot = Object.freeze({ parent: to.parent, collection: to.collection, index: at });
    if (!sameList) this.#setChildren(from.parent, from.collection, source);
    this.#setChildren(slot.parent, slot.collection, destination.toSpliced(at, 0, uid));
    record.parent = slot.parent;
    record.collection = slot.collection;
    if (!sameList || from.index !== at) {
      changes.push(Object.freeze({ kind: 'move', uid, type: record.type, from, to: slot }));
    }
    return Object.freeze({ op: 'move', uid, from, to: slot });
  }
}
