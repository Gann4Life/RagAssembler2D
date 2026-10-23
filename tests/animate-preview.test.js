import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { loadJson, toJson } from '../js/model/io.js';
import { setProps } from '../js/commands/props.js';
import { animatePose, bindAnimatePreview } from '../js/model/animate-preview.js';
import { ragFile } from './helpers/rag-file.js';

function loaded() {
  const doc = ragFile();
  doc.clips[0].tracks[0].keys = [
    { t: 0, v: 0, interp: 'linear' },
    { t: 2, v: 1, interp: 'linear' },
  ];
  const editor = createEditor();
  assert.equal(loadJson(editor.model, JSON.stringify(doc)).ok, true);
  const clip = editor.model.children(1, 'clips')[0];
  return { editor, clip, uid: (id) => editor.model.uidOf(id) };
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`);

test('animatePose turns the child body about the joint anchor and keeps the root body at rest', () => {
  const { editor, clip, uid } = loaded();
  const pose = animatePose(editor.model, clip, 1);
  assert.deepEqual(pose.get(uid('b_torso')), { x: 0.3, y: 0.2, angle: 0.1 });
  const head = pose.get(uid('b_head'));
  near(head.angle, 0.8);
  near(head.x, 0.3 - 0.2 * Math.sin(0.5));
  near(head.y, 0.6 + 0.2 * Math.cos(0.5));
  const arm = pose.get(uid('b_arm'));
  near(arm.x, 0.7);
  near(arm.y, 0.4);
  near(arm.angle, -0.2);
});

test('the preview shows the pose in Animate mode, follows the playhead, and returns to the rest pose', () => {
  const { editor, clip, uid } = loaded();
  const before = JSON.stringify(toJson(editor.model, 'x'));
  const shown = [];
  const preview = bindAnimatePreview(editor.model, editor.modes, (pose) => shown.push(pose));
  assert.deepEqual(shown, []);
  editor.modes.openClip(clip);
  near(shown.at(-1).get(uid('b_head')).angle, 0.3);
  editor.modes.setPlayhead(1);
  near(shown.at(-1).get(uid('b_head')).angle, 0.8);
  editor.modes.openClip(null);
  assert.equal(shown.at(-1), null);
  assert.equal(JSON.stringify(toJson(editor.model, 'x')), before);
  editor.modes.openClip(clip);
  const count = shown.length;
  preview.destroy();
  editor.modes.setPlayhead(1);
  assert.equal(shown.length, count);
});

test('the preview refreshes when the clip changes and returns to the rest pose after a load', () => {
  const { editor, clip, uid } = loaded();
  const shown = [];
  bindAnimatePreview(editor.model, editor.modes, (pose) => shown.push(pose));
  editor.modes.openClip(clip);
  editor.modes.setPlayhead(2);
  near(shown.at(-1).get(uid('b_head')).angle, 0.3);
  editor.history.execute(setProps([clip], { loop: false }));
  near(shown.at(-1).get(uid('b_head')).angle, 1.3);
  editor.modes.setPlayhead(1);
  editor.history.execute(setProps([clip], { loop: true, length: 1 }));
  near(shown.at(-1).get(uid('b_head')).angle, 0.3);
  loadJson(editor.model, JSON.stringify(ragFile()));
  assert.equal(shown.at(-1), null);
});