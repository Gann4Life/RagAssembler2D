import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMIT_TOLERANCE, clampToLimits, sampleTrack, sampleTrackRate, channelDefault, evaluateClip, resolveChannels, fkPose, jointAngleForBody } from '../lib/evaluate.js';

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
  assert.deepEqual(pose.root, { strength: 0.5, gain: 1, damping: 1, bodyAngle: 0, bodyAngleRate: 0 });
  assert.deepEqual(pose.joints.get('j1'), { angle: 0, angleRate: 0, strength: 1, gain: 1, damping: 1, S: 0.5, G: 10, D: 0.5 });
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

const body = (id, x, y, angle = 0) => ({ id, position: [x, y], angle });
const hinge = (id, bodyA, bodyB, x, y) => ({ id, bodyA, bodyB, anchor: [x, y] });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`);
const chain = () => ({
  ragdoll: { rootBody: 'b_0' },
  bodies: [body('b_0', 0, 0), body('b_1', 1, 0), body('b_2', 2, 0)],
  joints: [hinge('j_1', 'b_0', 'b_1', 0.5, 0), hinge('j_2', 'b_1', 'b_2', 1.5, 0)],
});
const angles = (entries) => new Map(Object.entries(entries).map(([id, angle]) => [id, { angle }]));

test('fkPose: zero angles give the rest pose', () => {
  const pose = fkPose(chain(), angles({}));
  assert.deepEqual([...pose.keys()], ['b_0', 'b_1', 'b_2']);
  for (const [id, x] of [['b_0', 0], ['b_1', 1], ['b_2', 2]]) {
    close(pose.get(id).x, x);
    close(pose.get(id).y, 0);
    close(pose.get(id).angle, 0);
  }
});

test('fkPose: a chain rotates around each anchor and accumulates', () => {
  const pose = fkPose(chain(), angles({ j_1: Math.PI / 2, j_2: -Math.PI / 2 }));
  close(pose.get('b_0').x, 0);
  close(pose.get('b_1').x, 0.5);
  close(pose.get('b_1').y, 0.5);
  close(pose.get('b_1').angle, Math.PI / 2);
  close(pose.get('b_2').x, 1);
  close(pose.get('b_2').y, 1);
  close(pose.get('b_2').angle, 0);
});

test('fkPose: untracked joints keep their rest angle', () => {
  const pose = fkPose(chain(), angles({ j_1: Math.PI / 2 }));
  close(pose.get('b_1').angle, Math.PI / 2);
  close(pose.get('b_2').angle, Math.PI / 2);
  close(pose.get('b_2').x, 0.5);
  close(pose.get('b_2').y, 1.5);
});

test('fkPose: a rotated rest pose and rotated root are relative to rest', () => {
  const def = {
    ragdoll: { rootBody: 'b_0' },
    bodies: [body('b_0', 1, 1, Math.PI / 2), body('b_1', 1, 2, Math.PI)],
    joints: [hinge('j_1', 'b_0', 'b_1', 1, 1.5)],
  };
  const rest = fkPose(def, angles({}));
  close(rest.get('b_1').x, 1);
  close(rest.get('b_1').y, 2);
  close(rest.get('b_1').angle, Math.PI);
  const posed = fkPose(def, angles({ j_1: Math.PI / 2 }));
  close(posed.get('b_0').angle, Math.PI / 2);
  close(posed.get('b_1').angle, 1.5 * Math.PI);
  close(posed.get('b_1').x, 0.5);
  close(posed.get('b_1').y, 1.5);
});

test('fkPose: a joint whose bodyB is nearer the root turns bodyA the other way', () => {
  const def = {
    ragdoll: { rootBody: 'b_1' },
    bodies: [body('b_0', 0, 0), body('b_1', 1, 0)],
    joints: [hinge('j_1', 'b_0', 'b_1', 0.5, 0)],
  };
  const pose = fkPose(def, angles({ j_1: Math.PI / 2 }));
  close(pose.get('b_1').x, 1);
  close(pose.get('b_0').angle, -Math.PI / 2);
  close(pose.get('b_0').x, 0.5);
  close(pose.get('b_0').y, 0.5);
});

test('fkPose: loop joints and unlinked bodies stay out of the FK', () => {
  const def = chain();
  def.bodies.push(body('b_3', 5, 5));
  def.joints.push(hinge('j_3', 'b_1', 'b_0', 0.5, 0), hinge('j_4', 'b_3', 'b_3', 5, 5));
  const pose = fkPose(def, angles({ j_1: 1, j_3: 2, j_4: 3 }));
  close(pose.get('b_2').angle, 1);
  assert.deepEqual(pose.get('b_3'), { x: 5, y: 5, angle: 0 });
});

test('fkPose: no root body gives the rest pose and never mutates the document', () => {
  const def = chain();
  def.ragdoll.rootBody = null;
  const before = structuredClone(def);
  const pose = fkPose(def, angles({ j_1: 1 }));
  assert.equal(pose.get('b_1').angle, 0);
  assert.deepEqual(def, before);
});

test('fkPose: follows the clip at the playhead with loop and hold timing', () => {
  const clip = (loop) => ({
    length: 2,
    loop,
    tracks: [{ target: 'j_1', channel: 'angle', keys: [{ t: 0, v: 0 }, { t: 2, v: 2 }] }],
  });
  const def = chain();
  const angleAt = (c, time) => {
    const pose = resolveChannels(def, [{ clip: c, time }]);
    return fkPose(def, pose.joints).get('b_1').angle;
  };
  close(angleAt(clip(true), 1), 1);
  close(angleAt(clip(true), 3), 1);
  close(angleAt(clip(false), 3), 2);
  close(angleAt(clip(false), 2), 2);
  close(angleAt(clip(false), 0), 0);
});

test('jointAngleForBody inverts fkPose', () => {
  const def = chain();
  const pose = fkPose(def, angles({ j_1: 0.3 }));
  close(jointAngleForBody(def, 'j_2', 1.1, pose), 0.8);
  const again = fkPose(def, angles({ j_1: 0.3, j_2: jointAngleForBody(def, 'j_2', 1.1, pose) }));
  close(again.get('b_2').angle, 1.1);
  close(jointAngleForBody(def, 'j_1', -0.4, pose), -0.4);
  assert.equal(jointAngleForBody(def, 'j_9', 0, pose), null);
});

test('jointAngleForBody respects direction and rest angles', () => {
  const def = {
    ragdoll: { rootBody: 'b_1' },
    bodies: [body('b_0', 0, 0, 0.5), body('b_1', 1, 0, 0.25)],
    joints: [hinge('j_1', 'b_0', 'b_1', 0.5, 0)],
  };
  const pose = fkPose(def, angles({ j_1: 0.6 }));
  const angle = jointAngleForBody(def, 'j_1', pose.get('b_0').angle, pose);
  close(angle, 0.6);
});
const smooth = (u) => u * u * (3 - 2 * u);
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`);
const kneeKeys = () => [k(0.2, 0, 'linear'), k(0.6, 1, 'ease')];

test('looping: the worked example of the wrap segment', () => {
  const keys = kneeKeys();
  closeTo(sampleTrack(keys, 0.4, false, 1), 0.5);
  closeTo(sampleTrack(keys, 0.9, false, 1), 1 - smooth(0.5));
  closeTo(sampleTrack(keys, 0, false, 1), 1 - smooth(0.4 / 0.6));
  closeTo(sampleTrack(keys, 0.1, false, 1), 1 - smooth(0.5 / 0.6));
  closeTo(sampleTrack(keys, 1, false, 1), sampleTrack(keys, 0, false, 1));
  closeTo(sampleTrack(keys, 1.9, false, 1), sampleTrack(keys, 0.9, false, 1));
  closeTo(sampleTrack(keys, -0.1, false, 1), sampleTrack(keys, 0.9, false, 1));
});

test('looping: non-loop sampling is unchanged', () => {
  const keys = kneeKeys();
  assert.equal(sampleTrack(keys, 0.9), 1);
  assert.equal(sampleTrack(keys, 0), 0);
  assert.equal(sampleTrack(keys, 0.9, false, null), 1);
});

test('looping: a single key is constant', () => {
  const keys = [k(0.3, 4, 'linear')];
  for (const t of [0, 0.3, 0.7, 1.4]) assert.equal(sampleTrack(keys, t, false, 1), 4);
});

test('looping: keys at 0 and length leave no wrap segment', () => {
  const keys = [k(0, 0, 'linear'), k(1, 5, 'linear')];
  closeTo(sampleTrack(keys, 0.5, false, 1), 2.5);
  closeTo(sampleTrack(keys, 1, false, 1), 5);
  closeTo(sampleTrack(keys, 0.999, false, 1), 4.995);
  closeTo(sampleTrack(keys, 1.0001, false, 1), 0.0005);
});

test('looping: a key at length only wraps toward the first key', () => {
  const keys = [k(0.5, 2, 'linear'), k(1, 6, 'linear')];
  closeTo(sampleTrack(keys, 1, false, 1), 6);
  closeTo(sampleTrack(keys, 0.25, false, 1), 4);
  closeTo(sampleTrack(keys, 0, false, 1), 6);
  const lone = [k(1, 6, 'linear')];
  assert.equal(sampleTrack(lone, 0.2, false, 1), 6);
});

test('looping: sprites step across the wrap', () => {
  const keys = [k(0.2, 'face_a'), k(0.6, 'face_b')];
  assert.equal(sampleTrack(keys, 0.1, true, 1), 'face_b');
  assert.equal(sampleTrack(keys, 0.2, true, 1), 'face_a');
  assert.equal(sampleTrack(keys, 0.7, true, 1), 'face_b');
  assert.equal(sampleTrack(keys, 0.1, true), 'face_a');
});

test('looping: angles unwind linearly across the wrap without wrapping', () => {
  const keys = [k(0, 0, 'linear'), k(0.5, 2 * Math.PI, 'linear')];
  closeTo(sampleTrack(keys, 0.5, false, 1), 2 * Math.PI);
  closeTo(sampleTrack(keys, 0.75, false, 1), Math.PI);
  closeTo(sampleTrack(keys, 1, false, 1), 0);
});

test('looping: the last key interp drives the wrap segment', () => {
  const keys = [k(0.2, 0, 'linear'), k(0.6, 1, 'step')];
  assert.equal(sampleTrack(keys, 0.9, false, 1), 1);
  assert.equal(sampleTrack(keys, 0.1, false, 1), 1);
});

test('looping: evaluateClip interpolates across the wrap only when loop is true', () => {
  const tracks = [{ target: 'knee', channel: 'angle', keys: kneeKeys() }];
  const looping = evaluateClip({ length: 1, loop: true, tracks }, 0.9);
  closeTo(looping.get('knee').get('angle'), 1 - smooth(0.5));
  const held = evaluateClip({ length: 1, loop: false, tracks }, 0.9);
  assert.equal(held.get('knee').get('angle'), 1);
});

test('looping: the resolved target is continuous across the wrap', () => {
  const def = { ragdoll: {}, joints: [{ id: 'knee' }], bodies: [] };
  const clip = { length: 1, loop: true, tracks: [{ target: 'knee', channel: 'angle', keys: kneeKeys() }] };
  const eps = 1e-6;
  const before = resolveChannels(def, [{ clip, time: 1 - eps }]).joints.get('knee').angle;
  const after = resolveChannels(def, [{ clip, time: 1 + eps }]).joints.get('knee').angle;
  assert.ok(Math.abs(before - after) < 1e-4, `${before} vs ${after}`);
});

test('sampleTrackRate is the exact slope per interp on the segment t_a <= t < t_b', () => {
  const keys = [k(0, 0, 'linear'), k(0.5, 1, 'ease'), k(1, 3, 'step'), k(2, 0, 'linear')];
  closeTo(sampleTrackRate(keys, 0), 2);
  closeTo(sampleTrackRate(keys, 0.25), 2);
  closeTo(sampleTrackRate(keys, 0.5), 0);
  closeTo(sampleTrackRate(keys, 0.75), 6 * 0.5 * 0.5 * 4);
  closeTo(sampleTrackRate(keys, 0.625), 6 * 0.25 * 0.75 * 4);
  assert.equal(sampleTrackRate(keys, 1.5), 0);
});

test('sampleTrackRate matches the derivative of sampleTrack', () => {
  const keys = [k(0.1, 0.2, 'ease'), k(0.4, 1.4, 'linear'), k(0.7, -0.5, 'ease')];
  const h = 1e-6;
  for (const loop of [null, 1]) {
    for (const t of [0.15, 0.3, 0.45, 0.6, 0.8, 0.95, 0.05]) {
      if (loop === null && (t < 0.1 || t > 0.7)) continue;
      const numeric = (sampleTrack(keys, t + h, false, loop) - sampleTrack(keys, t - h, false, loop)) / (2 * h);
      assert.ok(Math.abs(sampleTrackRate(keys, t, false, loop) - numeric) < 1e-5, `t=${t} loop=${loop}`);
    }
  }
});

test('sampleTrackRate is 0 for held values, single keys, empty tracks and discrete channels', () => {
  const keys = [k(0.2, 0, 'linear'), k(0.6, 1, 'linear')];
  assert.equal(sampleTrackRate(keys, 0.1), 0);
  assert.equal(sampleTrackRate(keys, 0.6), 0);
  assert.equal(sampleTrackRate(keys, 5), 0);
  assert.equal(sampleTrackRate([k(0.3, 4, 'linear')], 0.3, false, 1), 0);
  assert.equal(sampleTrackRate([], 0.3), 0);
  assert.equal(sampleTrackRate([k(0, 'a'), k(1, 'b')], 0.5, true), 0);
});

test('sampleTrackRate follows the wrap segment of a looping clip', () => {
  const keys = kneeKeys();
  closeTo(sampleTrackRate(keys, 0.4, false, 1), 2.5);
  closeTo(sampleTrackRate(keys, 0.9, false, 1), -6 * 0.5 * 0.5 / 0.6);
  closeTo(sampleTrackRate(keys, 1.9, false, 1), sampleTrackRate(keys, 0.9, false, 1));
  closeTo(sampleTrackRate(keys, 0.1, false, 1), -6 * (0.5 / 0.6) * (0.1 / 0.6) / 0.6);
  const stepped = [k(0.2, 0, 'linear'), k(0.6, 1, 'step')];
  assert.equal(sampleTrackRate(stepped, 0.9, false, 1), 0);
  const ends = [k(0, 0, 'linear'), k(1, 5, 'linear')];
  closeTo(sampleTrackRate(ends, 0.5, false, 1), 5);
  assert.equal(sampleTrackRate(ends, 1, false, 1), 0);
});

test('resolveChannels gives angle and bodyAngle rates scaled by speed and weight', () => {
  const tracks = [tr('j1', 'angle', [0, 0], [2, 1]), tr('root', 'bodyAngle', [0, 0], [1, -2]), tr('j1', 'gain', [0, 1], [2, 0])];
  const pose = resolveChannels(def, [{ clip: clipOf(tracks, { loop: false, speed: 2 }), time: 0.5 }]);
  closeTo(pose.joints.get('j1').angleRate, 1);
  closeTo(pose.root.bodyAngleRate, -4);
  assert.equal(pose.joints.get('j2').angleRate, 0);
  const played = resolveChannels(def, [{ clip: clipOf(tracks), time: 0.5, speed: 3, weight: 0.5 }]);
  closeTo(played.joints.get('j1').angleRate, 0.75);
  const additive = resolveChannels(def, [{ clip: clipOf(tracks, { blend: 'additive' }), time: 0.5, weight: 0.25 }]);
  closeTo(additive.root.bodyAngleRate, -0.5);
  const held = resolveChannels(def, [{ clip: clipOf(tracks, { loop: false }), time: 5 }]);
  assert.equal(held.joints.get('j1').angleRate, 0);
});

test('clampToLimits clamps only with enabled, finite limits', () => {
  const limits = { enabled: true, lower: -1, upper: 0.5 };
  assert.equal(clampToLimits(2, limits), 0.5);
  assert.equal(clampToLimits(-3, limits), -1);
  assert.equal(clampToLimits(0.25, limits), 0.25);
  assert.equal(clampToLimits(2, { ...limits, enabled: false }), 2);
  assert.equal(clampToLimits(2, { enabled: true, lower: -1, upper: Infinity }), 2);
  assert.equal(clampToLimits(2, undefined), 2);
  assert.equal(LIMIT_TOLERANCE, 1e-5);
});
