import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import {
  RENAME_POPUP_OFFSET,
  renameAnchor,
  renamePoint,
  renamePopupPosition,
  renameTarget,
} from '../js/rename.js';
import { serialize } from '../lib/serialize.js';
import { ragFile } from './helpers/rag-file.js';

const EPSILON = 1e-4;

function nearPoint(actual, expected, message) {
  assert.ok(Math.abs(actual.x - expected.x) < EPSILON && Math.abs(actual.y - expected.y) < EPSILON,
    `${message ?? ''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function sampleText({ position = [0, 0], angle = 0 } = {}) {
  const file = ragFile();
  file.ragdoll.position = position;
  file.ragdoll.angle = angle;
  return serialize(file);
}

async function loaded(options = {}, text = sampleText()) {
  const editor = createEditor(options);
  assert.equal(await editor.loadFrom(() => Promise.resolve(text)), true);
  editor.history.markSaved();
  const uid = (id) => (id === 'root' ? ROOT_UID : editor.model.uidOf(id));
  const events = [];
  editor.rename.on('rename', (event) => events.push(event.session));
  return { ...editor, uid, events };
}

test('renameTarget is the only selected root, body, shape or joint', async () => {
  const { model, uid } = await loaded();
  for (const id of ['root', 'b_torso', 'f_head', 'j_neck']) assert.equal(renameTarget(model, [uid(id)]), uid(id), id);
  assert.equal(renameTarget(model, []), null);
  assert.equal(renameTarget(model, [uid('b_torso'), uid('f_head')]), null);
  assert.equal(renameTarget(model, [uid('s_a')]), null);
  assert.equal(renameTarget(model, [model.clipByKey('walk')]), null);
  assert.equal(renameTarget(model, [999]), null);
});

test('rename is enabled in Edit mode with exactly one root, body, shape or joint selected', async () => {
  const { actions, selection, uid, model } = await loaded();
  for (const id of ['root', 'b_torso', 'f_head', 'j_neck']) {
    selection.set([uid(id)]);
    assert.equal(actions.isEnabled('rename'), true, id);
  }
  for (const objects of [[], [uid('b_torso'), uid('j_neck')], [uid('s_a')], [model.clipByKey('walk')]]) {
    selection.set(objects);
    assert.equal(actions.isEnabled('rename'), false, JSON.stringify(objects));
    assert.equal(actions.run('rename'), false);
  }
});

test('rename is disabled in Animate and Simulate mode, during a gesture, while open, confirming or with the UI busy', async () => {
  let busy = false;
  let answer = null;
  const env = await loaded({
    uiBusy: () => busy,
    confirm: () => new Promise((resolve) => {
      answer = resolve;
    }),
  });
  const { actions, selection, uid, history, modes, model, rename } = env;
  selection.set([uid('b_torso')]);
  history.beginGesture();
  assert.equal(actions.isEnabled('rename'), false);
  history.endGesture();
  busy = true;
  assert.equal(actions.isEnabled('rename'), false);
  busy = false;
  assert.equal(actions.run('rename'), true);
  assert.equal(actions.isEnabled('rename'), false);
  rename.cancel();
  history.execute({ label: 'Touch', run: (tx) => tx.set(uid('b_head'), 'name', 'h') });
  actions.run('new');
  assert.equal(actions.isEnabled('rename'), false);
  answer(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(actions.isEnabled('rename'), true);
  modes.openClip(model.clipByKey('walk'));
  assert.equal(actions.isEnabled('rename'), false);
  assert.equal(actions.reason('rename'), 'not available in Animate mode');
  modes.startSimulate();
  assert.equal(actions.isEnabled('rename'), false);
});

test('a rename opens with the current name and commits one undo step that keeps the selection and the id', async () => {
  const { actions, selection, uid, history, model, rename, events } = await loaded();
  selection.set([uid('f_head')]);
  assert.equal(actions.run('rename'), true);
  assert.deepEqual(rename.session, { uid: uid('f_head'), name: 'head' });
  assert.deepEqual(events, [{ uid: uid('f_head'), name: 'head' }]);
  assert.equal(rename.commit('skull'), true);
  assert.equal(rename.session, null);
  assert.deepEqual(events.at(-1), null);
  assert.equal(model.prop(uid('f_head'), 'name'), 'skull');
  assert.equal(model.prop(uid('f_head'), 'id'), 'f_head');
  assert.deepEqual(selection.objects, [uid('f_head')]);
  assert.equal(history.state.undoLabel, 'Rename');
  history.undo();
  assert.equal(model.prop(uid('f_head'), 'name'), 'head');
  assert.equal(history.canUndo, false);
});

test('an unchanged name records nothing, an empty name is stored as typed', async () => {
  const { selection, uid, history, model, rename } = await loaded();
  selection.set([ROOT_UID]);
  rename.start();
  assert.equal(rename.commit('sample'), false);
  assert.equal(history.canUndo, false);
  assert.equal(rename.session, null);
  rename.start();
  assert.equal(rename.commit(''), true);
  assert.equal(model.prop(ROOT_UID, 'name'), '');
  assert.equal(history.state.undoLabel, 'Rename');
  selection.set([uid('j_neck')]);
  rename.start();
  assert.equal(rename.commit('  spaced  '), true);
  assert.equal(model.prop(uid('j_neck'), 'name'), '  spaced  ');
  assert.throws(() => rename.commit(3), TypeError);
  assert.equal(rename.commit('closed'), false);
});

test('Esc cancels: nothing is recorded', async () => {
  const { selection, uid, history, model, rename, events } = await loaded();
  selection.set([uid('b_arm')]);
  rename.start();
  assert.equal(rename.cancel(), true);
  assert.equal(rename.cancel(), false);
  assert.equal(model.prop(uid('b_arm'), 'name'), 'arm');
  assert.equal(history.canUndo, false);
  assert.deepEqual(events.at(-1), null);
});

test('Undo, a mode change, New and Load cancel an open field', async () => {
  const text = sampleText();
  const env = await loaded({ files: { openText: () => Promise.resolve(text), saveText: () => Promise.resolve(true) } });
  const { actions, selection, uid, history, modes, model, rename } = env;
  history.execute({ label: 'Touch', run: (tx) => tx.set(uid('b_head'), 'name', 'h') });
  selection.set([uid('b_torso')]);
  rename.start();
  history.undo();
  assert.equal(rename.session, null);
  assert.equal(model.prop(uid('b_torso'), 'name'), 'torso');
  selection.set([uid('b_torso')]);
  rename.start();
  modes.openClip(model.clipByKey('walk'));
  assert.equal(rename.session, null);
  modes.openClip(null);
  selection.set([uid('b_torso')]);
  rename.start();
  history.markSaved();
  actions.run('new');
  assert.equal(rename.session, null);
  await env.loadFrom(() => Promise.resolve(text));
  selection.set([uid('b_torso')]);
  rename.start();
  assert.equal(await env.loadFrom(() => Promise.resolve(text)), true);
  assert.equal(rename.session, null);
});

test('deleting the renamed object cancels the field', async () => {
  const { selection, uid, history, rename } = await loaded();
  selection.set([uid('j_neck')]);
  rename.start();
  history.execute({ label: 'Remove', run: (tx) => tx.remove(uid('j_neck')) });
  assert.equal(rename.session, null);
});

test('renamePoint: root position, body origin, shape center or centroid, joint anchor, in world meters', async () => {
  const { model, uid } = await loaded({}, sampleText({ position: [1, 2], angle: Math.PI / 2 }));
  nearPoint(renamePoint(model, ROOT_UID), { x: 1, y: 2 });
  nearPoint(renamePoint(model, uid('b_head')), { x: 1 - 0.8, y: 2 + 0.3 });
  nearPoint(renamePoint(model, uid('j_neck')), { x: 1 - 0.6, y: 2 + 0.3 });
  const head = renamePoint(model, uid('f_head'));
  const turn = Math.PI / 2 + 0.3;
  nearPoint(head, {
    x: 1 - 0.8 + 0.02 * Math.cos(turn) - 0.05 * Math.sin(turn),
    y: 2 + 0.3 + 0.02 * Math.sin(turn) + 0.05 * Math.cos(turn),
  });
  const arm = renamePoint(model, uid('f_arm'));
  assert.ok(Number.isFinite(arm.x) && Number.isFinite(arm.y));
  assert.equal(renamePoint(model, uid('s_a')), null);
  assert.equal(renamePoint(model, 999), null);
});

test('renamePoint follows a displayed pose and gives null for an unplaced anchor', async () => {
  const { model, uid, history } = await loaded();
  const pose = new Map([[uid('b_head'), { x: 2, y: 3, angle: 0 }]]);
  nearPoint(renamePoint(model, uid('b_head'), pose), { x: 2, y: 3 });
  history.execute({ label: 'Unplace', run: (tx) => tx.set(uid('j_neck'), 'anchor', null) });
  assert.equal(renamePoint(model, uid('j_neck')), null);
});

test('renameAnchor: the pointer over the viewport, else the object point inside it, else the center', () => {
  const size = { width: 400, height: 300 };
  assert.deepEqual(renameAnchor({ pointer: { x: 10, y: 20 }, point: { x: 50, y: 60 }, ...size }), { x: 10, y: 20 });
  assert.deepEqual(renameAnchor({ pointer: null, point: { x: 50, y: 60 }, ...size }), { x: 50, y: 60 });
  assert.deepEqual(renameAnchor({ pointer: null, point: { x: 400, y: 300 }, ...size }), { x: 400, y: 300 });
  for (const point of [{ x: -1, y: 60 }, { x: 50, y: 301 }, { x: Number.NaN, y: 0 }, null]) {
    assert.deepEqual(renameAnchor({ pointer: null, point, ...size }), { x: 200, y: 150 }, JSON.stringify(point));
  }
});

test('renamePopupPosition sits 8 px right of and below the anchor and stays inside the viewport', () => {
  const size = { width: 260, height: 40 };
  const viewport = { width: 400, height: 300 };
  assert.equal(RENAME_POPUP_OFFSET, 8);
  assert.deepEqual(renamePopupPosition({ x: 10, y: 20 }, size, viewport), { x: 18, y: 28 });
  assert.deepEqual(renamePopupPosition({ x: 390, y: 290 }, size, viewport), { x: 140, y: 260 });
  assert.deepEqual(renamePopupPosition({ x: 100, y: 290 }, size, viewport), { x: 108, y: 260 });
  assert.deepEqual(renamePopupPosition({ x: -50, y: -50 }, size, viewport), { x: 0, y: 0 });
  assert.deepEqual(renamePopupPosition({ x: 100, y: 100 }, { width: 500, height: 400 }, viewport), { x: 0, y: 0 });
});
