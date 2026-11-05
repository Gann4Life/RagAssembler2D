import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aimAngle, resolveChannels, shortestDelta, wrapToPi } from '../lib/evaluate.js';
import { fakeInstance } from './helpers/fake-instance.js';

const near = (actual, expected, label = '', tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected}, got ${actual}`);
};

test('wrapToPi maps angles into (−π, π]', () => {
  near(wrapToPi(0), 0);
  near(wrapToPi(Math.PI), Math.PI);
  near(wrapToPi(-Math.PI), Math.PI);
  near(wrapToPi(1.5 * Math.PI), -0.5 * Math.PI);
  near(wrapToPi(7), 7 - 2 * Math.PI);
  near(wrapToPi(-7), -7 + 2 * Math.PI);
});

test('shortestDelta turns the short way across ±π', () => {
  near(shortestDelta(0, 1), 1);
  near(shortestDelta(3, -3), 2 * Math.PI - 6);
  near(shortestDelta(-3, 3), 6 - 2 * Math.PI);
});

test('aimAngle follows DESIGN.md §4.8: atan2(dir) − aimAxis − bodyA angle − reference angle, wrapped', () => {
  const anchor = { x: 1, y: 1 };
  near(aimAngle(anchor, { x: 1, y: 3 }, 0, 0, 0), Math.PI / 2);
  near(aimAngle(anchor, { x: 1, y: 3 }, 0, 0, Math.PI / 2), 0);
  near(aimAngle(anchor, { x: 2, y: 1 }, 0.3, 0.2, 0), -0.5);
  near(aimAngle(anchor, { x: 0, y: 1 }, 0, 0, -0.5), wrapToPi(Math.PI + 0.5));
});

function poseDocument() {
  return {
    ragdoll: { channels: { strength: 1, balance: 1, gain: 1, damping: 1 } },
    bodies: [],
    joints: [{ id: 'j', motor: { gain: 10, damping: 0.5 } }, { id: 'k', motor: { gain: 10, damping: 0.5 } }],
  };
}

function rampClip(strength = 0.4) {
  return {
    length: 1,
    loop: false,
    blend: 'override',
    tracks: [
      { target: 'j', channel: 'angle', keys: [{ t: 0, v: 0, interp: 'linear' }, { t: 1, v: 0.4, interp: 'linear' }] },
      { target: 'j', channel: 'strength', keys: [{ t: 0, v: strength, interp: 'linear' }] },
    ],
  };
}

test('an override moves the clip angle toward its target by weight and scales the rate by 1 − weight', () => {
  const layers = [{ clip: rampClip(), time: 0.5, speed: 1 }];
  const clip = resolveChannels(poseDocument(), layers).joints.get('j');
  near(clip.angle, 0.2);
  near(clip.angleRate, 0.4);
  for (const [weight, angle, rate] of [[0, 0.2, 0.4], [0.5, 0.6, 0.2], [1, 1, 0]]) {
    const pose = resolveChannels(poseDocument(), layers, {}, new Map([['j', { angle: 1, weight }]])).joints.get('j');
    near(pose.angle, angle, `angle at weight ${weight}`);
    near(pose.angleRate, rate, `rate at weight ${weight}`);
    near(pose.strength, 0.4, `strength at weight ${weight}`);
  }
});

test('an override weight outside 0-1 is clamped, and joints without an override are unchanged', () => {
  const layers = [{ clip: rampClip(), time: 0.5, speed: 1 }];
  const plain = resolveChannels(poseDocument(), layers);
  const over = resolveChannels(poseDocument(), layers, {}, new Map([['j', { angle: 1, weight: 3 }]]));
  near(over.joints.get('j').angle, 1);
  assert.deepEqual(over.joints.get('k'), plain.joints.get('k'));
  const under = resolveChannels(poseDocument(), layers, {}, new Map([['j', { angle: 1, weight: -1 }]]));
  assert.deepEqual(under.joints.get('j'), plain.joints.get('j'));
  assert.deepEqual(resolveChannels(poseDocument(), layers, {}, null), plain);
});

test('an override blends along the shortest path across ±π (DESIGN.md §4.8)', () => {
  const clip = { length: 1, loop: false, tracks: [{ target: 'j', channel: 'angle', keys: [{ t: 0, v: 3 }] }] };
  const pose = resolveChannels(poseDocument(), [{ clip, time: 0 }], {}, new Map([['j', { angle: -3, weight: 1 }]])).joints.get('j');
  near(pose.angle, 3 + (2 * Math.PI - 6));
});

test('an override strength lerps the clip strength by weight and is still scaled by root and runtime strength', () => {
  const layers = [{ clip: rampClip(0.4), time: 0.5, speed: 1 }];
  const overrides = new Map([['j', { angle: 0, weight: 0.5, strength: 1 }]]);
  const pose = resolveChannels(poseDocument(), layers, { strength: 0.5 }, overrides).joints.get('j');
  near(pose.strength, 0.7);
  near(pose.S, 0.35);
  const kept = resolveChannels(poseDocument(), layers, {}, new Map([['j', { angle: 0, weight: 1, strength: null }]])).joints.get('j');
  near(kept.strength, 0.4);
  const dead = poseDocument();
  dead.ragdoll.channels.strength = 0;
  const deadPose = resolveChannels(dead, layers, {}, new Map([['j', { angle: 0, weight: 1, strength: 1 }]])).joints.get('j');
  near(deadPose.strength, 1);
  assert.equal(deadPose.S, 0);
});

const DT = 1 / 60;

test('setJointAngle drives the motor toward the angle by its weight, negated with flipX', () => {
  const full = fakeInstance();
  full.rag.setJointAngle('a', 0.5);
  full.rag.update(DT);
  near(full.joints.get('j_a').motorSpeed, 5);
  near(full.joints.get('j_b').motorSpeed, 0);
  const half = fakeInstance();
  half.rag.setJointAngle('a', 0.5, { weight: 0.5 });
  half.rag.update(DT);
  near(half.joints.get('j_a').motorSpeed, 2.5);
  const mirrored = fakeInstance({ flipX: true });
  mirrored.rag.setJointAngle('a', 0.5);
  mirrored.rag.update(DT);
  near(mirrored.joints.get('j_a').motorSpeed, -5);
});

test('setJointAngle is not clamped to the limits', () => {
  const { rag, joints } = fakeInstance();
  rag.setJointAngle('a', 1.5);
  rag.update(DT);
  near(joints.get('j_a').motorSpeed, 15);
});

test('fadeIn ramps the weight over its seconds; calling again keeps the fade and updates the target', () => {
  const { rag, joints } = fakeInstance();
  rag.setJointAngle('a', 0.5, { fadeIn: 0.5 });
  rag.update(0.25);
  near(joints.get('j_a').motorSpeed, 2.5);
  rag.setJointAngle('a', 0.8, { fadeIn: 0.5 });
  rag.update(0.125);
  near(joints.get('j_a').motorSpeed, 6);
  rag.update(1);
  near(joints.get('j_a').motorSpeed, 8);
  rag.setJointAngle('a', 0.6, { weight: 0.5 });
  rag.update(DT);
  near(joints.get('j_a').motorSpeed, 3);
});

test('clearJointOverride fades the weight out over fadeOut, and a new call fades back in from there', () => {
  const { rag, joints } = fakeInstance();
  rag.setJointAngle('a', 0.5);
  rag.update(DT);
  rag.clearJointOverride('a', { fadeOut: 0.5 });
  rag.update(0.25);
  near(joints.get('j_a').motorSpeed, 2.5);
  rag.setJointAngle('a', 0.5, { fadeIn: 0.5 });
  rag.update(0.25);
  near(joints.get('j_a').motorSpeed, 3.75);
  rag.clearJointOverride('a', { fadeOut: 0.5 });
  rag.update(0.25);
  rag.update(0.25);
  near(joints.get('j_a').motorSpeed, 0);
  rag.update(DT);
  near(joints.get('j_a').motorSpeed, 0);
});

test('clearJointOverride without fadeOut and clearAllOverrides remove overrides at once', () => {
  const { rag, joints } = fakeInstance();
  rag.setJointAngle('a', 0.5);
  rag.setJointAngle('b', 0.5);
  rag.clearJointOverride('a');
  rag.update(DT);
  near(joints.get('j_a').motorSpeed, 0);
  near(joints.get('j_b').motorSpeed, 2);
  rag.clearAllOverrides();
  rag.update(DT);
  near(joints.get('j_b').motorSpeed, 0);
  rag.clearJointOverride('a', { fadeOut: 1 });
});

test('an override strength of 0 turns the motor off; root strength 0 turns it off whatever the override', () => {
  const soft = fakeInstance();
  soft.rag.setJointAngle('a', 0.5, { strength: 0 });
  soft.rag.update(DT);
  assert.equal(soft.joints.get('j_a').enabled, false);
  const dead = fakeInstance({ channels: { strength: 0, balance: 0, gain: 1, damping: 1 } });
  dead.rag.lookAt('a', { x: 1, y: 0.5 }, { strength: 1 });
  dead.rag.update(DT);
  assert.equal(dead.joints.get('j_a').enabled, false);
});

test('lookAt aims from the current physics state every update and clamps to the limits', () => {
  const { rag, joints, root } = fakeInstance();
  rag.lookAt('a', { x: 1, y: 0.5 });
  rag.update(DT);
  near(joints.get('j_a').motorSpeed, 10 * Math.atan2(0.5, 1));
  root.angle = 0.2;
  joints.get('j_a').referenceAngle = 0.1;
  rag.update(DT);
  near(joints.get('j_a').motorSpeed, 10 * (Math.atan2(0.5, 1) - 0.3));
  joints.get('j_a').anchor = [1, 0];
  rag.update(DT);
  near(joints.get('j_a').motorSpeed, 10);
  rag.lookAt('a', { x: 1, y: -3 });
  rag.update(DT);
  near(joints.get('j_a').motorSpeed, -10);
});

test('override methods throw an Error for an unknown joint and a TypeError for bad arguments', () => {
  const { rag } = fakeInstance();
  assert.throws(() => rag.lookAt('nope', { x: 0, y: 0 }), { name: 'Error', message: /lookAt: unknown joint "nope"/ });
  assert.throws(() => rag.setJointAngle('nope', 0), { name: 'Error', message: /setJointAngle: unknown joint "nope"/ });
  assert.throws(() => rag.clearJointOverride('nope'), { name: 'Error', message: /clearJointOverride: unknown joint "nope"/ });
  assert.throws(() => rag.lookAt('a', null), TypeError);
  assert.throws(() => rag.lookAt('a', { x: 0, y: Number.NaN }), TypeError);
  assert.throws(() => rag.setJointAngle('a', '1'), TypeError);
  assert.throws(() => rag.setJointAngle('a', 1, { weight: 'x' }), TypeError);
  assert.throws(() => rag.setJointAngle('a', 1, { strength: Infinity }), TypeError);
  assert.throws(() => rag.setJointAngle('a', 1, { fadeIn: -1 }), TypeError);
  assert.throws(() => rag.setJointAngle('a', 1, null), TypeError);
  assert.throws(() => rag.clearJointOverride('a', { fadeOut: Number.NaN }), TypeError);
});

test('jointControl returns one frozen handle per joint whose methods share the name-based overrides', () => {
  const { rag, joints } = fakeInstance();
  const control = rag.jointControl('a');
  assert.equal(control, rag.jointControl('a'));
  assert.notEqual(control, rag.jointControl('b'));
  assert.equal(control.name, 'a');
  assert.ok(Object.isFrozen(control));
  assert.throws(() => { control.name = 'x'; }, TypeError);
  control.setAngle(0.5, { weight: 0.5 });
  rag.update(DT);
  near(joints.get('j_a').motorSpeed, 2.5);
  rag.setJointAngle('a', 0.5, { fadeIn: 0.5 });
  rag.update(0.25);
  near(joints.get('j_a').motorSpeed, 5);
  control.lookAt({ x: 1, y: 0.5 });
  rag.update(DT);
  near(joints.get('j_a').motorSpeed, 10 * Math.atan2(0.5, 1));
  control.clearOverride({ fadeOut: 0.5 });
  rag.update(0.25);
  near(joints.get('j_a').motorSpeed, 5 * Math.atan2(0.5, 1));
  rag.setJointAngle('a', 0.5);
  control.clearOverride();
  rag.update(DT);
  near(joints.get('j_a').motorSpeed, 0);
  control.setAngle(0.5);
  rag.clearAllOverrides();
  rag.update(DT);
  near(joints.get('j_a').motorSpeed, 0);
});

test('jointControl throws an Error for an unknown joint and its methods throw TypeErrors for bad arguments', () => {
  const { rag } = fakeInstance();
  assert.throws(() => rag.jointControl('nope'), { name: 'Error', message: /jointControl: unknown joint "nope"/ });
  const control = rag.jointControl('a');
  assert.throws(() => control.setAngle(Number.NaN), { name: 'TypeError', message: /jointControl\("a"\)\.setAngle: angle/ });
  assert.throws(() => control.lookAt({ x: 1 }), { name: 'TypeError', message: /jointControl\("a"\)\.lookAt: worldPoint/ });
  assert.throws(() => control.setAngle(0, { weight: null }), TypeError);
  assert.throws(() => control.clearOverride({ fadeOut: -1 }), TypeError);
});

test('a jointControl handle stays valid after destroy and its calls do nothing', () => {
  const { rag } = fakeInstance();
  const control = rag.jointControl('a');
  rag.destroy();
  control.setAngle(0.5);
  control.lookAt({ x: 1, y: 1 });
  control.clearOverride({ fadeOut: 1 });
  assert.equal(rag.jointControl('a'), control);
});

test('override calls after destroy do nothing', () => {
  const { rag } = fakeInstance();
  rag.setJointAngle('a', 0.5);
  rag.destroy();
  rag.setJointAngle('a', 0.5);
  rag.lookAt('a', { x: 1, y: 1 });
  rag.clearJointOverride('a');
  rag.clearAllOverrides();
  rag.update(DT);
});

test('toWorld and toPixi convert through pixelsPerMeter, the Y flip and the view parent transform', () => {
  const { rag } = fakeInstance();
  assert.deepEqual(rag.toWorld({ x: 64, y: -32 }), { x: 2, y: 1 });
  assert.deepEqual(rag.toPixi({ x: 2, y: 1 }), { x: 64, y: -32 });
  const parent = {
    toLocal: (p) => ({ x: (p.x - 100) / 2, y: (p.y - 50) / 2 }),
    toGlobal: (p) => ({ x: p.x * 2 + 100, y: p.y * 2 + 50 }),
  };
  const nested = fakeInstance({ view: { parent, destroy() {} } }).rag;
  assert.deepEqual(nested.toWorld({ x: 164, y: -14 }), { x: 1, y: 1 });
  assert.deepEqual(nested.toPixi({ x: 1, y: 1 }), { x: 164, y: -14 });
  assert.throws(() => rag.toWorld({ x: 'a', y: 0 }), TypeError);
  assert.throws(() => rag.toPixi(null), TypeError);
});
