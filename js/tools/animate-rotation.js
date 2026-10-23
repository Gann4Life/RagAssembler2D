import { jointAngleForBody } from '../../lib/evaluate.js';
import { setJointAngleKey } from '../commands/keys.js';
import { toJson } from '../model/io.js';
import { animatePose } from '../model/animate-preview.js';
import { jointTree } from '../model/queries.js';
import { placement } from '../viewport/placement.js';
import { manipulationTarget, sweepTracker } from './manipulation.js';
import { formatRotation } from './transform-gizmo.js';

const PREVIEW_VERSION = 'preview';

/**
 * What an Animate-mode rotation turns: one body and the joint that parents it in the FK tree.
 * @typedef {object} AnimateTarget
 * @property {number} body Body uid.
 * @property {number} joint Uid of the body's parent joint.
 */

/**
 * The rotation target of a selection in Animate mode: exactly one body (or the body of one shape) that has a parent
 * joint in the FK tree from `rootBody`. Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {number[]} objects Selected uids.
 * @returns {Readonly<AnimateTarget>|null} The target, or `null` for several objects, a joint, the root body or a body
 *   outside the tree.
 */
export function animateRotationTarget(model, objects) {
  const target = manipulationTarget(model, objects);
  if (target.bodies.length !== 1 || target.joints.length !== 0) return null;
  const joint = jointTree(model).parent.get(target.bodies[0]);
  return joint === undefined ? null : Object.freeze({ body: target.bodies[0], joint });
}

/**
 * Pivot of an Animate-mode rotation: the joint anchor as displayed in a pose. Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {import('../viewport/bounds.js').Pose|null} pose Displayed pose, root-local, by body uid.
 * @param {number} joint Joint uid.
 * @returns {import('../../lib/geometry.js').Vec2|null} Anchor, world meters; `null` when it is not finite.
 */
export function animateRotationPivot(model, pose, joint) {
  const anchor = placement(model, pose).anchors.get(joint);
  return anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y) ? Object.freeze({ x: anchor.x, y: anchor.y }) : null;
}

/**
 * Joint angle a body rotation produces, from the pose the body was rotated in. Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {import('../viewport/bounds.js').Pose} pose Pose at the start of the rotation, by body uid.
 * @param {AnimateTarget} target Rotated body and its parent joint.
 * @param {number} turn Rotation applied to the body, radians, counter-clockwise positive.
 * @returns {{ angle: number, base: number, direction: 1|-1 }} Joint `angle` after the turn, before it, and the sign
 *   with which a counter-clockwise body turn changes the joint angle, radians.
 */
export function rotatedJointAngle(model, pose, target, turn) {
  const def = toJson(model, PREVIEW_VERSION);
  const poseById = new Map([...pose].map(([uid, transform]) => [model.prop(uid, 'id'), transform]));
  const jointId = model.prop(target.joint, 'id');
  const bodyAngle = pose.get(target.body).angle;
  const base = jointAngleForBody(def, jointId, bodyAngle, poseById);
  const angle = jointAngleForBody(def, jointId, bodyAngle + turn, poseById);
  return { angle, base, direction: jointAngleForBody(def, jointId, bodyAngle + 1, poseById) - base > 0 ? 1 : -1 };
}

/**
 * Starts a rotation drag in Animate mode: the pointer's sweep around the parent joint's anchor turns the body, and each
 * step sets the joint `angle` key at the playhead (CTRL snaps the joint angle to 15°; SHIFT and ALT do nothing).
 * Executes one command per step on `ctx.history`.
 * @param {import('./tool.js').ToolContext} ctx Tool context.
 * @param {{ target: AnimateTarget, press: import('./tool.js').ToolPointerEvent }} options Target and press event.
 * @returns {import('./manipulation.js').Manipulation} The drag.
 * @throws {Error} When no clip is open.
 */
export function startAnimateRotation(ctx, { target, press }) {
  const { model, modes } = ctx;
  const clip = modes.clip;
  if (clip === null) throw new Error('A clip must be open to rotate in Animate mode');
  const time = modes.playhead;
  const pose = animatePose(model, clip, time);
  const pivot = animateRotationPivot(model, pose, target.joint);
  const tracker = sweepTracker(ctx, pivot, press.world);
  const start = Math.atan2(press.world.y - pivot.y, press.world.x - pivot.x);
  let applied = 0;

  return Object.freeze({
    apply(e) {
      const raw = rotatedJointAngle(model, pose, target, tracker.update(e.world));
      const angle = ctx.snapAngle(raw.angle, e.ctrl);
      applied = (angle - raw.base) * raw.direction + 0;
      ctx.history.execute(setJointAngleKey(clip, target.joint, time, angle, 'Rotate joint'));
    },
    pivot() {
      return pivot;
    },
    sweep() {
      return { start, angle: applied };
    },
    readout() {
      return formatRotation(applied);
    },
  });
}
