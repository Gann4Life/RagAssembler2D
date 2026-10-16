import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { deleteObjects, deletionPlan } from '../js/commands/delete.js';
import { defaultsOf } from '../lib/schema.js';

const COLLECTIONS = { root: ['sprites', 'bodies', 'joints', 'clips'], body: ['fixtures'], clip: ['tracks', 'events'], track: ['keys'] };

function build({ bodies = {}, joints = [], rootBody = null, clips = [], sprites = [], editorOptions = {} }) {
  const editor = createEditor(editorOptions);
  const { history } = editor;
  const uids = {};
  history.execute({
    label: 'Build',
    run(tx) {
      for (const id of sprites) uids[id] = tx.add(ROOT_UID, 'sprites', undefined, { type: 'spriteAsset', props: { id } });
      for (const [id, shapes] of Object.entries(bodies)) {
        const fixtures = shapes.map((shapeId) => ({ type: 'shape', props: { id: shapeId, name: `shape ${shapeId}` } }));
        uids[id] = tx.add(ROOT_UID, 'bodies', undefined, { type: 'body', props: { id, name: `body ${id}` }, children: { fixtures } });
        for (const [index, shapeId] of shapes.entries()) uids[shapeId] = tx.model.children(uids[id], 'fixtures')[index];
      }
      joints.forEach(([bodyA, bodyB], index) => {
        const id = `j_${index + 1}`;
        uids[id] = tx.add(ROOT_UID, 'joints', undefined, { type: 'joint', props: { ...defaultsOf('joint'), id, bodyA, bodyB } });
      });
      const { tracks: _tracks, events: _events, ...clipProps } = defaultsOf('clip');
      clips.forEach((targets, clipIndex) => {
        const clipName = `c_${clipIndex + 1}`;
        const tracks = targets.map((target) => ({
          type: 'track',
          props: { target, channel: 'angle' },
          children: { keys: [{ type: 'key', props: { t: 0, value: 0.5 } }] },
        }));
        uids[clipName] = tx.add(ROOT_UID, 'clips', undefined, {
          type: 'clip',
          props: { ...clipProps, key: clipName },
          children: { tracks },
        });
        targets.forEach((target, index) => {
          uids[`${clipName}:${target}`] = tx.model.children(uids[clipName], 'tracks')[index];
        });
      });
      tx.set(ROOT_UID, 'rootBody', rootBody);
    },
  });
  return { editor, model: editor.model, uids };
}

function names(uids, list) {
  const byUid = new Map(Object.entries(uids).map(([name, uid]) => [uid, name]));
  return list.map((uid) => byUid.get(uid));
}

function summary(plan, uids) {
  return {
    bodies: names(uids, plan.bodies),
    shapes: names(uids, plan.shapes),
    joints: names(uids, plan.joints),
    tracks: names(uids, plan.tracks),
    rootBody: plan.rootBody,
    confirm: plan.confirm,
    empty: plan.empty,
  };
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
  bodies: { b_1: ['f_1'], b_2: ['f_2', 'f_3'], b_3: ['f_4'] },
  joints: [['b_1', 'b_2'], ['b_2', 'b_3'], ['b_3', 'b_1']],
  rootBody: 'b_1',
};

test('deletionPlan: the only shape of a body deletes the body and its joints', () => {
  const { model, uids } = build(RIG);
  assert.deepEqual(summary(deletionPlan(model, [uids.f_4]), uids), {
    bodies: ['b_3'],
    shapes: [],
    joints: ['j_2', 'j_3'],
    tracks: [],
    rootBody: null,
    confirm: false,
    empty: false,
  });
});

test('deletionPlan: one of two shapes deletes only the shape; both delete the grouped body', () => {
  const { model, uids } = build(RIG);
  const one = summary(deletionPlan(model, [uids.f_3]), uids);
  assert.deepEqual([one.bodies, one.shapes, one.joints], [[], ['f_3'], []]);
  const both = summary(deletionPlan(model, [uids.f_3, uids.f_2]), uids);
  assert.deepEqual([both.bodies, both.shapes, both.joints], [['b_2'], [], ['j_1', 'j_2']]);
});

test('deletionPlan: a body and its shape list the body once; duplicates are ignored', () => {
  const { model, uids } = build(RIG);
  const plan = summary(deletionPlan(model, [uids.f_2, uids.b_2, uids.b_2, uids.f_2]), uids);
  assert.deepEqual([plan.bodies, plan.shapes], [['b_2'], []]);
});

test('deletionPlan: shapes and bodies follow body order, then fixture order', () => {
  const { model, uids } = build({ bodies: { b_1: ['f_1', 'f_2'], b_2: ['f_3', 'f_4'], b_3: ['f_5'] } });
  const plan = summary(deletionPlan(model, [uids.f_4, uids.b_3, uids.f_2, uids.f_3, uids.f_5]), uids);
  assert.deepEqual([plan.bodies, plan.shapes], [['b_2', 'b_3'], ['f_2']]);
});

test('deletionPlan: a lone joint deletes only the joint', () => {
  const { model, uids } = build(RIG);
  const plan = summary(deletionPlan(model, [uids.j_2]), uids);
  assert.deepEqual([plan.bodies, plan.shapes, plan.joints, plan.rootBody], [[], [], ['j_2'], null]);
});

test('deletionPlan: joints cascade as bodyA and as bodyB, in joints order', () => {
  const { model, uids } = build(RIG);
  assert.deepEqual(summary(deletionPlan(model, [uids.b_2]), uids).joints, ['j_1', 'j_2']);
  assert.deepEqual(summary(deletionPlan(model, [uids.j_3, uids.b_3]), uids).joints, ['j_2', 'j_3']);
});

test('deletionPlan: tracks of removed joints and shapes go in clip order, then track order; root tracks never', () => {
  const { model, uids } = build({
    ...RIG,
    clips: [
      ['root', 'f_3', 'j_1', 'f_1'],
      ['f_1', 'j_3', 'root', 'f_2'],
    ],
  });
  const plan = summary(deletionPlan(model, [uids.b_1, uids.f_3]), uids);
  assert.deepEqual(plan.joints, ['j_1', 'j_3']);
  assert.deepEqual(plan.tracks, ['c_1:f_3', 'c_1:j_1', 'c_1:f_1', 'c_2:f_1', 'c_2:j_3']);
  assert.equal(plan.confirm, true);
  const everything = deletionPlan(model, [uids.b_1, uids.b_2, uids.b_3, ROOT_UID]);
  assert.ok(!everything.tracks.includes(uids['c_1:root']));
  assert.ok(!everything.tracks.includes(uids['c_2:root']));
  assert.equal(everything.tracks.length, 6);
});

test('deletionPlan: confirm is set exactly when tracks are removed', () => {
  const { model, uids } = build({ ...RIG, clips: [['f_4']] });
  assert.equal(deletionPlan(model, [uids.j_1]).confirm, false);
  assert.equal(deletionPlan(model, [uids.f_1]).confirm, false);
  assert.equal(deletionPlan(model, [uids.b_3]).confirm, true);
});

test('deletionPlan: rootBody moves to the first remaining body, or to null', () => {
  const { model, uids } = build({ ...RIG, bodies: { b_3: ['f_4'], b_1: ['f_1'], b_2: ['f_2', 'f_3'] } });
  assert.deepEqual(deletionPlan(model, [uids.b_1]).rootBody, { from: 'b_1', to: 'b_3' });
  assert.deepEqual(deletionPlan(model, [uids.b_1, uids.f_4]).rootBody, { from: 'b_1', to: 'b_2' });
  assert.deepEqual(deletionPlan(model, [uids.b_1, uids.b_2, uids.b_3]).rootBody, { from: 'b_1', to: null });
  assert.equal(deletionPlan(model, [uids.b_2]).rootBody, null);
});

test('deletionPlan: root, clip and sprite asset uids are ignored; an unknown uid throws', () => {
  const { model, uids } = build({ ...RIG, sprites: ['s_1'], clips: [['f_1']] });
  const plan = deletionPlan(model, [ROOT_UID, uids.c_1, uids.s_1]);
  assert.deepEqual(summary(plan, uids), {
    bodies: [],
    shapes: [],
    joints: [],
    tracks: [],
    rootBody: null,
    confirm: false,
    empty: true,
  });
  assert.equal(deletionPlan(model, []).empty, true);
  assert.ok(Object.isFrozen(plan));
  assert.throws(() => deletionPlan(model, [uids.b_1, 999]), Error);
});

test('deleteObjects is one Delete step; undo restores the identical document and redo removes it again', () => {
  const { editor, model, uids } = build({ ...RIG, sprites: ['s_1'], clips: [['f_1', 'root', 'j_2'], ['f_4']] });
  const { history } = editor;
  const before = dump(model);
  const plan = history.execute(deleteObjects([uids.f_1, uids.f_4, uids.f_3]));
  assert.deepEqual(names(uids, plan.bodies), ['b_1', 'b_3']);
  assert.equal(history.state.undoLabel, 'Delete');
  const after = dump(model);
  assert.deepEqual(names(uids, model.children(ROOT_UID, 'bodies')), ['b_2']);
  assert.deepEqual(names(uids, model.children(uids.b_2, 'fixtures')), ['f_2']);
  assert.deepEqual(model.children(ROOT_UID, 'joints'), []);
  assert.deepEqual(names(uids, model.children(uids.c_1, 'tracks')), ['c_1:root']);
  assert.deepEqual(model.children(uids.c_2, 'tracks'), []);
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'b_2');
  assert.equal(history.undo(), true);
  assert.deepEqual(dump(model), before);
  assert.equal(model.uidOf('b_1'), uids.b_1);
  assert.equal(history.redo(), true);
  assert.deepEqual(dump(model), after);
  assert.equal(history.undo(), true);
  assert.deepEqual(dump(model), before);
});

test('deleteObjects takes a custom label and prunes the selection', () => {
  const { editor, model, uids } = build(RIG);
  const { history, selection } = editor;
  selection.set([ROOT_UID, uids.f_2, uids.j_2, uids.b_1]);
  history.execute(deleteObjects(selection.objects, 'Remove'));
  assert.equal(history.state.undoLabel, 'Remove');
  assert.deepEqual(selection.objects, [ROOT_UID]);
  assert.equal(model.get(uids.b_1), null);
  assert.deepEqual(names(uids, model.children(uids.b_2, 'fixtures')), ['f_3']);
});

test('deleteObjects throws on an empty plan or an unknown uid and mutates nothing', () => {
  const { editor, model, uids } = build({ ...RIG, sprites: ['s_1'] });
  const { history } = editor;
  const before = dump(model);
  assert.throws(() => history.execute(deleteObjects([ROOT_UID, uids.s_1])), Error);
  assert.throws(() => history.execute(deleteObjects([uids.b_1, 999])), Error);
  assert.deepEqual(dump(model), before);
  assert.equal(history.state.undoLabel, 'Build');
});

test('deletionPlan: clips lists each clip holding a removed track, in clip order, with track and key counts', () => {
  const { model, uids } = build({ ...RIG, clips: [['f_1', 'j_1', 'f_4'], ['f_4'], ['f_2']] });
  const plan = deletionPlan(model, [uids.b_1, uids.b_3]);
  assert.deepEqual(plan.clips, [
    { uid: uids.c_1, tracks: 3, keys: 3 },
    { uid: uids.c_2, tracks: 1, keys: 1 },
  ]);
  assert.ok(Object.isFrozen(plan.clips));
  assert.deepEqual(deletionPlan(model, [uids.j_2]).clips, []);
});

function confirmRig(answer) {
  const requests = [];
  const confirm = (request) => {
    requests.push(request);
    return answer(request);
  };
  const built = build({
    bodies: { b_1: ['f_1'], b_2: ['f_2'], b_3: ['f_3'] },
    joints: [['b_1', 'b_2'], ['b_1', 'b_3']],
    rootBody: 'b_1',
    clips: [['f_1', 'j_1', 'j_2'], ['f_1']],
    editorOptions: { confirm },
  });
  built.editor.selection.set([built.uids.b_1]);
  return { ...built, requests };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('delete without tracks never asks and runs synchronously', () => {
  const requests = [];
  const { editor, model, uids } = build({ ...RIG, clips: [['f_1']], editorOptions: { confirm: (request) => requests.push(request) } });
  editor.selection.set([uids.j_1]);
  assert.equal(editor.actions.run('delete'), true);
  assert.equal(requests.length, 0);
  assert.equal(model.get(uids.j_1), null);
});

test('delete with tracks asks once with the delete request and deletes as one undo step on true', async () => {
  const { editor, model, uids, requests } = confirmRig(() => Promise.resolve(true));
  const before = dump(model);
  editor.actions.run('delete');
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    kind: 'delete',
    title: 'Delete animation tracks?',
    message: 'Deleting 1 body and 2 joints also removes 4 tracks and 4 keys from 2 clips. Undo restores them.',
    items: ['New Clip: 3 tracks, 3 keys', 'New Clip: 1 track, 1 key'],
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
  });
  await settle();
  assert.equal(model.get(uids.b_1), null);
  assert.equal(editor.history.state.undoLabel, 'Delete');
  editor.history.undo();
  assert.deepEqual(dump(model), before);
});

test('cancelling or a rejected confirmation deletes nothing and leaves the stack untouched', async () => {
  for (const answer of [() => Promise.resolve(false), () => Promise.reject(new Error('boom'))]) {
    const { editor, model, requests } = confirmRig(answer);
    const before = dump(model);
    const label = editor.history.state.undoLabel;
    editor.actions.run('delete');
    await settle();
    assert.equal(requests.length, 1);
    assert.deepEqual(dump(model), before);
    assert.equal(editor.history.state.undoLabel, label);
    assert.equal(editor.actions.isEnabled('delete'), true);
  }
});

test('delete is disabled with no reason while the confirmation is pending, and a mode change cancels the deletion', async () => {
  let resolve;
  const { editor, model, uids } = confirmRig(() => new Promise((done) => (resolve = done)));
  const before = dump(model);
  editor.actions.run('delete');
  assert.equal(editor.actions.isEnabled('delete'), false);
  assert.equal(editor.actions.reason('delete'), null);
  assert.equal(editor.actions.run('delete'), false);
  editor.modes.openClip(uids.c_1);
  resolve(true);
  await settle();
  assert.deepEqual(dump(model), before);
  assert.notEqual(model.get(uids.b_1), null);
});

test('createEditor: the default confirm deletes and a non-function confirm throws TypeError', async () => {
  const { editor, model, uids } = build({ ...RIG, clips: [['f_4']] });
  editor.selection.set([uids.b_3]);
  editor.actions.run('delete');
  await settle();
  assert.equal(model.get(uids.b_3), null);
  assert.throws(() => createEditor({ confirm: 'yes' }), TypeError);
});