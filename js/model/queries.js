import { ROOT_UID } from './model.js';

/**
 * Spanning tree of the joint graph from `rootBody`, by breadth-first search over undirected joints.
 * @typedef {object} JointTree
 * @property {number|null} root Uid of the body `rootBody` names, or `null` when it names no body.
 * @property {Map<number, number>} depth Smallest number of joints between each reachable body and the root body, by body uid.
 * @property {Map<number, number>} parent Tree joint that reached each reachable body other than the root body, joint uid by body uid.
 * @property {Set<number>} loops Joints between two reachable bodies that are not tree joints.
 */

function bodyUidOf(model, id) {
  if (typeof id !== 'string') return null;
  const uid = model.uidOf(id);
  return uid !== null && model.get(uid)?.type === 'body' ? uid : null;
}

function isBody(model, uid) {
  return model.get(uid)?.type === 'body';
}

function jointEdges(model) {
  const edges = [];
  for (const uid of model.children(ROOT_UID, 'joints')) {
    const props = model.get(uid).props;
    const a = bodyUidOf(model, props.bodyA);
    const b = bodyUidOf(model, props.bodyB);
    if (a !== null && b !== null && a !== b) edges.push({ uid, a, b });
  }
  return edges;
}

/**
 * Builds the joint tree from `rootBody`. Joints whose bodies do not resolve to two different bodies are
 * ignored; bodies missing from `depth` are unlinked.
 * @param {import('./model.js').Model} model Document model.
 * @returns {JointTree} A new tree; empty maps and set when `rootBody` names no body.
 */
export function jointTree(model) {
  const tree = { root: null, depth: new Map(), parent: new Map(), loops: new Set() };
  const root = bodyUidOf(model, model.prop(ROOT_UID, 'rootBody'));
  if (root === null) return tree;
  tree.root = root;
  const edges = jointEdges(model);
  const treeJoints = new Set();
  tree.depth.set(root, 0);
  const queue = [root];
  for (let head = 0; head < queue.length; head++) {
    const body = queue[head];
    for (const edge of edges) {
      if (edge.a !== body && edge.b !== body) continue;
      const other = edge.a === body ? edge.b : edge.a;
      if (tree.depth.has(other)) continue;
      tree.depth.set(other, tree.depth.get(body) + 1);
      tree.parent.set(other, edge.uid);
      treeJoints.add(edge.uid);
      queue.push(other);
    }
  }
  for (const edge of edges) {
    if (!treeJoints.has(edge.uid) && tree.depth.has(edge.a) && tree.depth.has(edge.b)) tree.loops.add(edge.uid);
  }
  return tree;
}

/**
 * Finds the joint that connects two bodies, in either order.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} bodyUid1 Body uid.
 * @param {number} bodyUid2 Body uid.
 * @returns {number|null} Uid of the first such joint in `joints` order, or `null` when there is none or the uids are equal.
 */
export function jointBetween(model, bodyUid1, bodyUid2) {
  if (bodyUid1 === bodyUid2) return null;
  const edge = jointEdges(model).find(
    ({ a, b }) => (a === bodyUid1 && b === bodyUid2) || (a === bodyUid2 && b === bodyUid1),
  );
  return edge ? edge.uid : null;
}

/**
 * Orders two bodies for a new joint: the one with fewer joints to `rootBody` is bodyA, an unlinked body counts
 * as farthest, and on a tie the body earlier in `bodies` is bodyA. Independent of argument order.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} bodyUid1 Body uid.
 * @param {number} bodyUid2 Body uid.
 * @returns {{ bodyA: number, bodyB: number }} Body uids.
 * @throws {Error} When a uid is not a body or the uids are equal.
 */
export function orderJointBodies(model, bodyUid1, bodyUid2) {
  if (!isBody(model, bodyUid1) || !isBody(model, bodyUid2)) throw new Error('Joint bodies must be bodies');
  if (bodyUid1 === bodyUid2) throw new Error('Joint bodies must be different');
  const { depth } = jointTree(model);
  const depth1 = depth.get(bodyUid1) ?? Infinity;
  const depth2 = depth.get(bodyUid2) ?? Infinity;
  let firstIsA = depth1 < depth2;
  if (depth1 === depth2) {
    const order = model.children(ROOT_UID, 'bodies');
    firstIsA = order.indexOf(bodyUid1) < order.indexOf(bodyUid2);
  }
  return firstIsA ? { bodyA: bodyUid1, bodyB: bodyUid2 } : { bodyA: bodyUid2, bodyB: bodyUid1 };
}

/**
 * Parent joint of every body that has one: a linked body's tree joint from `rootBody`, and for an unlinked
 * body the first joint in `joints` order that has it as bodyB. `rootBody` has none; loop joints never appear.
 * @param {import('./model.js').Model} model Document model.
 * @returns {Map<number, number>} A new map, joint uid by body uid, in `bodies` order.
 */
export function parentJoints(model) {
  const tree = jointTree(model);
  const unlinked = new Map();
  for (const edge of jointEdges(model)) {
    if (!tree.depth.has(edge.b) && !unlinked.has(edge.b)) unlinked.set(edge.b, edge.uid);
  }
  const parents = new Map();
  for (const body of model.children(ROOT_UID, 'bodies')) {
    const joint = tree.depth.has(body) ? tree.parent.get(body) : unlinked.get(body);
    if (joint !== undefined) parents.set(body, joint);
  }
  return parents;
}

function parentBodies(model, parents) {
  const result = new Map();
  for (const [body, joint] of parents) {
    const props = model.get(joint)?.props;
    if (!props) continue;
    const a = bodyUidOf(model, props.bodyA);
    const b = bodyUidOf(model, props.bodyB);
    const other = a === body ? b : a;
    if (other !== null) result.set(body, other);
  }
  return result;
}

/**
 * A body and every body whose chain of parent joints leads to it. Chains stop at a body without a parent
 * joint or at a body already seen on the chain, so cycles terminate.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} bodyUid Body uid.
 * @param {Map<number, number>} [parents] Result of `parentJoints(model)`, to reuse across calls.
 * @returns {Set<number>} A new set: `bodyUid` first, then the other bodies in `bodies` order.
 * @throws {Error} When `bodyUid` is not a body.
 */
export function bodySubtree(model, bodyUid, parents = parentJoints(model)) {
  if (!isBody(model, bodyUid)) throw new Error('bodySubtree needs a body uid');
  const parentOf = parentBodies(model, parents);
  const subtree = new Set([bodyUid]);
  for (const body of model.children(ROOT_UID, 'bodies')) {
    if (body === bodyUid) continue;
    const seen = new Set([body]);
    let current = parentOf.get(body);
    while (current !== undefined && !seen.has(current)) {
      if (current === bodyUid) {
        subtree.add(body);
        break;
      }
      seen.add(current);
      current = parentOf.get(current);
    }
  }
  return subtree;
}
