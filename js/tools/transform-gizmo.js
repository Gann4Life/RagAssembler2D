import { toDisplay } from '../units.js';
import { COLORS, GIZMO_SIZE, HIT_RADIUS, LINE_WIDTH } from '../viewport/style.js';

/**
 * Transform gizmo handle id.
 * @typedef {'square'|'x'|'y'|'ring'} GizmoHandle
 */

/**
 * Transform gizmo geometry in screen space, CSS px, Y down.
 * @typedef {object} GizmoLayout
 * @property {{ x: number, y: number }} pivot Pivot point.
 * @property {object} x X arrow, pointing right: points `start`, `base` and `tip`, and the `head` triangle (tip, then
 *   the two base corners). The shaft runs from `start` to `base`; the hit segment from `start` to `tip`.
 * @property {object} y Y arrow, pointing up, with the same members.
 * @property {{ x: number, y: number, size: number }} square Free-move square: top-left corner and side.
 * @property {number|null} ring Rotation ring radius, or `null` without a ring.
 */

const WHITE = 0xffffff;
const HOT_EXTRA_WIDTH = 1;
const SQUARE_GROWTH = 2;
const SQUARE_FILL_ALPHA = 0.4;
const PIVOT_DOT = 1.5;

function point(x, y) {
  return Object.freeze({ x, y });
}

function arrow(pivot, dx, dy) {
  const at = (distance) => point(pivot.x + dx * distance, pivot.y + dy * distance);
  const base = at(GIZMO_SIZE.arrowTip - GIZMO_SIZE.arrowHead);
  const half = GIZMO_SIZE.arrowWidth / 2;
  const tip = at(GIZMO_SIZE.arrowTip);
  return Object.freeze({
    start: at(GIZMO_SIZE.arrowStart),
    base,
    tip,
    head: Object.freeze([tip, point(base.x - dy * half, base.y + dx * half), point(base.x + dy * half, base.y - dx * half)]),
  });
}

/**
 * Lays out the transform gizmo around a pivot: world-aligned arrows, the free-move square between them and,
 * when `ring`, the rotation ring. Constant size in CSS px.
 * @param {{ x: number, y: number }} pivot Pivot, screen CSS px.
 * @param {{ ring: boolean }} options Whether the rotation ring is shown.
 * @returns {Readonly<GizmoLayout>} Frozen layout.
 */
export function gizmoLayout(pivot, { ring }) {
  const size = GIZMO_SIZE.squareSize;
  return Object.freeze({
    pivot: point(pivot.x, pivot.y),
    x: arrow(pivot, 1, 0),
    y: arrow(pivot, 0, -1),
    square: Object.freeze({ x: pivot.x + GIZMO_SIZE.squareOffset, y: pivot.y - GIZMO_SIZE.squareOffset - size, size }),
    ring: ring ? GIZMO_SIZE.rotateRing : null,
  });
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function onSquare(square, p) {
  return (
    p.x >= square.x - SQUARE_GROWTH &&
    p.x <= square.x + square.size + SQUARE_GROWTH &&
    p.y >= square.y - SQUARE_GROWTH &&
    p.y <= square.y + square.size + SQUARE_GROWTH
  );
}

function onArrow(entry, p) {
  return distanceToSegment(p, entry.start, entry.tip) <= HIT_RADIUS.gizmo;
}

/**
 * The gizmo handle under a screen point, in hit priority order: square, X arrow, Y arrow, ring. Nothing within
 * the root's hit radius of the pivot belongs to the gizmo.
 * @param {Readonly<GizmoLayout>} layout Gizmo layout.
 * @param {{ x: number, y: number }} screen Screen point, CSS px.
 * @returns {GizmoHandle|null} Handle id, or `null`.
 */
export function gizmoHandleAt(layout, screen) {
  const fromPivot = Math.hypot(screen.x - layout.pivot.x, screen.y - layout.pivot.y);
  if (fromPivot <= HIT_RADIUS.root) return null;
  if (onSquare(layout.square, screen)) return 'square';
  if (onArrow(layout.x, screen)) return 'x';
  if (onArrow(layout.y, screen)) return 'y';
  if (layout.ring !== null && Math.abs(fromPivot - layout.ring) <= HIT_RADIUS.gizmo) return 'ring';
  return null;
}

function look(handle, color, width, { hover, active }) {
  const hot = handle === hover || handle === active;
  return { color: hot ? WHITE : color, width: hot ? width + HOT_EXTRA_WIDTH : width };
}

function drawArrow(g, entry, style) {
  g.moveTo(entry.start.x, entry.start.y);
  g.lineTo(entry.base.x, entry.base.y);
  g.stroke({ width: style.width, color: style.color });
  g.poly(entry.head.flatMap(({ x, y }) => [x, y]));
  g.fill({ color: style.color });
}

function drawPivotMark(g, pivot, mode) {
  const arm = GIZMO_SIZE.pivot;
  if (mode === 'last') {
    g.circle(pivot.x, pivot.y, arm);
    g.stroke({ width: LINE_WIDTH.outline, color: COLORS.gizmo });
    g.circle(pivot.x, pivot.y, PIVOT_DOT);
    g.fill({ color: COLORS.gizmo });
    return;
  }
  g.moveTo(pivot.x - arm, pivot.y);
  g.lineTo(pivot.x + arm, pivot.y);
  g.moveTo(pivot.x, pivot.y - arm);
  g.lineTo(pivot.x, pivot.y + arm);
  g.stroke({ width: LINE_WIDTH.outline, color: COLORS.gizmo });
}

/**
 * Draws the transform gizmo on a `PIXI.Graphics` in screen space: ring, arrows, square, then the pivot mark (a cross
 * in Center mode, a ring with a dot in Last selected mode). The hovered or active handle is white and 1 px wider.
 * Uses only `moveTo`, `lineTo`, `poly`, `rect`, `circle`, `fill` and `stroke`.
 * @param {object} g `PIXI.Graphics` to draw on.
 * @param {Readonly<GizmoLayout>} layout Gizmo layout.
 * @param {{ hover: GizmoHandle|null, active: GizmoHandle|null, mode: 'center'|'last' }} state Hovered and dragged
 *   handles, and the pivot mode.
 * @returns {void}
 */
export function drawGizmo(g, layout, { hover, active, mode }) {
  const state = { hover, active };
  const { pivot, square } = layout;
  if (layout.ring !== null) {
    const ring = look('ring', COLORS.highlight, LINE_WIDTH.gizmo, state);
    g.circle(pivot.x, pivot.y, layout.ring);
    g.stroke({ width: ring.width, color: ring.color });
  }
  drawArrow(g, layout.x, look('x', COLORS.gizmoX, LINE_WIDTH.gizmo, state));
  drawArrow(g, layout.y, look('y', COLORS.gizmoY, LINE_WIDTH.gizmo, state));
  const free = look('square', COLORS.gizmoFree, LINE_WIDTH.outline, state);
  g.rect(square.x, square.y, square.size, square.size);
  g.fill({ color: free.color, alpha: SQUARE_FILL_ALPHA });
  g.stroke({ width: free.width, color: free.color });
  drawPivotMark(g, pivot, mode);
}

function oneDecimal(value) {
  return (Math.round(value * 10) / 10 + 0).toFixed(1);
}

/**
 * Readout text of a move: `Δx: 12.0 px  Δy: -3.5 px`, in document pixels, one decimal.
 * @param {import('../../lib/geometry.js').Vec2} d Applied move, world meters.
 * @param {number} pixelsPerMeter Document `units.pixelsPerMeter`.
 * @returns {string} Readout text.
 * @throws {RangeError} When `pixelsPerMeter` is not a finite number above 0.
 */
export function formatMove(d, pixelsPerMeter) {
  const x = oneDecimal(toDisplay(d.x, 'm', pixelsPerMeter));
  const y = oneDecimal(toDisplay(d.y, 'm', pixelsPerMeter));
  return `Δx: ${x} px  Δy: ${y} px`;
}

/**
 * Readout text of a rotation: `Δθ: 15.0°`, counter-clockwise positive, one decimal.
 * @param {number} theta Applied rotation, radians.
 * @returns {string} Readout text.
 */
export function formatRotation(theta) {
  return `Δθ: ${oneDecimal(toDisplay(theta, 'rad'))}°`;
}
