import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { createShapeBody } from '../js/commands/create.js';
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
