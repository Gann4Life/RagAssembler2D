import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOTOR, fakeInstance } from './helpers/fake-instance.js';

const LOOKAHEAD = (1 + MOTOR.damping) / MOTOR.gain;

function clip(key, { layer = 0, loop = true, hold = true, length = 1, speed = 1, keys } = {}) {
  return {
    key,
    name: key,
    loop,
    hold,
    layer,
    blend: 'override',
    length,
    fadeIn: 0,
    fadeOut: 0,
    speed,
    tracks: [{ target: 'j_a', channel: 'angle', keys: keys ?? [{ t: 0, v: 0, interp: 'linear' }, { t: length, v: length, interp: 'linear' }] }],
    events: [],
  };
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

function targetOf(joints) {
  const a = joints.get('j_a');
  return a.angle + a.motorSpeed / 10;
}

test('play activates the clip on its layer and drives toward its pose', () => {
  const { rag, joints } = fakeInstance({ clips: [clip('walk', { length: 2 })] });
  assert.equal(rag.isPlaying('walk'), false);
  rag.play('walk');
  assert.equal(rag.isPlaying('walk'), true);
  assert.equal(rag.activeClip(0), 'walk');
  rag.update(0.5);
  near(targetOf(joints), 0.5);
});

test('playing the active key is a no-op unless restart', () => {
  const { rag, joints } = fakeInstance({ clips: [clip('walk', { length: 2 })] });
  rag.play('walk');
  rag.update(0.5);
  rag.play('walk');
  rag.update(0.25);
  near(targetOf(joints), 0.75);
  rag.play('walk', { restart: true });
  rag.update(0.25);
  near(targetOf(joints), 0.25);
});

test('play speed multiplies the clip speed and updates on a repeated play', () => {
  const keys = [{ t: 0, v: 0, interp: 'linear' }, { t: 4, v: 1, interp: 'linear' }];
  const { rag, joints } = fakeInstance({ clips: [clip('walk', { length: 4, speed: 2, keys })] });
  rag.play('walk', { speed: 0.5 });
  rag.update(1);
  near(targetOf(joints), 0.25);
  rag.play('walk', { speed: 1 });
  rag.update(1);
  near(targetOf(joints), 0.75);
  assert.throws(() => rag.play('walk', { speed: 0 }), TypeError);
});

test('a clip replaces the active clip of its layer', () => {
  const { rag } = fakeInstance({ clips: [clip('walk'), clip('run')] });
  rag.play('walk');
  rag.play('run');
  assert.equal(rag.isPlaying('walk'), false);
  assert.equal(rag.activeClip(0), 'run');
});

test('looping clips wrap at length, also for large dt', () => {
  const { rag, joints } = fakeInstance({ clips: [clip('walk', { length: 1 })] });
  rag.play('walk');
  rag.update(0.75);
  rag.update(0.5);
  near(targetOf(joints), 0.25);
  rag.update(3.5);
  near(targetOf(joints), 0.75);
  assert.equal(rag.isPlaying('walk'), true);
});

test('non-loop clips with hold keep the last frame', () => {
  const { rag, joints } = fakeInstance({ clips: [clip('dead', { loop: false, hold: true, length: 1 })] });
  rag.play('dead');
  rag.update(5);
  assert.equal(rag.isPlaying('dead'), true);
  near(targetOf(joints), 1);
});

test('non-loop clips without hold stop themselves on completion', () => {
  const { rag, joints } = fakeInstance({ clips: [clip('pain', { loop: false, hold: false, length: 1 })] });
  rag.play('pain');
  rag.update(0.5);
  assert.equal(rag.isPlaying('pain'), true);
  rag.update(0.5);
  assert.equal(rag.isPlaying('pain'), false);
  assert.equal(rag.activeClip(0), null);
  near(targetOf(joints), 0);
});

test('stop removes only the active clip', () => {
  const { rag } = fakeInstance({ clips: [clip('walk'), clip('run')] });
  rag.play('walk');
  rag.stop('run');
  assert.equal(rag.isPlaying('walk'), true);
  rag.stop('walk');
  assert.equal(rag.isPlaying('walk'), false);
});

test('the highest active layer drives the pose', () => {
  const clips = [clip('walk', { layer: 0 }), clip('aim', { layer: 5, keys: [{ t: 0, v: 0.4, interp: 'linear' }] })];
  const { rag, joints } = fakeInstance({ clips });
  rag.play('walk');
  rag.play('aim');
  rag.update(0.5);
  near(targetOf(joints), 0.4);
  assert.equal(rag.activeClip(0), 'walk');
  rag.stop('aim');
  rag.update(0);
  near(targetOf(joints), 0.5 + LOOKAHEAD);
});

test('the motor pulls toward the clip angle (1 + D) / G − dt ahead, the time it lags by', () => {
  const { rag, joints } = fakeInstance({ clips: [clip('walk', { length: 2 })] });
  rag.play('walk');
  rag.update(0.1);
  near(targetOf(joints), 0.1 + LOOKAHEAD - 0.1);
  rag.update(1 / 60);
  near(targetOf(joints), 0.1 + LOOKAHEAD);
  const { rag: once, joints: held } = fakeInstance({ clips: [clip('dead', { loop: false, length: 1 })] });
  once.play('dead');
  once.update(0.9);
  once.update(1 / 60);
  near(targetOf(held), 1);
  const { rag: looped, joints: wrapped } = fakeInstance({ clips: [clip('walk', { length: 1 })] });
  looped.play('walk');
  looped.update(0.9);
  looped.update(1 / 60);
  near(targetOf(wrapped), 0.9 + LOOKAHEAD - 1);
});

test('without a clip or with no gain the motor pulls toward the resolved angle', () => {
  const { rag, joints } = fakeInstance({ angle: 0.2 });
  rag.update(1 / 60);
  near(targetOf(joints), 0);
});

test('flipX negates the angle channel', () => {
  const { rag, joints } = fakeInstance({ flipX: true, clips: [clip('walk', { keys: [{ t: 0, v: 0.3, interp: 'linear' }] })] });
  rag.play('walk');
  rag.update(0);
  near(targetOf(joints), -0.3);
});

test('unknown keys throw on play and stop, and are not playing', () => {
  const { rag } = fakeInstance();
  assert.throws(() => rag.play('nope'), /unknown clip "nope"/);
  assert.throws(() => rag.stop('nope'), /unknown clip/);
  assert.equal(rag.isPlaying('nope'), false);
});

test('destroy clears playback', () => {
  const { rag } = fakeInstance({ clips: [clip('walk')] });
  rag.play('walk');
  rag.destroy();
  assert.equal(rag.isPlaying('walk'), false);
  assert.equal(rag.activeClip(0), null);
});
