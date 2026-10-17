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

/**
 * Lists the joints that connect two different bodies.
 * @param {import('./model.js').Model} model Document model.
 * @returns {ReadonlyArray<{ uid: number, a: number, b: number }>} Joint uid with its `bodyA` and `bodyB` body uids,
 *   in `joints` order; joints whose references do not resolve to two different bodies are left out.
 */
export function jointEdges(model) {
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

/**
 * The body whose parent joint is the given joint.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} jointUid Joint uid.
 * @param {Map<number, number>} [parents] Result of `parentJoints(model)`, to reuse across calls.
 * @returns {number|null} The child body uid, or `null` when the joint is nobody's parent joint (a loop joint) or is not a joint.
 */
export function jointChildBody(model, jointUid, parents = parentJoints(model)) {
  if (model.get(jointUid)?.type !== 'joint') return null;
  for (const [body, joint] of parents) {
    if (joint === jointUid) return body;
  }
  return null;
}

/**
 * The bodies of a selection: the given bodies plus the body of every given shape. Other node types are ignored.
 * @param {import('./model.js').Model} model Document model.
 * @param {ReadonlyArray<number>} uids Selected uids.
 * @returns {number[]} A new list of body uids, each once, in `bodies` order.
 * @throws {Error} When a uid is unknown.
 */
export function selectedBodies(model, uids) {
  const picked = new Set();
  for (const uid of uids) {
    const node = model.get(uid);
    if (node === null) throw new Error(`Unknown node uid ${uid}`);
    if (node.type === 'body') picked.add(uid);
    else if (node.type === 'shape') picked.add(node.parent);
  }
  return model.children(ROOT_UID, 'bodies').filter((body) => picked.has(body));
}

/**
 * Finds the joints and tracks that reference a node by its file id. A reference resolves through
 * `model.uidOf`, so only the first holder of a duplicated id is referenced.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} uid Referenced node uid.
 * @returns {{ joints: number[], tracks: number[] }} Joints whose `bodyA` or `bodyB` resolves to `uid`, in `joints`
 *   order and each once; tracks whose `target` resolves to `uid`, in clip order, then track order.
 * @throws {Error} When the uid is unknown.
 */
export function referencesTo(model, uid) {
  if (model.get(uid) === null) throw new Error(`Unknown node uid ${uid}`);
  const resolves = (id) => typeof id === 'string' && model.uidOf(id) === uid;
  const joints = model.children(ROOT_UID, 'joints').filter((joint) => {
    const { bodyA, bodyB } = model.get(joint).props;
    return resolves(bodyA) || resolves(bodyB);
  });
  const tracks = model
    .children(ROOT_UID, 'clips')
    .flatMap((clip) => model.children(clip, 'tracks'))
    .filter((track) => resolves(model.get(track).props.target));
  return { joints, tracks };
}
