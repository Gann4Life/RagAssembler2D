import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Emitter } from '../lib/emitter.js';
import { createEditor } from '../js/editor.js';
import { loadJson } from '../js/model/io.js';
import { setProps } from '../js/commands/props.js';
import { HANDOVER_MS, animatePose, bindAnimateView, blendPoses } from '../js/model/animate-preview.js';
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

test('blendPoses goes linearly in position and continuous angle, keeping bodies missing from the start', () => {
  const from = new Map([[1, { x: 0, y: 0, angle: 3 }]]);
  const to = new Map([
    [1, { x: 2, y: -4, angle: 4 }],
    [2, { x: 5, y: 5, angle: 5 }],
  ]);
  assert.deepEqual(blendPoses(from, to, 0.25), new Map([[1, { x: 0.5, y: -1, angle: 3.25 }], [2, { x: 5, y: 5, angle: 5 }]]));
  assert.deepEqual(blendPoses(from, to, 1).get(1), { x: 2, y: -4, angle: 4 });
});

function fakePlayer() {
  const emitter = new Emitter();
  return {
    holding: false,
    heldPose: null,
    livePose: null,
    figureValue: null,
    ghostList: [],
    figure() {
      return this.figureValue;
    },
    ghosts() {
      return this.ghostList;
    },
    on: (type, fn) => emitter.on(type, fn),
    view(instant) {
      emitter.emit('view', { instant });
    },
  };
}

function fakeClock() {
  const clock = {
    time: 0,
    frames: [],
    request(callback) {
      clock.frames.push(callback);
      return clock.frames.length;
    },
    cancel(handle) {
      clock.frames[handle - 1] = null;
    },
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
      const pending = clock.frames.filter(Boolean);
      clock.frames = [];
      for (const frame of pending) frame(clock.time);
    },
  };
  return clock;
}

function bound() {
  const env = loaded();
  const player = fakePlayer();
  const clock = fakeClock();
  const shown = [];
  const ghosts = [];
  const view = bindAnimateView({
    model: env.editor.model,
    modes: env.editor.modes,
    player,
    clock,
    apply: (pose) => shown.push(pose),
    applyGhosts: (list) => ghosts.push(list),
  });
  return { ...env, player, clock, shown, ghosts, view };
}

const pose = (x) => new Map([[2, { x, y: 0, angle: x }]]);

test('Edit mode shows the rest pose and Animate the clip simulation figure, else the FK pose', () => {
  const { editor, clip, uid, player, shown } = bound();
  assert.deepEqual(shown, []);
  editor.modes.openClip(clip);
  player.view(true);
  near(shown.at(-1).get(uid('b_head')).angle, 0.3);
  player.figureValue = { pose: pose(1), source: '1:at' };
  player.view(true);
  assert.equal(shown.at(-1), player.figureValue.pose);
  editor.modes.openClip(null);
  player.view(true);
  assert.equal(shown.at(-1), null);
});

test('a posed hold is shown as is and hands over to the run in 150 ms with a smoothstep', () => {
  const { editor, clip, player, clock, shown } = bound();
  editor.modes.openClip(clip);
  player.figureValue = { pose: pose(0), source: '1:at' };
  player.view(true);
  player.holding = true;
  player.heldPose = pose(10);
  player.view(false);
  assert.equal(shown.at(-1), player.heldPose);
  player.holding = false;
  player.figureValue = { pose: pose(20), source: '2:at' };
  player.view(false);
  assert.equal(shown.at(-1).get(2).x, 10);
  clock.advance(HANDOVER_MS / 2);
  near(shown.at(-1).get(2).x, 15);
  near(shown.at(-1).get(2).angle, 15);
  player.figureValue = { pose: pose(30), source: '2:at' };
  clock.advance(HANDOVER_MS / 4);
  const u = 0.75;
  near(shown.at(-1).get(2).x, 10 + 20 * u * u * (3 - 2 * u));
  clock.advance(HANDOVER_MS);
  assert.equal(shown.at(-1), player.figureValue.pose);
  assert.equal(clock.frames.filter(Boolean).length, 0);
});

test('a source change the user caused is shown at once, and so is the latest step reached of the same run', () => {
  const { editor, clip, player, shown } = bound();
  editor.modes.openClip(clip);
  player.figureValue = { pose: pose(0), source: '1:latest' };
  player.view(true);
  player.figureValue = { pose: pose(1), source: '1:latest' };
  player.view(false);
  assert.equal(shown.at(-1), player.figureValue.pose);
  player.figureValue = { pose: pose(5), source: '1:at' };
  player.view(false);
  assert.equal(shown.at(-1).get(2).x, 1);
  player.figureValue = { pose: pose(7), source: '3:at' };
  player.view(true);
  assert.equal(shown.at(-1), player.figureValue.pose);
});

test('Simulate shows the live pose, and ghosts are applied only when they change', () => {
  const { editor, clip, player, shown, ghosts } = bound();
  editor.modes.openClip(clip);
  player.ghostList = [{ t: 0.5, side: 'ahead', pose: pose(1), key: '1:30:ahead' }];
  player.view(false);
  player.view(false);
  assert.equal(ghosts.length, 1);
  player.ghostList = [];
  player.view(false);
  assert.equal(ghosts.length, 2);
  editor.modes.startSimulate();
  player.livePose = pose(4);
  player.view(false);
  assert.equal(shown.at(-1), player.livePose);
});

test('the FK pose follows document changes, and destroy unsubscribes', () => {
  const { editor, clip, uid, player, shown, view } = bound();
  editor.modes.openClip(clip);
  editor.modes.setPlayhead(2);
  player.view(true);
  near(shown.at(-1).get(uid('b_head')).angle, 0.3);
  editor.history.execute(setProps([clip], { loop: false }));
  near(shown.at(-1).get(uid('b_head')).angle, 1.3);
  const count = shown.length;
  view.destroy();
  editor.history.execute(setProps([clip], { loop: true }));
  player.view(true);
  assert.equal(shown.length, count);
});
