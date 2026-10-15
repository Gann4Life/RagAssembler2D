import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { jointZeroAngle, placement } from '../js/viewport/placement.js';
import { defaultsOf } from '../lib/schema.js';

const EPSILON = 1e-9;

function near(actual, expected, message = '') {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message} expected ${expected}, got ${actual}`);
}

function nearPoint(actual, expected, message = '') {
  near(actual.x, expected.x, `${message} x:`);
  near(actual.y, expected.y, `${message} y:`);
}

function shape(id, shapeRecord) {
  return { type: 'shape', props: { ...defaultsOf('shape', shapeRecord.type), id, name: id, shape: shapeRecord } };
}

function body(id, position, angle, fixtures = []) {
  const { fixtures: omitted, ...props } = defaultsOf('body');
  return { type: 'body', props: { ...props, id, name: id, position, angle }, children: { fixtures } };
}

function joint(id, bodyA, bodyB, anchor) {
  return { type: 'joint', props: { ...defaultsOf('joint'), id, name: id, bodyA, bodyB, anchor } };
}

function document({ position = [0, 0], angle = 0, bodies = [], joints = [] } = {}) {
  const model = new Model();
  const { meta, units, preview } = defaultsOf('document');
  model.reset({
    type: 'root',
    props: { ...defaultsOf('root'), position, angle, meta, units, preview },
    children: { bodies, joints },
  });
  return model;
}

test('jointZeroAngle points from the anchor to bodyB, or along bodyB +X when they coincide', () => {
  near(jointZeroAngle({ x: 0, y: 0 }, { x: 0, y: 2, angle: 0.3 }), Math.PI / 2);
  near(jointZeroAngle({ x: 1, y: 1 }, { x: 0, y: 1, angle: 0.3 }), Math.PI);
  near(jointZeroAngle({ x: 1, y: 1 }, { x: 1, y: 1, angle: 0.3 }), 0.3);
  assert.ok(Object.is(jointZeroAngle({ x: 0, y: 0 }, { x: 0, y: 0, angle: -0 }), 0));
});

test('rest placement composes the root transform with body transforms', () => {
  const model = document({
    position: [10, 0],
    angle: Math.PI / 2,
    bodies: [body('b_1', [1, 0], 0.2), body('b_2', [0, 2], -0.1)],
    joints: [joint('j_1', 'b_1', 'b_2', [1, 1])],
  });
  const placed = placement(model);
  assert.deepEqual(placed.root, { x: 10, y: 0, angle: Math.PI / 2 });
  const [b1, b2, j1] = ['b_1', 'b_2', 'j_1'].map((id) => model.uidOf(id));
  assert.deepEqual([...placed.bodies.keys()], [b1, b2]);
  nearPoint(placed.bodies.get(b1), { x: 10, y: 1 });
  near(placed.bodies.get(b1).angle, Math.PI / 2 + 0.2);
  nearPoint(placed.bodies.get(b2), { x: 8, y: 0 });
  nearPoint(placed.anchors.get(j1), { x: 9, y: 1 });
  near(placed.zero.get(j1), Math.atan2(1, -1) + Math.PI / 2);
  assert.ok(Object.is(placed.angles.get(j1), 0));
});

test('a pose moves bodies, carries anchors with bodyA and turns the zero direction', () => {
  const model = document({
    bodies: [body('b_1', [0, 0], 0), body('b_2', [2, 0], 0)],
    joints: [joint('j_1', 'b_1', 'b_2', [1, 0])],
  });
  const [b1, b2, j1] = ['b_1', 'b_2', 'j_1'].map((id) => model.uidOf(id));
  const pose = new Map([
    [b1, { x: 0, y: 0, angle: Math.PI / 2 }],
    [b2, { x: 0, y: 2, angle: Math.PI / 2 + 0.5 }],
  ]);
  const placed = placement(model, pose);
  nearPoint(placed.bodies.get(b2), { x: 0, y: 2 });
  nearPoint(placed.anchors.get(j1), { x: 0, y: 1 });
  near(placed.zero.get(j1), Math.PI / 2);
  near(placed.angles.get(j1), 0.5);
});

test('bodies missing from the pose stay at rest', () => {
  const model = document({
    bodies: [body('b_1', [0, 0], 0), body('b_2', [2, 0], 0)],
    joints: [joint('j_1', 'b_1', 'b_2', [1, 0])],
  });
  const [b1, b2, j1] = ['b_1', 'b_2', 'j_1'].map((id) => model.uidOf(id));
  const placed = placement(model, new Map([[b2, { x: 2, y: 0, angle: -0.4 }]]));
  nearPoint(placed.bodies.get(b1), { x: 0, y: 0 });
  nearPoint(placed.anchors.get(j1), { x: 1, y: 0 });
  near(placed.zero.get(j1), 0);
  near(placed.angles.get(j1), -0.4);
});

test('joints without valid bodies keep their rest anchor, no zero direction and angle 0', () => {
  const model = document({
    position: [0, 1],
    bodies: [body('b_1', [0, 0], 0, [shape('f_1', { type: 'circle', center: [0, 0], radius: 1 })])],
    joints: [
      joint('j_1', 'b_1', null, [1, 0]),
      joint('j_2', 'f_1', 'b_1', [2, 0]),
      joint('j_3', 'b_9', 'b_1', [3, 0]),
      joint('j_4', 'b_1', 'b_1', null),
    ],
  });
  const b1 = model.uidOf('b_1');
  const placed = placement(model, new Map([[b1, { x: 5, y: 0, angle: 0 }]]));
  const [j1, j2, j3, j4] = ['j_1', 'j_2', 'j_3', 'j_4'].map((id) => model.uidOf(id));
  nearPoint(placed.anchors.get(j1), { x: 6, y: 1 });
  nearPoint(placed.anchors.get(j2), { x: 2, y: 1 });
  nearPoint(placed.anchors.get(j3), { x: 3, y: 1 });
  assert.ok(!Number.isFinite(placed.anchors.get(j4).x));
  for (const uid of [j1, j2, j3, j4]) {
    assert.equal(placed.zero.get(uid), null);
    assert.equal(placed.angles.get(uid), 0);
  }
  assert.equal(model.get(ROOT_UID).type, 'root');
});
