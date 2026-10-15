import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { setProps } from '../js/commands/props.js';
import { defaultsOf } from '../lib/schema.js';

function setup() {
  const model = new Model();
  const history = new History(model);
  const changes = [];
  model.on('change', (payload) => changes.push(payload));
  return { model, history, changes };
}

function addNode(history, collection, snapshot) {
  return history.execute({ label: 'Add', run: (tx) => tx.add(ROOT_UID, collection, undefined, snapshot) });
}

function addClip(history, name, key) {
  const { tracks, events, ...props } = defaultsOf('clip');
  return addNode(history, 'clips', { type: 'clip', props: { ...props, name, key } });
}

function addJoint(history, model, name) {
  return addNode(history, 'joints', { type: 'joint', props: { ...defaultsOf('joint'), id: model.nextId('j'), name } });
}

test('setProps sets every path on every uid in one step', () => {
  const { model, history, changes } = setup();
  const a = addJoint(history, model, 'a');
  const b = addJoint(history, model, 'b');
  changes.length = 0;
  const command = setProps([a, b], { 'limits.upper': 1.2, 'motor.maxTorque': 50 });
  assert.equal(command.label, 'Edit properties');
  history.execute(command);
  assert.equal(changes.length, 1);
  assert.deepEqual(
    changes[0].changes.map((change) => [change.uid, change.path]),
    [
      [a, 'limits.upper'],
      [a, 'motor.maxTorque'],
      [b, 'limits.upper'],
      [b, 'motor.maxTorque'],
    ],
  );
  assert.equal(model.prop(b, 'limits.upper'), 1.2);
  assert.equal(history.state.undoLabel, 'Edit properties');
  history.undo();
  assert.equal(model.prop(a, 'limits.upper'), defaultsOf('joint').limits.upper);
  assert.equal(model.prop(b, 'motor.maxTorque'), defaultsOf('joint').motor.maxTorque);
});

test('setProps takes a custom label and does not check types or ranges', () => {
  const { model, history } = setup();
  const a = addJoint(history, model, 'a');
  history.execute(setProps([a], { 'limits.upper': 'not a number' }, 'Upper limit'));
  assert.equal(model.prop(a, 'limits.upper'), 'not a number');
  assert.equal(history.state.undoLabel, 'Upper limit');
});

test('setProps throws before mutating on empty input, unknown uids and id paths', () => {
  const { model, history, changes } = setup();
  const a = addJoint(history, model, 'a');
  changes.length = 0;
  for (const command of [
    setProps([], { name: 'x' }),
    setProps([a], {}),
    setProps([a, 9999], { name: 'x' }),
    setProps([a], { name: 'x', id: 'j_99' }),
    setProps([a], { 'id.x': 1 }),
  ]) {
    assert.throws(() => history.execute(command));
  }
  assert.deepEqual(changes, []);
  assert.equal(model.prop(a, 'name'), 'a');
});

test('renaming a clip with an automatic key makes the key follow the name', () => {
  const { model, history } = setup();
  const clip = addClip(history, 'New Clip', 'new_clip');
  history.execute(setProps([clip], { name: 'Walk Cycle' }));
  assert.equal(model.prop(clip, 'key'), 'walk_cycle');
  history.undo();
  assert.equal(model.prop(clip, 'name'), 'New Clip');
  assert.equal(model.prop(clip, 'key'), 'new_clip');
});

test('a hand-edited clip key does not follow the name', () => {
  const { model, history } = setup();
  const clip = addClip(history, 'Walk', 'custom');
  history.execute(setProps([clip], { name: 'Run' }));
  assert.equal(model.prop(clip, 'key'), 'custom');
});

test('the followed key avoids the keys of the other clips', () => {
  const { model, history } = setup();
  addClip(history, 'Run', 'run');
  const clip = addClip(history, 'Walk', 'walk');
  history.execute(setProps([clip], { name: 'Run' }));
  assert.equal(model.prop(clip, 'key'), 'run_2');
});

test('an explicit key wins over key-follows-name', () => {
  const { model, history } = setup();
  const clip = addClip(history, 'Walk', 'walk');
  history.execute(setProps([clip], { name: 'Run', key: 'sprint' }));
  assert.equal(model.prop(clip, 'key'), 'sprint');
});

test('renaming several clips at once yields unique keys, in uid order', () => {
  const { model, history } = setup();
  const a = addClip(history, 'A', 'a');
  const b = addClip(history, 'B', 'b');
  history.execute(setProps([a, b], { name: 'Run' }));
  assert.equal(model.prop(a, 'key'), 'run');
  assert.equal(model.prop(b, 'key'), 'run_2');
  history.undo();
  assert.equal(model.prop(a, 'key'), 'a');
  assert.equal(model.prop(b, 'key'), 'b');
});

test('renaming other node types never sets a key', () => {
  const { model, history } = setup();
  const joint = addJoint(history, model, 'elbow');
  history.execute(setProps([joint], { name: 'knee' }));
  assert.equal(model.prop(joint, 'key'), undefined);
});
