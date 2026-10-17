import { polygonCentroid, shapeGeometryValid } from '../../lib/geometry.js';
import { ROOT_UID } from '../model/model.js';
import { referencesTo } from '../model/queries.js';
import { deletionPlan } from './delete.js';

/**
 * What grouping the bodies of a selection does, computed from the model before mutating it.
 * @typedef {object} GroupPlan
 * @property {ReadonlyArray<number>} bodies Merged bodies, in `bodies` order, survivor included.
 * @property {number|null} survivor Body that keeps the shapes: `rootBody` when merged, else the first merged body;
 *   `null` when `bodies` is empty.
 * @property {ReadonlyArray<number>} joints Internal joints (both bodies merged), deleted, in `joints` order.
 * @property {ReadonlyArray<number>} redirected Other joints that reference a merged body other than the survivor,
 *   in `joints` order.
 * @property {Readonly<import('./delete.js').DeletionPlan>} deletion Deletion plan of the internal joints, with the
 *   tracks and clips removed with them.
 * @property {boolean} invalid Whether a moved shape has invalid geometry or a merged body a non-finite transform.
 * @property {boolean} confirm Whether internal joints are deleted and the user must confirm.
 * @property {boolean} empty Whether fewer than two bodies would merge.
 */

/**
 * Shapes moved together out of one body into a new body.
 * @typedef {object} SplitPart
 * @property {number} body Source body uid.
 * @property {ReadonlyArray<number>} shapes Shape uids moved, in fixture order.
 */

const TAU = 2 * Math.PI;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePair(value) {
  return Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function wrapAngle(angle) {
  if (angle > -Math.PI && angle <= Math.PI) return angle + 0;
  const wrapped = ((((angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return (wrapped === -Math.PI ? Math.PI : wrapped) + 0;
}

function rotate(x, y, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin + 0, x * sin + y * cos + 0];
}

function resolve(model, id) {
  return typeof id === 'string' ? model.uidOf(id) : null;
}

function readSelection(model, uids) {
  const givenBodies = new Set();
  const shapes = new Set();
  const picked = new Set();
  for (const uid of uids) {
    const node = model.get(uid);
    if (node === null) throw new Error(`Unknown node uid ${uid}`);
    if (node.type === 'body') {
      givenBodies.add(uid);
      picked.add(uid);
    } else if (node.type === 'shape') {
      shapes.add(uid);
      picked.add(node.parent);
    }
  }
  const bodies = model.children(ROOT_UID, 'bodies').filter((body) => picked.has(body));
  return { bodies, givenBodies, shapes };
}

function bodyTransformValid(model, body) {
  const position = model.prop(body, 'position');
  const angle = model.prop(body, 'angle');
  return (position === undefined || isFinitePair(position)) && (angle === undefined || isFiniteNumber(angle));
}

function frameOf(model, body) {
  const position = model.prop(body, 'position');
  const angle = model.prop(body, 'angle');
  return {
    x: isFinitePair(position) ? position[0] + 0 : 0,
    y: isFinitePair(position) ? position[1] + 0 : 0,
    angle: isFiniteNumber(angle) ? angle + 0 : 0,
  };
}

function shapeValid(model, shape) {
  return shapeGeometryValid(model.prop(shape, 'shape'));
}

function shapeCenter(record) {
  if (record.type === 'polygon') return polygonCentroid(record.vertices);
  return { x: record.center[0], y: record.center[1] };
}

function relativeFrame(from, to) {
  const [x, y] = rotate(from.x - to.x, from.y - to.y, -to.angle);
  return { x, y, delta: from.angle - to.angle + 0 };
}

function mapPoint(relative, [px, py]) {
  const [x, y] = rotate(px, py, relative.delta);
  return [relative.x + x + 0, relative.y + y + 0];
}

function writer(tx) {
  return (uid, path, value) => {
    if (!sameValue(tx.model.prop(uid, path), value)) tx.set(uid, path, value);
  };
}

function reexpressShape(tx, shape, relative) {
  const write = writer(tx);
  const record = tx.model.prop(shape, 'shape');
  if (record.type === 'polygon') {
    write(shape, 'shape.vertices', record.vertices.map((vertex) => mapPoint(relative, vertex)));
  } else {
    write(shape, 'shape.center', mapPoint(relative, record.center));
  }
  if (relative.delta === 0) return;
  if (record.type === 'box') {
    write(shape, 'shape.angle', wrapAngle(record.angle + relative.delta));
    return;
  }
  const sprite = tx.model.prop(shape, 'sprite');
  if (!isPlainObject(sprite)) return;
  const offset = sprite.offset === undefined ? [0, 0] : sprite.offset;
  if (isFinitePair(offset)) write(shape, 'sprite.offset', rotate(offset[0], offset[1], relative.delta));
  const angle = sprite.angle === undefined ? 0 : sprite.angle;
  if (isFiniteNumber(angle)) write(shape, 'sprite.angle', wrapAngle(angle + relative.delta));
}

/**
 * Computes what grouping the bodies of a selection does: the given bodies plus the body of every given shape are
 * merged into the survivor; joints between two merged bodies are deleted with their tracks, other joints to merged
 * bodies are redirected to the survivor. Other node types are ignored. Reads the model only.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {ReadonlyArray<number>} uids Selected uids.
 * @returns {Readonly<GroupPlan>} The frozen plan.
 * @throws {Error} When a uid is unknown.
 */
export function groupPlan(model, uids) {
  const { bodies } = readSelection(model, uids);
  const rootBody = resolve(model, model.prop(ROOT_UID, 'rootBody'));
  const survivor = bodies.length === 0 ? null : bodies.includes(rootBody) ? rootBody : bodies[0];
  const merged = new Set(bodies);
  const joints = [];
  const redirected = [];
  if (bodies.length >= 2) {
    const touching = new Set(bodies.flatMap((body) => referencesTo(model, body).joints));
    for (const joint of model.children(ROOT_UID, 'joints')) {
      if (!touching.has(joint)) continue;
      const { bodyA, bodyB } = model.get(joint).props;
      const a = resolve(model, bodyA);
      const b = resolve(model, bodyB);
      if (merged.has(a) && merged.has(b)) joints.push(joint);
      else if ((merged.has(a) && a !== survivor) || (merged.has(b) && b !== survivor)) redirected.push(joint);
    }
  }
  const invalid =
    bodies.some((body) => !bodyTransformValid(model, body)) ||
    bodies.some((body) => body !== survivor && model.children(body, 'fixtures').some((shape) => !shapeValid(model, shape)));
  return Object.freeze({
    bodies: Object.freeze(bodies),
    survivor,
    joints: Object.freeze(joints),
    redirected: Object.freeze(redirected),
    deletion: deletionPlan(model, joints),
    invalid,
    confirm: joints.length > 0,
    empty: bodies.length < 2,
  });
}

/**
 * Builds a command that groups the bodies of a selection as {@link groupPlan} computes when it runs: removes the
 * internal joints' tracks and the internal joints, moves every other merged body's shapes to the survivor keeping
 * their world placement, redirects the other joints, then removes the emptied bodies. `rootBody` never changes.
 * `run` returns the survivor's shape uids, in fixture order.
 * @param {ReadonlyArray<number>} uids Selected uids.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds an unknown uid, an empty plan or an invalid plan; nothing is mutated then.
 */
export function groupBodies(uids, label = 'Group') {
  const requested = Object.freeze([...uids]);
  return Object.freeze({
    label,
    run(tx) {
      const { model } = tx;
      const plan = groupPlan(model, requested);
      if (plan.empty) throw new Error('Group needs shapes of two or more bodies');
      if (plan.invalid) throw new Error('Group would re-express invalid geometry');
      const { survivor } = plan;
      const survivorFrame = frameOf(model, survivor);
      const survivorId = model.prop(survivor, 'id');
      const others = plan.bodies.filter((body) => body !== survivor);
      const relatives = new Map(others.map((body) => [body, relativeFrame(frameOf(model, body), survivorFrame)]));
      for (const uid of [...plan.deletion.tracks, ...plan.joints]) tx.remove(uid);
      for (const body of others) {
        for (const shape of [...model.children(body, 'fixtures')]) {
          tx.move(shape, survivor, 'fixtures', undefined);
          reexpressShape(tx, shape, relatives.get(body));
        }
      }
      const write = writer(tx);
      for (const joint of plan.redirected) {
        const { bodyA, bodyB, aimAxis } = model.get(joint).props;
        const a = resolve(model, bodyA);
        const b = resolve(model, bodyB);
        if (relatives.has(a)) tx.set(joint, 'bodyA', survivorId);
        if (!relatives.has(b)) continue;
        tx.set(joint, 'bodyB', survivorId);
        const { delta } = relatives.get(b);
        const current = aimAxis === undefined ? 0 : aimAxis;
        if (delta !== 0 && isFiniteNumber(current)) write(joint, 'aimAxis', wrapAngle(current + delta));
      }
      for (const body of others) tx.remove(body);
      return [...model.children(survivor, 'fixtures')];
    },
  });
}

function partsInvalid(model, parts) {
  return parts.some(
    ({ body, shapes }) => !bodyTransformValid(model, body) || shapes.some((shape) => !shapeValid(model, shape)),
  );
}

function freezeParts(parts) {
  return Object.freeze(parts.map(({ body, shapes }) => Object.freeze({ body, shapes: Object.freeze([...shapes]) })));
}

/**
 * Computes what splitting a selection does: for each body of the selection, in `bodies` order, that is not itself
 * selected and has some but not all of its shapes selected, one part with those shapes. Reads the model only.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {ReadonlyArray<number>} uids Selected uids.
 * @returns {Readonly<{ parts: ReadonlyArray<Readonly<SplitPart>>, invalid: boolean }>} Frozen parts, and whether a
 *   part's shape has invalid geometry or its source body a non-finite transform.
 * @throws {Error} When a uid is unknown.
 */
export function splitParts(model, uids) {
  const { bodies, givenBodies, shapes } = readSelection(model, uids);
  const parts = [];
  for (const body of bodies) {
    if (givenBodies.has(body)) continue;
    const fixtures = model.children(body, 'fixtures');
    const moved = fixtures.filter((shape) => shapes.has(shape));
    if (moved.length > 0 && moved.length < fixtures.length) parts.push({ body, shapes: moved });
  }
  const frozen = freezeParts(parts);
  return Object.freeze({ parts: frozen, invalid: partsInvalid(model, frozen) });
}

/**
 * Computes what ungrouping a selection does: every body of the selection with two or more shapes keeps its first
 * shape, and each other shape is one single-shape part. Reads the model only.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {ReadonlyArray<number>} uids Selected uids.
 * @returns {Readonly<{ bodies: ReadonlyArray<number>, parts: ReadonlyArray<Readonly<SplitPart>>, invalid: boolean }>}
 *   Frozen ungrouped bodies in `bodies` order, parts in body then fixture order, and whether a part's shape has
 *   invalid geometry or its source body a non-finite transform.
 * @throws {Error} When a uid is unknown.
 */
export function ungroupParts(model, uids) {
  const bodies = readSelection(model, uids).bodies.filter((body) => model.children(body, 'fixtures').length >= 2);
  const parts = bodies.flatMap((body) =>
    model
      .children(body, 'fixtures')
      .slice(1)
      .map((shape) => ({ body, shapes: [shape] })),
  );
  const frozen = freezeParts(parts);
  return Object.freeze({ bodies: Object.freeze(bodies), parts: frozen, invalid: partsInvalid(model, frozen) });
}

function numberOf(id) {
  return id.slice(id.indexOf('_') + 1);
}

function extract(tx, { body, shapes }, index) {
  const { model } = tx;
  const frame = frameOf(model, body);
  const centers = shapes.map((shape) => shapeCenter(model.prop(shape, 'shape')));
  const cx = centers.reduce((total, center) => total + center.x, 0) / centers.length + 0;
  const cy = centers.reduce((total, center) => total + center.y, 0) / centers.length + 0;
  const [ox, oy] = rotate(cx, cy, frame.angle);
  const id = model.nextId('b');
  const props = {
    ...model.get(body).props,
    id,
    name: `body_${numberOf(id)}`,
    position: [frame.x + ox + 0, frame.y + oy + 0],
    angle: frame.angle,
  };
  const created = tx.add(ROOT_UID, 'bodies', index, { type: 'body', props, children: { fixtures: [] } });
  const write = writer(tx);
  const shift = ([x, y]) => [x - cx + 0, y - cy + 0];
  for (const shape of shapes) {
    tx.move(shape, created, 'fixtures', undefined);
    const record = model.prop(shape, 'shape');
    if (record.type === 'polygon') write(shape, 'shape.vertices', record.vertices.map(shift));
    else write(shape, 'shape.center', shift(record.center));
  }
  return created;
}

function extractAll(tx, parts) {
  const added = new Map();
  const created = new Set();
  for (const part of parts) {
    const count = added.get(part.body) ?? 0;
    const index = tx.model.children(ROOT_UID, 'bodies').indexOf(part.body) + 1 + count;
    created.add(extract(tx, part, index));
    added.set(part.body, count + 1);
  }
  return created;
}

function shapesOf(model, members) {
  return model
    .children(ROOT_UID, 'bodies')
    .filter((body) => members.has(body))
    .flatMap((body) => model.children(body, 'fixtures'));
}

/**
 * Builds a command that splits a selection as {@link splitParts} computes when it runs: each part's shapes move to
 * one new body inserted after its source, at the average of their centers with the source's angle and fields,
 * keeping their world placement. Joints, tracks and `rootBody` never change. `run` returns the moved shape uids, in
 * `bodies` order, then fixture order.
 * @param {ReadonlyArray<number>} uids Selected uids.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds an unknown uid, no part or an invalid part; nothing is mutated then.
 */
export function splitShapes(uids, label = 'Split') {
  const requested = Object.freeze([...uids]);
  return Object.freeze({
    label,
    run(tx) {
      const { parts, invalid } = splitParts(tx.model, requested);
      if (parts.length === 0) throw new Error('Nothing to split');
      if (invalid) throw new Error('Split would re-express invalid geometry');
      return shapesOf(tx.model, extractAll(tx, parts));
    },
  });
}

/**
 * Builds a command that ungroups a selection as {@link ungroupParts} computes when it runs: each shape but the
 * first of every ungrouped body moves alone to a new body, as {@link splitShapes} does. Joints, tracks and
 * `rootBody` never change. `run` returns every shape of the ungrouped bodies and their new bodies, in `bodies`
 * order, then fixture order.
 * @param {ReadonlyArray<number>} uids Selected uids.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds an unknown uid, no part or an invalid part; nothing is mutated then.
 */
export function ungroupBodies(uids, label = 'Ungroup') {
  const requested = Object.freeze([...uids]);
  return Object.freeze({
    label,
    run(tx) {
      const { bodies, parts, invalid } = ungroupParts(tx.model, requested);
      if (parts.length === 0) throw new Error('Nothing to ungroup');
      if (invalid) throw new Error('Ungroup would re-express invalid geometry');
      const created = extractAll(tx, parts);
      return shapesOf(tx.model, new Set([...bodies, ...created]));
    },
  });
}
