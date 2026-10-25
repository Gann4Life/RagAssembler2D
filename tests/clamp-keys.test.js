import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { clampKeysToLimits, keysOutsideLimits } from '../js/commands/keys.js';
import { loadJson, toJson } from '../js/model/io.js';
import { validate } from '../lib/validate.js';
import { ragFile } from './helpers/rag-file.js';

function track(target, values) {
  return { target, channel: 'angle', keys: values.map((v, index) => ({ t: index * 0.5, v, interp: index === 0 ? 'step' : 'ease' })) };
}

function scene(extra = {}) {
  const doc = ragFile();
  doc.clips[0].tracks = [track('j_neck', [0.1, 0.9, -2]), track('j_shoulder2', [3, -3])];
  doc.clips.push({
    ...structuredClone(doc.clips[0]),
    key: 'run',
    name: 'Run',
    tracks: [track('j_shoulder', [0.1, 0.2]), track('j_neck', [0.7])],
  });
  doc.clips.push({ ...structuredClone(doc.clips[0]), key: 'lean', name: 'Lean', blend: 'additive', tracks: [track('j_neck', [4])] });
  Object.assign(doc, extra);
  const messages = [];
  const editor = createEditor({ status: (text) => messages.push(text) });
  assert.equal(loadJson(editor.model, JSON.stringify(doc)).ok, true);
  return { editor, messages, model: editor.model, clips: editor.model.children(ROOT_UID, 'clips') };
}

test('keysOutsideLimits lists override keys beyond enabled limits in clip, track and key order', () => {
  const { model } = scene();
  const values = keysOutsideLimits(model).map((uid) => model.prop(uid, 'v'));
  assert.deepEqual(values, [0.9, -2, 0.7]);
});

test('clampKeysToLimits sets the nearer limit in one undo step and keeps t, interp and structure', () => {
  const { editor, model } = scene();
  const before = toJson(model, 'dev');
  const result = editor.history.execute(clampKeysToLimits());
  assert.deepEqual(result, { keys: 3, clips: 2 });
  const after = toJson(model, 'dev');
  assert.deepEqual(after.clips[0].tracks[0].keys.map((key) => key.v), [0.1, 0.2, -0.5]);
  assert.deepEqual(after.clips[0].tracks[1].keys.map((key) => key.v), [3, -3]);
  assert.deepEqual(after.clips[1].tracks[1].keys.map((key) => key.v), [0.2]);
  assert.deepEqual(after.clips[2], before.clips[2]);
  const shape = (json) => json.clips.map((clip) => clip.tracks.map((t) => t.keys.map(({ v, ...rest }) => rest)));
  assert.deepEqual(shape(after), shape(before));
  assert.equal(editor.history.state.undoLabel, 'Clamp keys to limits');
  assert.equal(keysOutsideLimits(model).length, 0);
  assert.equal(validate(after).warnings.filter((w) => w.code === 'W_KEY_OUTSIDE_LIMITS').length, 0);
  editor.history.undo();
  assert.deepEqual(toJson(model, 'dev'), before);
  assert.equal(editor.history.canUndo, false);
});

test('clampKeysToLimits without keys outside changes nothing and returns zero counts', () => {
  const { editor, model } = scene();
  editor.history.execute(clampKeysToLimits());
  const before = toJson(model, 'dev');
  assert.deepEqual(editor.history.execute(clampKeysToLimits()), { keys: 0, clips: 0 });
  assert.deepEqual(toJson(model, 'dev'), before);
});

test('clamp-keys-to-limits is enabled only with keys outside, in Edit and Animate, and not during a gesture', () => {
  const { editor, model, clips, messages } = scene();
  const { actions, modes, history } = editor;
  assert.equal(actions.isEnabled('clamp-keys-to-limits'), true);
  assert.equal(actions.reason('clamp-keys-to-limits'), null);
  history.beginGesture();
  assert.equal(actions.isEnabled('clamp-keys-to-limits'), false);
  assert.equal(actions.reason('clamp-keys-to-limits'), null);
  history.cancelGesture();
  modes.openClip(clips[0]);
  assert.equal(actions.isEnabled('clamp-keys-to-limits'), true);
  modes.startSimulate();
  assert.equal(actions.isEnabled('clamp-keys-to-limits'), false);
  assert.equal(actions.reason('clamp-keys-to-limits'), 'only in Edit and Animate modes');
  modes.stopSimulate();
  modes.openClip(null);
  actions.run('clamp-keys-to-limits');
  assert.deepEqual(messages.at(-1), 'Clamp keys to limits: 3 keys in 2 clips');
  assert.equal(actions.isEnabled('clamp-keys-to-limits'), false);
  assert.equal(actions.reason('clamp-keys-to-limits'), 'no keys outside the joint limits');
  assert.equal(model.prop(model.children(model.children(clips[1], 'tracks')[1], 'keys')[0], 'v'), 0.2);
});

test('the status message uses singulars', () => {
  const { editor, messages } = scene();
  const doc = toJson(editor.model, 'dev');
  doc.clips = [doc.clips[0]];
  doc.clips[0].tracks = [track('j_neck', [0.9])];
  const single = createEditor({ status: (text) => messages.push(text) });
  loadJson(single.model, JSON.stringify(doc));
  single.actions.run('clamp-keys-to-limits');
  assert.equal(messages.at(-1), 'Clamp keys to limits: 1 key in 1 clip');
});
