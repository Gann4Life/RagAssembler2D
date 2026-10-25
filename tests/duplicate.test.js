import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { duplicatePlan, duplicateSelection } from '../js/commands/duplicate.js';
import { defaultsOf } from '../lib/schema.js';

const COLLECTIONS = { root: ['sprites', 'bodies', 'joints', 'clips'], body: ['fixtures'], clip: ['tracks', 'events'], track: ['keys'] };

function build({ bodies, joints = [], rootAngle = 0, clips = [] }) {
  const editor = createEditor();
  const uids = {};
  editor.history.execute({
    label: 'Build',
    run(tx) {
      const { fixtures: _fixtures, ...bodyDefaults } = defaultsOf('body');
      for (const { id, name = id, position = [0, 0], shapes } of bodies) {
        const fixtures = shapes.map(({ id: shapeId, name: shapeName = shapeId }) => ({
          type: 'shape',
          props: {
            ...defaultsOf('shape', 'circle'),
            id: shapeId,
            name: shapeName,
            shape: { type: 'circle', center: [0.1, 0.2], radius: 0.25 },
            sprite: { asset: null, offset: [0.5, 0], angle: 0.3, scale: [1, 1], z: 2, visible: true },
          },
        }));
        uids[id] = tx.add(ROOT_UID, 'bodies', undefined, {
          type: 'body',
          props: { ...bodyDefaults, id, name, position, angle: 0.4, linearDamping: 0.7, bullet: true },
          children: { fixtures },
        });
        shapes.forEach(({ id: shapeId }, index) => {
          uids[shapeId] = tx.model.children(uids[id], 'fixtures')[index];
        });
      }
      for (const { id, bodyA, bodyB, name = id } of joints) {
        uids[id] = tx.add(ROOT_UID, 'joints', undefined, {
          type: 'joint',
          props: { ...defaultsOf('joint'), id, name, bodyA, bodyB, anchor: [1, 2], collideConnected: true },
        });
      }
      const { tracks: _tracks, events: _events, ...clipProps } = defaultsOf('clip');
      for (const { key, target } of clips) {
        uids[key] = tx.add(ROOT_UID, 'clips', undefined, {
          type: 'clip',
          props: { ...clipProps, key },
          children: {
            tracks: [{ type: 'track', props: { target, channel: 'angle' }, children: { keys: [{ type: 'key', props: { t: 0, value: 0.1 } }] } }],
          },
        });
      }
      tx.set(ROOT_UID, 'rootBody', bodies[0].id);
      tx.set(ROOT_UID, 'angle', rootAngle);
    },
  });
  return { editor, model: editor.model, history: editor.history, uids };
}

function dump(model, uid = ROOT_UID) {
  const node = model.get(uid);
  const children = {};
  for (const collection of COLLECTIONS[node.type] ?? []) {
    children[collection] = model.children(uid, collection).map((child) => dump(model, child));
  }
  return { uid, type: node.type, props: structuredClone(node.props), children };
}

const RIG = {
  bodies: [
    { id: 'b_1', name: 'torso', position: [1, 1], shapes: [{ id: 'f_1', name: 'chest' }, { id: 'f_2' }] },
    { id: 'b_2', name: 'arm', position: [2, 1], shapes: [{ id: 'f_3' }] },
    { id: 'b_3', name: 'leg', position: [3, 1], shapes: [{ id: 'f_4' }] },
  ],
  joints: [
    { id: 'j_1', bodyA: 'b_1', bodyB: 'b_2', name: 'shoulder' },
    { id: 'j_2', bodyA: 'b_2', bodyB: 'b_3', name: 'knee' },
  ],
};

const FORK = {
  bodies: [
    { id: 'b_1', name: 'torso', position: [1, 1], shapes: [{ id: 'f_1' }] },
    { id: 'b_2', name: 'armL', position: [2, 1], shapes: [{ id: 'f_2' }] },
    { id: 'b_3', name: 'armR', position: [3, 1], shapes: [{ id: 'f_3' }] },
  ],
  joints: [
    { id: 'j_1', bodyA: 'b_1', bodyB: 'b_2' },
    { id: 'j_2', bodyA: 'b_1', bodyB: 'b_3' },
    { id: 'j_3', bodyA: 'b_2', bodyB: 'b_3', name: 'loop' },
  ],
};

test('duplicatePlan: whole branches of bodies, shapes and non-loop joints, internal joints included', () => {
  const { model, uids } = build(RIG);
  const branch = duplicatePlan(model, [uids.b_2]);
  assert.deepEqual(branch.bodies, [uids.b_2, uids.b_3]);
  assert.deepEqual(branch.joints, [uids.j_2]);
  assert.deepEqual(duplicatePlan(model, [uids.f_3, ROOT_UID]).bodies, [uids.b_2, uids.b_3]);
  const root = duplicatePlan(model, [uids.b_1]);
  assert.deepEqual(root.bodies, [uids.b_1, uids.b_2, uids.b_3]);
  assert.deepEqual(root.joints, [uids.j_1, uids.j_2]);
  assert.equal(root.empty, false);
  assert.deepEqual(duplicatePlan(model, [uids.b_3]).joints, []);
  assert.throws(() => duplicatePlan(model, [9999]), /Unknown node uid 9999/);
});

test('duplicatePlan: a selected joint copies its child branch and is re-attached', () => {
  const { model, uids } = build(RIG);
  const plan = duplicatePlan(model, [uids.j_1]);
  assert.deepEqual(plan.bodies, [uids.b_2, uids.b_3]);
  assert.deepEqual(plan.joints, [uids.j_1, uids.j_2]);
  const nonSelected = duplicatePlan(model, [uids.b_2]);
  assert.deepEqual(nonSelected.joints, [uids.j_2]);
});

test('duplicatePlan: a loop joint alone, the root or nothing copies nothing; loops inside a branch are internal', () => {
  const { model, uids } = build(FORK);
  assert.equal(duplicatePlan(model, [uids.j_3]).empty, true);
  assert.equal(duplicatePlan(model, [ROOT_UID]).empty, true);
  const plan = duplicatePlan(model, [uids.b_1]);
  assert.deepEqual(plan.joints, [uids.j_1, uids.j_2, uids.j_3]);
  assert.deepEqual(duplicatePlan(model, [uids.b_2, uids.b_3]).joints, [uids.j_3]);
});

test('duplicateSelection copies whole branches with new ids and fields, appended in order', () => {
  const { model, history, uids } = build(RIG);
  const result = history.execute(duplicateSelection([uids.b_2, uids.b_1]));
  const bodies = model.children(ROOT_UID, 'bodies');
  assert.equal(bodies.length, 6);
  const [torsoCopy, armCopy, legCopy] = bodies.slice(3);
  assert.deepEqual(result, [armCopy, torsoCopy]);
  const torso = model.get(torsoCopy).props;
  assert.equal(torso.id, 'b_4');
  assert.equal(torso.name, 'torso_copy');
  assert.equal(torso.angle, 0.4);
  assert.equal(torso.linearDamping, 0.7);
  assert.equal(torso.bullet, true);
  assert.deepEqual(torso.position, model.prop(uids.b_1, 'position'));
  assert.equal(model.prop(legCopy, 'name'), 'leg_copy');
  const shapes = model.children(torsoCopy, 'fixtures');
  assert.deepEqual(shapes.map((shape) => model.prop(shape, 'id')), ['f_5', 'f_6']);
  assert.deepEqual(shapes.map((shape) => model.prop(shape, 'name')), ['chest_copy', 'f_2_copy']);
  assert.deepEqual(model.prop(shapes[0], 'shape'), model.prop(uids.f_1, 'shape'));
  assert.deepEqual(model.prop(shapes[0], 'sprite'), model.prop(uids.f_1, 'sprite'));
  const joints = model.children(ROOT_UID, 'joints');
  assert.equal(joints.length, 4);
  const jointCopy = model.get(joints[2]).props;
  assert.equal(jointCopy.id, 'j_3');
  assert.equal(jointCopy.name, 'shoulder_copy');
  assert.equal(jointCopy.bodyA, 'b_4');
  assert.equal(jointCopy.bodyB, 'b_5');
  assert.equal(jointCopy.collideConnected, true);
  assert.deepEqual(jointCopy.anchor, model.prop(uids.j_1, 'anchor'));
  assert.equal(model.get(joints[3]).props.bodyB, 'b_6');
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'b_1');
});

test('duplicateSelection re-attaches a selected joint to the uncopied parent and selects only selected objects', () => {
  const { model, history, uids } = build(RIG);
  const result = history.execute(duplicateSelection([uids.j_1, ROOT_UID, uids.f_3, uids.j_2, uids.b_2]));
  const [armCopy, legCopy] = model.children(ROOT_UID, 'bodies').slice(3);
  const [shoulderCopy, kneeCopy] = model.children(ROOT_UID, 'joints').slice(2);
  assert.deepEqual(result, [shoulderCopy, model.children(armCopy, 'fixtures')[0], kneeCopy, armCopy]);
  assert.equal(model.get(shoulderCopy).props.bodyA, 'b_1');
  assert.equal(model.get(shoulderCopy).props.bodyB, 'b_4');
  assert.equal(model.get(kneeCopy).props.bodyA, 'b_4');
  assert.equal(model.get(kneeCopy).props.bodyB, 'b_5');
  assert.equal(model.children(ROOT_UID, 'joints').length, 4);
});

test('duplicateSelection copies an ancestor and its selected joint once, and does not copy edge joints', () => {
  const { model, history, uids } = build(RIG);
  const result = history.execute(duplicateSelection([uids.b_1, uids.j_1]));
  assert.equal(model.children(ROOT_UID, 'bodies').length, 6);
  assert.equal(model.children(ROOT_UID, 'joints').length, 4);
  assert.equal(result.length, 2);
  const only = build(RIG);
  only.history.execute(duplicateSelection([only.uids.b_3]));
  assert.equal(only.model.children(ROOT_UID, 'bodies').length, 4);
  assert.equal(only.model.children(ROOT_UID, 'joints').length, 2);
});
test('duplicateSelection names: _copy suffix stripped, first free _copy<k> taken', () => {
  const { model, history, uids } = build({
    bodies: [
      { id: 'b_1', name: 'arm', shapes: [{ id: 'f_1', name: 'pad' }] },
      { id: 'b_2', name: 'arm_copy', shapes: [{ id: 'f_2', name: 'pad_copy3' }] },
      { id: 'b_3', name: 'hand_copy1', shapes: [{ id: 'f_3' }] },
    ],
  });
  history.execute(duplicateSelection([uids.b_1]));
  history.execute(duplicateSelection([uids.b_1]));
  history.execute(duplicateSelection([uids.b_2]));
  history.execute(duplicateSelection([uids.b_3]));
  const bodies = model.children(ROOT_UID, 'bodies').map((body) => model.prop(body, 'name'));
  assert.deepEqual(bodies.slice(3), ['arm_copy2', 'arm_copy3', 'arm_copy4', 'hand_copy1_copy']);
  const shapes = model.children(ROOT_UID, 'bodies').flatMap((body) => model.children(body, 'fixtures').map((shape) => model.prop(shape, 'name')));
  assert.deepEqual(shapes.slice(3), ['pad_copy', 'pad_copy2', 'pad_copy4', 'f_3_copy']);
});

test('duplicateSelection numbers copies made in one operation', () => {
  const { model, history, uids } = build({
    bodies: [
      { id: 'b_1', name: 'arm', shapes: [{ id: 'f_1', name: 'pad' }] },
      { id: 'b_2', name: 'arm', shapes: [{ id: 'f_2', name: 'pad' }] },
    ],
  });
  history.execute(duplicateSelection([uids.b_1, uids.b_2]));
  const names = model.children(ROOT_UID, 'bodies').map((body) => model.prop(body, 'name'));
  assert.deepEqual(names.slice(2), ['arm_copy', 'arm_copy2']);
});

test('duplicateSelection is one undo step with exact undo and redo, leaves tracks and rootBody alone', () => {
  const { model, history, uids } = build({ ...RIG, clips: [{ key: 'c', target: 'b_2' }] });
  const before = dump(model);
  history.execute(duplicateSelection([uids.b_1, uids.b_2]));
  assert.equal(history.state.undoLabel, 'Duplicate');
  const after = dump(model);
  assert.equal(model.children(uids.c, 'tracks').length, 1);
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'b_1');
  history.undo();
  assert.deepEqual(dump(model), before);
  history.redo();
  assert.deepEqual(dump(model), after);
});

test('duplicateSelection throws and mutates nothing for a loop joint alone', () => {
  const { model, history, uids } = build(FORK);
  const before = dump(model);
  assert.throws(() => history.execute(duplicateSelection([ROOT_UID, uids.j_3])), /Nothing to duplicate/);
  assert.deepEqual(dump(model), before);
});

test('duplicate action copies in place, selects the copies and never copies the root', () => {
  const { editor, model, uids } = build({ ...RIG, rootAngle: Math.PI / 2 });
  editor.settings.set('snap.grid', true);
  editor.selection.set([uids.b_1]);
  assert.equal(editor.actions.run('duplicate'), true);
  const copy = model.children(ROOT_UID, 'bodies')[3];
  assert.deepEqual(model.prop(copy, 'position'), model.prop(uids.b_1, 'position'));
  assert.deepEqual(editor.selection.objects, [copy]);
  editor.selection.set([ROOT_UID]);
  assert.equal(editor.actions.isEnabled('duplicate'), false);
  assert.equal(editor.actions.reason('duplicate'), 'select a body, shape or non-loop joint');
  assert.equal(model.children(ROOT_UID, 'bodies').length, 6);
});

test('duplicate action availability: needs a body, shape or non-loop joint in Edit mode, nothing during a gesture', () => {
  const { editor, uids } = build(FORK);
  const { actions, selection, history, modes } = editor;
  selection.set([]);
  assert.equal(actions.isEnabled('duplicate'), false);
  assert.equal(actions.reason('duplicate'), 'select a body, shape or non-loop joint');
  selection.set([uids.j_3]);
  assert.equal(actions.isEnabled('duplicate'), false);
  assert.equal(actions.reason('duplicate'), 'select a body, shape or non-loop joint');
  selection.set([uids.j_1]);
  assert.equal(actions.isEnabled('duplicate'), true);
  selection.set([uids.f_1]);
  assert.equal(actions.isEnabled('duplicate'), true);
  assert.equal(actions.isRepeatable('duplicate'), false);
  history.beginGesture();
  assert.equal(actions.isEnabled('duplicate'), false);
  assert.equal(actions.reason('duplicate'), null);
  history.endGesture();
  modes.startSimulate();
  selection.set([uids.f_1]);
  assert.equal(actions.isEnabled('duplicate'), false);
  assert.equal(actions.reason('duplicate'), 'only in Edit mode');
});
