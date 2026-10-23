import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { Model, ROOT_UID } from '../js/model/model.js';
import { loadJson, saveJson, toJson } from '../js/model/io.js';
import { createClip, createShapeBody } from '../js/commands/create.js';
import { deleteClip } from '../js/commands/delete.js';
import { setProps } from '../js/commands/props.js';
import { TimelinePlayer } from '../js/timeline-player.js';
import { SNAP_STEP, fractionOfTime, rulerTicks, snapTime, timeAtOffset } from '../js/timeline-time.js';

const clipsOf = (editor) => editor.model.children(ROOT_UID, 'clips');

function editorWithBody() {
  const editor = createEditor();
  editor.history.execute(createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'circle', radius: 0.5 } }));
  return editor;
}

test('createClip appends a clip with a unique key and undoes in one step', () => {
  const { model, history } = createEditor();
  const first = history.execute(createClip());
  const second = history.execute(createClip());
  assert.deepEqual([model.prop(first, 'key'), model.prop(second, 'key')], ['new_clip', 'new_clip_2']);
  assert.equal(model.prop(first, 'length'), 1);
  assert.equal(model.prop(first, 'loop'), true);
  assert.equal(history.state.undoLabel, 'Create clip');
  history.undo();
  assert.deepEqual(model.children(ROOT_UID, 'clips'), [first]);
  history.redo();
  assert.equal(model.prop(second, 'key'), 'new_clip_2');
});

test('createClip avoids a key taken by a renamed clip', () => {
  const { model, history } = createEditor();
  const first = history.execute(createClip());
  history.execute(setProps([first], { key: 'new_clip_2' }));
  const second = history.execute(createClip());
  const third = history.execute(createClip());
  assert.equal(model.prop(second, 'key'), 'new_clip');
  assert.equal(model.prop(third, 'key'), 'new_clip_3');
});

test('deleteClip removes the clip, undo restores it, and a non-clip is refused', () => {
  const { model, history, modes } = createEditor();
  const uid = history.execute(createClip());
  modes.openClip(uid);
  history.execute(deleteClip(uid));
  assert.deepEqual(clipsOf({ model }), []);
  assert.equal(modes.mode, 'edit');
  history.undo();
  assert.equal(clipsOf({ model }).length, 1);
  assert.throws(() => history.execute(deleteClip(ROOT_UID)), /not a clip/);
  assert.equal(history.state.undoLabel, 'Create clip');
});

test('length and loop edits are undoable and re-clamp the playhead', () => {
  const { model, history, modes } = createEditor();
  const uid = history.execute(createClip());
  modes.openClip(uid);
  modes.setPlayhead(0.9);
  history.execute(setProps([uid], { length: 0.5 }, 'Set clip length'));
  assert.equal(modes.playhead, 0.5);
  history.execute(setProps([uid], { loop: false }, 'Toggle clip loop'));
  history.undo();
  assert.equal(model.prop(uid, 'loop'), true);
  history.undo();
  assert.equal(model.prop(uid, 'length'), 1);
});

test('clips round-trip through save and load', () => {
  const editor = editorWithBody();
  const { model, history } = editor;
  const first = history.execute(createClip());
  history.execute(createClip());
  history.execute(setProps([first], { length: 2.5, loop: false }));
  const saved = saveJson(model, 'dev');
  assert.equal(saved.ok, true);
  const loaded = new Model();
  assert.equal(loadJson(loaded, saved.text).ok, true);
  assert.deepEqual(toJson(loaded, 'dev').clips, toJson(model, 'dev').clips);
  assert.deepEqual(
    loaded.children(ROOT_UID, 'clips').map((uid) => loaded.prop(uid, 'key')),
    ['new_clip', 'new_clip_2'],
  );
});

test('snapTime snaps to 1/30 s and clamps to the clip', () => {
  assert.equal(SNAP_STEP, 1 / 30);
  assert.equal(snapTime(0.5, 1), 15 * SNAP_STEP);
  assert.equal(snapTime(-1, 1), 0);
  assert.equal(snapTime(5, 1), 1);
  assert.equal(Object.is(snapTime(-0.001, 1), -0), false);
});

test('timeAtOffset maps the ruler width to the clip length', () => {
  assert.equal(timeAtOffset(100, 200, 2), 1);
  assert.equal(timeAtOffset(-20, 200, 2), 0);
  assert.equal(timeAtOffset(900, 200, 2), 2);
  assert.equal(timeAtOffset(10, 0, 2), 0);
  assert.equal(fractionOfTime(0.5, 2), 0.25);
  assert.equal(fractionOfTime(3, 2), 1);
  assert.equal(fractionOfTime(1, 0), 0);
});

test('rulerTicks stays under a dozen intervals and ends at the length', () => {
  for (const length of [0.2, 1, 2.5, 10, 120]) {
    const ticks = rulerTicks(length);
    assert.ok(ticks.length <= 14, `${length}: ${ticks.length}`);
    assert.equal(ticks[0], 0);
    assert.ok(ticks.at(-1) <= length);
  }
});

function playerWithClock(editor) {
  const frames = [];
  const clock = {
    request: (callback) => frames.push(callback),
    cancel: (handle) => {
      frames[handle - 1] = null;
    },
  };
  const player = new TimelinePlayer(editor.model, editor.modes, clock);
  const tick = (timestamp) => {
    const callback = frames.pop();
    frames.length = 0;
    callback?.(timestamp);
  };
  return { player, tick };
}

test('player advances the playhead in seconds and loops', () => {
  const editor = createEditor();
  const clip = editor.history.execute(createClip());
  editor.modes.openClip(clip);
  const { player, tick } = playerWithClock(editor);
  assert.equal(player.play(), true);
  tick(1000);
  tick(1400);
  assert.ok(Math.abs(editor.modes.playhead - 0.4) < 1e-9);
  tick(2200);
  assert.ok(Math.abs(editor.modes.playhead - 0.2) < 1e-9);
  assert.equal(player.playing, true);
  assert.equal(editor.history.canUndo, true);
  assert.equal(editor.history.state.undoLabel, 'Create clip');
});

test('player stops at the end of a non-loop clip and restarts from 0 on play', () => {
  const editor = createEditor();
  const clip = editor.history.execute(createClip());
  editor.history.execute(setProps([clip], { loop: false }));
  editor.modes.openClip(clip);
  const { player, tick } = playerWithClock(editor);
  const states = [];
  player.on('playing', (value) => states.push(value));
  player.play();
  tick(0);
  tick(5000);
  assert.equal(editor.modes.playhead, 1);
  assert.equal(player.playing, false);
  assert.deepEqual(states, [true, false]);
  player.play();
  assert.equal(editor.modes.playhead, 0);
  assert.equal(player.playing, true);
});

test('player keeps playing when another clip is opened and stops on rest pose', () => {
  const editor = createEditor();
  const first = editor.history.execute(createClip());
  const second = editor.history.execute(createClip());
  editor.modes.openClip(first);
  const { player, tick } = playerWithClock(editor);
  player.play();
  tick(0);
  tick(300);
  editor.modes.openClip(second);
  assert.equal(player.playing, true);
  assert.equal(editor.modes.playhead, 0);
  tick(500);
  assert.ok(Math.abs(editor.modes.playhead - 0.2) < 1e-9);
  editor.modes.openClip(null);
  assert.equal(player.playing, false);
});

test('player refuses to play in Edit mode and pause is safe when idle', () => {
  const editor = createEditor();
  const { player } = playerWithClock(editor);
  assert.equal(player.canPlay(), false);
  assert.equal(player.play(), false);
  assert.equal(player.toggle(), false);
  player.pause();
  assert.equal(player.playing, false);
});

test('player stops when the open clip is deleted', () => {
  const editor = createEditor();
  const clip = editor.history.execute(createClip());
  editor.modes.openClip(clip);
  const { player } = playerWithClock(editor);
  player.play();
  editor.history.execute(deleteClip(clip));
  assert.equal(player.playing, false);
});
