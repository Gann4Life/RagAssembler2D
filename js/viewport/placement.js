import { composeTransforms, invertTransform, transformPoint } from '../../lib/geometry.js';
import { ROOT_UID } from '../model/model.js';

/**
 * World placement of the displayed pose, in meters and radians.
 * @typedef {object} Placement
 * @property {import('../../lib/geometry.js').Transform} root Root transform.
 * @property {Map<number, import('../../lib/geometry.js').Transform>} bodies Body world transforms by uid.
 * @property {Map<number, import('../../lib/geometry.js').Vec2>} anchors Joint anchors by uid; may be non-finite for malformed data.
 * @property {Map<number, number|null>} zero Joint zero directions by uid, world radians (the root's +X at rest,
 *   turned with `bodyA`); `null` without a valid `bodyA`, `bodyB` and anchor.
 * @property {Map<number, number>} angles Current joint angles by uid, radians, 0 at rest.
 */

function vec(value) {
  return Array.isArray(value) ? { x: value[0], y: value[1] } : { x: Number.NaN, y: Number.NaN };
}

function restTransform(props) {
  const position = Array.isArray(props.position) ? props.position : [0, 0];
  return { x: position[0], y: position[1], angle: props.angle ?? 0 };
}

function bodyUidOf(model, id) {
  if (typeof id !== 'string') return null;
  const uid = model.uidOf(id);
  return uid !== null && uid !== undefined && model.get(uid)?.type === 'body' ? uid : null;
}

/**
 * Places the root, bodies and joints as displayed: bodies take their pose transform when given, else their
 * rest transform; a joint anchor keeps its rest position relative to `bodyA`. A joint's zero direction is the
 * root's +X at rest, turned with `bodyA` since rest, and joint angles are bodyB's rotation relative to bodyA since
 * rest.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {import('./bounds.js').Pose|null} [pose] Root-local body transforms replacing the rest pose.
 * @returns {Placement} World placement.
 */
export function placement(model, pose = null) {
  const root = restTransform(model.get(ROOT_UID).props);
  const rest = new Map();
  const local = new Map();
  const bodies = new Map();
  for (const uid of model.children(ROOT_UID, 'bodies')) {
    const restBody = restTransform(model.get(uid).props);
    const shown = pose?.get(uid) ?? restBody;
    rest.set(uid, restBody);
    local.set(uid, shown);
    bodies.set(uid, composeTransforms(root, shown));
  }
  const anchors = new Map();
  const zero = new Map();
  const angles = new Map();
  for (const uid of model.children(ROOT_UID, 'joints')) {
    const props = model.get(uid).props;
    const anchor = vec(props.anchor);
    const bodyA = bodyUidOf(model, props.bodyA);
    const bodyB = bodyUidOf(model, props.bodyB);
    const restA = bodyA === null ? null : rest.get(bodyA);
    const shownA = bodyA === null ? null : local.get(bodyA);
    const shownAnchor = restA ? transformPoint(shownA, transformPoint(invertTransform(restA), anchor)) : anchor;
    anchors.set(uid, transformPoint(root, shownAnchor));
    if (restA && bodyB !== null && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
      const restB = rest.get(bodyB);
      const shownB = local.get(bodyB);
      const turn = shownA.angle - restA.angle;
      zero.set(uid, turn + root.angle + 0);
      angles.set(uid, shownB.angle - shownA.angle - (restB.angle - restA.angle) + 0);
    } else {
      zero.set(uid, null);
      angles.set(uid, 0);
    }
  }
  return { root, bodies, anchors, zero, angles };
}
