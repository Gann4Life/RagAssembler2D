import { transformPoint } from '../../lib/geometry.js';
import { defaultsOf } from '../../lib/schema.js';
import { setProps } from '../commands/props.js';
import { manipulationParts, placeParts, rotationAbout, transformParts } from '../commands/transform.js';
import { ROOT_UID } from '../model/model.js';
import { parentJoints } from '../model/queries.js';
import { placement } from '../viewport/placement.js';
import { formatMove, formatRotation } from './transform-gizmo.js';

/**
 * What the Select tool moves and rotates, derived from the selection.
 * @typedef {object} Target
 * @property {boolean} root Whether the root is the target; then `bodies` and `joints` are empty.
 * @property {number[]} bodies Body uids.
 * @property {number[]} joints Joint uids.
 */

/**
 * A move or rotation drag in progress. Every step is computed from the values captured at its start.
 * @typedef {object} Manipulation
 * @property {(e: import('./tool.js').ToolPointerEvent) => void} apply Executes the step for a pointer event.
 * @property {() => import('../../lib/geometry.js').Vec2|null} pivot Current gizmo pivot, world meters; `null` when it
 *   is not placed.
 * @property {() => string} readout Readout text of the last applied step.
 * @property {() => { start: number, angle: number }|null} [sweep] Rotation only: world direction of the press from the
 *   pivot and the applied angle, radians, counter-clockwise positive.
 */

const PIVOT_DEAD_ZONE = 1;
const FALLBACK_PIXELS_PER_METER = defaultsOf('document').units.pixelsPerMeter;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePair(value) {
  return Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);
}

function isFinitePoint(p) {
  return p !== null && p !== undefined && isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

function readVec(value) {
  return isFinitePair(value) ? { x: value[0], y: value[1] } : { x: 0, y: 0 };
}

function readAngle(value) {
  return isFiniteNumber(value) ? value : 0;
}

function distance(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function direction(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function wrap(angle) {
  const turned = angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
  return turned === -Math.PI ? Math.PI : turned;
}

function rotate(v, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

function merge(full, changed) {
  const bodies = new Map(changed.bodies.map((entry) => [entry.uid, entry]));
  const anchors = new Map(changed.anchors.map((entry) => [entry.uid, entry]));
  return {
    bodies: full.bodies.map((entry) => bodies.get(entry.uid) ?? entry),
    anchors: full.anchors.map((entry) => anchors.get(entry.uid) ?? entry),
  };
}

function pixelsPerMeter(model) {
  const value = model.prop(ROOT_UID, 'units.pixelsPerMeter');
  return isFiniteNumber(value) && value > 0 ? value : FALLBACK_PIXELS_PER_METER;
}

/**
 * The target of a selection: the root alone when it is selected; otherwise the selected bodies and the bodies of
 * selected shapes, deduplicated in selection order, and the selected joints. Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {number[]} objects Selected uids.
 * @returns {Readonly<Target>} Frozen target.
 */
export function manipulationTarget(model, objects) {
  if (objects.includes(ROOT_UID)) return Object.freeze({ root: true, bodies: Object.freeze([]), joints: Object.freeze([]) });
  const bodies = [];
  const joints = [];
  for (const uid of objects) {
    const node = model.get(uid);
    if (!node) continue;
    let body = null;
    if (node.type === 'body') body = uid;
    else if (node.type === 'shape' && model.get(node.parent)?.type === 'body') body = node.parent;
    else if (node.type === 'joint' && !joints.includes(uid)) joints.push(uid);
    if (body !== null && !bodies.includes(body)) bodies.push(body);
  }
  return Object.freeze({ root: false, bodies: Object.freeze(bodies), joints: Object.freeze(joints) });
}

/**
 * Pivot of one body: its parent joint's anchor when that joint exists and its anchor is placed, else the body
 * origin; the origin always when `center`. Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {number} bodyUid Body uid.
 * @param {boolean} center Whether to force the body origin.
 * @returns {import('../../lib/geometry.js').Vec2} Pivot, root-local meters.
 */
export function rotationPivot(model, bodyUid, center) {
  const origin = readVec(model.prop(bodyUid, 'position'));
  if (center) return origin;
  const joint = parentJoints(model).get(bodyUid);
  if (joint === undefined) return origin;
  const anchor = model.prop(joint, 'anchor');
  return isFinitePair(anchor) ? { x: anchor[0], y: anchor[1] } : origin;
}

/**
 * The target object the last selection entry maps to: the root for a root target; else the last selected body of
 * the target, shape of a target body (as its body) or target joint. Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {number[]} objects Selected uids, in selection order.
 * @param {Target} target Target of `objects`.
 * @returns {{ type: 'root'|'body'|'joint', uid: number }|null} The object, or `null` when none maps to the target.
 */
export function lastTargetObject(model, objects, target) {
  if (target.root) return Object.freeze({ type: 'root', uid: ROOT_UID });
  for (let index = objects.length - 1; index >= 0; index--) {
    const uid = objects[index];
    const node = model.get(uid);
    if (!node) continue;
    if (node.type === 'body' && target.bodies.includes(uid)) return Object.freeze({ type: 'body', uid });
    if (node.type === 'shape' && target.bodies.includes(node.parent)) return Object.freeze({ type: 'body', uid: node.parent });
    if (node.type === 'joint' && target.joints.includes(uid)) return Object.freeze({ type: 'joint', uid });
  }
  return null;
}

function alonePivot(model, place, object, ctrl) {
  if (object.type === 'root') return { x: place.root.x, y: place.root.y };
  if (object.type === 'body') return transformPoint(place.root, rotationPivot(model, object.uid, ctrl));
  const anchor = place.anchors.get(object.uid);
  return anchor ? { x: anchor.x, y: anchor.y } : null;
}

function centerPivot(place, target) {
  const points = [];
  for (const uid of target.bodies) {
    const body = place.bodies.get(uid);
    if (body) points.push(body);
  }
  for (const uid of target.joints) {
    const anchor = place.anchors.get(uid);
    if (isFinitePoint(anchor)) points.push(anchor);
  }
  if (points.length === 0) return null;
  const sum = points.reduce((total, p) => ({ x: total.x + p.x, y: total.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * The transform gizmo's pivot for a selection, in the rest pose: the root position; one body's parent joint
 * anchor (else its origin; the origin with CTRL); one joint's anchor; for several objects, the mean of the body
 * origins and placed joint anchors (`center`) or the pivot of the last selected one alone (`last`). Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {number[]} objects Selected uids, in selection order.
 * @param {{ mode: 'center'|'last', ctrl: boolean }} options Pivot mode and CTRL.
 * @returns {import('../../lib/geometry.js').Vec2|null} Pivot, world meters; `null` for an empty target or a pivot
 *   that is not finite.
 */
export function gizmoPivot(model, objects, { mode, ctrl }) {
  const target = manipulationTarget(model, objects);
  const place = placement(model);
  let pivot = null;
  if (target.root) pivot = alonePivot(model, place, { type: 'root', uid: ROOT_UID }, ctrl);
  else if (target.bodies.length === 1 && target.joints.length === 0) {
    pivot = alonePivot(model, place, { type: 'body', uid: target.bodies[0] }, ctrl);
  } else if (target.joints.length === 1 && target.bodies.length === 0) {
    pivot = alonePivot(model, place, { type: 'joint', uid: target.joints[0] }, ctrl);
  } else if (target.bodies.length + target.joints.length > 1) {
    if (mode === 'last') {
      const last = lastTargetObject(model, objects, target);
      pivot = last && alonePivot(model, place, last, ctrl);
    } else {
      pivot = centerPivot(place, target);
    }
  }
  return isFinitePoint(pivot) ? Object.freeze({ x: pivot.x + 0, y: pivot.y + 0 }) : null;
}

/**
 * Whether rotating a target can change anything: the root, at least one body, or at least two joints.
 * @param {Target} target Target.
 * @returns {boolean}
 */
export function canRotate(target) {
  return target.root || target.bodies.length > 0 || target.joints.length >= 2;
}

/**
 * Accumulates the angle the pointer sweeps around a pivot, following it past half a turn: each update adds the
 * change of direction wrapped to (−π, π]. A pointer within 1 CSS px of the pivot on screen changes nothing.
 * @param {import('./tool.js').ToolContext} ctx Tool context; its camera places the dead zone.
 * @param {import('../../lib/geometry.js').Vec2} pivot Pivot, world meters.
 * @param {import('../../lib/geometry.js').Vec2} from Start point of the sweep, world meters.
 * @returns {{ update: (world: import('../../lib/geometry.js').Vec2) => number,
 *   restart: (pivot: import('../../lib/geometry.js').Vec2, from: import('../../lib/geometry.js').Vec2) => void }}
 *   `update` takes the pointer, world meters, and returns the swept angle, radians, counter-clockwise positive;
 *   `restart` sets a new pivot and start point and resets the angle to 0.
 */
export function sweepTracker(ctx, pivot, from) {
  let center = pivot;
  let prev = direction(pivot, from);
  let theta = 0;
  return Object.freeze({
    update(world) {
      if (distance(ctx.camera.worldToScreen(center), ctx.camera.worldToScreen(world)) <= PIVOT_DEAD_ZONE) return theta;
      const phi = direction(center, world);
      theta += wrap(phi - prev);
      prev = phi;
      return theta;
    },
    restart(nextPivot, nextFrom) {
      center = nextPivot;
      prev = direction(nextPivot, nextFrom);
      theta = 0;
    },
  });
}

function rootStart(model) {
  const { root } = placement(model);
  return root;
}

/**
 * Starts a move drag of a target. Each step moves by the pointer's displacement since `press`, adjusted so that
 * `ref` lands on the grid when grid snap is on; an `axis` of `'x'` or `'y'` keeps the other component at 0. The
 * root moves its `position`; bodies carry their subtrees (ALT: the bodies alone) and the anchors they carry.
 * Executes one command per step on `ctx.history`.
 * @param {import('./tool.js').ToolContext} ctx Tool context.
 * @param {{ target: Target, ref: import('../../lib/geometry.js').Vec2, axis: 'x'|'y'|'xy',
 *   press: import('./tool.js').ToolPointerEvent }} options Target, reference point (world m), axis and press event.
 * @returns {Manipulation} The drag.
 */
export function startMove(ctx, { target, ref, axis, press }) {
  const { model } = ctx;
  const root = rootStart(model);
  const startPivot = gizmoPivot(model, ctx.selection.objects, { mode: ctx.settings.get('gizmo.pivot'), ctrl: press.ctrl });
  const full = target.root ? null : manipulationParts(model, target, { subtree: true });
  const only = target.root ? null : manipulationParts(model, target, { subtree: false });
  let d = { x: 0, y: 0 };

  function vector(e) {
    const raw = { x: ref.x + e.world.x - press.world.x, y: ref.y + e.world.y - press.world.y };
    if (axis === 'x') raw.y = ref.y;
    if (axis === 'y') raw.x = ref.x;
    const snapped = ctx.snapPoint(raw);
    return { x: axis === 'y' ? 0 : snapped.x - ref.x + 0, y: axis === 'x' ? 0 : snapped.y - ref.y + 0 };
  }

  return Object.freeze({
    apply(e) {
      d = vector(e);
      if (target.root) {
        ctx.history.execute(setProps([ROOT_UID], { position: [root.x + d.x + 0, root.y + d.y + 0] }, 'Move ragdoll'));
        return;
      }
      const local = rotate(d, -root.angle);
      const active = e.alt ? only : full;
      const moved = transformParts(active, { x: local.x, y: local.y, angle: 0 });
      ctx.history.execute(placeParts(merge(full, moved), 'Move'));
    },
    pivot() {
      return startPivot && Object.freeze({ x: startPivot.x + d.x, y: startPivot.y + d.y });
    },
    readout() {
      return formatMove(d, pixelsPerMeter(model));
    },
  });
}

/**
 * Starts a rotation drag of a target by the angle the pointer sweeps around the pivot, following it past half a
 * turn. The root turns its `angle` around its position; bodies and joints turn around the gizmo pivot with their
 * subtrees and carried anchors (ALT: the bodies alone and the target joints' anchors). CTRL, read live, moves the
 * pivot to the body origin and restarts the sweep when that moves the pivot; SHIFT snaps the root angle, the one
 * body's root-local angle, or else the rotation itself, to 15°. Executes one command per step on `ctx.history`.
 * @param {import('./tool.js').ToolContext} ctx Tool context.
 * @param {{ target: Target, press: import('./tool.js').ToolPointerEvent, mode: 'center'|'last' }} options Target,
 *   press event and pivot mode.
 * @returns {Manipulation} The drag.
 */
export function startRotation(ctx, { target, press, mode }) {
  const { model } = ctx;
  const root = rootStart(model);
  const objects = ctx.selection.objects;
  const anchorPivot = target.root ? { x: root.x, y: root.y } : gizmoPivot(model, objects, { mode, ctrl: false });
  const originPivot = target.root ? anchorPivot : (gizmoPivot(model, objects, { mode, ctrl: true }) ?? anchorPivot);
  const full = target.root ? null : manipulationParts(model, target, { subtree: true });
  const only = target.root ? null : manipulationParts(model, target, { subtree: false });
  const single = !target.root && target.bodies.length === 1 && target.joints.length === 0;
  const a0 = single ? readAngle(model.prop(target.bodies[0], 'angle')) : 0;
  const pivotOf = (ctrl) => (ctrl && !target.root ? originPivot : anchorPivot);
  let current = pivotOf(press.ctrl);
  const tracker = sweepTracker(ctx, current, press.world);
  let pivotCenter = press.ctrl;
  let applied = 0;

  function follow(e) {
    current = pivotOf(e.ctrl);
    if (e.ctrl !== pivotCenter) {
      pivotCenter = e.ctrl;
      if (distance(anchorPivot, originPivot) > 0) tracker.restart(current, press.world);
    }
    return tracker.update(e.world);
  }

  return Object.freeze({
    apply(e) {
      const theta = follow(e);
      if (target.root) {
        const angle = ctx.snapAngle(root.angle + theta, e.shift) + 0;
        applied = angle - root.angle;
        ctx.history.execute(setProps([ROOT_UID], { angle }, 'Rotate ragdoll'));
        return;
      }
      applied = single ? ctx.snapAngle(a0 + theta, e.shift) - a0 : ctx.snapAngle(theta, e.shift);
      const active = e.alt ? only : full;
      const turned = transformParts(active, rotationAbout(ctx.toLocal(current), applied));
      ctx.history.execute(placeParts(merge(full, turned), 'Rotate'));
    },
    pivot() {
      return current && Object.freeze({ x: current.x, y: current.y });
    },
    sweep() {
      return { start: direction(current, press.world), angle: applied };
    },
    readout() {
      return formatRotation(applied);
    },
  });
}
