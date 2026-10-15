import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { FRAME_EMPTY_SIZE, FRAME_MIN_SIZE, framingBounds } from '../js/viewport/bounds.js';
import { defaultsOf } from '../lib/schema.js';

const EPSILON = 1e-9;

function nearBox(actual, expected) {
  assert.ok(actual, 'expected a box');
  for (const key of ['minX', 'minY', 'maxX', 'maxY']) {
    assert.ok(Math.abs(actual[key] - expected[key]) < EPSILON, `${key}: expected ${expected[key]}, got ${actual[key]}`);
  }
}

function shape(id, shapeRecord) {
  return { type: 'shape', props: { ...defaultsOf('shape', shapeRecord.type), id, name: id, shape: shapeRecord } };
}

function body(id, position, angle, fixtures) {
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

function uidsOf(model, ...ids) {
  return ids.map((id) => model.uidOf(id));
}

test('constants follow DESIGN §5.4', () => {
  assert.equal(FRAME_MIN_SIZE, 1);
  assert.equal(FRAME_EMPTY_SIZE, 4);
});

test('an empty ragdoll frames 4 × 4 m around the root', () => {
  nearBox(framingBounds(document({ position: [3, -2] }), null), { minX: 1, minY: -4, maxX: 5, maxY: 0 });
});

test('everything covers shapes, joint anchors and the root position under the root transform', () => {
  const model = document({
    position: [10, 0],
    bodies: [
      body('b_1', [1, 0], 0, [shape('f_1', { type: 'box', center: [0, 0], width: 2, height: 1, angle: 0 })]),
      body('b_2', [0, 3], 0, [shape('f_2', { type: 'circle', center: [0, 0], radius: 0.5 })]),
    ],
    joints: [joint('j_1', 'b_1', 'b_2', [-4, 1])],
  });
  nearBox(framingBounds(model, null), { minX: 6, minY: -0.5, maxX: 12, maxY: 3.5 });
});

test('the root angle rotates root-local content', () => {
  const model = document({
    angle: Math.PI / 2,
    bodies: [body('b_1', [2, 0], 0, [shape('f_1', { type: 'circle', center: [0, 0], radius: 1 })])],
  });
  nearBox(framingBounds(model, uidsOf(model, 'b_1')), { minX: -1, minY: 1, maxX: 1, maxY: 3 });
});

test('selections count bodies, shapes, joints and the root, and nothing else', () => {
  const model = document({
    bodies: [
      body('b_1', [0, 0], 0, [
        shape('f_1', { type: 'box', center: [0, 0], width: 2, height: 2, angle: 0 }),
        shape('f_2', { type: 'box', center: [5, 0], width: 2, height: 2, angle: 0 }),
      ]),
    ],
    joints: [joint('j_1', 'b_1', null, [0, 8])],
  });
  nearBox(framingBounds(model, uidsOf(model, 'b_1')), { minX: -1, minY: -1, maxX: 6, maxY: 1 });
  nearBox(framingBounds(model, uidsOf(model, 'f_2')), { minX: 4, minY: -1, maxX: 6, maxY: 1 });
  nearBox(framingBounds(model, uidsOf(model, 'j_1')), { minX: -0.5, minY: 7.5, maxX: 0.5, maxY: 8.5 });
  nearBox(framingBounds(model, [ROOT_UID]), { minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 0.5 });
  assert.equal(framingBounds(model, []), null);
  assert.equal(framingBounds(model, [9999]), null);
});

test('small boxes grow to 1 m around their center', () => {
  const model = document({
    bodies: [body('b_1', [0, 0], 0, [shape('f_1', { type: 'box', center: [2, 2], width: 0.2, height: 3, angle: 0 })])],
  });
  nearBox(framingBounds(model, uidsOf(model, 'f_1')), { minX: 1.5, minY: 0.5, maxX: 2.5, maxY: 3.5 });
});

test('a pose replaces body transforms and moves anchors with bodyA', () => {
  const model = document({
    position: [1, 0],
    bodies: [body('b_1', [0, 0], 0, [shape('f_1', { type: 'circle', center: [0, 0], radius: 1 })])],
    joints: [joint('j_1', 'b_1', null, [2, 0])],
  });
  const [bodyUid, jointUid] = uidsOf(model, 'b_1', 'j_1');
  const pose = new Map([[bodyUid, { x: 0, y: 5, angle: Math.PI / 2 }]]);
  nearBox(framingBounds(model, [bodyUid], pose), { minX: 0, minY: 4, maxX: 2, maxY: 6 });
  nearBox(framingBounds(model, [jointUid], pose), { minX: 0.5, minY: 6.5, maxX: 1.5, maxY: 7.5 });
});

test('shapes without bounds are skipped', () => {
  const model = document({
    bodies: [body('b_1', [0, 0], 0, [shape('f_1', { type: 'polygon', vertices: [] })])],
  });
  assert.equal(framingBounds(model, uidsOf(model, 'f_1')), null);
  nearBox(framingBounds(model, null), { minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 0.5 });
});
