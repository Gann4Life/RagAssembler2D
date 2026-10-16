import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { Camera } from '../js/viewport/camera.js';
import { boxTest, hitTest } from '../js/viewport/hit.js';
import { COLORS, GIZMO_SIZE, HIT_RADIUS, LABEL_SIZE, LINE_WIDTH } from '../js/viewport/style.js';
import { defaultsOf } from '../lib/schema.js';

function shape(id, shapeRecord) {
  return { type: 'shape', props: { ...defaultsOf('shape', shapeRecord.type), id, name: id, shape: shapeRecord } };
}

function circle(id, center, radius) {
  return shape(id, { type: 'circle', center, radius });
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

function camera100() {
  const camera = new Camera();
  camera.setSize(400, 400);
  camera.zoomAt({ x: 200, y: 200 }, 100 / camera.scale);
  assert.equal(camera.scale, 100);
  return camera;
}

function uids(model, ...ids) {
  return ids.map((id) => (id === 'root' ? ROOT_UID : model.uidOf(id)));
}

test('style constants follow DESIGN §5.4', () => {
  assert.deepEqual(COLORS, { highlight: 0x5b9cf5, invalid: 0xe5484d, gizmo: 0xd8dade });
  assert.deepEqual(LINE_WIDTH, { outline: 1, selected: 2 });
  assert.deepEqual(GIZMO_SIZE, {
    rootCross: 14,
    rootRing: 10,
    jointCircle: 6,
    jointArc: 20,
    jointNeedle: 20,
    aimArrow: 32,
    centerOfMass: 5,
    rotateHandle: 40,
    rotateKnob: 5,
    pivot: 4,
  });
  assert.deepEqual(HIT_RADIUS, { joint: 8, root: 12, shape: 4, handle: 8 });
  assert.equal(LABEL_SIZE, 11);
  for (const table of [COLORS, LINE_WIDTH, GIZMO_SIZE, HIT_RADIUS]) assert.ok(Object.isFrozen(table));
});

test('hits are joints, then the root, then shapes, later objects first', () => {
  const model = document({
    bodies: [
      body('b_1', [0, 0], 0, [circle('f_1', [0, 0], 1), circle('f_2', [0.5, 0], 1)]),
      body('b_2', [0, 0], 0, [circle('f_3', [0, 0], 1)]),
    ],
    joints: [joint('j_1', 'b_1', 'b_2', [0, 0]), joint('j_2', 'b_1', 'b_2', [0, 0])],
  });
  assert.deepEqual(hitTest(model, camera100(), { x: 200, y: 200 }), uids(model, 'j_2', 'j_1', 'root', 'f_3', 'f_2', 'f_1'));
});

test('joints, root and shapes use their screen-space radii', () => {
  const model = document({
    bodies: [body('b_1', [0, -1], 0, [circle('f_1', [0, 0], 0.5)])],
    joints: [joint('j_1', 'b_1', null, [1, 0])],
  });
  const camera = camera100();
  const [j1, f1] = uids(model, 'j_1', 'f_1');
  assert.deepEqual(hitTest(model, camera, { x: 307, y: 200 }), [j1]);
  assert.deepEqual(hitTest(model, camera, { x: 309, y: 200 }), []);
  assert.deepEqual(hitTest(model, camera, { x: 211, y: 200 }), [ROOT_UID]);
  assert.deepEqual(hitTest(model, camera, { x: 213, y: 200 }), []);
  assert.deepEqual(hitTest(model, camera, { x: 253, y: 300 }), [f1]);
  assert.deepEqual(hitTest(model, camera, { x: 255, y: 300 }), []);
  camera.zoomAt({ x: 200, y: 200 }, 2);
  assert.deepEqual(hitTest(model, camera, { x: 200 + 100 + 3, y: 400 }), [f1]);
  assert.deepEqual(hitTest(model, camera, { x: 200 + 100 + 5, y: 400 }), []);
});

test('bodies are never hit and invalid shapes or anchors are skipped', () => {
  const model = document({
    position: [3, 3],
    bodies: [
      body('b_1', [2, 0], 0, [
        circle('f_1', [0, 0], 0),
        shape('f_2', { type: 'polygon', vertices: [[0, 0], [1, 0]] }),
        shape('f_3', { type: 'box', center: [0, 0], width: -1, height: 1, angle: 0 }),
      ]),
    ],
    joints: [joint('j_1', 'b_1', null, null)],
  });
  assert.deepEqual(hitTest(model, camera100(), { x: 700, y: -100 }), []);
  assert.deepEqual(hitTest(model, camera100(), { x: 500, y: -100 }), [ROOT_UID]);
});

test('the root transform places everything', () => {
  const model = document({
    position: [1, 1],
    angle: Math.PI / 2,
    bodies: [body('b_1', [1, 0], 0, [circle('f_1', [0, 0], 0.2)])],
    joints: [joint('j_1', 'b_1', null, [0, 1])],
  });
  const camera = camera100();
  const [j1, f1] = uids(model, 'j_1', 'f_1');
  assert.deepEqual(hitTest(model, camera, { x: 300, y: 100 }), [ROOT_UID]);
  assert.deepEqual(hitTest(model, camera, { x: 300, y: 0 }), [f1]);
  assert.deepEqual(hitTest(model, camera, { x: 200, y: 100 }), [j1]);
});

test('hit testing follows the displayed pose', () => {
  const model = document({
    bodies: [body('b_1', [0, 0], 0, [circle('f_1', [1, 0], 0.2)])],
    joints: [joint('j_1', 'b_1', null, [0.5, 0])],
  });
  const camera = camera100();
  const [b1, j1, f1] = uids(model, 'b_1', 'j_1', 'f_1');
  assert.deepEqual(hitTest(model, camera, { x: 300, y: 200 }), [f1]);
  const pose = new Map([[b1, { x: 0, y: 0, angle: Math.PI / 2 }]]);
  assert.deepEqual(hitTest(model, camera, { x: 300, y: 200 }, { pose }), []);
  assert.deepEqual(hitTest(model, camera, { x: 200, y: 100 }, { pose }), [f1]);
  assert.deepEqual(hitTest(model, camera, { x: 200, y: 150 }, { pose }), [j1]);
  assert.deepEqual(hitTest(model, camera, { x: 200, y: 150 }, { pose: null }), []);
});

function aabb(minX, minY, maxX, maxY) {
  return { minX, minY, maxX, maxY };
}

test('boxTest takes shapes entirely inside, edges included, and not those partly outside', () => {
  const model = document({
    bodies: [body('b_1', [0, 0], 0, [circle('f_1', [0, 0], 1), circle('f_2', [3, 0], 1)])],
  });
  const [f1, f2] = uids(model, 'f_1', 'f_2');
  assert.deepEqual(boxTest(model, aabb(-1, -1, 1, 1)), [f1]);
  assert.deepEqual(boxTest(model, aabb(-0.999, -1, 1, 1)), []);
  assert.deepEqual(boxTest(model, aabb(-1, -1, 4, 1)), [f1, f2]);
  assert.deepEqual(boxTest(model, aabb(-1, -1, 3.9, 1)), [f1]);
  assert.deepEqual(boxTest(model, aabb(10, 10, 20, 20)), []);
});

test('boxTest counts a rotated box shape by its tight bounds', () => {
  const half = Math.SQRT1_2;
  const model = document({
    bodies: [body('b_1', [0, 0], Math.PI / 4, [shape('f_1', { type: 'box', center: [0, 0], width: 1, height: 1, angle: 0 })])],
  });
  const [f1] = uids(model, 'f_1');
  assert.deepEqual(boxTest(model, aabb(-half - 1e-9, -half - 1e-9, half + 1e-9, half + 1e-9)), [f1]);
  assert.deepEqual(boxTest(model, aabb(-0.6, -0.6, 0.6, 0.6)), []);
});

test('boxTest takes joints by anchor and never the root', () => {
  const model = document({
    position: [1, 0],
    bodies: [body('b_1', [0, 0], 0)],
    joints: [joint('j_1', 'b_1', null, [0, 1]), joint('j_2', 'b_1', null, [5, 5])],
  });
  const [j1] = uids(model, 'j_1');
  assert.deepEqual(boxTest(model, aabb(1, 1, 2, 2)), [j1]);
  assert.deepEqual(boxTest(model, aabb(0, -1, 2, 0.5)), []);
  assert.deepEqual(boxTest(model, aabb(-100, -100, 0.999, 100)), []);
});

test('boxTest skips invalid geometry and unplaced anchors', () => {
  const model = document({
    bodies: [
      body('b_1', [0, 0], 0, [
        circle('f_1', [0, 0], 0),
        shape('f_2', { type: 'polygon', vertices: [[0, 0], [1, 0]] }),
        shape('f_3', { type: 'box', center: [0, 0], width: -1, height: 1, angle: 0 }),
        shape('f_4', { type: 'polygon', vertices: [] }),
        shape('f_5', { type: 'circle', center: [0, Number.NaN], radius: 1 }),
        shape('f_6', { type: 'polygon', vertices: [[0, 0], [1, 1], [1, 0], [0, 1]] }),
      ]),
    ],
    joints: [joint('j_1', 'b_1', null, null)],
  });
  const [f6] = uids(model, 'f_6');
  assert.deepEqual(boxTest(model, aabb(-100, -100, 100, 100)), [f6]);
});

test('boxTest follows the displayed pose and anchors follow bodyA', () => {
  const model = document({
    bodies: [body('b_1', [0, 0], 0, [circle('f_1', [1, 0], 0.2)])],
    joints: [joint('j_1', 'b_1', null, [0.5, 0])],
  });
  const [b1, j1, f1] = uids(model, 'b_1', 'j_1', 'f_1');
  const rest = aabb(0.25, -0.25, 1.25, 0.25);
  assert.deepEqual(boxTest(model, rest), [f1, j1]);
  const pose = new Map([[b1, { x: 0, y: 0, angle: Math.PI / 2 }]]);
  assert.deepEqual(boxTest(model, rest, { pose }), []);
  assert.deepEqual(boxTest(model, aabb(-0.25, 0.25, 0.25, 1.25), { pose }), [f1, j1]);
  assert.deepEqual(boxTest(model, aabb(-0.25, 0.25, 0.25, 1.25), { pose: null }), []);
});

test('boxTest returns shapes in body and fixture order, then joints in joints order', () => {
  const model = document({
    bodies: [
      body('b_1', [0, 0], 0, [circle('f_1', [0, 0], 0.1), circle('f_2', [0.5, 0], 0.1)]),
      body('b_2', [1, 0], 0, [circle('f_3', [0, 0], 0.1)]),
    ],
    joints: [joint('j_1', 'b_1', 'b_2', [0.2, 0]), joint('j_2', 'b_1', 'b_2', [0.1, 0])],
  });
  assert.deepEqual(boxTest(model, aabb(-1, -1, 2, 1)), uids(model, 'f_1', 'f_2', 'f_3', 'j_1', 'j_2'));
});
