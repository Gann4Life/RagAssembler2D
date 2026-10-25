import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter, STEP_SETTINGS, stepWorld } from '../lib/ragimporter.js';
import { composeTransforms, invertTransform } from '../lib/geometry.js';
import { SIMULATE_WORLD, createSimulateSession } from '../js/physics/simulate-session.js';
import { CLIP_SIMULATION } from '../js/physics/clip-simulation.js';
import { SIMULATE_STEP } from '../js/timeline-player.js';
import { addHoldClip, bipedRig, fitTorque, humanoidRig } from './helpers/rigs.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

const FRAMES = 300;

class Container {
  constructor() {
    this.children = [];
    this.parent = null;
    this.sortableChildren = false;
  }

  addChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children.splice(this.children.indexOf(child), 1);
    child.parent = null;
    return child;
  }

  destroy() {}
}

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function configure() {
  RagImporter.configure({ Box2D, PIXI: { Container } });
}

function rig(make, root) {
  const { json, pose } = make();
  fitTorque(json);
  json.ragdoll.position = [root.x, root.y];
  json.ragdoll.angle = root.angle;
  const clip = addHoldClip(json, pose, 1);
  return { json, clip };
}

function editorRun(json, clip, frames) {
  configure();
  const session = createSimulateSession(Box2D, json, { clip });
  try {
    for (let i = 0; i < frames; i++) session.step(SIMULATE_STEP);
    return session.pose();
  } finally {
    session.destroy();
  }
}

function lowestBounds(rag) {
  let lowest = Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const body of rag.bodies.values()) {
    for (let fixture = body.GetFixtureList(); Box2D.getPointer(fixture) !== 0; fixture = fixture.GetNext()) {
      const aabb = fixture.GetAABB(0);
      lowest = Math.min(lowest, aabb.get_lowerBound().get_y());
      left = Math.min(left, aabb.get_lowerBound().get_x());
      right = Math.max(right, aabb.get_upperBound().get_x());
    }
  }
  return { top: lowest, centerX: (left + right) / 2 };
}

function hostRun(json, clip, frames) {
  configure();
  const root = { x: json.ragdoll.position[0], y: json.ragdoll.position[1], angle: json.ragdoll.angle };
  const gravity = new Box2D.b2Vec2(...json.preview.gravity);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const rag = RagImporter.parse(json).spawn(world, { x: root.x, y: root.y, angle: root.angle, flipX: false });
  const { top, centerX } = lowestBounds(rag);
  const groundDef = new Box2D.b2BodyDef();
  const ground = world.CreateBody(groundDef);
  Box2D.destroy(groundDef);
  const shape = new Box2D.b2PolygonShape();
  const center = new Box2D.b2Vec2(centerX, top - SIMULATE_WORLD.halfHeight);
  shape.SetAsBox(SIMULATE_WORLD.halfWidth, SIMULATE_WORLD.halfHeight, center, 0);
  ground.CreateFixture(shape, 0).SetFriction(SIMULATE_WORLD.friction);
  Box2D.destroy(center);
  Box2D.destroy(shape);
  rag.play(clip, { restart: true });
  try {
    for (let i = 0; i < frames; i++) stepWorld(world, [rag]);
    const toRoot = invertTransform(root);
    const pose = new Map();
    for (const [id, body] of rag.bodies) {
      const position = body.GetPosition();
      pose.set(id, composeTransforms(toRoot, { x: position.get_x(), y: position.get_y(), angle: body.GetAngle() }));
    }
    return pose;
  } finally {
    rag.destroy();
    world.DestroyBody(ground);
    Box2D.destroy(world);
  }
}

function fakeWorld(calls) {
  return { Step: (dt, velocityIterations, positionIterations) => calls.push(['Step', dt, velocityIterations, positionIterations]) };
}

function fakeRag(name, calls) {
  return { update: (dt) => calls.push([name, dt]) };
}

test('STEP_SETTINGS holds the editor stepping and is frozen', () => {
  assert.deepEqual({ ...STEP_SETTINGS }, { dt: 1 / 60, substeps: 8, velocityIterations: 8, positionIterations: 3 });
  assert.equal(Object.isFrozen(STEP_SETTINGS), true);
});

test('the editor step constants come from STEP_SETTINGS', () => {
  assert.equal(SIMULATE_STEP, STEP_SETTINGS.dt);
  assert.equal(CLIP_SIMULATION.step, STEP_SETTINGS.dt);
});

test('stepWorld updates every instance in order before each of the substeps', () => {
  const calls = [];
  stepWorld(fakeWorld(calls), [fakeRag('a', calls), fakeRag('b', calls)], 0.08);
  const substep = 0.08 / 8;
  const expected = [];
  for (let i = 0; i < 8; i++) expected.push(['a', substep], ['b', substep], ['Step', substep, 8, 3]);
  assert.deepEqual(calls, expected);
});

test('stepWorld updates the instances of a one-shot iterator in every substep', () => {
  const calls = [];
  const ragA = fakeRag('a', calls);
  const ragB = fakeRag('b', calls);
  stepWorld(fakeWorld(calls), (function* () {
    yield ragA;
    yield ragB;
  })(), 0.08);
  assert.equal(calls.filter(([name]) => name === 'a').length, 8);
  assert.equal(calls.filter(([name]) => name === 'b').length, 8);
});

test('stepWorld defaults to one STEP_SETTINGS.dt frame and no instances', () => {
  const calls = [];
  stepWorld(fakeWorld(calls));
  assert.deepEqual(calls, Array.from({ length: 8 }, () => ['Step', STEP_SETTINGS.dt / 8, 8, 3]));
});

test('stepWorld rejects a world without Step, non-iterable instances and a bad dt', () => {
  assert.throws(() => stepWorld({}, []), TypeError);
  assert.throws(() => stepWorld(null), TypeError);
  assert.throws(() => stepWorld(fakeWorld([]), fakeRag('a', [])), TypeError);
  for (const dt of [-1, Number.NaN, Infinity, '1']) assert.throws(() => stepWorld(fakeWorld([]), [], dt), TypeError);
});

for (const [name, make, root] of [
  ['biped', bipedRig, { x: 0.5, y: 0, angle: 0 }],
  ['humanoid', humanoidRig, { x: -1.2, y: 0.3, angle: 0.05 }],
]) {
  test(`the ${name} gives identical body transforms in the editor and through stepWorld after ${FRAMES} frames`, () => {
    const { json, clip } = rig(make, root);
    const editor = editorRun(json, clip, FRAMES);
    const host = hostRun(json, clip, FRAMES);
    assert.deepEqual([...host.keys()], [...editor.keys()]);
    for (const [id, transform] of editor) assert.deepEqual(host.get(id), transform, id);
  });

  test(`the ${name} gives identical body transforms on two host runs`, () => {
    const { json, clip } = rig(make, root);
    assert.deepEqual(hostRun(json, clip, FRAMES), hostRun(json, clip, FRAMES));
  });
}
