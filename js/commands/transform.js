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
 * Pivot of one body: its parent joint's anchor when that joint exists and its anchor is placed, else the body
 * origin; the origin always when `center`. Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {number} bodyUid Body uid.
 * @param {boolean} center Whether to force the body origin.
 * @returns {import('../../lib/geometry.js').Vec2} Pivot, root-local meters.
 */
export function rotationPivot(model, bodyUid, center) {
  const position = model.prop(bodyUid, 'position');
  const origin = isFinitePair(position) ? { x: position[0], y: position[1] } : { x: 0, y: 0 };
  if (center) return origin;
  const joint = parentJoints(model).get(bodyUid);
  if (joint === undefined) return origin;
  const anchor = model.prop(joint, 'anchor');
  return isFinitePair(anchor) ? { x: anchor[0], y: anchor[1] } : origin;
}

const REST_EPSILON = 1e-12;
const PLACEMENT_FIELDS =Object.freeze(['x', 'y', 'angle']);

function placement(model, uid, values) {
  const parts = manipulationParts(model, { bodies: [uid], joints: [] }, { subtree: true });
  const start = bodyEntry(model, uid);
  let moved = parts;
  let position = start.position;
  if (values.angle !== undefined) {
    const turn = rotationAbout(rotationPivot(model, uid, false), values.angle - start.angle);
    moved = transformParts(moved, turn);
    position = transformPoint(turn, position);
  }
  const dx = values.x === undefined ? 0 : values.x - position.x;
  const dy = values.y === undefined ? 0 : values.y - position.y;
  if (dx !== 0 || dy !== 0) moved = transformParts(moved, { x: dx, y: dy, angle: 0 });
  const exact = (entry) => {
    if (entry.uid !== uid) return entry;
    return {
      uid,
      position: vec(values.x ?? entry.position.x, values.y ?? entry.position.y),
      angle: values.angle === undefined ? entry.angle : values.angle + 0,
    };
  };
  return freezeParts(moved.bodies.map(exact), [...moved.anchors]);
}

/**
 * Builds a command that places bodies at absolute values, each carrying its subtree and the anchors it carries, as
 * a Select move or rotation without ALT: `x`/`y` translate the subtree so the body's origin lands on the value;
 * `angle` turns it around `rotationPivot(model, uid, false)` so the body's angle becomes the value (rotation first
 * when both are given). Bodies are placed one after the other in `uids` order, each read where the earlier ones left
 * it, so each ends at the values; a selected ancestor goes before the bodies of its subtree.
 * @param {number[]} uids Body uids, in order.
 * @param {{ x?: number, y?: number, angle?: number }} values Root-local meters and radians.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds a uid that is not a body; nothing is mutated then.
 * @throws {RangeError} When `run` finds a given value that is not a finite number; nothing is mutated then.
 */
export function placeBodies(uids, values, label = 'Move') {
  return Object.freeze({
    label,
    run(tx) {
      const { model } = tx;
      for (const uid of uids) if (typeOf(model, uid) !== 'body') throw new Error(`Node ${uid} is not a body`);
      const given = {};
      for (const field of PLACEMENT_FIELDS) {
        const value = values?.[field];
        if (value === undefined) continue;
        if (!isFiniteNumber(value)) throw new RangeError(`Placement ${field} must be a finite number`);
        given[field] = value;
      }
      for (const uid of ancestorsFirst(model, uids)) placeParts(placement(model, uid, given), label).run(tx);
    },
  });
}

function ancestorsFirst(model, uids) {
  const parents = parentJoints(model);
  const subtrees = new Map(uids.map((uid) => [uid, bodySubtree(model, uid, parents)]));
  const order = [];
  const visit = (uid, path) => {
    if (order.includes(uid) || path.has(uid)) return;
    path.add(uid);
    for (const other of uids) {
      if (other !== uid && subtrees.get(other).has(uid) && !subtrees.get(uid).has(other)) visit(other, path);
    }
    order.push(uid);
  };
  for (const uid of uids) visit(uid, new Set());
  return order;
}

/**
 * The rest angle of a joint and what turning it needs.
 * @typedef {object} JointRest
 * @property {number|null} rest `bodyB.angle − bodyA.angle` in radians; `null` when a body is missing or has no finite angle.
 * @property {number|null} child Child body uid (the body the joint is the parent joint of); `null` for a loop joint or invalid bodies.
 * @property {boolean} reversed Whether the child is bodyA.
 * @property {boolean} placed Whether the anchor is a finite pair.
 */

/**
 * Reads the rest angle of a joint (`DESIGN.md` §2.4) and whether it can be turned. Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {number} jointUid Joint uid.
 * @param {Map<number, number>} [parents] Result of `parentJoints(model)`, to reuse across calls.
 * @returns {Readonly<JointRest>} The frozen rest angle information.
 * @throws {Error} When `jointUid` is not a joint.
 */
export function jointRest(model, jointUid, parents = parentJoints(model)) {
  if (typeOf(model, jointUid) !== 'joint') throw new Error(`Node ${jointUid} is not a joint`);
  const a = bodyUidOf(model, model.prop(jointUid, 'bodyA'));
  const b = bodyUidOf(model, model.prop(jointUid, 'bodyB'));
  const angleA = a === null ? null : model.prop(a, 'angle');
  const angleB = b === null ? null : model.prop(b, 'angle');
  const valid = a !== null && b !== null && a !== b && isFiniteNumber(angleA) && isFiniteNumber(angleB);
  const child = valid ? jointChildBody(model, jointUid, parents) : null;
  return Object.freeze({
    rest: valid ? angleB - angleA + 0 : null,
    child,
    reversed: child !== null && child === a,
    placed: isFinitePair(model.prop(jointUid, 'anchor')),
  });
}

/**
 * Builds a command that turns the child body subtree of each joint about its anchor, as Select's rotation ring
 * does without ALT, until the joint's rest angle is `angle`; the turn is the opposite way for a reversed joint.
 * Joints are placed one after the other in one transaction through `placeBodies`.
 * @param {import('../model/model.js').Model} model Document model, read to skip joints already at `angle`.
 * @param {number[]} jointUids Joint uids.
 * @param {number} angle Rest angle, radians.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command|null} The command, or `null` when every joint already has the rest angle.
 * @throws {RangeError} When `angle` is not a finite number.
 * @throws {Error} When `run` finds a joint without a child body, without a placed anchor or without valid bodies; nothing is mutated then.
 */
export function setRestAngles(model, jointUids, angle, label = 'Edit rest angle') {
  if (!isFiniteNumber(angle)) throw new RangeError('Rest angle must be a finite number');
  const differs = (current, uid) => {
    const { rest } = jointRest(current, uid);
    return rest === null || Math.abs(rest - angle) > REST_EPSILON;
  };
  if (!jointUids.some((uid) => differs(model, uid))) return null;
  return Object.freeze({
    label,
    run(tx) {
      const { model: current } = tx;
      for (const uid of jointUids) {
        const info = jointRest(current, uid);
        if (info.child === null || !info.placed || info.rest === null) throw new Error(`Joint ${uid} has no child body or placed anchor`);
      }
      for (const uid of jointUids) {
        if (!differs(current, uid)) continue;
        const { child, reversed } = jointRest(current, uid);
        const [a, b] = [bodyUidOf(current, current.prop(uid, 'bodyA')), bodyUidOf(current, current.prop(uid, 'bodyB'))];
        const target = reversed ? current.prop(b, 'angle') - angle : current.prop(a, 'angle') + angle;
        placeBodies([child], { angle: target }, label).run(tx);
      }
    },
  });
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
