import { Emitter } from '../../lib/emitter.js';
import { polygonCentroid, transformPoint } from '../../lib/geometry.js';
import { setProps } from '../commands/props.js';
import { placement } from '../viewport/placement.js';

/**
 * An open rename field: the object it renames and its name when it opened.
 * @typedef {object} RenameSession
 * @property {number} uid Root, body, shape or joint uid.
 * @property {string} name Name when the field opened; `''` when the object had none.
 */

/** Gap between the anchor point and the rename popup's top-left corner, CSS px. */
export const RENAME_POPUP_OFFSET = 8;

const RENAMABLE = new Set(['root', 'body', 'shape', 'joint']);

function isFinitePoint(p) {
  return p !== null && p !== undefined && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function isFinitePair(value) {
  return Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function nameOf(model, uid) {
  const name = model.prop(uid, 'name');
  return typeof name === 'string' ? name : '';
}

/**
 * The object F2 renames: the only selected object when it is the root, a body, a shape or a joint. Pure.
 * @param {import('./model.js').Model} model Document model.
 * @param {ReadonlyArray<number>} objects Selected object uids.
 * @returns {number|null} Its uid, or `null` with none or several selected or another type.
 */
export function renameTarget(model, objects) {
  if (objects.length !== 1) return null;
  return RENAMABLE.has(model.get(objects[0])?.type) ? objects[0] : null;
}

function shapeCenter(record) {
  if (record?.type === 'polygon') {
    const valid = Array.isArray(record.vertices) && record.vertices.length > 0 && record.vertices.every(isFinitePair);
    return valid ? polygonCentroid(record.vertices) : null;
  }
  const center = record?.center ?? [0, 0];
  return isFinitePair(center) ? { x: center[0], y: center[1] } : null;
}

/**
 * The world point a rename popup falls back to: the root position, a body origin, a shape's center (circle and box
 * `center`, polygon centroid) or a joint anchor, in the displayed pose. Pure.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} uid Root, body, shape or joint uid.
 * @param {import('../viewport/bounds.js').Pose|null} [pose] Displayed pose; the rest pose when omitted.
 * @returns {import('../../lib/geometry.js').Vec2|null} World meters, or `null` when it is not finite or the uid is
 *   of another type.
 */
export function renamePoint(model, uid, pose = null) {
  const node = model.get(uid);
  if (!node || !RENAMABLE.has(node.type)) return null;
  const place = placement(model, pose);
  let point = null;
  if (node.type === 'root') point = place.root;
  else if (node.type === 'body') point = place.bodies.get(uid) ?? null;
  else if (node.type === 'joint') point = place.anchors.get(uid) ?? null;
  else {
    const body = place.bodies.get(node.parent);
    const center = shapeCenter(node.props.shape);
    point = body && center ? transformPoint(body, center) : null;
  }
  return isFinitePoint(point) ? Object.freeze({ x: point.x + 0, y: point.y + 0 }) : null;
}

/**
 * Anchor point of the rename popup: the pointer when it is over the viewport, else the object's screen point when
 * it is finite and inside the viewport, else the viewport center. Pure.
 * @param {{ pointer: import('../../lib/geometry.js').Vec2|null, point: import('../../lib/geometry.js').Vec2|null,
 *   width: number, height: number }} options Pointer and object point, CSS px from the viewport's top-left (`null`
 *   when absent), and the viewport size, CSS px.
 * @returns {import('../../lib/geometry.js').Vec2} Anchor, CSS px from the viewport's top-left.
 */
export function renameAnchor({ pointer, point, width, height }) {
  if (isFinitePoint(pointer)) return Object.freeze({ x: pointer.x, y: pointer.y });
  if (isFinitePoint(point) && point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height) {
    return Object.freeze({ x: point.x, y: point.y });
  }
  return Object.freeze({ x: width / 2, y: height / 2 });
}

/**
 * Top-left corner of the rename popup: `RENAME_POPUP_OFFSET` right of and below the anchor, then moved as little
 * as needed to stay inside the viewport (the top-left edge wins when the popup is larger). Pure.
 * @param {import('../../lib/geometry.js').Vec2} anchor Anchor, CSS px from the viewport's top-left.
 * @param {{ width: number, height: number }} size Popup size, CSS px.
 * @param {{ width: number, height: number }} viewport Viewport size, CSS px.
 * @returns {import('../../lib/geometry.js').Vec2} Corner, CSS px from the viewport's top-left.
 */
export function renamePopupPosition(anchor, size, viewport) {
  const clamp = (value, extent, limit) => Math.max(0, Math.min(value, limit - extent)) + 0;
  return Object.freeze({
    x: clamp(anchor.x + RENAME_POPUP_OFFSET, size.width, viewport.width),
    y: clamp(anchor.y + RENAME_POPUP_OFFSET, size.height, viewport.height),
  });
}

/**
 * Rename session of the editor (F2): at most one open field. Opens on the single selected root, body, shape or
 * joint in Edit mode outside a gesture; commits as one `Rename` undo step through `setProps`; cancels on Undo, a
 * mode change, a model reset (New, Load) or the removal of its object. Not undoable. Emits `rename` with
 * `{ session }` whenever a field opens (the session) or closes (`null`).
 */
export class Rename {
  #model;
  #history;
  #selection;
  #modes;
  #emitter = new Emitter();
  #session = null;

  /**
   * Creates a closed session and subscribes to the model's `change` and `reset` events and the modes' `mode` event.
   * @param {{ model: import('./model.js').Model, history: import('../commands/history.js').History,
   *   selection: import('./selection.js').Selection, modes: import('../modes.js').Modes }} core Editor core parts.
   */
  constructor({ model, history, selection, modes }) {
    this.#model = model;
    this.#history = history;
    this.#selection = selection;
    this.#modes = modes;
    model.on('change', ({ changes, cause }) => {
      if (this.#session === null) return;
      const removed = changes.some((change) => change.kind === 'remove' && change.uid === this.#session.uid);
      if (cause === 'undo' || removed) this.cancel();
    });
    model.on('reset', () => this.cancel());
    modes.on('mode', () => this.cancel());
  }

  /**
   * The open field, or `null`.
   * @returns {Readonly<RenameSession>|null}
   */
  get session() {
    return this.#session;
  }

  /**
   * Whether a field can open now: Edit mode, no gesture, no open field and a rename target in the selection.
   * @returns {boolean}
   */
  canStart() {
    return (
      this.#session === null
      && this.#modes.can('edit.rest')
      && !this.#history.inGesture
      && renameTarget(this.#model, this.#selection.objects) !== null
    );
  }

  /**
   * Opens a field on the rename target when `canStart`.
   * @returns {Readonly<RenameSession>|null} The new session, or `null` when none opened.
   */
  start() {
    if (!this.canStart()) return null;
    const uid = renameTarget(this.#model, this.#selection.objects);
    this.#open(Object.freeze({ uid, name: nameOf(this.#model, uid) }));
    return this.#session;
  }

  /**
   * Closes the field and stores `name` as typed, empty included, as one `Rename` undo step; an unchanged name, a
   * removed object, a mode other than Edit or an open gesture record nothing.
   * @param {string} name Typed name.
   * @returns {boolean} Whether a step was recorded.
   * @throws {TypeError} When `name` is not a string.
   */
  commit(name) {
    if (typeof name !== 'string') throw new TypeError('A name must be a string');
    const session = this.#session;
    if (session === null) return false;
    this.#open(null);
    const node = this.#model.get(session.uid);
    if (!node || !this.#modes.can('edit.rest') || this.#history.inGesture) return false;
    if (name === nameOf(this.#model, session.uid)) return false;
    this.#history.execute(setProps([session.uid], { name }, 'Rename'));
    return true;
  }

  /**
   * Closes the field without changes.
   * @returns {boolean} Whether a field was open.
   */
  cancel() {
    if (this.#session === null) return false;
    this.#open(null);
    return true;
  }

  /**
   * Subscribes to `rename` events.
   * @param {'rename'} type Event type.
   * @param {(event: Readonly<{ session: Readonly<RenameSession>|null }>) => void} fn Listener.
   * @returns {() => void} Function that unsubscribes the listener.
   */
  on(type, fn) {
    return this.#emitter.on(type, fn);
  }

  /**
   * Unsubscribes a listener.
   * @param {'rename'} type Event type.
   * @param {(event: Readonly<{ session: Readonly<RenameSession>|null }>) => void} fn Listener.
   * @returns {void}
   */
  off(type, fn) {
    this.#emitter.off(type, fn);
  }

  #open(session) {
    this.#session = session;
    this.#emitter.emit('rename', Object.freeze({ session }));
  }
}
