import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter, STEP_SETTINGS, stepWorld } from '../lib/ragimporter.js';
import { shapeBounds } from '../lib/geometry.js';
import { bipedRig, fitTorque } from './helpers/rigs.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

const RAD = Math.PI / 180;
const SETTLE = 1;
const SECONDS = 6;
const LEGS = ['b_thighL', 'b_shinL', 'b_footL', 'b_thighR', 'b_shinR', 'b_footR'];
const KEY_TIMES = [0, 0.2, 0.4, 0.6, 0.8];
const HIP = [20, 30, 45, 15, 25];
const KNEE = [-10, -20, -70, -35, 5];
const ANKLE = [0, -5, -30, -15, -40];

class Container {
  constructor() {
    this.parent = null;
  }

  destroy() {}
}

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function track(target, degrees, phase) {
  const shifted = [...degrees.slice(phase), ...degrees.slice(0, phase)];
  return { target, channel: 'angle', keys: KEY_TIMES.map((t, i) => ({ t, v: shifted[i] * RAD, interp: 'linear' })) };
}

function walkingBiped() {
  const { json } = bipedRig();
  fitTorque(json);
  const tracks = [];
  for (const [side, phase] of [['L', 0], ['R', 2]]) {
    tracks.push(track(`j_thigh${side}`, HIP, phase), track(`j_shin${side}`, KNEE, phase), track(`j_foot${side}`, ANKLE, phase));
  }
  json.clips = [{ key: 'walk', name: 'walk', loop: true, hold: false, layer: 0, blend: 'override', length: 1, fadeIn: 0, fadeOut: 0, speed: 1, tracks, events: [] }];
  return json;
}

function groundTop(json) {
  let lowest = Infinity;
  for (const body of json.bodies) {
    const frame = { x: body.position[0], y: body.position[1], angle: body.angle };
    for (const entry of body.fixtures) lowest = Math.min(lowest, shapeBounds(entry.shape, frame).minY);
  }
  return lowest;
}

function legJitter(json) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const gravity = new Box2D.b2Vec2(0, -10);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const groundDef = new Box2D.b2BodyDef();
  const ground = world.CreateBody(groundDef);
  Box2D.destroy(groundDef);
  const shape = new Box2D.b2PolygonShape();
  const center = new Box2D.b2Vec2(0, groundTop(json) - 0.5);
  shape.SetAsBox(50, 0.5, center, 0);
  ground.CreateFixture(shape, 0).SetFriction(0.8);
  Box2D.destroy(center);
  Box2D.destroy(shape);
  const rag = RagImporter.parse(json).spawn(world, { x: 0, y: 0 });
  rag.play('walk');
  const spins = LEGS.map(() => []);
  try {
    for (let i = 0; i < Math.round(SECONDS / STEP_SETTINGS.dt); i++) {
      stepWorld(world, [rag]);
      if (i < Math.round(SETTLE / STEP_SETTINGS.dt)) continue;
      LEGS.forEach((id, k) => spins[k].push(rag.bodies.get(id).GetAngularVelocity()));
    }
  } finally {
    rag.destroy();
    world.DestroyBody(ground);
    Box2D.destroy(world);
  }
  let squares = 0;
  let samples = 0;
  for (const omega of spins) {
    for (let i = 1; i < omega.length - 1; i++) {
      squares += (omega[i] - (omega[i - 1] + omega[i + 1]) / 2) ** 2;
      samples++;
    }
  }
  return Math.sqrt(squares / samples);
}

test('a light-legged biped walking on linear keys moves its legs without frame-to-frame jitter', () => {
  const jitter = legJitter(walkingBiped());
  assert.ok(jitter < 1, `high-frequency leg angular velocity ${jitter} rad/s RMS`);
});
