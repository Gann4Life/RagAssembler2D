import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter, RagFormatError } from '../lib/ragimporter.js';
import { composeTransforms, shapeBounds } from '../lib/geometry.js';
import { SIMULATE_WORLD, createSimulateSession } from '../js/physics/simulate-session.js';
import { SIMULATE_STEP } from '../js/timeline-player.js';
import { ragFile } from './helpers/rag-file.js';
import { addHoldClip, bipedRig, fitTorque, humanoidRig } from './helpers/rigs.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

const TOLERANCE = 1e-5;

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

function start(json, clip = null) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  return createSimulateSession(Box2D, json, { clip });
}

function heapProbe() {
  const probe = new Box2D.b2Vec2(0, 0);
  const pointer = Box2D.getPointer(probe);
  Box2D.destroy(probe);
  return pointer;
}

function root(json) {
  return { x: json.ragdoll.position[0], y: json.ragdoll.position[1], angle: json.ragdoll.angle };
}

function worldY(json, transform) {
  return composeTransforms(root(json), transform).y;
}

function run(session, seconds) {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += SIMULATE_STEP) session.step(SIMULATE_STEP);
}

test('SIMULATE_WORLD holds the environment constants and is frozen', () => {
  assert.deepEqual({ ...SIMULATE_WORLD }, { gravity: -10, halfWidth: 50, halfHeight: 0.5, friction: 0.8 });
  assert.equal(Object.isFrozen(SIMULATE_WORLD), true);
});

test('the session starts in rest pose, root-local, by body id', () => {
  const json = ragFile();
  const session = start(json);
  try {
    const pose = session.pose();
    assert.deepEqual([...pose.keys()], json.bodies.map((body) => body.id));
    for (const body of json.bodies) {
      const transform = pose.get(body.id);
      assert.ok(Math.abs(transform.x - body.position[0]) < TOLERANCE, `${body.id} x`);
      assert.ok(Math.abs(transform.y - body.position[1]) < TOLERANCE, `${body.id} y`);
      assert.ok(Math.abs(transform.angle - body.angle) < TOLERANCE, `${body.id} angle`);
    }
  } finally {
    session.destroy();
  }
});

test('gravity pulls a limp ragdoll down and the ground under its rest pose stops it', () => {
  const json = ragFile();
  json.ragdoll.channels.strength = 0;
  const session = start(json);
  try {
    const restY = worldY(json, session.pose().get('b_torso'));
    run(session, 0.25);
    const fallingY = worldY(json, session.pose().get('b_torso'));
    assert.ok(fallingY < restY, `torso did not fall: ${fallingY} >= ${restY}`);
    run(session, 3);
    const settledY = worldY(json, session.pose().get('b_torso'));
    assert.ok(restY - settledY < 1, `torso fell through the ground: ${restY} -> ${settledY}`);
    for (const transform of session.pose().values()) {
      assert.ok(Number.isFinite(transform.x) && Number.isFinite(transform.y) && Number.isFinite(transform.angle));
    }
  } finally {
    session.destroy();
  }
});

function lowestOf(json, pose) {
  let lowest = Infinity;
  for (const body of json.bodies) {
    for (const entry of body.fixtures) lowest = Math.min(lowest, shapeBounds(entry.shape, pose.get(body.id)).minY);
  }
  return lowest;
}

test('a posed spawn stands on the rest pose ground: its lowest point is moved to the rest lowest point', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  for (const [pose, label] of [[new Map([['j_shinL', 1.2], ['j_shinR', 1.2]]), 'raised'], [new Map([['j_footR', 0.8]]), 'lowered']]) {
    const { json } = humanoidRig();
    json.ragdoll.position = [3, 2];
    addHoldClip(json, pose, 1);
    json.clips[0].tracks.forEach((track) => track.keys.shift());
    const rest = createSimulateSession(Box2D, json, { clip: 'hold' });
    const restLowest = lowestOf(json, rest.pose());
    rest.destroy();
    const before = heapProbe();
    const posed = createSimulateSession(Box2D, json, { clip: 'hold', pose: 'hold' });
    try {
      const spawned = posed.pose();
      assert.ok(Math.abs(lowestOf(json, spawned) - restLowest) < 0.02, `${label}: ${lowestOf(json, spawned)} vs ${restLowest}`);
      assert.ok(Math.abs(spawned.get('b_shinR').angle - spawned.get('b_thighR').angle - (pose.get('j_shinR') ?? 0)) < TOLERANCE);
    } finally {
      posed.destroy();
    }
    assert.equal(heapProbe(), before);
  }
});

test('a non-looping clip shows its keyed pose at step 0 and a clip without keys starts at rest', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const { json } = humanoidRig();
  addHoldClip(json, new Map([['j_shinR', 1.2]]), 1);
  json.clips[0].tracks[0].keys = [{ t: 0, v: 1.2, interp: 'linear' }];
  assert.equal(json.clips[0].loop, false);
  const keyed = createSimulateSession(Box2D, json, { clip: 'hold', pose: 'hold' });
  try {
    const spawned = keyed.pose();
    assert.ok(Math.abs(spawned.get('b_shinR').angle - spawned.get('b_thighR').angle - 1.2) < TOLERANCE);
  } finally {
    keyed.destroy();
  }
  json.clips[0].tracks = [];
  const empty = createSimulateSession(Box2D, json, { clip: 'hold', pose: 'hold' });
  const rest = createSimulateSession(Box2D, json, { clip: 'hold' });
  try {
    for (const [id, transform] of rest.pose()) {
      const spawned = empty.pose().get(id);
      assert.ok(Math.abs(spawned.x - transform.x) < TOLERANCE && Math.abs(spawned.y - transform.y) < TOLERANCE, id);
      assert.ok(Math.abs(spawned.angle - transform.angle) < TOLERANCE, id);
    }
  } finally {
    empty.destroy();
    rest.destroy();
  }
});

test('a humanoid holding a pose on one foot stands still instead of hopping', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const { json, pose } = humanoidRig();
  fitTorque(json);
  addHoldClip(json, pose, 1);
  const session = createSimulateSession(Box2D, json, { clip: 'hold' });
  try {
    run(session, 4);
    const heights = [];
    for (let i = 0; i < 120; i++) {
      session.step(SIMULATE_STEP);
      heights.push(session.pose().get('b_pelvis').y);
    }
    const range = Math.max(...heights) - Math.min(...heights);
    assert.ok(range < 0.003, `pelvis height range ${range} m`);
  } finally {
    session.destroy();
  }
});

test('a light-hub biped on 20 g thighs holds a bent-knee pose within 1° (substeps make its motor chains converge)', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const { json, pose } = bipedRig();
  fitTorque(json);
  addHoldClip(json, pose, 1);
  const session = createSimulateSession(Box2D, json, { clip: 'hold' });
  const rest = new Map(json.bodies.map((body) => [body.id, body.angle]));
  let worst = 0;
  try {
    run(session, 3);
    for (let i = 0; i < 120; i++) {
      session.step(SIMULATE_STEP);
      const bodies = session.pose();
      for (const joint of json.joints) {
        const angle = bodies.get(joint.bodyB).angle - bodies.get(joint.bodyA).angle - (rest.get(joint.bodyB) - rest.get(joint.bodyA));
        worst = Math.max(worst, Math.abs(angle - (pose.get(joint.id) ?? 0)) * 180 / Math.PI);
      }
    }
  } finally {
    session.destroy();
  }
  assert.ok(worst < 1, `largest joint error ${worst.toFixed(2)}°`);
});

test('the open clip plays on the instance and an unknown clip key releases everything', () => {
  const json = ragFile();
  const session = start(json, 'walk');
  run(session, 0.5);
  session.destroy();
  const before = heapProbe();
  assert.throws(() => start(json, 'missing'), /unknown clip "missing"/);
  assert.equal(heapProbe(), before);
});

test('destroy releases every native object, is idempotent and ends the session', () => {
  const json = ragFile();
  const warm = start(json);
  warm.destroy();
  const before = heapProbe();
  const session = start(json, 'walk');
  run(session, 0.1);
  session.destroy();
  session.destroy();
  assert.equal(heapProbe(), before);
  assert.throws(() => session.step(SIMULATE_STEP), /destroyed/);
  assert.throws(() => session.pose(), /destroyed/);
});

test('an invalid document throws RagFormatError before anything native is created', () => {
  const json = ragFile();
  json.ragdoll.rootBody = 'b_missing';
  const before = heapProbe();
  assert.throws(() => start(json), RagFormatError);
  assert.equal(heapProbe(), before);
});
