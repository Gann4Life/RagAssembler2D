import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { Model, ROOT_UID } from '../js/model/model.js';
import { loadJson, saveJson, toJson } from '../js/model/io.js';
import { createClip, createShapeBody } from '../js/commands/create.js';
import { deleteClip } from '../js/commands/delete.js';
import { setProps } from '../js/commands/props.js';
import { SIMULATE_MAX_STEPS, SIMULATE_STEP, TimelinePlayer } from '../js/timeline-player.js';
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

function fakeSimulator() {
  const sessions = [];
  const simulator = (json, options) => {
    const session = {
      json,
      options,
      steps: [],
      destroyed: false,
      step(dt) {
        session.steps.push(dt);
      },
      pose() {
        return new Map(json.bodies.map((body) => [body.id, { x: 0, y: -session.steps.length, angle: 0 }]));
      },
      destroy() {
        session.destroyed = true;
      },
    };
    sessions.push(session);
    return session;
  };
  return { simulator, sessions };
}

function playerWithClock(editor, simulator = fakeSimulator().simulator) {
  const frames = [];
  const clock = {
    request: (callback) => frames.push(callback),
    cancel: (handle) => {
      frames[handle - 1] = null;
    },
  };
  const player = new TimelinePlayer(editor.model, editor.modes, clock, simulator);
  const poses = [];
  player.on('pose', (pose) => poses.push(pose));
  const tick = (timestamp) => {
    const callback = frames.pop();
    frames.length = 0;
    callback?.(timestamp);
  };
  return { player, tick, poses };
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test('play in Edit mode simulates without a clip and stop restores Edit without touching the model', () => {
  const editor = editorWithBody();
  const before = JSON.stringify(toJson(editor.model, 'dev'));
  const undoLabel = editor.history.state.undoLabel;
  const { simulator, sessions } = fakeSimulator();
  const { player, tick, poses } = playerWithClock(editor, simulator);
  assert.equal(player.canPlay(), true);
  assert.equal(player.play(), true);
  assert.equal(editor.modes.mode, 'simulate');
  assert.equal(player.simulating, true);
  assert.equal(sessions[0].options.clip, null);
  assert.equal(editor.modes.can('history'), false);
  tick(0);
  tick(50);
  assert.equal(sessions[0].steps.length, 3);
  assert.ok(sessions[0].steps.every((dt) => dt === SIMULATE_STEP));
  assert.equal(editor.modes.playhead, 0);
  const body = editor.model.uidOf(sessions[0].json.bodies[0].id);
  assert.deepEqual(poses.at(-1).get(body), { x: 0, y: -3, angle: 0 });
  assert.equal(player.stop(), true);
  assert.equal(editor.modes.mode, 'edit');
  assert.equal(player.playing, false);
  assert.equal(sessions[0].destroyed, true);
  assert.equal(poses.at(-1), null);
  assert.equal(JSON.stringify(toJson(editor.model, 'dev')), before);
  assert.equal(editor.history.state.undoLabel, undoLabel);
});

test('play in Animate mode plays the open clip from 0 and stop restores clip and playhead', () => {
  const editor = editorWithBody();
  const clip = editor.history.execute(createClip());
  editor.history.execute(setProps([clip], { length: 2 }));
  editor.modes.openClip(clip);
  editor.modes.setPlayhead(1.5);
  const { simulator, sessions } = fakeSimulator();
  const { player, tick } = playerWithClock(editor, simulator);
  player.play();
  assert.equal(sessions[0].options.clip, editor.model.prop(clip, 'key'));
  assert.equal(editor.modes.playhead, 0);
  assert.equal(editor.modes.clip, clip);
  tick(0);
  tick(50);
  near(editor.modes.playhead, 3 * SIMULATE_STEP);
  player.stop();
  assert.equal(editor.modes.mode, 'animate');
  assert.equal(editor.modes.clip, clip);
  assert.equal(editor.modes.playhead, 1.5);
});

test('a long frame runs at most the step cap and the playhead loops with the clip', () => {
  const editor = editorWithBody();
  const clip = editor.history.execute(createClip());
  editor.modes.openClip(clip);
  const { simulator, sessions } = fakeSimulator();
  const { player, tick } = playerWithClock(editor, simulator);
  player.play();
  tick(0);
  tick(5000);
  assert.equal(sessions[0].steps.length, SIMULATE_MAX_STEPS);
  player.pause();
  for (let i = SIMULATE_MAX_STEPS; i < 70; i++) player.nextFrame();
  near(editor.modes.playhead, (70 * SIMULATE_STEP) % 1);
});

test('a non-loop clip holds the playhead at its end while the simulation runs on', () => {
  const editor = editorWithBody();
  const clip = editor.history.execute(createClip());
  editor.history.execute(setProps([clip], { loop: false }));
  editor.modes.openClip(clip);
  const { simulator, sessions } = fakeSimulator();
  const { player } = playerWithClock(editor, simulator);
  player.play();
  for (let i = 0; i < 90; i++) player.nextFrame();
  assert.equal(editor.modes.playhead, 1);
  assert.equal(sessions[0].steps.length, 90);
  assert.equal(editor.modes.mode, 'simulate');
});

test('pause keeps Simulate mode, next frame steps once and toggle resumes', () => {
  const editor = editorWithBody();
  const { simulator, sessions } = fakeSimulator();
  const { player } = playerWithClock(editor, simulator);
  const states = [];
  player.on('playing', (value) => states.push(value));
  assert.equal(player.nextFrame(), false);
  player.play();
  player.pause();
  assert.equal(editor.modes.mode, 'simulate');
  assert.equal(player.canPlay(), true);
  assert.equal(player.nextFrame(), true);
  assert.equal(sessions[0].steps.length, 1);
  assert.equal(player.toggle(), true);
  assert.equal(player.playing, true);
  assert.equal(sessions.length, 1);
  assert.deepEqual(states, [true, false, true]);
});

test('without a simulator nothing plays, and a failing simulator leaves the mode unchanged', () => {
  const editor = editorWithBody();
  const idle = playerWithClock(editor, null).player;
  assert.equal(idle.canPlay(), false);
  assert.equal(idle.play(), false);
  assert.equal(idle.stop(), false);
  const failing = playerWithClock(editor, () => {
    throw new Error('invalid document');
  }).player;
  assert.throws(() => failing.play(), /invalid document/);
  assert.equal(editor.modes.mode, 'edit');
  assert.equal(failing.simulating, false);
});

test('a model reset during Simulate ends the simulation in Edit mode', () => {
  const editor = editorWithBody();
  const clip = editor.history.execute(createClip());
  editor.modes.openClip(clip);
  const text = saveJson(editor.model, 'dev').text;
  const { simulator, sessions } = fakeSimulator();
  const { player, poses } = playerWithClock(editor, simulator);
  player.play();
  assert.equal(loadJson(editor.model, text).ok, true);
  assert.equal(editor.modes.mode, 'edit');
  assert.equal(player.simulating, false);
  assert.equal(player.playing, false);
  assert.equal(sessions[0].destroyed, true);
  assert.equal(poses.at(-1), null);
});

