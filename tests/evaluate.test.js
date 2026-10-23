import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleTrack, channelDefault, evaluateClip, resolveChannels } from '../lib/evaluate.js';

const k = (t, v, interp) => ({ t, v, interp });

test('linear segment interpolates', () => {
  const keys = [k(0, 0, 'linear'), k(2, 10, 'linear')];
  assert.equal(sampleTrack(keys, 1), 5);
  assert.equal(sampleTrack(keys, 0.5), 2.5);
});

test('interp defaults to linear', () => {
  assert.equal(sampleTrack([{ t: 0, v: 0 }, { t: 1, v: 4 }], 0.25), 1);
});

test('step holds until the next key', () => {
  const keys = [k(0, 1, 'step'), k(1, 9, 'linear')];
  assert.equal(sampleTrack(keys, 0.99), 1);
  assert.equal(sampleTrack(keys, 1), 9);
});

test('ease is smoothstep', () => {
  const keys = [k(0, 0, 'ease'), k(1, 1, 'linear')];
  assert.equal(sampleTrack(keys, 0.5), 0.5);
  assert.equal(sampleTrack(keys, 0.25), 0.15625);
  assert.equal(sampleTrack(keys, 0.75), 0.84375);
});

test('interp is per segment', () => {
  const keys = [k(0, 0, 'step'), k(1, 10, 'linear'), k(2, 20, 'linear')];
  assert.equal(sampleTrack(keys, 0.5), 0);
  assert.equal(sampleTrack(keys, 1.5), 15);
});

test('holds first value before and last value after', () => {
  const keys = [k(1, 3, 'linear'), k(2, 7, 'linear')];
  assert.equal(sampleTrack(keys, 0), 3);
  assert.equal(sampleTrack(keys, -5), 3);
  assert.equal(sampleTrack(keys, 2), 7);
  assert.equal(sampleTrack(keys, 99), 7);
});

test('single key is constant', () => {
  const keys = [k(0.5, 0.25, 'linear')];
  for (const t of [-1, 0.5, 3]) assert.equal(sampleTrack(keys, t), 0.25);
});

test('track without keys has no effect', () => {
  assert.equal(sampleTrack([], 1), undefined);
});

test('angles interpolate in radians without wrapping', () => {
  const keys = [k(0, 0, 'linear'), k(1, 3 * Math.PI, 'linear')];
  assert.equal(sampleTrack(keys, 0.5), 1.5 * Math.PI);
  const reverse = [k(0, Math.PI, 'linear'), k(1, -Math.PI, 'linear')];
  assert.equal(sampleTrack(reverse, 0.5), 0);
});

test('discrete channels always step', () => {
  const keys = [k(0, 'a', 'linear'), k(1, 'b', 'ease'), k(2, null, 'linear')];
  assert.equal(sampleTrack(keys, 0.99, true), 'a');
  assert.equal(sampleTrack(keys, 1, true), 'b');
  assert.equal(sampleTrack(keys, 1.5, true), 'b');
  assert.equal(sampleTrack(keys, 2, true), null);
  assert.equal(sampleTrack(keys, 5, true), null);
});

test('joint channel defaults', () => {
  assert.equal(channelDefault('joint', 'angle'), 0);
  for (const c of ['strength', 'gain', 'damping']) assert.equal(channelDefault('joint', c), 1);
});

test('root channel defaults come from the ragdoll channels', () => {
  const ragdoll = { channels: { strength: 0.5, gain: 0.25, damping: 1 } };
  assert.equal(channelDefault('root', 'strength', ragdoll), 0.5);
  assert.equal(channelDefault('root', 'gain', ragdoll), 0.25);
  assert.equal(channelDefault('root', 'damping', ragdoll), 1);
  assert.equal(channelDefault('root', 'strength', {}), null);
});

test('shape sprite default is the shape sprite asset', () => {
  assert.equal(channelDefault('shape', 'sprite', { sprite: { asset: 'img1' } }), 'img1');
  assert.equal(channelDefault('shape', 'sprite', { sprite: null }), null);
  assert.equal(channelDefault('shape', 'sprite', {}), null);
});

test('unknown channel throws', () => {
  assert.throws(() => channelDefault('joint', 'sprite'), /Unknown channel/);
  assert.throws(() => channelDefault('body', 'angle'), /Unknown channel/);
});

const clipOf = (tracks, extra = {}) => ({ length: 2, loop: true, blend: 'override', tracks, ...extra });
const tr = (target, channel, ...keys) => ({ target, channel, keys: keys.map(([t, v]) => k(t, v, 'linear')) });

test('evaluateClip wraps looping time and clamps non-loop time', () => {
  const clip = clipOf([tr('j1', 'angle', [0, 0], [2, 4])]);
  assert.equal(evaluateClip(clip, 3).get('j1').get('angle'), 2);
  assert.equal(evaluateClip(clip, -0.5).get('j1').get('angle'), 3);
  const once = { ...clip, loop: false };
  assert.equal(evaluateClip(once, 5).get('j1').get('angle'), 4);
  assert.equal(evaluateClip(once, -1).get('j1').get('angle'), 0);
});

test('evaluateClip skips tracks without keys and steps sprites', () => {
  const clip = clipOf([tr('j1', 'angle'), { target: 's1', channel: 'sprite', keys: [k(0, 'a', 'linear'), k(1, 'b', 'linear')] }]);
  const sampled = evaluateClip(clip, 0.5);
  assert.equal(sampled.has('j1'), false);
  assert.equal(sampled.get('s1').get('sprite'), 'a');
});

const def = {
  ragdoll: { channels: { strength: 0.5, gain: 1, damping: 1 } },
  joints: [
    { id: 'j1', motor: { gain: 10, damping: 0.5 } },
    { id: 'j2', motor: { gain: 4, damping: 2 } },
  ],
  bodies: [{ fixtures: [{ id: 's1', sprite: { asset: 'img' } }, { id: 's2' }] }],
};

test('resolveChannels with no layers returns defaults', () => {
  const pose = resolveChannels(def, []);
  assert.deepEqual(pose.root, { strength: 0.5, gain: 1, damping: 1 });
  assert.deepEqual(pose.joints.get('j1'), { angle: 0, strength: 1, gain: 1, damping: 1, S: 0.5, G: 10, D: 0.5 });
  assert.equal(pose.sprites.get('s1'), 'img');
  assert.equal(pose.sprites.get('s2'), null);
});

test('resolveChannels applies clip values and leaves untracked channels at default', () => {
  const clip = clipOf([tr('j1', 'angle', [0, 0], [2, 1]), tr('j1', 'strength', [0, 0.4]), tr('root', 'strength', [0, 1])]);
  const pose = resolveChannels(def, [{ clip, time: 1 }], { gain: 0.5 });
  const j1 = pose.joints.get('j1');
  assert.equal(j1.angle, 0.5);
  assert.equal(j1.S, 0.4);
  assert.equal(j1.G, 5);
  assert.equal(pose.joints.get('j2').angle, 0);
  assert.equal(pose.joints.get('j2').S, 1);
  assert.equal(pose.joints.get('j2').D, 2);
});

test('resolveChannels weight, additive blend and discrete switch', () => {
  const tracks = [tr('j1', 'angle', [0, 2]), tr('j1', 'gain', [0, 0]), tr('s1', 'sprite', [0, 'x'])];
  const half = resolveChannels(def, [{ clip: clipOf(tracks), time: 0, weight: 0.25 }]);
  assert.equal(half.joints.get('j1').angle, 0.5);
  assert.equal(half.joints.get('j1').gain, 0.75);
  assert.equal(half.sprites.get('s1'), 'img');
  const flip = resolveChannels(def, [{ clip: clipOf(tracks), time: 0, weight: 0.5 }]);
  assert.equal(flip.sprites.get('s1'), 'x');
  const additive = resolveChannels(def, [{ clip: clipOf(tracks, { blend: 'additive' }), time: 0, weight: 0.5 }]);
  assert.equal(additive.joints.get('j1').angle, 1);
  assert.equal(additive.joints.get('j1').gain, 0.5);
  assert.equal(additive.sprites.get('s1'), 'x');
});

test('resolveChannels clamps multipliers and ignores unknown targets', () => {
  const clip = clipOf([tr('j1', 'strength', [0, 3]), tr('ghost', 'angle', [0, 1])]);
  const pose = resolveChannels(def, [{ clip, time: 0 }], { strength: 5 });
  assert.equal(pose.joints.get('j1').strength, 1);
  assert.equal(pose.joints.get('j1').S, 0.5);
  assert.equal(pose.joints.has('ghost'), false);
});

test('resolveChannels rejects more than one layer', () => {
  const layer = { clip: clipOf([]), time: 0 };
  assert.throws(() => resolveChannels(def, [layer, layer]), /single layer/);
});
