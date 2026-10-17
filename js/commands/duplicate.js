import { ROOT_UID } from '../model/model.js';
import { bodySubtree, jointChildBody, parentJoints, selectedBodies } from '../model/queries.js';

/**
 * What duplicating a selection copies, computed from the model before mutating it.
 * @typedef {object} DuplicatePlan
 * @property {ReadonlyArray<number>} bodies Copied bodies (whole branches), in `bodies` order.
 * @property {ReadonlyArray<number>} joints Copied joints (internal, or selected and re-attached), in `joints` order.
 * @property {boolean} empty Whether no body is copied.
 */

const COPY_SUFFIX = /_copy(\d*)$/;

function isFinitePair(value) {
  return (
    Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

function resolve(model, id) {
  return typeof id === 'string' ? model.uidOf(id) : null;
}

function baseName(name) {
  const text = typeof name === 'string' ? name : '';
  const match = COPY_SUFFIX.exec(text);
  if (match === null || (match[1] !== '' && Number(match[1]) < 2)) return text;
  return text.slice(0, match.index);
}

function namesOf(model, uids) {
  return new Set(uids.map((uid) => model.prop(uid, 'name')));
}

function allShapes(model) {
  return model.children(ROOT_UID, 'bodies').flatMap((body) => model.children(body, 'fixtures'));
}

function namer(used) {
  return (name) => {
    const base = baseName(name);
    let candidate = `${base}_copy`;
    for (let k = 2; used.has(candidate); k += 1) candidate = `${base}_copy${k}`;
    used.add(candidate);
    return candidate;
  };
}

function shifted(point, offset) {
  const [x, y] = isFinitePair(point) ? point : [0, 0];
  return [x + offset[0] + 0, y + offset[1] + 0];
}

/**
 * Computes what duplicating a selection copies: the union of the whole branches of the selected bodies, the
 * bodies of the selected shapes and the child body of every selected joint; every joint whose two bodies are
 * copied; and every selected joint with only its child body copied (re-attached to the uncopied body). Other
 * node types are ignored. Reads the model only.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {ReadonlyArray<number>} uids Selected uids.
 * @returns {Readonly<DuplicatePlan>} The frozen plan.
 * @throws {Error} When a uid is unknown.
 */
export function duplicatePlan(model, uids) {
  const parents = parentJoints(model);
  const copied = new Set();
  for (const body of selectedBodies(model, uids)) {
    for (const member of bodySubtree(model, body, parents)) copied.add(member);
  }
  const selectedJoints = new Set();
  for (const uid of uids) {
    const child = jointChildBody(model, uid, parents);
    if (child === null) continue;
    selectedJoints.add(uid);
    for (const member of bodySubtree(model, child, parents)) copied.add(member);
  }
  const bodies = model.children(ROOT_UID, 'bodies').filter((body) => copied.has(body));
  const joints = model.children(ROOT_UID, 'joints').filter((joint) => {
    const { bodyA, bodyB } = model.get(joint).props;
    const a = copied.has(resolve(model, bodyA));
    const b = copied.has(resolve(model, bodyB));
    return (a && b) || ((a || b) && selectedJoints.has(joint));
  });
  return Object.freeze({ bodies: Object.freeze(bodies), joints: Object.freeze(joints), empty: bodies.length === 0 });
}

/**
 * Builds a command that duplicates a selection as {@link duplicatePlan} computes when it runs: copies are appended
 * with new ids and `<base>_copy<k>` names, bodies and joint anchors moved by `offset`, shapes unchanged, no track
 * copied, `rootBody` unchanged. `run` returns the uids that replace the selection: the copy of every given body,
 * shape and joint that was copied, in the given order; bodies copied only as part of a branch are not included.
 * @param {ReadonlyArray<number>} uids Selected uids.
 * @param {readonly [number, number]} offset Offset added to body positions and joint anchors, root-local meters.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds an unknown uid or nothing to copy; nothing is mutated then.
 */
export function duplicateSelection(uids, offset, label = 'Duplicate') {
  const requested = Object.freeze([...uids]);
  const shift = Object.freeze([...offset]);
  return Object.freeze({
    label,
    run(tx) {
      const { model } = tx;
      const plan = duplicatePlan(model, requested);
      if (plan.empty) throw new Error('Nothing to duplicate');
      const bodyName = namer(namesOf(model, model.children(ROOT_UID, 'bodies')));
      const shapeName = namer(namesOf(model, allShapes(model)));
      const jointName = namer(namesOf(model, model.children(ROOT_UID, 'joints')));
      const copies = new Map();
      const ids = new Map();
      for (const body of plan.bodies) {
        const source = model.get(body).props;
        const id = model.nextId('b');
        const fixtures = model.children(body, 'fixtures').map((shape) => ({
          type: 'shape',
          props: { ...model.get(shape).props, id: model.nextId('f'), name: shapeName(model.prop(shape, 'name')) },
        }));
        const props = { ...source, id, name: bodyName(source.name), position: shifted(source.position, shift) };
        const copy = tx.add(ROOT_UID, 'bodies', undefined, { type: 'body', props, children: { fixtures } });
        const copiedShapes = model.children(copy, 'fixtures');
        const sourceShapes = model.children(body, 'fixtures');
        copies.set(body, copy);
        sourceShapes.forEach((shape, index) => copies.set(shape, copiedShapes[index]));
        ids.set(source.id, id);
      }
      for (const joint of plan.joints) {
        const source = model.get(joint).props;
        const props = {
          ...source,
          id: model.nextId('j'),
          name: jointName(source.name),
          bodyA: ids.get(source.bodyA) ?? source.bodyA,
          bodyB: ids.get(source.bodyB) ?? source.bodyB,
          anchor: shifted(source.anchor, shift),
        };
        copies.set(joint, tx.add(ROOT_UID, 'joints', undefined, { type: 'joint', props }));
      }
      return [...new Set(requested)].filter((uid) => copies.has(uid)).map((uid) => copies.get(uid));
    },
  });
}
