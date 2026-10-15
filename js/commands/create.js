import { defaultsOf } from '../../lib/schema.js';
import { ROOT_UID } from '../model/model.js';

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
