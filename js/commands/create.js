import { autoClipKey, defaultsOf } from '../../lib/schema.js';
import { ROOT_UID } from '../model/model.js';
import { jointBetween } from '../model/queries.js';

const SHAPE_TYPES = ['circle', 'box'];
const SIZE_FIELDS = { circle: ['radius'], box: ['width', 'height'] };

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validate(position, angle, shape) {
  if (!SHAPE_TYPES.includes(shape?.type)) throw new Error(`Unsupported shape type "${shape?.type}"`);
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  if (!finite(position?.x) || !finite(position?.y)) throw new RangeError('position must be a pair of finite numbers');
  if (!finite(angle)) throw new RangeError('angle must be a finite number');
  for (const field of SIZE_FIELDS[shape.type]) {
    if (!isPositiveNumber(shape[field])) throw new RangeError(`${field} must be a finite number above 0`);
  }
}

function numberOf(id) {
  return id.slice(id.indexOf('_') + 1);
}

/**
 * Builds a command that creates one body holding one shape. `run` returns the new shape uid. The body takes
 * `position` and `angle`; the shape is stored around the body origin, with schema defaults for every field
 * not given. When `rootBody` is `null` the new body becomes the root body.
 * @param {{ position: { x: number, y: number }, angle: number, shape: { type: 'circle', radius: number } | { type: 'box', width: number, height: number } }} spec
 *   Body position (root-local, meters), body angle (radians) and the shape record.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds an unknown or unsupported shape type.
 * @throws {RangeError} When `run` finds a non-finite `position` or `angle`, or a size that is not above 0;
 *   nothing is mutated and no id is allocated then.
 */
export function createShapeBody({ position, angle, shape } = {}, label = `Create ${shape?.type}`) {
  return Object.freeze({
    label,
    run(tx) {
      validate(position, angle, shape);
      const { model } = tx;
      const bodyId = model.nextId('b');
      const shapeId = model.nextId('f');
      const { fixtures, ...bodyDefaults } = defaultsOf('body');
      const shapeDefaults = defaultsOf('shape', shape.type);
      const bodyProps = {
        ...bodyDefaults,
        id: bodyId,
        name: `body_${numberOf(bodyId)}`,
        position: [position.x, position.y],
        angle,
      };
      const shapeProps = {
        ...shapeDefaults,
        id: shapeId,
        name: `${shape.type}_${numberOf(shapeId)}`,
        shape: { ...shapeDefaults.shape, ...shape },
      };
      const bodyUid = tx.add(ROOT_UID, 'bodies', undefined, {
        type: 'body',
        props: bodyProps,
        children: { fixtures: [{ type: 'shape', props: shapeProps }] },
      });
      const rootBody = model.prop(ROOT_UID, 'rootBody');
      if (rootBody === null || rootBody === undefined) tx.set(ROOT_UID, 'rootBody', bodyId);
      return model.children(bodyUid, 'fixtures')[0];
    },
  });
}

function validateJoint(model, bodyA, bodyB, anchor, limits) {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const isBody = (uid) => model.get(uid)?.type === 'body';
  const unassigned = bodyA === null && bodyB === null;
  if (!unassigned) {
    if (!isBody(bodyA) || !isBody(bodyB)) throw new Error('bodyA and bodyB must be body uids, or both null');
    if (bodyA === bodyB) throw new Error('bodyA and bodyB must be different bodies');
    if (jointBetween(model, bodyA, bodyB) !== null) throw new Error('A joint already connects these bodies');
  }
  if (!finite(anchor?.x) || !finite(anchor?.y)) throw new RangeError('anchor must be a pair of finite numbers');
  if (limits === undefined) return;
  if (typeof limits?.enabled !== 'boolean') throw new RangeError('limits.enabled must be a boolean');
  if (!finite(limits.lower) || !finite(limits.upper)) throw new RangeError('limits must be finite numbers');
  if (limits.lower > 0 || limits.upper < 0) throw new RangeError('limits must satisfy lower <= 0 <= upper');
}

/**
 * Builds a command that appends one revolute joint between two bodies, already ordered by the caller, or an
 * unassigned joint when both bodies are `null`. `run` returns the new joint uid. Every field not given takes its
 * schema default; `rootBody` is untouched.
 * @param {{ bodyA: number|null, bodyB: number|null, anchor: { x: number, y: number }, limits?: { enabled: boolean, lower: number, upper: number } }} spec
 *   Body uids (parent, child) or both `null`, anchor (root-local meters, rest pose) and optional limits (radians).
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds a uid that is not a body, only one `null` body, equal uids, or a joint already
 *   connecting the pair.
 * @throws {RangeError} When `run` finds a non-finite `anchor`, or `limits` with a non-boolean `enabled`, a
 *   non-finite bound, `lower > 0` or `upper < 0`; nothing is mutated and no id is allocated then.
 */
export function createJoint({ bodyA, bodyB, anchor, limits } = {}, label = 'Create joint') {
  return Object.freeze({
    label,
    run(tx) {
      const { model } = tx;
      validateJoint(model, bodyA, bodyB, anchor, limits);
      const jointId = model.nextId('j');
      const props = {
        ...defaultsOf('joint'),
        id: jointId,
        name: `joint_${numberOf(jointId)}`,
        bodyA: bodyA === null ? null : model.prop(bodyA, 'id'),
        bodyB: bodyB === null ? null : model.prop(bodyB, 'id'),
        anchor: [anchor.x + 0, anchor.y + 0],
      };
      if (limits !== undefined) props.limits = { enabled: limits.enabled, lower: limits.lower + 0, upper: limits.upper + 0 };
      return tx.add(ROOT_UID, 'joints', undefined, { type: 'joint', props });
    },
  });
}

function uniqueName(base, names) {
  const used = new Set(names);
  let name = base;
  for (let n = 2; used.has(name); n += 1) name = `${base} ${n}`;
  return name;
}

/**
 * Builds a command that appends one empty clip with schema defaults, a name no existing clip uses ("New Clip",
 * "New Clip 2", ...) and a key from `autoClipKey` that no existing clip uses. `run` returns the new clip uid.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 */
export function createClip(label = 'Create clip') {
  return Object.freeze({
    label,
    run(tx) {
      const { model } = tx;
      const { tracks, events, ...props } = defaultsOf('clip');
      const clips = model.children(ROOT_UID, 'clips');
      const taken = clips.map((clip) => model.prop(clip, 'key'));
      props.name = uniqueName(props.name, clips.map((clip) => model.prop(clip, 'name')));
      props.key = autoClipKey(props.name, taken);
      return tx.add(ROOT_UID, 'clips', undefined, { type: 'clip', props });
    },
  });
}
