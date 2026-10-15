import { pointInShape } from '../../lib/geometry.js';
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
