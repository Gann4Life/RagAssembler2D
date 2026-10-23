import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleTrack, channelDefault } from '../lib/evaluate.js';

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
