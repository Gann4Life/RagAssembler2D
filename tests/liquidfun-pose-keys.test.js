import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter } from '../lib/ragimporter.js';
import { fkPose } from '../lib/evaluate.js';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { loadJson } from '../js/model/io.js';
import { createPoseSession } from '../js/physics/pose-session.js';
import { rigDocument } from './helpers/rigs.js';

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
const LIMIT = 0.6;

function armDocument() {
  const json = rigDocument('arm', 'b1', [
    { id: 'b0', at: [0, 0.5], shapes: [{ type: 'box', center: [0, 0], width: 0.2, height: 1, angle: 0 }] },
    { id: 'b1', at: [0, 1.5], shapes: [{ type: 'box', center: [0, 0], width: 0.2, height: 1, angle: 0 }], parent: 'b0', anchor: [0, 1], lower: -LIMIT, upper: LIMIT },
    { id: 'b2', at: [0, 2.5], shapes: [{ type: 'box', center: [0, 0], width: 0.2, height: 1, angle: 0.3 }], parent: 'b1', anchor: [0, 2], lower: -LIMIT, upper: LIMIT },
    { id: 'b3', at: [0, 3.5], shapes: [{ type: 'box', center: [0, 0], width: 0.2, height: 1, angle: 0 }], parent: 'b2', anchor: [0, 3], lower: -LIMIT, upper: LIMIT },
  ]);
  json.joints[0].bodyA = 'b_b1';
  json.joints[0].bodyB = 'b_b0';
  json.ragdoll.rootBody = 'b_b1';
  json.clips.push({
    key: 'clip',
    name: 'clip',
    loop: false,
    hold: true,
    layer: 0,
    blend: 'override',
    length: 1,
    fadeIn: 0,
    fadeOut: 0,
    speed: 1,
    tracks: json.joints.map((joint) => ({ target: joint.id, channel: 'angle', keys: [{ t: 0, v: LIMIT, interp: 'linear' }] })),
    events: [],
  });
  return json;
}

function playback() {
  const state = { playing: false, holds: [], pause() {}, hold(pose) { state.holds.push(pose); } };
  return state;
}

function poseEditor(json) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const service = playback();
  const editor = createEditor({ physics: { startPose: (doc, options) => createPoseSession(Box2D, doc, options) }, playback: service });
  assert.equal(loadJson(editor.model, JSON.stringify(json)).ok, true);
  editor.camera.setSize(800, 800);
  editor.modes.openClip(editor.model.children(ROOT_UID, 'clips')[0]);
  editor.modes.setPlayhead(PLAYHEAD);
  return { editor, service };
}

function shapeOf(model, bodyId) {
  return model.children(model.uidOf(bodyId), 'fixtures')[0];
}

function dragBody(editor, displayed, bodyId, offset) {
  const { model, tools, camera } = editor;
  const view = { displayed };
  tools.bindView({
    hitTest: () => [shapeOf(model, bodyId)],
    boxTest: () => [],
    setCursor() {},
    invalidateOverlay() {},
    setPose() {},
    displayedPose: () => view.displayed,
  });
  assert.equal(tools.activate('pose'), true);
  const start = displayed.get(model.uidOf(bodyId));
  const from = camera.worldToScreen({ x: start.x, y: start.y });
  const send = (type, screen) => tools.pointer({ type, screen, button: type === 'move' ? -1 : 0, buttons: type === 'up' ? 0 : 1, shift: false, ctrl: false, alt: false, clicks: 1 });
  send('down', from);
  for (let i = 1; i <= 60; i++) {
    send('move', { x: from.x + (offset.x * i) / 60, y: from.y + (offset.y * i) / 60 });
    tools.tick(1 / 60);
  }
  for (let i = 0; i < 30; i++) tools.tick(1 / 60);
  send('up', { x: from.x + offset.x, y: from.y + offset.y });
}

function uidPose(model, pose) {
  return new Map([...pose].map(([id, transform]) => [model.uidOf(id), transform]));
}

function keysAtPlayhead(model) {
  const clip = model.children(ROOT_UID, 'clips')[0];
  const keys = new Map();
  for (const track of model.children(clip, 'tracks')) {
    if (model.prop(track, 'channel') !== 'angle') continue;
    const key = model.children(track, 'keys').find((uid) => Math.abs(model.prop(uid, 't') - PLAYHEAD) < 1e-9);
    if (key !== undefined) keys.set(model.prop(track, 'target'), model.prop(key, 'v'));
  }
  return keys;
}

function box2dAngle(json, joint, pose) {
  const rest = new Map(json.bodies.map((body) => [body.id, body.angle]));
  return pose.get(joint.bodyB).angle - pose.get(joint.bodyA).angle - (rest.get(joint.bodyB) - rest.get(joint.bodyA));
}

for (const [name, bodyId, offset] of [
  ['the free end', 'b_b3', { x: 400, y: 150 }],
  ['the free end the other way', 'b_b3', { x: -400, y: 150 }],
  ['a body below rootBody through a reversed joint', 'b_b0', { x: 400, y: -100 }],
]) {
  test(`Pose keys stay within the joint limits and equal the released angles when the display lags the keys: ${name}`, () => {
    const json = armDocument();
    const { editor, service } = poseEditor(json);
    const lagging = uidPose(editor.model, fkPose(json, new Map()));
    dragBody(editor, lagging, bodyId, offset);
    assert.equal(service.holds.length, 1);
    const released = new Map([...service.holds[0]].map(([uid, transform]) => [editor.model.prop(uid, 'id'), transform]));
    const keys = keysAtPlayhead(editor.model);
    assert.ok(keys.size > 0, 'the drag keyed something');
    for (const joint of json.joints) {
      if (!keys.has(joint.id)) continue;
      const key = keys.get(joint.id);
      assert.ok(key >= -LIMIT - 1e-9 && key <= LIMIT + 1e-9, `${joint.id} key ${key} outside ±${LIMIT}`);
      const seen = Math.min(Math.max(box2dAngle(json, joint, released), -LIMIT), LIMIT);
      assert.ok(Math.abs(key - seen) < 1e-6, `${joint.id} key ${key} != released ${seen}`);
    }
  });
}

test('Pose drags repeated from a lagging display never push a key past its limit', () => {
  const json = armDocument();
  const { editor } = poseEditor(json);
  const lagging = uidPose(editor.model, fkPose(json, new Map()));
  for (let i = 0; i < 4; i++) dragBody(editor, lagging, 'b_b3', { x: 400, y: 150 });
  for (const [id, key] of keysAtPlayhead(editor.model)) {
    assert.ok(Math.abs(key) <= LIMIT + 1e-9, `${id} key ${key}`);
  }
});

test('after a release every joint evaluates to the angle the released pose shows', () => {
  const json = armDocument();
  const { editor, service } = poseEditor(json);
  const shown = fkPose(json, new Map(json.joints.map((joint) => [joint.id, { angle: LIMIT }])));
  dragBody(editor, uidPose(editor.model, shown), 'b_b3', { x: -300, y: -200 });
  const released = new Map([...service.holds[0]].map(([uid, transform]) => [editor.model.prop(uid, 'id'), transform]));
  const keys = keysAtPlayhead(editor.model);
  assert.ok(keys.size > 0, 'the drag keyed something');
  for (const joint of json.joints) {
    const evaluated = keys.get(joint.id) ?? LIMIT;
    const seen = box2dAngle(json, joint, released);
    assert.ok(Math.abs(evaluated - seen) < 0.04, `${joint.id} evaluates to ${evaluated}, released ${seen}`);
  }
});
