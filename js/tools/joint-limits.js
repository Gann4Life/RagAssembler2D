import { defaultsOf } from '../../lib/schema.js';
import { setProps } from '../commands/props.js';
import { toDisplay } from '../units.js';
import { placement } from '../viewport/placement.js';
import { snapAngle } from '../viewport/snap.js';
import { COLORS, GIZMO_SIZE, LINE_WIDTH } from '../viewport/style.js';
import { manipulationTarget, sweepTracker } from './manipulation.js';

/**
 * Limit editor handle id: the lower or upper limit handle, or the ring when it rotates the range.
 * @typedef {'limit-lower'|'limit-upper'|'limit-range'} LimitHandleId
 */

/**
 * Limit editor geometry in screen space, CSS px, Y down.
 * @typedef {object} LimitLayout
 * @property {{ x: number, y: number }} center Joint anchor on screen.
 * @property {number} zero Zero direction, world radians, counter-clockwise positive.
 * @property {number} lower Lower limit, radians.
 * @property {number} upper Upper limit, radians.
 * @property {boolean} enabled Whether the limits are enabled.
 * @property {ReadonlyArray<{ id: 'limit-lower'|'limit-upper', screen: { x: number, y: number } }>} handles Limit
 *   handles on the rotation ring, lower first.
 */

const WHITE = 0xffffff;
const WEDGE_ALPHA = 0.15;
const DISABLED_ALPHA = 0.5;
const LABEL = 'Edit limits';
const DEFAULT_LIMITS = Object.freeze(defaultsOf('joint').limits);

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function rawLimits(model, uid) {
  const limits = model.get(uid)?.props.limits;
  return limits !== null && typeof limits === 'object' && !Array.isArray(limits) ? limits : {};
}

function resolveLimits(limits) {
  const source = limits ?? {};
  return {
    enabled: source.enabled ?? DEFAULT_LIMITS.enabled,
    lower: source.lower ?? DEFAULT_LIMITS.lower,
    upper: source.upper ?? DEFAULT_LIMITS.upper,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function onRing(center, angle) {
  return Object.freeze({
    x: center.x + GIZMO_SIZE.rotateRing * Math.cos(angle),
    y: center.y - GIZMO_SIZE.rotateRing * Math.sin(angle),
  });
}

function along(center, angle, length) {
  return { x: center.x + Math.cos(angle) * length, y: center.y - Math.sin(angle) * length };
}

function oneDecimal(value) {
  return (Math.round(value * 10) / 10 + 0).toFixed(1);
}

/**
 * The joint whose limits the Select gizmo edits: the one selected joint when the selection holds no root and no
 * body, the joint has a zero direction and a placed anchor, and its limits (missing values read as schema defaults)
 * are finite with `lower ≤ 0 ≤ upper`. Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {number[]} objects Selected uids, in selection order.
 * @returns {number|null} Joint uid, or `null`.
 */
export function limitJoint(model, objects) {
  const target = manipulationTarget(model, objects);
  if (target.root || target.bodies.length > 0 || target.joints.length !== 1) return null;
  const uid = target.joints[0];
  const place = placement(model);
  const zero = place.zero.get(uid);
  const anchor = place.anchors.get(uid);
  if (!isFiniteNumber(zero) || !anchor || !isFiniteNumber(anchor.x) || !isFiniteNumber(anchor.y)) return null;
  const { lower, upper } = resolveLimits(rawLimits(model, uid));
  if (!isFiniteNumber(lower) || !isFiniteNumber(upper) || lower > 0 || upper < 0) return null;
  return uid;
}

/**
 * Interval of the shift δ a ring drag may apply to both limits: the width is kept, 0 stays inside the range and no
 * limit passes ±π, while a limit already beyond ±π can only come back. Pure.
 * @param {{ lower: number, upper: number }} limits Limits at the press, radians, `lower ≤ 0 ≤ upper`.
 * @returns {Readonly<{ min: number, max: number }>} Bounds of δ, radians, `min ≤ 0 ≤ max`, never `-0`.
 */
export function limitRange({ lower, upper }) {
  return Object.freeze({
    min: Math.max(-upper, Math.min(0, -Math.PI - lower)) + 0,
    max: Math.min(-lower, Math.max(0, Math.PI - upper)) + 0,
  });
}

/**
 * Limits after a limit drag: a handle adds the sweep to its own limit, rounded to 15° with SHIFT and clamped to its
 * side of 0 and within ±π (or its press value when that is beyond); the range adds the clamped, snapped sweep to
 * both (see `limitRange`). Pure.
 * @param {{ lower: number, upper: number }} start Limits at the press, radians.
 * @param {LimitHandleId} handle Dragged handle.
 * @param {number} sweep Angle swept since the press, radians, counter-clockwise positive.
 * @param {boolean} shift Whether SHIFT is held.
 * @returns {Readonly<{ lower: number, upper: number }>} New limits, radians, never `-0`.
 */
export function limitValues(start, handle, sweep, shift) {
  let { lower, upper } = start;
  if (handle === 'limit-lower') {
    lower = clamp(snapAngle(start.lower + sweep, shift), Math.min(-Math.PI, start.lower), 0);
  } else if (handle === 'limit-upper') {
    upper = clamp(snapAngle(start.upper + sweep, shift), 0, Math.max(Math.PI, start.upper));
  } else {
    const range = limitRange(start);
    const delta = clamp(snapAngle(sweep, shift), range.min, range.max);
    lower = start.lower + delta;
    upper = start.upper + delta;
  }
  return Object.freeze({ lower: lower + 0, upper: upper + 0 });
}

/**
 * Lays out the limit editor around a joint anchor: the two limit handles on the rotation ring at the zero direction
 * plus each limit. Missing limit values read as schema defaults. Pure.
 * @param {{ x: number, y: number }} center Joint anchor, screen CSS px.
 * @param {number} zero Zero direction, world radians.
 * @param {{ enabled?: boolean, lower?: number, upper?: number }} limits Joint limits, radians.
 * @returns {Readonly<LimitLayout>} Frozen layout.
 */
export function limitLayout(center, zero, limits) {
  const { enabled, lower, upper } = resolveLimits(limits);
  const anchor = Object.freeze({ x: center.x, y: center.y });
  return Object.freeze({
    center: anchor,
    zero,
    lower,
    upper,
    enabled: enabled === true,
    handles: Object.freeze([
      Object.freeze({ id: 'limit-lower', screen: onRing(anchor, zero + lower) }),
      Object.freeze({ id: 'limit-upper', screen: onRing(anchor, zero + upper) }),
    ]),
  });
}

/**
 * Readout text of joint limits: `lower: -30.0°  upper: 45.0°`, one decimal.
 * @param {number} lower Lower limit, radians.
 * @param {number} upper Upper limit, radians.
 * @returns {string} Readout text.
 */
export function formatLimits(lower, upper) {
  return `lower: ${oneDecimal(toDisplay(lower, 'rad'))}°  upper: ${oneDecimal(toDisplay(upper, 'rad'))}°`;
}

/**
 * Starts a limit drag of one joint. A limit handle adds the angle the pointer sweeps around the anchor to its limit;
 * the range moves both. When both limits are 0 a limit handle waits for the first non-zero sweep: counter-clockwise
 * takes the upper limit, clockwise the lower one. SHIFT is read live. Each changed step sets `limits.lower`,
 * `limits.upper` and `limits.enabled` = true through one `Edit limits` command; a step back to the press limits
 * restores the press values, `enabled` included. A joint without a `limits` object is written and restored as a whole
 * `limits`, so a drag back leaves it untouched.
 * @param {import('./tool.js').ToolContext} ctx Tool context.
 * @param {{ joint: number, handle: LimitHandleId, press: import('./tool.js').ToolPointerEvent }} options Joint uid,
 *   pressed handle and press event.
 * @returns {import('./manipulation.js').Manipulation} The drag.
 */
export function startLimitDrag(ctx, { joint, handle, press }) {
  const { model } = ctx;
  const raw = rawLimits(model, joint);
  const original = model.get(joint).props.limits;
  const whole = raw !== original;
  const start = resolveLimits(raw);
  const anchor = placement(model).anchors.get(joint);
  const pivot = Object.freeze({ x: anchor.x + 0, y: anchor.y + 0 });
  const tracker = sweepTracker(ctx, pivot, press.world);
  const coincident = handle !== 'limit-range' && start.lower === 0 && start.upper === 0;
  let resolved = coincident ? null : handle;
  let values = { lower: start.lower, upper: start.upper };
  let written = false;

  function write(props) {
    ctx.history.execute(setProps([joint], props, LABEL));
  }

  function changed({ lower, upper }) {
    if (whole) return { limits: { enabled: true, lower, upper } };
    return { 'limits.lower': lower, 'limits.upper': upper, 'limits.enabled': true };
  }

  function restored() {
    if (whole) return { limits: original };
    return { 'limits.lower': raw.lower, 'limits.upper': raw.upper, 'limits.enabled': raw.enabled };
  }

  return Object.freeze({
    apply(e) {
      const sweep = tracker.update(e.world);
      if (resolved === null && sweep !== 0) resolved = sweep > 0 ? 'limit-upper' : 'limit-lower';
      values = resolved === null ? { lower: start.lower, upper: start.upper } : limitValues(start, resolved, sweep, e.shift);
      if (values.lower !== start.lower || values.upper !== start.upper) {
        write(changed(values));
        written = true;
      } else if (written) {
        write(restored());
      }
    },
    pivot() {
      return pivot;
    },
    readout() {
      return formatLimits(values.lower, values.upper);
    },
  });
}

/**
 * Draws the range of a limit editor on a `PIXI.Graphics` in screen space: the wedge from `lower` to `upper` on the
 * ring radius, filled at 15 %; the zero direction as a 1 px reference line from the joint circle to the ring; and
 * the 2 px range arc on the ring. Wedge and arc are at half opacity with limits disabled. Uses only `moveTo`,
 * `lineTo`, `arc`, `closePath`, `fill` and `stroke`.
 * @param {object} g `PIXI.Graphics` to draw on.
 * @param {Readonly<LimitLayout>} layout Limit layout.
 * @returns {void}
 */
export function drawLimitRange(g, layout) {
  const { center, zero, lower, upper } = layout;
  const alpha = layout.enabled ? 1 : DISABLED_ALPHA;
  const radius = GIZMO_SIZE.rotateRing;
  const span = upper > lower;
  if (span) {
    g.moveTo(center.x, center.y);
    g.arc(center.x, center.y, radius, -(zero + lower), -(zero + upper), true);
    g.closePath();
    g.fill({ color: COLORS.gizmoZ, alpha: WEDGE_ALPHA * alpha });
  }
  const inner = along(center, zero, GIZMO_SIZE.jointCircle);
  const outer = along(center, zero, radius);
  g.moveTo(inner.x, inner.y);
  g.lineTo(outer.x, outer.y);
  g.stroke({ width: LINE_WIDTH.outline, color: COLORS.gizmo });
  if (span) {
    const first = along(center, zero + lower, radius);
    g.moveTo(first.x, first.y);
    g.arc(center.x, center.y, radius, -(zero + lower), -(zero + upper), true);
    g.stroke({ width: LINE_WIDTH.gizmo, color: COLORS.gizmoZ, alpha });
  }
}

/**
 * Draws the limit handles of a limit editor on a `PIXI.Graphics` in screen space, upper first so the lower one lies
 * on top: circles filled with the gizmo color and outlined; the hovered or dragged one white and larger. Half
 * opacity with limits disabled. Uses only `circle`, `fill` and `stroke`.
 * @param {object} g `PIXI.Graphics` to draw on.
 * @param {Readonly<LimitLayout>} layout Limit layout.
 * @param {{ hover: 'limit-lower'|'limit-upper'|null, active: 'limit-lower'|'limit-upper'|null }} state Hovered and
 *   dragged handles.
 * @returns {void}
 */
export function drawLimitHandles(g, layout, { hover, active }) {
  const alpha = layout.enabled ? 1 : DISABLED_ALPHA;
  for (let index = layout.handles.length - 1; index >= 0; index--) {
    const { id, screen } = layout.handles[index];
    const hot = id === hover || id === active;
    g.circle(screen.x, screen.y, hot ? GIZMO_SIZE.limitHandleActive : GIZMO_SIZE.limitHandle);
    g.fill({ color: hot ? WHITE : COLORS.gizmo, alpha });
    g.stroke({ width: LINE_WIDTH.outline, color: COLORS.handleOutline, alpha });
  }
}
