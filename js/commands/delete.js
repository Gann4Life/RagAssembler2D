import { ROOT_UID } from '../model/model.js';
import { referencesTo } from '../model/queries.js';

/**
 * What a deletion removes, computed from the model before mutating it.
 * @typedef {object} DeletionPlan
 * @property {ReadonlyArray<number>} bodies Bodies removed with all their shapes, in `bodies` order.
 * @property {ReadonlyArray<number>} shapes Shapes removed alone (their body keeps other shapes), in body order,
 *   then fixture order.
 * @property {ReadonlyArray<number>} joints Joints removed, in `joints` order.
 * @property {ReadonlyArray<number>} tracks Tracks removed, in clip order, then track order.
 * @property {Readonly<{ from: string, to: string|null }>|null} rootBody The `rootBody` change when the current
 *   root body is removed, else `null`.
 * @property {boolean} confirm Whether the deletion removes tracks and needs a confirmation.
 * @property {boolean} empty Whether nothing would be removed.
 */

const DELETABLE = new Set(['body', 'shape', 'joint']);

function inOrder(order, members) {
  return Object.freeze(order.filter((uid) => members.has(uid)));
}

function requestedByType(model, uids) {
  const requested = { body: new Set(), shape: new Set(), joint: new Set() };
  for (const uid of uids) {
    const node = model.get(uid);
    if (node === null) throw new Error(`Unknown node uid ${uid}`);
    if (DELETABLE.has(node.type)) requested[node.type].add(uid);
  }
  return requested;
}

function allTracks(model) {
  return model.children(ROOT_UID, 'clips').flatMap((clip) => model.children(clip, 'tracks'));
}

function rootBodyChange(model, bodyOrder, removedBodies) {
  const from = model.prop(ROOT_UID, 'rootBody');
  if (typeof from !== 'string') return null;
  const current = model.uidOf(from);
  if (!removedBodies.has(current)) return null;
  const next = bodyOrder.find((uid) => !removedBodies.has(uid));
  return Object.freeze({ from, to: next === undefined ? null : model.prop(next, 'id') });
}

/**
 * Computes what deleting objects removes: requested bodies, bodies whose every shape is requested, the other
 * requested shapes, the joints of removed bodies, the tracks of removed shapes and joints, and the new
 * `rootBody`. Reads the model only. Duplicates are ignored, and so are uids that are not bodies, shapes or joints.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {ReadonlyArray<number>} uids Uids to delete.
 * @returns {Readonly<DeletionPlan>} The frozen plan.
 * @throws {Error} When a uid is unknown.
 */
export function deletionPlan(model, uids) {
  const requested = requestedByType(model, uids);
  const bodyOrder = model.children(ROOT_UID, 'bodies');
  const removedBodies = new Set(requested.body);
  for (const uid of requested.shape) {
    const body = model.get(uid).parent;
    const fixtures = model.children(body, 'fixtures');
    if (fixtures.every((fixture) => requested.shape.has(fixture))) removedBodies.add(body);
  }
  const bodies = inOrder(bodyOrder, removedBodies);
  const shapes = Object.freeze(
    bodyOrder
      .filter((body) => !removedBodies.has(body))
      .flatMap((body) => model.children(body, 'fixtures').filter((uid) => requested.shape.has(uid))),
  );
  const removedJoints = new Set(requested.joint);
  for (const body of bodies) {
    for (const joint of referencesTo(model, body).joints) removedJoints.add(joint);
  }
  const joints = inOrder(model.children(ROOT_UID, 'joints'), removedJoints);
  const removedTracks = new Set();
  const targets = [...joints, ...shapes, ...bodies.flatMap((body) => model.children(body, 'fixtures'))];
  for (const target of targets) {
    for (const track of referencesTo(model, target).tracks) removedTracks.add(track);
  }
  const tracks = inOrder(allTracks(model), removedTracks);
  return Object.freeze({
    bodies,
    shapes,
    joints,
    tracks,
    rootBody: rootBodyChange(model, bodyOrder, removedBodies),
    confirm: tracks.length > 0,
    empty: bodies.length + shapes.length + joints.length + tracks.length === 0,
  });
}

/**
 * Builds a command that deletes objects with the cascade of {@link deletionPlan}, computed when it runs: one
 * removal per track, joint, lone shape and body, in that order, then the `rootBody` change. `run` returns the plan.
 * @param {ReadonlyArray<number>} uids Uids to delete.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds an unknown uid or an empty plan; nothing is mutated then.
 */
export function deleteObjects(uids, label = 'Delete') {
  const requested = Object.freeze([...uids]);
  return Object.freeze({
    label,
    run(tx) {
      const plan = deletionPlan(tx.model, requested);
      if (plan.empty) throw new Error('Nothing to delete');
      for (const uid of [...plan.tracks, ...plan.joints, ...plan.shapes, ...plan.bodies]) tx.remove(uid);
      if (plan.rootBody !== null) tx.set(ROOT_UID, 'rootBody', plan.rootBody.to);
      return plan;
    },
  });
}
