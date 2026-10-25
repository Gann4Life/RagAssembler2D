import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter } from '../lib/ragimporter.js';
import { composeTransforms, invertTransform, transformPoint } from '../lib/geometry.js';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { loadJson, toJson } from '../js/model/io.js';
import { createPoseSession } from '../js/physics/pose-session.js';
import { createSimulateSession } from '../js/physics/simulate-session.js';
import { bipedRig, fitTorque } from './helpers/rigs.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

class Container {
  constructor() {
    this.parent = null;
  }

  destroy() {}
}

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

const PLAYHEAD = 0.5;
const STEP = 1 / 60;
const PAST_EXTENDED = 0.3;
const DEGREE = Math.PI / 180;
const DRAG_DEPTH = 0.2;
const THROUGH_GROUND = 0.02;
const STRAIGHT = 15 * DEGREE;
const CROUCH = Object.freeze({ j_thighL: 0.2, j_shinL: -1.2, j_footL: 1, j_thighR: 0.2, j_shinR: -1.2, j_footR: 1 });
const OTHER_LIMBS = ['j_thighR', 'j_shinR', 'j_footR', 'j_torso', 'j_head', 'j_upperL', 'j_foreL', 'j_upperR', 'j_foreR'];

function crouchDocument() {
  const { json } = bipedRig();
  for (const id of ['j_shinL', 'j_shinR']) {
    const joint = json.joints.find((entry) => entry.id === id);
    joint.limits = { enabled: true, lower: -1.57, upper: 0 };
  }
  for (const id of ['j_footL', 'j_footR']) {
    const joint = json.joints.find((entry) => entry.id === id);
    joint.limits = { enabled: true, lower: -1.57, upper: 1.57 };
  }
  fitTorque(json);
  json.clips.push({
    key: 'jump',
    name: 'jump',
    loop: false,
    hold: true,
    layer: 0,
    blend: 'override',
    length: 1,
    fadeIn: 0,
    fadeOut: 0,
    speed: 1,
    tracks: [
      ...Object.entries(CROUCH).map(([target, v]) => ({
        target,
        channel: 'angle',
        keys: [0, 0.4, PLAYHEAD].map((t) => ({ t, v, interp: 'linear' })),
      })),
      { target: 'j_torso', channel: 'angle', keys: [{ t: 0, v: 0.2, interp: 'linear' }] },
    ],
    events: [],
  });
  return json;
}

function simulate(json, seconds) {
  const session = createSimulateSession(Box2D, json, { clip: 'jump', pose: 'jump' });
  try {
    const frames = [session.pose()];
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      session.step(STEP);
      frames.push(session.pose());
    }
    return frames;
  } finally {
    session.destroy();
  }
}

function setup(json) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const playback = { playing: false, holds: [], pause() {}, hold(pose) { playback.holds.push(pose); } };
  const editor = createEditor({ physics: { startPose: (doc, options) => createPoseSession(Box2D, doc, options) }, playback, autokey: () => true });
  assert.equal(loadJson(editor.model, JSON.stringify(json)).ok, true);
  editor.camera.setSize(800, 800);
  editor.camera.zoomAt({ x: 400, y: 400 }, 400 / editor.camera.scale);
  const clip = editor.model.children(ROOT_UID, 'clips')[0];
  editor.modes.openClip(clip);
  editor.modes.setPlayhead(PLAYHEAD);
  return { editor, playback, clip };
}

function allKeys({ editor, clip }) {
  const { model } = editor;
  const keys = new Map();
  for (const track of model.children(clip, 'tracks')) {
    const values = model.children(track, 'keys').map((key) => [model.prop(key, 't'), model.prop(key, 'v')]);
    keys.set(`${model.prop(track, 'target')}/${model.prop(track, 'channel')}`, values);
  }
  return keys;
}

function keyAt(keys, name, t) {
  return keys.get(name)?.find(([time]) => Math.abs(time - t) < 1e-9)?.[1];
}

function restOf(json) {
  return new Map(json.bodies.map((body) => [body.id, { x: body.position[0], y: body.position[1], angle: body.angle }]));
}

function jointAngle(json, pose, id) {
  const joint = json.joints.find((entry) => entry.id === id);
  const rest = restOf(json);
  return pose.get(joint.bodyB).angle - pose.get(joint.bodyA).angle - (rest.get(joint.bodyB).angle - rest.get(joint.bodyA).angle);
}

function extendTarget(json, pose, past) {
  const rest = restOf(json);
  const knee = json.joints.find((entry) => entry.id === 'j_shinL').anchor;
  const thigh = pose.get('b_thighL');
  const anchor = transformPoint(thigh, transformPoint(invertTransform(rest.get('b_thighL')), { x: knee[0], y: knee[1] }));
  const straight = composeTransforms(thigh, composeTransforms(invertTransform(rest.get('b_thighL')), rest.get('b_shinL')));
  return transformPoint({ ...anchor, angle: past }, { x: straight.x - anchor.x, y: straight.y - anchor.y });
}

function dragShinStraight(env, json, displayedById, past) {
  const { editor } = env;
  const { model, tools, camera } = editor;
  const displayed = new Map([...displayedById].map(([id, transform]) => [model.uidOf(id), transform]));
  const shown = [];
  tools.bindView({
    hitTest: () => [model.children(model.uidOf('b_shinL'), 'fixtures')[0]],
    boxTest: () => [],
    setCursor() {},
    invalidateOverlay() {},
    setPose: (pose) => shown.push(pose),
    displayedPose: () => displayed,
  });
  assert.equal(tools.activate('pose'), true);
  const send = (type, screen) => tools.pointer({ type, screen, button: type === 'move' ? -1 : 0, buttons: type === 'up' ? 0 : 1, shift: false, ctrl: false, alt: false, clicks: 1 });
  const from = camera.worldToScreen(displayedById.get('b_shinL'));
  send('down', from);
  const start = new Map([...shown[0]].map(([uid, transform]) => [model.prop(uid, 'id'), transform]));
  const to = camera.worldToScreen(extendTarget(json, start, past));
  for (let i = 1; i <= 60; i++) {
    send('move', { x: from.x + ((to.x - from.x) * i) / 60, y: from.y + ((to.y - from.y) * i) / 60 });
    tools.tick(STEP);
  }
  for (let i = 0; i < 60; i++) tools.tick(STEP);
  const released = new Map([...shown.at(-1)].map(([uid, transform]) => [model.prop(uid, 'id'), transform]));
  send('up', to);
  return { start, released };
}

function lowestPoint(json, pose, ids) {
  let lowest = Infinity;
  for (const body of json.bodies) {
    if (ids !== undefined && !ids.includes(body.id)) continue;
    const placed = pose.get(body.id);
    for (const { shape } of body.fixtures) {
      if (shape.type === 'circle') {
        lowest = Math.min(lowest, transformPoint(placed, { x: shape.center[0], y: shape.center[1] }).y - shape.radius);
        continue;
      }
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const corner = transformPoint({ x: shape.center[0], y: shape.center[1], angle: shape.angle }, { x: (sx * shape.width) / 2, y: (sy * shape.height) / 2 });
        lowest = Math.min(lowest, transformPoint(placed, corner).y);
      }
    }
  }
  return lowest;
}

function dragDown(env, displayedById, bodyId, depth) {
  const { editor } = env;
  const { model, tools, camera } = editor;
  const displayed = new Map([...displayedById].map(([id, transform]) => [model.uidOf(id), transform]));
  const shown = [];
  tools.bindView({
    hitTest: () => [model.children(model.uidOf(bodyId), 'fixtures')[0]],
    boxTest: () => [],
    setCursor() {},
    invalidateOverlay() {},
    setPose: (pose) => shown.push(pose),
    displayedPose: () => displayed,
  });
  assert.equal(tools.activate('pose'), true);
  const send = (type, screen) => tools.pointer({ type, screen, button: type === 'move' ? -1 : 0, buttons: type === 'up' ? 0 : 1, shift: false, ctrl: false, alt: false, clicks: 1 });
  const grabbed = displayedById.get(bodyId);
  const from = camera.worldToScreen(grabbed);
  const to = camera.worldToScreen({ x: grabbed.x, y: grabbed.y - depth });
  send('down', from);
  for (let i = 1; i <= 60; i++) {
    send('move', { x: from.x + ((to.x - from.x) * i) / 60, y: from.y + ((to.y - from.y) * i) / 60 });
    tools.tick(STEP);
  }
  for (let i = 0; i < 60; i++) tools.tick(STEP);
  const released = new Map([...shown.at(-1)].map(([uid, transform]) => [model.prop(uid, 'id'), transform]));
  send('up', to);
  assert.equal(shown.at(-1), null, 'the release hands the display back');
  return { shown: shown.slice(0, -1).map((pose) => new Map([...pose].map(([uid, transform]) => [model.prop(uid, 'id'), transform]))), released };
}

function rootRise(frames) {
  const step = Math.round(PLAYHEAD / STEP);
  const heights = frames.slice(step, step + 30).map((pose) => pose.get('b_pelvis').y);
  const speeds = heights.slice(1).map((y, index) => (y - heights[index]) / STEP);
  return { top: Math.max(...heights), speed: Math.max(...speeds) };
}

test('an Animate Pose drag pushes a grounded leg through the ground of the clip simulation and keys it as released', () => {
  const json = crouchDocument();
  const env = setup(json);
  const before = allKeys(env);
  const frames = simulate(toJson(env.editor.model, 'test'), PLAYHEAD + STEP);
  const shownAtPlayhead = frames[Math.round(PLAYHEAD / STEP)];
  const ground = lowestPoint(json, restOf(json));
  const foot = ['b_shinL', 'b_footL'];
  const standing = lowestPoint(json, shownAtPlayhead, foot);
  assert.ok(Math.abs(standing - ground) < 0.02, `the foot stands on the ground at the playhead: ${standing} vs ${ground}`);

  const { shown, released } = dragDown(env, shownAtPlayhead, 'b_shinL', DRAG_DEPTH);
  const deepest = Math.min(...shown.map((pose) => lowestPoint(json, pose, foot)));
  assert.ok(deepest < ground - THROUGH_GROUND, `the leg goes ${(ground - deepest).toFixed(3)} m through the ground during the drag`);
  const depth = ground - lowestPoint(json, released, foot);
  assert.ok(depth > THROUGH_GROUND, `the leg is released ${depth.toFixed(3)} m through the ground`);
  assert.ok(Math.abs(jointAngle(json, released, 'j_shinL')) < STRAIGHT, 'the leg stops at its length, straightened, not at the ground');
  assert.equal(env.playback.holds.length, 1);
  const held = new Map([...env.playback.holds[0]].map(([uid, transform]) => [env.editor.model.prop(uid, 'id'), transform]));
  assert.deepEqual(held, released, 'the posed hold shows the leg through the ground');

  const keys = allKeys(env);
  const knee = keyAt(keys, 'j_shinL/angle', PLAYHEAD);
  assert.notEqual(knee, keyAt(before, 'j_shinL/angle', PLAYHEAD), 'the knee is keyed');
  for (const joint of ['j_thighL', 'j_shinL']) {
    const { lower, upper } = json.joints.find((entry) => entry.id === joint).limits ?? {};
    const angle = jointAngle(json, released, joint);
    const expected = Number.isFinite(lower) ? Math.min(Math.max(angle, lower), upper) : angle;
    assert.ok(Math.abs(keyAt(keys, `${joint}/angle`, PLAYHEAD) - expected) < 1e-6, `${joint} keyed at its released angle`);
  }
});

test('an Animate Pose drag that extends a grounded leg keys the extended knee, leaves other limbs alone and makes the body jump', () => {
  const json = crouchDocument();
  const env = setup(json);
  const before = allKeys(env);
  const crouched = simulate(toJson(env.editor.model, 'test'), 1);
  const step = Math.round(PLAYHEAD / STEP);
  const shown = crouched[step];
  assert.ok(jointAngle(json, shown, 'j_shinL') < -0.5, 'the knee is bent in the simulation at the playhead');

  const { start, released } = dragShinStraight(env, json, shown, PAST_EXTENDED);
  assert.ok(Math.abs(jointAngle(json, start, 'j_shinL') - CROUCH.j_shinL) < 1e-5, 'the drag starts from the keyed knee');
  assert.ok(Math.abs(jointAngle(json, start, 'j_footL') - CROUCH.j_footL) < 1e-5, 'the drag starts from the keyed ankle');
  assert.equal(env.playback.holds.length, 1);
  const held = new Map([...env.playback.holds[0]].map(([uid, transform]) => [env.editor.model.prop(uid, 'id'), transform]));
  assert.deepEqual(held, released, 'the posed hold shows the released pose');

  const keys = allKeys(env);
  const knee = keyAt(keys, 'j_shinL/angle', PLAYHEAD);
  assert.ok(Math.abs(knee) < 0.5 * DEGREE, `knee key ${knee / DEGREE}° is the extended angle`);
  for (const id of OTHER_LIMBS) {
    assert.deepEqual(keys.get(`${id}/angle`), before.get(`${id}/angle`), `${id} keys untouched`);
  }
  for (const [name, values] of before) {
    const now = keys.get(name);
    for (const [t, v] of values) {
      if (Math.abs(t - PLAYHEAD) > 1e-9) assert.equal(keyAt(new Map([[name, now]]), name, t), v, `${name} at ${t} untouched`);
    }
  }
  for (const [name] of keys) {
    const value = keyAt(keys, name, PLAYHEAD);
    if (value === keyAt(before, name, PLAYHEAD)) continue;
    const joint = name.split('/')[0];
    if (joint === 'root') continue;
    const { lower, upper } = json.joints.find((entry) => entry.id === joint).limits;
    const seen = Math.min(Math.max(jointAngle(json, released, joint), lower), upper);
    assert.ok(Math.abs(value - seen) < 1e-6, `${name} keyed at its released angle`);
  }

  const extended = simulate(toJson(env.editor.model, 'test'), 1);
  const was = rootRise(crouched);
  const now = rootRise(extended);
  assert.ok(now.top > was.top + 0.02, `the root rises: ${now.top} vs ${was.top}`);
  assert.ok(now.speed > 0.1, `the root is pushed up at ${now.speed} m/s`);

  const first = allKeys(env);
  for (let round = 0; round < 5; round++) {
    const frames = simulate(toJson(env.editor.model, 'test'), PLAYHEAD + STEP);
    dragShinStraight(env, json, frames[step], 0);
    const again = allKeys(env);
    for (const [name, values] of first) {
      values.forEach(([t, v], index) => {
        const [, w] = again.get(name)[index];
        assert.ok(Math.abs(w - v) < 0.1 * DEGREE, `round ${round}: ${name} at ${t} drifted from ${v} to ${w}`);
      });
    }
    assert.ok(Math.abs(keyAt(again, 'j_shinL/angle', PLAYHEAD)) < 0.5 * DEGREE, `round ${round}: knee stays extended`);
  }
});
