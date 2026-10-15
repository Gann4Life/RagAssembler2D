import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { jointBetween, jointTree, orderJointBodies } from '../js/model/queries.js';
import { defaultsOf } from '../lib/schema.js';

function build({ bodies = [], joints = [], rootBody = null, shapes = [] }) {
  const model = new Model();
  const history = new History(model);
  const uids = {};
  history.execute({
    label: 'Build',
    run(tx) {
      for (const id of bodies) {
        const fixtures = shapes.includes(id) ? [{ type: 'shape', props: { id: `f_${id}` } }] : [];
        uids[id] = tx.add(ROOT_UID, 'bodies', undefined, { type: 'body', props: { id }, children: { fixtures } });
      }
      joints.forEach(([bodyA, bodyB], index) => {
        const id = `j_${index + 1}`;
        uids[id] = tx.add(ROOT_UID, 'joints', undefined, { type: 'joint', props: { ...defaultsOf('joint'), id, bodyA, bodyB } });
      });
      tx.set(ROOT_UID, 'rootBody', rootBody);
    },
  });
  return { model, uids };
}

function depths(tree, uids) {
  const names = new Map(Object.entries(uids).map(([name, uid]) => [uid, name]));
  return Object.fromEntries([...tree.depth].map(([uid, depth]) => [names.get(uid), depth]));
}

function parents(tree, uids) {
  const names = new Map(Object.entries(uids).map(([name, uid]) => [uid, name]));
  return Object.fromEntries([...tree.parent].map(([body, joint]) => [names.get(body), names.get(joint)]));
}

function loops(tree, uids) {
  const names = new Map(Object.entries(uids).map(([name, uid]) => [uid, name]));
  return [...tree.loops].map((uid) => names.get(uid)).sort();
}

test('jointTree: a chain gives increasing depths and tree joints', () => {
  const { model, uids } = build({
    bodies: ['b_1', 'b_2', 'b_3'],
    joints: [['b_1', 'b_2'], ['b_2', 'b_3']],
    rootBody: 'b_1',
  });
  const tree = jointTree(model);
  assert.equal(tree.root, uids.b_1);
  assert.deepEqual(depths(tree, uids), { b_1: 0, b_2: 1, b_3: 2 });
  assert.deepEqual(parents(tree, uids), { b_2: 'j_1', b_3: 'j_2' });
  assert.deepEqual(loops(tree, uids), []);
});

test('jointTree: a branch gives siblings the same depth', () => {
  const { model, uids } = build({
    bodies: ['b_1', 'b_2', 'b_3', 'b_4'],
    joints: [['b_1', 'b_2'], ['b_1', 'b_3'], ['b_3', 'b_4']],
    rootBody: 'b_1',
  });
  const tree = jointTree(model);
  assert.deepEqual(depths(tree, uids), { b_1: 0, b_2: 1, b_3: 1, b_4: 2 });
  assert.deepEqual(parents(tree, uids), { b_2: 'j_1', b_3: 'j_2', b_4: 'j_3' });
});

test('jointTree: two disconnected parts leave the second one unlinked and out of loops', () => {
  const { model, uids } = build({
    bodies: ['b_1', 'b_2', 'b_3', 'b_4', 'b_5'],
    joints: [['b_1', 'b_2'], ['b_3', 'b_4'], ['b_4', 'b_5'], ['b_5', 'b_3']],
    rootBody: 'b_1',
  });
  const tree = jointTree(model);
  assert.deepEqual(depths(tree, uids), { b_1: 0, b_2: 1 });
  assert.deepEqual(parents(tree, uids), { b_2: 'j_1' });
  assert.deepEqual(loops(tree, uids), []);
});

test('jointTree: rootBody null, unknown or not a body gives an empty tree', () => {
  for (const rootBody of [null, 'b_9', 'j_1', 'root']) {
    const { model } = build({ bodies: ['b_1', 'b_2'], joints: [['b_1', 'b_2']], rootBody });
    const tree = jointTree(model);
    assert.equal(tree.root, null, String(rootBody));
    assert.equal(tree.depth.size, 0);
    assert.equal(tree.parent.size, 0);
    assert.equal(tree.loops.size, 0);
  }
});

test('jointTree: joints with null, unknown, non-body or equal references are ignored', () => {
  const { model, uids } = build({
    bodies: ['b_1', 'b_2', 'b_3'],
    shapes: ['b_1'],
    joints: [[null, 'b_2'], ['b_1', 'b_9'], ['f_b_1', 'b_2'], ['b_1', 'b_1'], ['b_1', null], ['b_2', 'b_1']],
    rootBody: 'b_1',
  });
  const tree = jointTree(model);
  assert.deepEqual(depths(tree, uids), { b_1: 0, b_2: 1 });
  assert.deepEqual(parents(tree, uids), { b_2: 'j_6' });
  assert.deepEqual(loops(tree, uids), []);
});

test('jointTree: the shortest path sets the depth', () => {
  const { model, uids } = build({
    bodies: ['b_1', 'b_2', 'b_3', 'b_4'],
    joints: [['b_1', 'b_2'], ['b_2', 'b_3'], ['b_3', 'b_4'], ['b_1', 'b_4']],
    rootBody: 'b_1',
  });
  const tree = jointTree(model);
  assert.deepEqual(depths(tree, uids), { b_1: 0, b_2: 1, b_3: 2, b_4: 1 });
  assert.deepEqual(parents(tree, uids), { b_2: 'j_1', b_3: 'j_2', b_4: 'j_4' });
  assert.deepEqual(loops(tree, uids), ['j_3']);
});

test('jointTree: joints order decides which joint is the tree joint', () => {
  const first = build({
    bodies: ['b_1', 'b_2', 'b_3', 'b_4'],
    joints: [['b_1', 'b_2'], ['b_1', 'b_3'], ['b_2', 'b_4'], ['b_3', 'b_4']],
    rootBody: 'b_1',
  });
  const firstTree = jointTree(first.model);
  assert.deepEqual(parents(firstTree, first.uids), { b_2: 'j_1', b_3: 'j_2', b_4: 'j_3' });
  assert.deepEqual(loops(firstTree, first.uids), ['j_4']);
  const second = build({
    bodies: ['b_1', 'b_2', 'b_3', 'b_4'],
    joints: [['b_1', 'b_2'], ['b_1', 'b_3'], ['b_3', 'b_4'], ['b_2', 'b_4']],
    rootBody: 'b_1',
  });
  const secondTree = jointTree(second.model);
  assert.deepEqual(parents(secondTree, second.uids), { b_2: 'j_1', b_3: 'j_2', b_4: 'j_4' });
  assert.deepEqual(loops(secondTree, second.uids), ['j_3']);
});

test('jointTree: a triangle and a second joint on the same pair are loops', () => {
  const triangle = build({
    bodies: ['b_1', 'b_2', 'b_3'],
    joints: [['b_1', 'b_2'], ['b_2', 'b_3'], ['b_3', 'b_1']],
    rootBody: 'b_1',
  });
  const triangleTree = jointTree(triangle.model);
  assert.deepEqual(depths(triangleTree, triangle.uids), { b_1: 0, b_2: 1, b_3: 1 });
  assert.deepEqual(loops(triangleTree, triangle.uids), ['j_2']);
  const doubled = build({ bodies: ['b_1', 'b_2'], joints: [['b_1', 'b_2'], ['b_2', 'b_1']], rootBody: 'b_1' });
  const doubledTree = jointTree(doubled.model);
  assert.deepEqual(parents(doubledTree, doubled.uids), { b_2: 'j_1' });
  assert.deepEqual(loops(doubledTree, doubled.uids), ['j_2']);
});

test('jointTree: reversed joints are still edges', () => {
  const { model, uids } = build({
    bodies: ['b_1', 'b_2', 'b_3'],
    joints: [['b_2', 'b_1'], ['b_3', 'b_2']],
    rootBody: 'b_1',
  });
  const tree = jointTree(model);
  assert.deepEqual(depths(tree, uids), { b_1: 0, b_2: 1, b_3: 2 });
  assert.deepEqual(parents(tree, uids), { b_2: 'j_1', b_3: 'j_2' });
});

test('jointTree returns fresh maps on every call', () => {
  const { model } = build({ bodies: ['b_1'], rootBody: 'b_1' });
  const first = jointTree(model);
  first.depth.clear();
  assert.equal(jointTree(model).depth.size, 1);
});

test('jointBetween finds the first joint of a pair in either order', () => {
  const { model, uids } = build({
    bodies: ['b_1', 'b_2', 'b_3'],
    joints: [['b_1', 'b_1'], ['b_2', 'b_1'], ['b_1', 'b_2']],
  });
  assert.equal(jointBetween(model, uids.b_1, uids.b_2), uids.j_2);
  assert.equal(jointBetween(model, uids.b_2, uids.b_1), uids.j_2);
  assert.equal(jointBetween(model, uids.b_1, uids.b_3), null);
  assert.equal(jointBetween(model, uids.b_1, uids.b_1), null);
});

test('orderJointBodies puts the body closer to rootBody first', () => {
  const { model, uids } = build({
    bodies: ['b_3', 'b_2', 'b_1'],
    joints: [['b_1', 'b_2'], ['b_3', 'b_2']],
    rootBody: 'b_1',
  });
  assert.deepEqual(orderJointBodies(model, uids.b_3, uids.b_2), { bodyA: uids.b_2, bodyB: uids.b_3 });
  assert.deepEqual(orderJointBodies(model, uids.b_2, uids.b_3), { bodyA: uids.b_2, bodyB: uids.b_3 });
  assert.deepEqual(orderJointBodies(model, uids.b_3, uids.b_1), { bodyA: uids.b_1, bodyB: uids.b_3 });
});

test('orderJointBodies counts an unlinked body as farthest', () => {
  const { model, uids } = build({
    bodies: ['b_4', 'b_1', 'b_2', 'b_3'],
    joints: [['b_1', 'b_2'], ['b_2', 'b_3']],
    rootBody: 'b_1',
  });
  assert.deepEqual(orderJointBodies(model, uids.b_4, uids.b_3), { bodyA: uids.b_3, bodyB: uids.b_4 });
  assert.deepEqual(orderJointBodies(model, uids.b_3, uids.b_4), { bodyA: uids.b_3, bodyB: uids.b_4 });
});

test('orderJointBodies breaks ties by bodies order, whatever the argument order', () => {
  const unlinked = build({ bodies: ['b_2', 'b_1'], rootBody: null });
  for (const [p, q] of [['b_1', 'b_2'], ['b_2', 'b_1']]) {
    assert.deepEqual(orderJointBodies(unlinked.model, unlinked.uids[p], unlinked.uids[q]), {
      bodyA: unlinked.uids.b_2,
      bodyB: unlinked.uids.b_1,
    });
  }
  const siblings = build({
    bodies: ['b_1', 'b_3', 'b_2'],
    joints: [['b_1', 'b_2'], ['b_1', 'b_3']],
    rootBody: 'b_1',
  });
  for (const [p, q] of [['b_2', 'b_3'], ['b_3', 'b_2']]) {
    assert.deepEqual(orderJointBodies(siblings.model, siblings.uids[p], siblings.uids[q]), {
      bodyA: siblings.uids.b_3,
      bodyB: siblings.uids.b_2,
    });
  }
});

test('orderJointBodies throws for non-bodies and equal uids', () => {
  const { model, uids } = build({ bodies: ['b_1', 'b_2'], shapes: ['b_1'], joints: [['b_1', 'b_2']] });
  const shapeUid = model.children(uids.b_1, 'fixtures')[0];
  assert.throws(() => orderJointBodies(model, uids.b_1, uids.b_1), Error);
  assert.throws(() => orderJointBodies(model, uids.b_1, shapeUid), Error);
  assert.throws(() => orderJointBodies(model, uids.j_1, uids.b_2), Error);
  assert.throws(() => orderJointBodies(model, ROOT_UID, uids.b_2), Error);
  assert.throws(() => orderJointBodies(model, uids.b_1, 999), Error);
});
