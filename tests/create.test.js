import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { createJoint, createShapeBody } from '../js/commands/create.js';
import { defaultsOf } from '../lib/schema.js';

function setup() {
  const model = new Model();
  const history = new History(model);
  return { model, history };
}

function bodies(model) {
  return model.children(ROOT_UID, 'bodies');
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('createShapeBody creates a circle body from schema defaults', () => {
  const { model, history } = setup();
  const uid = history.execute(createShapeBody({ position: { x: 1.5, y: -2 }, angle: 0.3, shape: { type: 'circle', radius: 0.4 } }));
  const [bodyUid] = bodies(model);
  const { fixtures, ...bodyDefaults } = defaultsOf('body');
  assert.deepEqual(plain(model.get(bodyUid).props), { ...bodyDefaults, id: 'b_1', name: 'body_1', position: [1.5, -2], angle: 0.3 });
  assert.deepEqual(model.children(bodyUid, 'fixtures'), [uid]);
  assert.equal(model.get(uid).type, 'shape');
  const shapeDefaults = defaultsOf('shape', 'circle');
  assert.deepEqual(plain(model.get(uid).props), {
    ...shapeDefaults,
    id: 'f_1',
    name: 'circle_1',
    shape: { type: 'circle', center: [0, 0], radius: 0.4 },
  });
  assert.equal(model.uidOf('f_1'), uid);
});

test('createShapeBody creates a box body with center zero and angle zero', () => {
  const { model, history } = setup();
  const uid = history.execute(createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'box', width: 2, height: 1 } }));
  assert.deepEqual(plain(model.prop(uid, 'shape')), { type: 'box', center: [0, 0], width: 2, height: 1, angle: 0 });
  assert.equal(model.prop(uid, 'name'), 'box_1');
});

test('createShapeBody lets given shape fields win over defaults', () => {
  const { model, history } = setup();
  const uid = history.execute(
    createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'box', width: 1, height: 1, center: [0.1, 0.2], angle: 0.5 } }),
  );
  assert.deepEqual(plain(model.prop(uid, 'shape')), { type: 'box', center: [0.1, 0.2], width: 1, height: 1, angle: 0.5 });
});

test('names take the number of their own id and bodies are appended', () => {
  const { model, history } = setup();
  model.nextId('b');
  model.nextId('b');
  model.nextId('f');
  const first = history.execute(createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'circle', radius: 1 } }));
  const second = history.execute(createShapeBody({ position: { x: 1, y: 0 }, angle: 0, shape: { type: 'box', width: 1, height: 1 } }));
  assert.deepEqual(
    bodies(model).map((uid) => model.prop(uid, 'name')),
    ['body_3', 'body_4'],
  );
  assert.equal(model.prop(first, 'name'), 'circle_2');
  assert.equal(model.prop(second, 'name'), 'box_3');
  assert.equal(model.prop(second, 'id'), 'f_3');
});

test('rootBody is set only when it is null', () => {
  const { model, history } = setup();
  assert.equal(model.prop(ROOT_UID, 'rootBody'), null);
  history.execute(createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'circle', radius: 1 } }));
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'b_1');
  history.execute(createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'circle', radius: 1 } }));
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'b_1');
});

test('one history step with the default or given label, undo and redo keep ids and uids', () => {
  const { model, history } = setup();
  const uid = history.execute(createShapeBody({ position: { x: 3, y: 4 }, angle: 0, shape: { type: 'box', width: 1, height: 1 } }));
  assert.equal(history.state.undoLabel, 'Create box');
  const after = plain(model.get(ROOT_UID).props);
  const bodyUid = bodies(model)[0];
  assert.equal(history.undo(), true);
  assert.equal(history.state.canUndo, false);
  assert.deepEqual(bodies(model), []);
  assert.equal(model.prop(ROOT_UID, 'rootBody'), null);
  assert.equal(model.get(uid), null);
  assert.equal(history.redo(), true);
  assert.deepEqual(bodies(model), [bodyUid]);
  assert.deepEqual(model.children(bodyUid, 'fixtures'), [uid]);
  assert.deepEqual(plain(model.get(ROOT_UID).props), after);
  assert.equal(model.prop(bodyUid, 'id'), 'b_1');
  assert.equal(model.prop(uid, 'id'), 'f_1');
  history.execute(createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'circle', radius: 1 } }, 'Custom'));
  assert.equal(history.state.undoLabel, 'Custom');
});

test('preconditions throw before mutating or allocating ids', () => {
  const bad = [
    [{ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'polygon', vertices: [] } }, Error],
    [{ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'star' } }, Error],
    [{ position: { x: 0, y: 0 }, angle: 0, shape: undefined }, Error],
    [{ position: { x: NaN, y: 0 }, angle: 0, shape: { type: 'circle', radius: 1 } }, RangeError],
    [{ position: { x: 0, y: Infinity }, angle: 0, shape: { type: 'circle', radius: 1 } }, RangeError],
    [{ position: undefined, angle: 0, shape: { type: 'circle', radius: 1 } }, RangeError],
    [{ position: { x: 0, y: 0 }, angle: NaN, shape: { type: 'circle', radius: 1 } }, RangeError],
    [{ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'circle', radius: 0 } }, RangeError],
    [{ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'circle', radius: -1 } }, RangeError],
    [{ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'circle' } }, RangeError],
    [{ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'box', width: 1, height: 0 } }, RangeError],
    [{ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'box', width: Infinity, height: 1 } }, RangeError],
    [{ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'box', width: '1', height: 1 } }, RangeError],
  ];
  for (const [spec, error] of bad) {
    const { model, history } = setup();
    const before = plain(model.get(ROOT_UID).props);
    assert.throws(() => history.execute(createShapeBody(spec)), error, JSON.stringify(spec));
    assert.deepEqual(bodies(model), []);
    assert.deepEqual(plain(model.get(ROOT_UID).props), before);
    assert.equal(model.nextId('b'), 'b_1');
    assert.equal(model.nextId('f'), 'f_1');
    assert.equal(history.state.canUndo, false);
  }
});

function jointSetup() {
  const { model, history } = setup();
  const shapes = [0, 1, 2].map((x) =>
    history.execute(createShapeBody({ position: { x, y: 0 }, angle: 0, shape: { type: 'circle', radius: 1 } })),
  );
  const [b1, b2, b3] = shapes.map((uid) => model.get(uid).parent);
  return { model, history, b1, b2, b3, shapes };
}

function joints(model) {
  return model.children(ROOT_UID, 'joints');
}

test('createJoint creates a pin joint from schema defaults with file ids', () => {
  const { model, history, b1, b2 } = jointSetup();
  const uid = history.execute(createJoint({ bodyA: b2, bodyB: b1, anchor: { x: 0.5, y: -0.25 } }));
  assert.deepEqual(joints(model), [uid]);
  assert.equal(model.get(uid).type, 'joint');
  assert.deepEqual(plain(model.get(uid).props), {
    ...defaultsOf('joint'),
    id: 'j_1',
    name: 'joint_1',
    bodyA: 'b_2',
    bodyB: 'b_1',
    anchor: [0.5, -0.25],
  });
  assert.equal(model.uidOf('j_1'), uid);
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'b_1');
});

test('createJoint stores given limits and appends after existing joints', () => {
  const { model, history, b1, b2, b3 } = jointSetup();
  model.nextId('j');
  model.nextId('j');
  const first = history.execute(createJoint({ bodyA: b1, bodyB: b2, anchor: { x: 0, y: 0 } }));
  const second = history.execute(
    createJoint({ bodyA: b2, bodyB: b3, anchor: { x: 1, y: 0 }, limits: { enabled: true, lower: -0.5, upper: 0.5 } }),
  );
  assert.deepEqual(joints(model), [first, second]);
  assert.equal(model.prop(first, 'id'), 'j_3');
  assert.equal(model.prop(second, 'name'), 'joint_4');
  assert.deepEqual(plain(model.prop(first, 'limits')), defaultsOf('joint').limits);
  assert.deepEqual(plain(model.prop(second, 'limits')), { enabled: true, lower: -0.5, upper: 0.5 });
  const disabled = history.execute(
    createJoint({ bodyA: b1, bodyB: b3, anchor: { x: 0, y: 0 }, limits: { enabled: false, lower: 0, upper: 0 } }),
  );
  assert.deepEqual(plain(model.prop(disabled, 'limits')), { enabled: false, lower: 0, upper: 0 });
});

test('createJoint is one history step; undo and redo keep the id and uid', () => {
  const { model, history, b1, b2 } = jointSetup();
  const before = plain(model.get(ROOT_UID).props);
  const uid = history.execute(createJoint({ bodyA: b1, bodyB: b2, anchor: { x: 0.5, y: 0 } }));
  assert.equal(history.state.undoLabel, 'Create joint');
  const props = plain(model.get(uid).props);
  assert.equal(history.undo(), true);
  assert.deepEqual(joints(model), []);
  assert.equal(model.get(uid), null);
  assert.deepEqual(plain(model.get(ROOT_UID).props), before);
  assert.equal(history.state.undoLabel, 'Create circle');
  assert.equal(history.redo(), true);
  assert.deepEqual(joints(model), [uid]);
  assert.deepEqual(plain(model.get(uid).props), props);
  assert.equal(model.uidOf('j_1'), uid);
  history.execute(createJoint({ bodyA: b2, bodyB: model.children(ROOT_UID, 'bodies')[2], anchor: { x: 0, y: 0 } }, 'Custom'));
  assert.equal(history.state.undoLabel, 'Custom');
});

test('createJoint preconditions throw before mutating or allocating ids', () => {
  const probe = jointSetup();
  const { b1, b2, shapes } = probe;
  const anchor = { x: 0, y: 0 };
  const bad = [
    [{ bodyA: b1, bodyB: shapes[1], anchor }, Error],
    [{ bodyA: ROOT_UID, bodyB: b2, anchor }, Error],
    [{ bodyA: b1, bodyB: 999, anchor }, Error],
    [{ bodyA: undefined, bodyB: b2, anchor }, Error],
    [{ bodyA: b1, bodyB: b1, anchor }, Error],
    [{ bodyA: b1, bodyB: b2, anchor: { x: NaN, y: 0 } }, RangeError],
    [{ bodyA: b1, bodyB: b2, anchor: { x: 0, y: Infinity } }, RangeError],
    [{ bodyA: b1, bodyB: b2, anchor: undefined }, RangeError],
    [{ bodyA: b1, bodyB: b2, anchor, limits: { enabled: 'yes', lower: 0, upper: 0 } }, RangeError],
    [{ bodyA: b1, bodyB: b2, anchor, limits: { enabled: true, lower: NaN, upper: 0 } }, RangeError],
    [{ bodyA: b1, bodyB: b2, anchor, limits: { enabled: true, lower: 0, upper: Infinity } }, RangeError],
    [{ bodyA: b1, bodyB: b2, anchor, limits: { enabled: true, lower: 0.1, upper: 0.5 } }, RangeError],
    [{ bodyA: b1, bodyB: b2, anchor, limits: { enabled: true, lower: -0.5, upper: -0.1 } }, RangeError],
    [{ bodyA: b1, bodyB: b2, anchor, limits: null }, RangeError],
  ];
  for (const [spec, error] of bad) {
    const { model, history } = jointSetup();
    const before = plain(model.get(ROOT_UID).props);
    assert.throws(() => history.execute(createJoint(spec)), error, JSON.stringify(spec));
    assert.deepEqual(joints(model), []);
    assert.deepEqual(plain(model.get(ROOT_UID).props), before);
    assert.equal(history.state.undoLabel, 'Create circle');
    const uid = history.execute(createJoint({ bodyA: b1, bodyB: b2, anchor }));
    assert.equal(model.prop(uid, 'id'), 'j_1');
  }
});

test('createJoint refuses a pair already joined, in either order', () => {
  const { model, history, b1, b2 } = jointSetup();
  history.execute(createJoint({ bodyA: b1, bodyB: b2, anchor: { x: 0, y: 0 } }));
  for (const [bodyA, bodyB] of [[b1, b2], [b2, b1]]) {
    assert.throws(() => history.execute(createJoint({ bodyA, bodyB, anchor: { x: 0, y: 0 } })), Error);
    assert.equal(joints(model).length, 1);
    assert.equal(history.state.undoLabel, 'Create joint');
  }
  assert.equal(model.nextId('j'), 'j_2');
});

test('createJoint with both bodies null creates an unassigned joint; undo and redo keep its id and uid', () => {
  const { model, history } = setup();
  const before = plain(model.get(ROOT_UID).props);
  const uid = history.execute(createJoint({ bodyA: null, bodyB: null, anchor: { x: 0, y: 0 } }, 'Add joint'));
  assert.deepEqual(joints(model), [uid]);
  assert.deepEqual(plain(model.get(uid).props), {
    ...defaultsOf('joint'),
    id: 'j_1',
    name: 'joint_1',
    bodyA: null,
    bodyB: null,
    anchor: [0, 0],
  });
  assert.deepEqual(plain(model.get(ROOT_UID).props), before);
  assert.equal(history.state.undoLabel, 'Add joint');
  assert.equal(history.undo(), true);
  assert.deepEqual(joints(model), []);
  assert.equal(history.redo(), true);
  assert.deepEqual(joints(model), [uid]);
  assert.equal(model.uidOf('j_1'), uid);
  const second = history.execute(createJoint({ bodyA: null, bodyB: null, anchor: { x: 0, y: 0 } }));
  assert.equal(model.prop(second, 'id'), 'j_2');
});

test('createJoint refuses one null body', () => {
  const { model, history, b1 } = jointSetup();
  for (const [bodyA, bodyB] of [[null, b1], [b1, null], [null, undefined]]) {
    assert.throws(() => history.execute(createJoint({ bodyA, bodyB, anchor: { x: 0, y: 0 } })), Error);
  }
  assert.deepEqual(joints(model), []);
  assert.equal(model.nextId('j'), 'j_1');
});