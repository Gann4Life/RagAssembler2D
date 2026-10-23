import { transformPoint } from '../../lib/geometry.js';
import { ROOT_UID } from '../model/model.js';
import { bodySubtree, jointChildBody, parentJoints } from '../model/queries.js';

/**
 * What a manipulation moves, in root-local meters and radians.
 * @typedef {object} Parts
 * @property {ReadonlyArray<{ uid: number, position: import('../../lib/geometry.js').Vec2, angle: number }>} bodies
 *   Bodies with their position and angle.
 * @property {ReadonlyArray<{ uid: number, anchor: import('../../lib/geometry.js').Vec2 }>} anchors Joints with their anchor.
 */

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePair(value) {
  return Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);
}

function typeOf(model, uid) {
  return model.get(uid)?.type ?? null;
}

function bodyUidOf(model, id) {
  if (typeof id !== 'string') return null;
  const uid = model.uidOf(id);
  return uid !== null && typeOf(model, uid) === 'body' ? uid : null;
}

function vec(x, y) {
  return Object.freeze({ x: x + 0, y: y + 0 });
}

function freezeParts(bodies, anchors) {
  return Object.freeze({
    bodies: Object.freeze(bodies.map((entry) => Object.freeze(entry))),
    anchors: Object.freeze(anchors.map((entry) => Object.freeze(entry))),
  });
}

function bodyEntry(model, uid) {
  const position = model.prop(uid, 'position');
  const angle = model.prop(uid, 'angle');
  return {
    uid,
    position: isFinitePair(position) ? vec(position[0], position[1]) : vec(0, 0),
    angle: isFiniteNumber(angle) ? angle + 0 : 0,
  };
}

/**
 * Start values of what a manipulation target moves: the given bodies and the child bodies of the given joints (with
 * their subtrees when `subtree`), and
 * the placed anchors of the given joints, of the moved bodies' parent joints and of joints between two moved bodies.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {{ bodies: number[], joints: number[] }} target Body and joint uids.
 * @param {{ subtree: boolean }} options Whether each body carries its subtree.
 * @returns {Readonly<Parts>} Frozen parts, bodies in `bodies` order and anchors in `joints` order.
 * @throws {Error} When a body uid is not a body or a joint uid is not a joint.
 */
export function manipulationParts(model, { bodies, joints }, { subtree }) {
  for (const uid of bodies) if (typeOf(model, uid) !== 'body') throw new Error(`Node ${uid} is not a body`);
  for (const uid of joints) if (typeOf(model, uid) !== 'joint') throw new Error(`Node ${uid} is not a joint`);
  const parents = parentJoints(model);
  const moved = new Set();
  for (const body of bodies) {
    for (const uid of subtree ? bodySubtree(model, body, parents) : [body]) moved.add(uid);
  }
  if (subtree) {
    for (const joint of joints) {
      const child = jointChildBody(model, joint, parents);
      if (child === null) continue;
      for (const uid of bodySubtree(model, child, parents)) moved.add(uid);
    }
  }
  const carried = new Set(joints);
  for (const body of moved) if (parents.has(body)) carried.add(parents.get(body));
  const bodyEntries = model
    .children(ROOT_UID, 'bodies')
    .filter((uid) => moved.has(uid))
    .map((uid) => bodyEntry(model, uid));
  const anchorEntries = [];
  for (const uid of model.children(ROOT_UID, 'joints')) {
    const props = model.get(uid).props;
    if (!isFinitePair(props.anchor)) continue;
    const a = bodyUidOf(model, props.bodyA);
    const b = bodyUidOf(model, props.bodyB);
    const inside = a !== null && b !== null && a !== b && moved.has(a) && moved.has(b);
    if (carried.has(uid) || inside) anchorEntries.push({ uid, anchor: vec(props.anchor[0], props.anchor[1]) });
  }
  return freezeParts(bodyEntries, anchorEntries);
}

/**
 * Applies a rigid transform to every position, angle and anchor of `parts`. Pure; never yields `-0`.
 * @param {Readonly<Parts>} parts Parts, root-local.
 * @param {import('../../lib/geometry.js').Transform} t Transform in the root-local frame.
 * @returns {Readonly<Parts>} New frozen parts.
 */
export function transformParts(parts, t) {
  const point = (p) => {
    const { x, y } = transformPoint(t, p);
    return vec(x, y);
  };
  return freezeParts(
    parts.bodies.map(({ uid, position, angle }) => ({ uid, position: point(position), angle: angle + t.angle + 0 })),
    parts.anchors.map(({ uid, anchor }) => ({ uid, anchor: point(anchor) })),
  );
}

/**
 * The transform that rotates by `angle` around `pivot`.
 * @param {import('../../lib/geometry.js').Vec2} pivot Pivot, meters.
 * @param {number} angle Rotation, radians, counter-clockwise.
 * @returns {import('../../lib/geometry.js').Transform} The transform.
 */
export function rotationAbout(pivot, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: pivot.x - (cos * pivot.x - sin * pivot.y) + 0,
    y: pivot.y - (sin * pivot.x + cos * pivot.y) + 0,
    angle,
  };
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateParts(model, parts) {
  for (const { uid, position, angle } of parts.bodies) {
    if (typeOf(model, uid) !== 'body') throw new Error(`Node ${uid} is not a body`);
    if (!isFiniteNumber(position?.x) || !isFiniteNumber(position?.y) || !isFiniteNumber(angle)) {
      throw new RangeError(`Body ${uid} needs a finite position and angle`);
    }
  }
  for (const { uid, anchor } of parts.anchors) {
    if (typeOf(model, uid) !== 'joint') throw new Error(`Node ${uid} is not a joint`);
    if (!isFiniteNumber(anchor?.x) || !isFiniteNumber(anchor?.y)) throw new RangeError(`Joint ${uid} needs a finite anchor`);
  }
}

/**
 * Builds a command that sets each listed body's `position` and `angle` and each listed joint's `anchor`, in list
 * order, skipping values equal to the current ones.
 * @param {Readonly<Parts>} parts Absolute values, root-local meters and radians.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds a body entry that is not a body or an anchor entry that is not a joint.
 * @throws {RangeError} When `run` finds a non-finite number; nothing is mutated then.
 */
export function placeParts(parts, label = 'Move') {
  return Object.freeze({
    label,
    run(tx) {
      const { model } = tx;
      validateParts(model, parts);
      const write = (uid, path, value) => {
        if (!sameValue(model.prop(uid, path), value)) tx.set(uid, path, value);
      };
      for (const { uid, position, angle } of parts.bodies) {
        write(uid, 'position', [position.x + 0, position.y + 0]);
        write(uid, 'angle', angle + 0);
      }
      for (const { uid, anchor } of parts.anchors) write(uid, 'anchor', [anchor.x + 0, anchor.y + 0]);
    },
  });
}
