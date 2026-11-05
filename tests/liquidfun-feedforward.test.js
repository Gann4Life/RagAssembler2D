import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter } from '../lib/ragimporter.js';
import { sampleTrack } from '../lib/evaluate.js';
import { createSimulateSession } from '../js/physics/simulate-session.js';
import { fitTorque, rigDocument } from './helpers/rigs.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

const STEP = 1 / 60;
const RAD = Math.PI / 180;
const SHOULDER = 'j_upperR';
const ELBOW = 'j_foreR';
const STRIKE_START = 0.4;
const STRIKE_END = 0.5;
const RETURN_END = 0.9;

class Container {
  constructor() {
    this.parent = null;
  }

  destroy() {}
}

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function key(t, degrees, interp = 'linear') {
  return { t, v: degrees * RAD, interp };
}

function strikeTrack(target, from, to) {
  return {
    target,
    channel: 'angle',
    keys: [key(0, from), key(STRIKE_START, from), key(STRIKE_END, to, 'ease'), key(RETURN_END, from)],
  };
}

function clipOf(key, length, tracks) {
  return { key, name: key, loop: false, hold: true, layer: 0, blend: 'override', length, fadeIn: 0, fadeOut: 0, speed: 1, tracks, events: [] };
}

const box = (width, height, center = [0, 0]) => ({ type: 'box', center, width, height, angle: 0 });
const circle = (radius, center = [0, 0]) => ({ type: 'circle', center, radius });

function punchRig() {
  const leg = (side, x) => [
    { id: `thigh${side}`, at: [x, 0.45], shapes: [box(0.17, 0.32)], parent: 'pelvis', anchor: [x, 0.6], lower: -1.5, upper: 1.5 },
    { id: `shin${side}`, at: [x, 0.18], shapes: [box(0.15, 0.3), circle(0.1, [0.03, -0.08])], parent: `thigh${side}`, anchor: [x, 0.31], lower: -1.5, upper: 1.5 },
  ];
  const arm = (side, x) => [
    { id: `upper${side}`, at: [x, 0.86], shapes: [box(0.14, 0.3)], parent: 'chest', anchor: [x, 1.0] },
    { id: `fore${side}`, at: [x + 0.25, 0.72], shapes: [box(0.6, 0.16)], parent: `upper${side}`, anchor: [x, 0.72], lower: -1.2, upper: 1.8 },
  ];
  const json = rigDocument('striker', 'pelvis', [
    { id: 'pelvis', at: [0, 0.68], shapes: [circle(0.17)] },
    { id: 'chest', at: [0, 0.96], shapes: [circle(0.23)], parent: 'pelvis', anchor: [0, 0.8], lower: -0.8, upper: 0.8 },
    { id: 'head', at: [0.05, 1.3], shapes: [circle(0.15)], parent: 'chest', anchor: [0, 1.17], lower: -0.5, upper: 0.5 },
    ...leg('L', -0.06),
    ...leg('R', 0.06),
    ...arm('L', -0.14),
    ...arm('R', -0.08),
  ]);
  fitTorque(json);
  json.clips = [
    clipOf('punch', 1.2, [strikeTrack(SHOULDER, 60, 156), strikeTrack(ELBOW, 13, 82)]),
    clipOf('ramp', 1.4, [{ target: SHOULDER, channel: 'angle', keys: [{ t: 0, v: 0, interp: 'linear' }, { t: 0.2, v: 0, interp: 'linear' }, { t: 1.2, v: 2, interp: 'linear' }] }]),
  ];
  return json;
}

function jointAngles(json, clip) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const rest = new Map(json.bodies.map((body) => [body.id, body.angle]));
  const joints = json.joints.filter((joint) => joint.id === SHOULDER || joint.id === ELBOW);
  const session = createSimulateSession(Box2D, json, { clip, pose: clip });
  const length = json.clips.find((entry) => entry.key === clip).length;
  const frames = [];
  const record = () => {
    const pose = session.pose();
    const angles = new Map();
    for (const joint of joints) {
      angles.set(joint.id, pose.get(joint.bodyB).angle - pose.get(joint.bodyA).angle - (rest.get(joint.bodyB) - rest.get(joint.bodyA)));
    }
    frames.push(angles);
  };
  try {
    record();
    for (let i = 0; i < Math.round(length / STEP); i++) {
      session.step(STEP);
      record();
    }
  } finally {
    session.destroy();
  }
  return frames;
}

const stepAt = (t) => Math.round(t / STEP);

function trackOf(json, clip, target) {
  return json.clips.find((entry) => entry.key === clip).tracks.find((track) => track.target === target).keys;
}

const json = punchRig();
const punch = jointAngles(json, 'punch');

for (const target of [SHOULDER, ELBOW]) {
  const keys = trackOf(json, 'punch', target);
  const keyed = (t) => sampleTrack(keys, t);
  const angle = (t) => punch[stepAt(t)].get(target);

  test(`M1, M2: the ${target} strike arrives at the keyed angle at the keyed time with the keyed speed`, () => {
    const arrival = Math.abs(angle(STRIKE_END) - keyed(STRIKE_END)) / RAD;
    assert.ok(arrival <= 5, `arrival error ${arrival}°`);
    const keyedSpeed = (keyed(STRIKE_END) - keyed(STRIKE_START)) / (STRIKE_END - STRIKE_START);
    const speed = (angle(STRIKE_END) - angle(STRIKE_END - STEP)) / STEP;
    assert.ok(speed >= 0.8 * keyedSpeed, `impact speed ${speed} rad/s, keyed ${keyedSpeed} rad/s`);
  });

  test(`M3: the ${target} follows the ease return and passes the strike key by little`, () => {
    let squares = 0;
    let samples = 0;
    for (let step = stepAt((STRIKE_END + RETURN_END) / 2); step <= stepAt(RETURN_END); step++) {
      squares += ((punch[step].get(target) - keyed(step * STEP)) / RAD) ** 2;
      samples++;
    }
    const rms = Math.sqrt(squares / samples);
    assert.ok(rms <= 3, `return RMS ${rms}°`);
    let overshoot = 0;
    for (let step = stepAt(STRIKE_END); step <= stepAt(RETURN_END); step++) {
      overshoot = Math.max(overshoot, (punch[step].get(target) - keyed(STRIKE_END)) / RAD);
    }
    assert.ok(overshoot <= 15, `overshoot ${overshoot}°`);
    const back = Math.abs(angle(STRIKE_END + 0.2) - keyed(STRIKE_END + 0.2)) / RAD;
    assert.ok(back <= 2, `${back}° off the track 0.2 s after the key`);
  });
}

test('M4: a steady 2 rad/s ramp is tracked within 0.5° at mid-segment', () => {
  const frames = jointAngles(json, 'ramp');
  const keys = trackOf(json, 'ramp', SHOULDER);
  const error = Math.abs(frames[stepAt(0.7)].get(SHOULDER) - sampleTrack(keys, 0.7)) / RAD;
  assert.ok(error <= 0.5, `mid-ramp error ${error}°`);
});
