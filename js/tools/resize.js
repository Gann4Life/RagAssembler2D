import { composeTransforms, invertTransform, shapeGeometryValid, transformPoint } from '../../lib/geometry.js';
import { defaultsOf } from '../../lib/schema.js';
import { setProps } from '../commands/props.js';
import { ROOT_UID } from '../model/model.js';
import { toDisplay } from '../units.js';
import { placement } from '../viewport/placement.js';
import { COLORS, GIZMO_SIZE, LINE_WIDTH } from '../viewport/style.js';

/**
 * Resize handle id: a box corner or side by compass direction in the shape's own axes, or the circle handle.
 * @typedef {'resize-ne'|'resize-nw'|'resize-sw'|'resize-se'|'resize-e'|'resize-n'|'resize-w'|'resize-s'|'resize-r'} ResizeHandleId
 */

/**
 * A resize handle of one shape.
 * @typedef {object} ResizeHandle
 * @property {number} shape Shape uid.
 * @property {ResizeHandleId} id Handle id.
 * @property {import('../../lib/geometry.js').Vec2} point Handle center, world meters, rest pose.
 * @property {{ x: -1|0|1, y: -1|0|1 }} sign Outward sign per shape axis; 0 for an axis the handle leaves alone.
 * @property {number} outward Outward direction, world radians.
 */

const MIN_SIZE = 0.01;
const WHITE = 0xffffff;
const FALLBACK_PIXELS_PER_METER = defaultsOf('document').units.pixelsPerMeter;
const RESIZE_CURSORS = Object.freeze(['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize']);
const BOX_HANDLES = Object.freeze([
  ['resize-ne', 1, 1],
  ['resize-nw', -1, 1],
  ['resize-sw', -1, -1],
  ['resize-se', 1, -1],
  ['resize-e', 1, 0],
  ['resize-n', 0, 1],
  ['resize-w', -1, 0],
  ['resize-s', 0, -1],
]);

function shapeRecord(model, uid) {
  const node = model.get(uid);
  if (node?.type !== 'shape' || model.get(node.parent)?.type !== 'body') return null;
  const record = model.prop(uid, 'shape');
  if (record?.type !== 'circle' && record?.type !== 'box') return null;
  return shapeGeometryValid(record) ? record : null;
}

function shapeFrame(model, uid, record) {
  const body = placement(model).bodies.get(model.get(uid).parent);
  const angle = record.type === 'box' ? record.angle : 0;
  return composeTransforms(body, { x: record.center[0], y: record.center[1], angle });
}

function frozenPoint(p) {
  return Object.freeze({ x: p.x + 0, y: p.y + 0 });
}

function handle(shape, id, point, x, y, outward) {
  return Object.freeze({ shape, id, point: frozenPoint(point), sign: Object.freeze({ x, y }), outward: outward + 0 });
}

function pixelsPerMeter(model) {
  const value = model.prop(ROOT_UID, 'units.pixelsPerMeter');
  return Number.isFinite(value) && value > 0 ? value : FALLBACK_PIXELS_PER_METER;
}

function oneDecimal(value) {
  return (Math.round(value * 10) / 10 + 0).toFixed(1);
}

/**
 * The shapes that carry resize handles for a selection, in resize order: none when the root is selected; else each
 * selected shape at its place and each selected body's shapes in child order, each shape once at its first place,
 * keeping only circles and boxes with valid geometry. Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {number[]} objects Selected uids, in selection order.
 * @returns {ReadonlyArray<number>} Frozen shape uids.
 */
export function resizeShapes(model, objects) {
  if (objects.includes(ROOT_UID)) return Object.freeze([]);
  const shapes = [];
  const add = (uid) => {
    if (!shapes.includes(uid) && shapeRecord(model, uid) !== null) shapes.push(uid);
  };
  for (const uid of objects) {
    const node = model.get(uid);
    if (node?.type === 'shape') add(uid);
    else if (node?.type === 'body') model.children(uid, 'fixtures').forEach(add);
  }
  return Object.freeze(shapes);
}

/**
 * The resize handles of one shape in the rest pose, in tie order: a box's corners `ne`, `nw`, `sw`, `se`, then its
 * sides `e`, `n`, `w`, `s`; a circle's one handle on its +X. They follow the root, the body and a box's `angle`. Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {number} uid Shape uid.
 * @returns {ReadonlyArray<ResizeHandle>} Frozen handles; empty for anything but a valid circle or box.
 */
export function resizeHandles(model, uid) {
  const record = shapeRecord(model, uid);
  if (record === null) return Object.freeze([]);
  const frame = shapeFrame(model, uid, record);
  if (record.type === 'circle') {
    return Object.freeze([handle(uid, 'resize-r', transformPoint(frame, { x: record.radius, y: 0 }), 1, 0, frame.angle)]);
  }
  const hw = record.width / 2;
  const hh = record.height / 2;
  return Object.freeze(
    BOX_HANDLES.map(([id, x, y]) =>
      handle(uid, id, transformPoint(frame, { x: x * hw, y: y * hh }), x, y, Math.atan2(y, x) + frame.angle),
    ),
  );
}

/**
 * Resizes a box from one handle, in the box's own axes. Per axis the handle changes, the size is
 * `max(min, s·q + size0 / 2)` with the opposite side fixed, or `max(min, 2·s·q)` when `centered`; with `shift` both
 * sizes take `k·size0`, `k` the largest factor of the changed axes, raised so no size is below `min`. Pure.
 * @param {{ width: number, height: number }} size0 Size at the press, meters.
 * @param {import('../../lib/geometry.js').Vec2} q Handle point in box axes relative to the press center, meters.
 * @param {{ x: -1|0|1, y: -1|0|1 }} sign Handle outward sign per axis.
 * @param {{ shift: boolean, centered: boolean, min: number }} options Keep the aspect, keep the center, and the
 *   minimum size in meters.
 * @returns {Readonly<{ center: import('../../lib/geometry.js').Vec2, width: number, height: number }>} New size and
 *   the center offset from the press center in box axes, meters, never `-0`.
 */
export function resizedBox(size0, q, sign, { shift, centered, min }) {
  const start = { x: size0.width, y: size0.height };
  const size = { ...start };
  const changed = ['x', 'y'].filter((axis) => sign[axis] !== 0);
  for (const axis of changed) {
    const s = sign[axis];
    size[axis] = Math.max(min, centered ? 2 * s * q[axis] : s * q[axis] + start[axis] / 2);
  }
  if (shift && changed.length > 0) {
    const k = Math.max(...changed.map((axis) => size[axis] / start[axis]), min / start.x, min / start.y);
    size.x = k * start.x;
    size.y = k * start.y;
  }
  const offset = (axis) => (changed.includes(axis) && !centered ? (sign[axis] * (size[axis] - start[axis])) / 2 : 0);
  return Object.freeze({ center: frozenPoint({ x: offset('x'), y: offset('y') }), width: size.x + 0, height: size.y + 0 });
}

/**
 * The CSS resize cursor closest to a direction on screen, ignoring its sense.
 * @param {number} screenAngle Direction, radians, screen axes (Y down).
 * @returns {'ew-resize'|'nesw-resize'|'ns-resize'|'nwse-resize'} Cursor.
 */
export function resizeCursor(screenAngle) {
  const folded = ((screenAngle % Math.PI) + Math.PI) % Math.PI;
  return RESIZE_CURSORS[Math.round(folded / (Math.PI / 4)) % RESIZE_CURSORS.length];
}

/**
 * Readout text of a resize: `w: 50.0 px  h: 25.0 px` for a box, `r: 12.5 px` for a circle, in document pixels.
 * @param {{ width: number, height: number }|{ radius: number }} geometry Size, meters.
 * @param {number} pixelsPerMeter Document `units.pixelsPerMeter`.
 * @returns {string} Readout text.
 * @throws {RangeError} When `pixelsPerMeter` is not a finite number above 0.
 */
export function formatSize(geometry, pixelsPerMeter) {
  const px = (value) => oneDecimal(toDisplay(value, 'm', pixelsPerMeter));
  if ('radius' in geometry) return `r: ${px(geometry.radius)} px`;
  return `w: ${px(geometry.width)} px  h: ${px(geometry.height)} px`;
}

/**
 * Starts a resize drag of one shape from one of its handles. Each step moves the handle point by the pointer's
 * displacement since `press`; a box snaps it to the grid and resizes in its own axes (SHIFT keeps the aspect, ALT or
 * CTRL keeps the center, all read live), a circle takes the snapped distance to its center as radius. Sizes never go
 * below `ctx.snapLength(0.01)`. Only the shape's geometry changes; executes one `Resize` command per step.
 * @param {import('./tool.js').ToolContext} ctx Tool context.
 * @param {{ shape: number, handle: ResizeHandleId, press: import('./tool.js').ToolPointerEvent,
 *   pivot: import('../../lib/geometry.js').Vec2|null }} options Shape uid, pressed handle, press event and the
 *   gizmo pivot to keep, world meters.
 * @returns {import('./manipulation.js').Manipulation} The drag.
 * @throws {Error} When the shape has no handle `handle`.
 */
export function startResize(ctx, { shape, handle: id, press, pivot }) {
  const { model } = ctx;
  const record = shapeRecord(model, shape);
  const pressed = resizeHandles(model, shape).find((entry) => entry.id === id);
  if (!record || !pressed) throw new Error(`Shape ${shape} has no resize handle ${id}`);
  const frame = shapeFrame(model, shape, record);
  const toBox = invertTransform(frame);
  const min = ctx.snapLength(MIN_SIZE);
  const fixedPivot = pivot && frozenPoint(pivot);
  const isBox = record.type === 'box';
  const geometry0 = isBox ? { width: record.width, height: record.height } : { radius: record.radius };
  let geometry = geometry0;

  function resizeBox(h, e) {
    const q = transformPoint(toBox, ctx.snapPoint(h));
    const r = resizedBox(geometry0, q, pressed.sign, { shift: e.shift, centered: e.alt || e.ctrl, min });
    const offset = transformPoint({ x: 0, y: 0, angle: record.angle }, r.center);
    geometry = { width: r.width, height: r.height };
    const center = [record.center[0] + offset.x + 0, record.center[1] + offset.y + 0];
    return { 'shape.center': center, 'shape.width': r.width, 'shape.height': r.height };
  }

  function resizeCircle(h) {
    const radius = Math.max(min, ctx.snapLength(Math.hypot(h.x - frame.x, h.y - frame.y)));
    geometry = { radius };
    return { 'shape.radius': radius };
  }

  return Object.freeze({
    apply(e) {
      const h = { x: pressed.point.x + e.world.x - press.world.x, y: pressed.point.y + e.world.y - press.world.y };
      ctx.history.execute(setProps([shape], isBox ? resizeBox(h, e) : resizeCircle(h), 'Resize'));
    },
    pivot() {
      return fixedPivot;
    },
    readout() {
      return formatSize(geometry, pixelsPerMeter(model));
    },
  });
}

/**
 * Draws resize handles on a `PIXI.Graphics` in screen space, last first so the first lies on top: axis-aligned
 * squares filled with the gizmo color and outlined; the hovered or dragged one white and larger. Uses only `rect`,
 * `fill` and `stroke`.
 * @param {object} g `PIXI.Graphics` to draw on.
 * @param {ReadonlyArray<{ x: number, y: number }>} points Handle centers, screen CSS px.
 * @param {{ hover: number|null, active: number|null }} state Indexes of the hovered and dragged handles.
 * @returns {void}
 */
export function drawResizeHandles(g, points, { hover, active }) {
  for (let index = points.length - 1; index >= 0; index--) {
    const hot = index === hover || index === active;
    const size = hot ? GIZMO_SIZE.resizeHandleActive : GIZMO_SIZE.resizeHandle;
    const { x, y } = points[index];
    g.rect(x - size / 2, y - size / 2, size, size);
    g.fill({ color: hot ? WHITE : COLORS.gizmo });
    g.stroke({ width: LINE_WIDTH.outline, color: COLORS.handleOutline });
  }
}
