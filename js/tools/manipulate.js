import { setProps } from '../commands/props.js';
import { manipulationParts, placeParts, rotationAbout, transformParts } from '../commands/transform.js';
import { ROOT_UID } from '../model/model.js';
import { parentJoints } from '../model/queries.js';
import { placement } from '../viewport/placement.js';
import { COLORS, GIZMO_SIZE, HIT_RADIUS, LINE_WIDTH } from '../viewport/style.js';
import { DRAG_THRESHOLD, defineTool } from './tool.js';

const PRIMARY = 0;
const PIVOT_DEAD_ZONE = 1;

/**
 * What the Manipulate tool acts on.
 * @typedef {object} Target
 * @property {boolean} root Whether the root is the target; then `bodies` and `joints` are empty.
 * @property {number[]} bodies Body uids.
 * @property {number[]} joints Joint uids.
 */

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePair(value) {
  return Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);
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

/**
 * The Manipulate target of a selection: the root alone when it is selected; otherwise the selected bodies and
 * the bodies of selected shapes, deduplicated in selection order, and the selected joints. Pure.
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
 * Pivot of a body rotation: its parent joint's anchor when that joint exists and its anchor is placed, else the
 * body origin; the origin always when `center`. Pure.
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

function isRotatable(target) {
  return target.root || (target.bodies.length === 1 && target.joints.length === 0);
}

function belongs(model, target, selected, uid) {
  if (selected.includes(uid)) return true;
  const node = model.get(uid);
  return node?.type === 'shape' && target.bodies.includes(node.parent);
}

/**
 * Builds the Manipulate tool: in Edit mode a press on the selection drags it (the root, or bodies with their
 * subtrees and the anchors they carry, ALT for the bodies alone), a press on another object selects it and drags
 * it, and the rotate knob rotates the root or one body (CTRL around its origin, SHIFT in 15° steps). Each drag is
 * one undo step. In Animate mode it only selects.
 * @returns {Readonly<import('./tool.js').Tool>} The tool.
 */
export function manipulateTool() {
  let ctx = null;
  let press = null;
  let ctrl = false;

  const editing = () => ctx.modes.can('edit.rest');
  const currentTarget = () => manipulationTarget(ctx.model, ctx.selection.objects);

  function handle(target, center) {
    if (!isRotatable(target)) return null;
    const place = placement(ctx.model);
    let world;
    let angle;
    if (target.root) {
      world = { x: place.root.x, y: place.root.y };
      angle = place.root.angle;
    } else {
      const body = target.bodies[0];
      world = ctx.toWorld(rotationPivot(ctx.model, body, center));
      angle = place.bodies.get(body)?.angle ?? 0;
    }
    if (!isFiniteNumber(world.x) || !isFiniteNumber(world.y) || !isFiniteNumber(angle)) return null;
    const pivot = ctx.camera.worldToScreen(world);
    const knob = {
      x: pivot.x + GIZMO_SIZE.rotateHandle * Math.cos(angle),
      y: pivot.y - GIZMO_SIZE.rotateHandle * Math.sin(angle),
    };
    return { pivot, knob };
  }

  function onKnob(target, screen) {
    const found = handle(target, ctrl);
    return found !== null && distance(found.knob, screen) <= HIT_RADIUS.handle;
  }

  function rootTransform() {
    const { root } = placement(ctx.model);
    return root;
  }

  function movePress(target, hit) {
    const root = rootTransform();
    if (target.root) return { kind: 'move', root: true, start: { x: root.x, y: root.y }, ref: { x: root.x, y: root.y } };
    const place = placement(ctx.model);
    const node = ctx.model.get(hit);
    const point = node.type === 'joint' ? place.anchors.get(hit) : place.bodies.get(node.parent);
    return {
      kind: 'move',
      root: false,
      full: manipulationParts(ctx.model, target, { subtree: true }),
      only: manipulationParts(ctx.model, target, { subtree: false }),
      rootAngle: root.angle,
      ref: { x: point.x, y: point.y },
    };
  }

  function rotatePress(e, target) {
    const root = rootTransform();
    if (target.root) {
      const pivot = { x: root.x, y: root.y };
      return { kind: 'rotate', root: true, start: root.angle, sweep: { pivotCenter: e.ctrl, prev: direction(pivot, e.world), theta: 0 } };
    }
    const body = target.bodies[0];
    const rotation = {
      kind: 'rotate',
      root: false,
      full: manipulationParts(ctx.model, target, { subtree: true }),
      only: manipulationParts(ctx.model, target, { subtree: false }),
      a0: readAngle(ctx.model.prop(body, 'angle')),
      pivots: { anchor: rotationPivot(ctx.model, body, false), center: rotationPivot(ctx.model, body, true) },
    };
    const pivot = ctx.toWorld(e.ctrl ? rotation.pivots.center : rotation.pivots.anchor);
    rotation.sweep = { pivotCenter: e.ctrl, prev: direction(pivot, e.world), theta: 0 };
    return rotation;
  }

  function resolvePress(e) {
    const target = currentTarget();
    if (editing() && onKnob(target, e.screen)) return rotatePress(e, target);
    const hits = ctx.hitTest(e.screen);
    if (hits.length === 0) return { kind: 'empty' };
    const hit = hits[0];
    let pressed = target;
    if (!belongs(ctx.model, target, ctx.selection.objects, hit)) {
      ctx.selection.set([hit]);
      pressed = currentTarget();
    }
    return editing() ? movePress(pressed, hit) : { kind: 'select' };
  }

  function applyMove(e) {
    const raw = { x: press.ref.x + e.world.x - press.world.x, y: press.ref.y + e.world.y - press.world.y };
    const snapped = ctx.snapPoint(raw);
    const d = { x: snapped.x - press.ref.x, y: snapped.y - press.ref.y };
    if (press.root) {
      const position = [press.start.x + d.x + 0, press.start.y + d.y + 0];
      ctx.history.execute(setProps([ROOT_UID], { position }, 'Move ragdoll'));
      return;
    }
    const local = rotate(d, -press.rootAngle);
    const active = e.alt ? press.only : press.full;
    const moved = transformParts(active, { x: local.x, y: local.y, angle: 0 });
    ctx.history.execute(placeParts(merge(press.full, moved), 'Move'));
  }

  function pivotLocal(center) {
    return center ? press.pivots.center : press.pivots.anchor;
  }

  function sweep(e) {
    const state = press.sweep;
    const center = press.root ? false : e.ctrl;
    const local = press.root ? null : pivotLocal(center);
    const root = rootTransform();
    const pivot = press.root ? { x: root.x, y: root.y } : ctx.toWorld(local);
    const near = distance(ctx.camera.worldToScreen(pivot), e.screen) <= PIVOT_DEAD_ZONE;
    if (!press.root && center !== state.pivotCenter) {
      const changed = distance(pivotLocal(center), pivotLocal(state.pivotCenter)) > 0;
      state.pivotCenter = center;
      if (changed) {
        state.prev = direction(pivot, press.world);
        state.theta = 0;
      }
    }
    if (!near) {
      const phi = direction(pivot, e.world);
      state.theta += wrap(phi - state.prev);
      state.prev = phi;
    }
    return local;
  }

  function applyRotate(e) {
    const local = sweep(e);
    const { theta } = press.sweep;
    if (press.root) {
      ctx.history.execute(setProps([ROOT_UID], { angle: ctx.snapAngle(press.start + theta, e.shift) + 0 }, 'Rotate ragdoll'));
      return;
    }
    const turn = ctx.snapAngle(press.a0 + theta, e.shift) - press.a0;
    const active = e.alt ? press.only : press.full;
    const turned = transformParts(active, rotationAbout(local, turn));
    ctx.history.execute(placeParts(merge(press.full, turned), 'Rotate'));
  }

  function apply(e) {
    if (press.kind === 'move') applyMove(e);
    else if (press.kind === 'rotate') applyRotate(e);
  }

  function latch(e) {
    if (!press.dragging && distance(press.screen, e.screen) >= DRAG_THRESHOLD) press.dragging = true;
    press.last = e;
  }

  function hoverCursor(screen) {
    if (!editing()) return null;
    if (onKnob(currentTarget(), screen)) return 'pointer';
    return ctx.hitTest(screen).length > 0 ? 'move' : null;
  }

  return defineTool({
    id: 'manipulate',
    cursor: 'default',
    hover: true,
    activate(context) {
      ctx = context;
    },
    deactivate() {
      press = null;
    },
    pointerDown(e) {
      if (e.button !== PRIMARY) return;
      ctrl = e.ctrl;
      press = { ...resolvePress(e), screen: e.screen, world: e.world, dragging: false, last: e };
      if (press.kind === 'move') ctx.setCursor('move');
      else if (press.kind === 'rotate') ctx.setCursor('pointer');
      ctx.invalidateOverlay();
    },
    pointerMove(e) {
      ctrl = e.ctrl;
      if (press) {
        latch(e);
        if (press.dragging) apply(e);
        ctx.invalidateOverlay();
        return;
      }
      ctx.setCursor(hoverCursor(e.screen));
      ctx.invalidateOverlay();
    },
    pointerUp(e) {
      if (e.button !== PRIMARY || !press) return;
      ctrl = e.ctrl;
      latch(e);
      if (press.dragging) apply(e);
      else if (press.kind === 'empty') ctx.selection.clear();
      press = null;
      ctx.setCursor(null);
      ctx.invalidateOverlay();
    },
    cancel() {
      if (!press) return false;
      press = null;
      ctx.setCursor(null);
      ctx.invalidateOverlay();
      return true;
    },
    drawOverlay(g) {
      if (!ctx || !editing()) return;
      const found = handle(currentTarget(), ctrl);
      if (!found) return;
      const { pivot, knob } = found;
      const arm = GIZMO_SIZE.pivot;
      g.moveTo(pivot.x, pivot.y);
      g.lineTo(knob.x, knob.y);
      g.moveTo(pivot.x - arm, pivot.y);
      g.lineTo(pivot.x + arm, pivot.y);
      g.moveTo(pivot.x, pivot.y - arm);
      g.lineTo(pivot.x, pivot.y + arm);
      g.stroke({ width: LINE_WIDTH.outline, color: COLORS.highlight });
      g.circle(knob.x, knob.y, GIZMO_SIZE.rotateKnob);
      g.fill({ color: COLORS.highlight });
    },
  });
}
