import { pointInShape, shapeBounds, shapeGeometryValid } from '../../lib/geometry.js';
import { ROOT_UID } from '../model/model.js';
import { placement } from './placement.js';
import { HIT_RADIUS } from './style.js';

function screenDistance(camera, world, screen) {
  const point = camera.worldToScreen(world);
  return Math.hypot(point.x - screen.x, point.y - screen.y);
}

/**
 * Everything under a screen point in the displayed pose, topmost first: joints whose anchor is within
 * `HIT_RADIUS.joint` (later joints first), the root within `HIT_RADIUS.root`, then shapes containing the point
 * or within `HIT_RADIUS.shape` (later bodies first, later shapes of a body first). Bodies and sprites are never
 * hit; invalid shape geometry and non-finite anchors are skipped.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {import('./camera.js').Camera} camera Viewport camera.
 * @param {{ x: number, y: number }} screen Screen point, CSS px.
 * @param {{ pose?: import('./bounds.js').Pose|null }} [options] Displayed pose, root-local; rest pose when omitted.
 * @returns {number[]} Uids of type `joint`, `root` and `shape`.
 */
export function hitTest(model, camera, screen, { pose = null } = {}) {
  const placed = placement(model, pose);
  const hits = [];
  const joints = model.children(ROOT_UID, 'joints');
  for (let index = joints.length - 1; index >= 0; index--) {
    const anchor = placed.anchors.get(joints[index]);
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) continue;
    if (screenDistance(camera, anchor, screen) <= HIT_RADIUS.joint) hits.push(joints[index]);
  }
  if (screenDistance(camera, placed.root, screen) <= HIT_RADIUS.root) hits.push(ROOT_UID);
  const world = camera.screenToWorld(screen);
  const tolerance = HIT_RADIUS.shape / camera.scale;
  const bodies = model.children(ROOT_UID, 'bodies');
  for (let bodyIndex = bodies.length - 1; bodyIndex >= 0; bodyIndex--) {
    const transform = placed.bodies.get(bodies[bodyIndex]);
    const fixtures = model.children(bodies[bodyIndex], 'fixtures');
    for (let index = fixtures.length - 1; index >= 0; index--) {
      if (pointInShape(model.get(fixtures[index]).props.shape, transform, world, tolerance)) hits.push(fixtures[index]);
    }
  }
  return hits;
}

function finiteBounds(bounds) {
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite);
}

function boundsInside(bounds, box) {
  return bounds.minX >= box.minX && bounds.maxX <= box.maxX && bounds.minY >= box.minY && bounds.maxY <= box.maxY;
}

function placedBounds(shape, transform) {
  if (!shapeGeometryValid(shape)) return null;
  try {
    const bounds = shapeBounds(shape, transform);
    return finiteBounds(bounds) ? bounds : null;
  } catch {
    return null;
  }
}

/**
 * Everything inside a world box in the displayed pose: shapes lying entirely inside it (body order, then
 * fixture order), then joints whose anchor lies inside it (`joints` order). Edges count as inside. The root,
 * bodies and sprites are never returned; invalid shape geometry and non-finite anchors are skipped.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {import('../../lib/geometry.js').Aabb} box World box, meters, Y up.
 * @param {{ pose?: import('./bounds.js').Pose|null }} [options] Displayed pose, root-local; rest pose when omitted.
 * @returns {number[]} Uids of type `shape`, then `joint`.
 */
export function boxTest(model, box, { pose = null } = {}) {
  const placed = placement(model, pose);
  const found = [];
  for (const body of model.children(ROOT_UID, 'bodies')) {
    const transform = placed.bodies.get(body);
    for (const fixture of model.children(body, 'fixtures')) {
      const bounds = placedBounds(model.get(fixture).props.shape, transform);
      if (bounds && boundsInside(bounds, box)) found.push(fixture);
    }
  }
  for (const joint of model.children(ROOT_UID, 'joints')) {
    const anchor = placed.anchors.get(joint);
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) continue;
    if (anchor.x >= box.minX && anchor.x <= box.maxX && anchor.y >= box.minY && anchor.y <= box.maxY) found.push(joint);
  }
  return found;
}
