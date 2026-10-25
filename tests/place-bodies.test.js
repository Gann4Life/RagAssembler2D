import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { placeBodies, rotationPivot } from '../js/commands/transform.js';
import { rotationPivot as manipulationPivot } from '../js/tools/manipulation.js';
import { defaultsOf } from '../lib/schema.js';

const EPSILON = 1e-9;

function near(actual, expected, message = '') {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message} expected ${expected}, got ${actual}`);
}

function nearPair(actual, expected, message = '') {
  near(actual[0], expected[0], `${message} x`);
  near(actual[1], expected[1], `${message} y`);
}

function arm() {
  const model = new Model();
  const history = new History(model);
  const uids = {};
  const bodies = {
    b_1: { position: [0, 0], angle: 0 },
    b_2: { position: [1, 0], angle: 0 },
    b_3: { position: [2, 0], angle: 0.5 },
    b_4: { position: [3, 0], angle: 0 },
    b_5: { position: [5, 5], angle: 0.25 },
  };
  const joints = [
    ['b_1', 'b_2', [0.5, 0]],
    ['b_2', 'b_3', [1.5, 0]],
    ['b_3', 'b_4', [2.5, 0]],
  ];
  history.execute({
    label: 'Build',
    run(tx) {
      for (const [id, props] of Object.entries(bodies)) {
        uids[id] = tx.add(ROOT_UID, 'bodies', undefined, { type: 'body', props: { id, ...props }, children: { fixtures: [] } });
      }
      joints.forEach(([bodyA, bodyB, anchor], index) => {
        const id = `j_${index + 1}`;
        uids[id] = tx.add(ROOT_UID, 'joints', undefined, { type: 'joint', props: { ...defaultsOf('joint'), id, bodyA, bodyB, anchor } });
      });
      tx.set(ROOT_UID, 'rootBody', 'b_1');
    },
  });
  return { model, history, uids };
}

test('placeBodies: a position edit translates the body with its subtree and carried anchors', () => {
  const { model, history, uids } = arm();
  history.execute(placeBodies([uids.b_2], { x: 2 }));
  assert.deepEqual(model.prop(uids.b_1, 'position'), [0, 0]);
  assert.deepEqual(model.prop(uids.b_2, 'position'), [2, 0]);
  nearPair(model.prop(uids.b_3, 'position'), [3, 0]);
  nearPair(model.prop(uids.b_4, 'position'), [4, 0]);
  nearPair(model.prop(uids.j_1, 'anchor'), [1.5, 0]);
  nearPair(model.prop(uids.j_2, 'anchor'), [2.5, 0]);
  nearPair(model.prop(uids.j_3, 'anchor'), [3.5, 0]);
  assert.equal(model.prop(uids.b_3, 'angle'), 0.5);
  assert.deepEqual(model.prop(uids.b_5, 'position'), [5, 5]);
  assert.equal(history.state.undoLabel, 'Move');
});

test('placeBodies: a y edit leaves x and the angle as they are', () => {
  const { model, history, uids } = arm();
  history.execute(placeBodies([uids.b_3], { y: -1 }, 'Move'));
  assert.deepEqual(model.prop(uids.b_3, 'position'), [2, -1]);
  nearPair(model.prop(uids.b_4, 'position'), [3, -1]);
  nearPair(model.prop(uids.j_2, 'anchor'), [1.5, -1]);
  assert.equal(model.prop(uids.b_3, 'angle'), 0.5);
  assert.deepEqual(model.prop(uids.b_2, 'position'), [1, 0]);
});

test('placeBodies: an angle edit turns the subtree around the parent joint anchor', () => {
  const { model, history, uids } = arm();
  history.execute(placeBodies([uids.b_2], { angle: Math.PI / 2 }, 'Rotate'));
  assert.equal(model.prop(uids.b_2, 'angle'), Math.PI / 2);
  nearPair(model.prop(uids.b_2, 'position'), [0.5, 0.5], 'b_2');
  nearPair(model.prop(uids.b_3, 'position'), [0.5, 1.5], 'b_3');
  near(model.prop(uids.b_3, 'angle'), 0.5 + Math.PI / 2, 'b_3 angle');
  nearPair(model.prop(uids.j_1, 'anchor'), [0.5, 0], 'j_1');
  nearPair(model.prop(uids.j_2, 'anchor'), [0.5, 1], 'j_2');
  assert.deepEqual(model.prop(uids.b_1, 'position'), [0, 0]);
  assert.equal(history.state.undoLabel, 'Rotate');
});

test('placeBodies: rootBody and bodies without a parent joint turn around their origin', () => {
  const { model, history, uids } = arm();
  history.execute(placeBodies([uids.b_1], { angle: Math.PI }));
  assert.deepEqual(model.prop(uids.b_1, 'position'), [0, 0]);
  assert.equal(model.prop(uids.b_1, 'angle'), Math.PI);
  nearPair(model.prop(uids.b_2, 'position'), [-1, 0]);
  history.execute(placeBodies([uids.b_5], { angle: 1 }));
  assert.deepEqual(model.prop(uids.b_5, 'position'), [5, 5]);
  assert.equal(model.prop(uids.b_5, 'angle'), 1);
});

test('placeBodies: several bodies are placed in order, each ending at the value, in one undo step', () => {
  const { model, history, uids } = arm();
  const before = history.state.undoLabel;
  history.execute(placeBodies([uids.b_2, uids.b_3], { x: 10 }));
  assert.deepEqual(model.prop(uids.b_2, 'position'), [10, 0]);
  assert.deepEqual(model.prop(uids.b_3, 'position'), [10, 0]);
  nearPair(model.prop(uids.b_4, 'position'), [11, 0]);
  history.undo();
  assert.equal(history.state.undoLabel, before);
  assert.deepEqual(model.prop(uids.b_2, 'position'), [1, 0]);
  assert.deepEqual(model.prop(uids.b_3, 'position'), [2, 0]);
  assert.deepEqual(model.prop(uids.b_4, 'position'), [3, 0]);
  assert.deepEqual(model.prop(uids.j_1, 'anchor'), [0.5, 0]);
});

test('placeBodies: several angles end at the value whatever the order', () => {
  const { model, history, uids } = arm();
  history.execute(placeBodies([uids.b_3, uids.b_2], { angle: 1 }));
  assert.equal(model.prop(uids.b_2, 'angle'), 1);
  assert.equal(model.prop(uids.b_3, 'angle'), 1);
});

test('placeBodies: the current values record nothing', () => {
  const { history, uids } = arm();
  history.execute(placeBodies([uids.b_2], { x: 1, angle: 0 }));
  assert.equal(history.state.undoLabel, 'Build');
});

test('placeBodies: a uid that is not a body or a non-finite value throws before mutating', () => {
  const { model, history, uids } = arm();
  assert.throws(() => history.execute(placeBodies([uids.b_2, uids.j_1], { x: 3 })), /not a body/);
  assert.throws(() => history.execute(placeBodies([uids.b_2], { x: Number.NaN })), RangeError);
  assert.throws(() => history.execute(placeBodies([uids.b_2], { angle: Infinity })), RangeError);
  assert.deepEqual(model.prop(uids.b_2, 'position'), [1, 0]);
  assert.equal(history.state.undoLabel, 'Build');
});

test('rotationPivot moved to transform.js and is re-exported unchanged by manipulation.js', () => {
  const { model, uids } = arm();
  assert.equal(manipulationPivot, rotationPivot);
  assert.deepEqual(rotationPivot(model, uids.b_3, false), { x: 1.5, y: 0 });
  assert.deepEqual(rotationPivot(model, uids.b_3, true), { x: 2, y: 0 });
  assert.deepEqual(rotationPivot(model, uids.b_1, false), { x: 0, y: 0 });
});
