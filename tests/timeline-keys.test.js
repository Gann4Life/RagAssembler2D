import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { createClip, createJoint, createShapeBody } from '../js/commands/create.js';
import { deleteKeys, moveKeys, setJointAngleKey } from '../js/commands/keys.js';
import { setProps } from '../js/commands/props.js';
import { jointAngleRows } from '../js/timeline-rows.js';
import { SNAP_STEP } from '../js/timeline-time.js';

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
}

function environment(times = [0.2, 0.5, 0.8]) {
  const editor = createEditor();
  const { model, history } = editor;
  const bodies = [0, 1].map((x) =>
    model.get(history.execute(createShapeBody({ position: { x, y: 0 }, angle: 0, shape: { type: 'circle', radius: 0.4 } }))).parent,
  );
  history.execute(setProps([ROOT_UID], { rootBody: model.prop(bodies[0], 'id') }));
  const joint = history.execute(createJoint({ bodyA: bodies[0], bodyB: bodies[1], anchor: { x: 0.5, y: 0 } }));
  const clip = history.execute(createClip());
  for (const [index, time] of times.entries()) history.execute(setJointAngleKey(clip, joint, time, index));
  const keys = () => jointAngleRows(model, clip)[0].keys;
  return { ...editor, joint, clip, keys };
}

test('moveKeys snaps to 1/30 s, keeps keys sorted and undoes in one step', () => {
  const { history, keys } = environment();
  const [first, , third] = keys().map((key) => key.uid);
  const depth = history.state.undoLabel;
  history.execute(moveKeys([first], 0.7));
  assert.deepEqual(keys().map((key) => key.uid).slice(0, 2).length, 2);
  assert.equal(keys().at(-1).uid, first);
  near(keys().at(-1).t, 0.9);
  assert.equal(history.state.undoLabel, 'Move keys');
  history.undo();
  assert.equal(history.state.undoLabel, depth);
  assert.equal(keys()[0].uid, first);
  near(keys()[0].t, 0.2);
  assert.equal(keys()[2].uid, third);
});

test('moveKeys clamps to the clip and replaces a key it lands on', () => {
  const { history, keys } = environment();
  const [first, second] = keys().map((key) => key.uid);
  history.execute(moveKeys([first], -5));
  near(keys()[0].t, 0);
  history.execute(moveKeys([first], 0.5));
  assert.equal(keys().length, 2);
  assert.ok(!keys().some((key) => key.uid === second));
  near(keys()[0].t, 0.5);
  history.undo();
  assert.equal(keys().length, 3);
  assert.ok(keys().some((key) => key.uid === second));
  near(keys()[0].t, 0);
  history.undo();
  near(keys()[0].t, 0.2);
});

test('moveKeys moves a group by one offset and stops at the clip edge', () => {
  const { history, keys } = environment();
  const [first, second, third] = keys().map((key) => key.uid);
  history.execute(moveKeys([second, third], 5));
  assert.deepEqual(keys().map((key) => key.uid), [first, second, third]);
  near(keys()[2].t - keys()[1].t, 0.3);
  near(keys()[2].t, 1);
  near(keys()[0].t, 0.2);
  assert.ok(Math.abs(keys()[2].t / SNAP_STEP - Math.round(keys()[2].t / SNAP_STEP)) < 1e-9);
});

test('moveKeys rejects bad input without mutating', () => {
  const { history, keys, joint } = environment();
  const before = JSON.stringify(keys());
  assert.throws(() => history.execute(moveKeys([keys()[0].uid], Number.NaN)), TypeError);
  assert.throws(() => history.execute(moveKeys([keys()[0].uid, joint], 0.1)), /not a key/);
  assert.equal(JSON.stringify(keys()), before);
});

test('deleteKeys removes keys, keeps an empty track and undoes', () => {
  const { history, keys, model, clip } = environment();
  history.execute(deleteKeys([keys()[1].uid]));
  assert.equal(keys().length, 2);
  history.execute(deleteKeys(keys().map((key) => key.uid)));
  assert.equal(model.children(clip, 'tracks').length, 1);
  assert.equal(jointAngleRows(model, clip)[0].keys.length, 0);
  history.undo();
  assert.equal(keys().length, 2);
  history.undo();
  assert.equal(keys().length, 3);
  near(keys()[1].t, 0.5);
});
