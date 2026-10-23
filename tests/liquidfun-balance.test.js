import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { RagImporter } from '../lib/ragimporter.js';
import { shapeBounds } from '../lib/geometry.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

const STEP = 1 / 60;
const DEGREE = Math.PI / 180;

class Container {
  constructor() {
    this.parent = null;
  }

  destroy() {}
}

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function sample() {
  return JSON.parse(readFileSync(new URL('../demo/assets/sample.rag.json', import.meta.url), 'utf8'));
}

function lowestPoint(json) {
  let lowest = Infinity;
  for (const body of json.bodies) {
    const frame = { x: body.position[0], y: body.position[1], angle: body.angle };
    for (const fixture of body.fixtures) lowest = Math.min(lowest, shapeBounds(fixture.shape, frame).minY);
  }
  return lowest;
}

function groundWorld() {
  const gravity = new Box2D.b2Vec2(0, -10);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const groundDef = new Box2D.b2BodyDef();
  const ground = world.CreateBody(groundDef);
  Box2D.destroy(groundDef);
  const box = new Box2D.b2PolygonShape();
  const center = new Box2D.b2Vec2(0, -0.25);
  box.SetAsBox(40, 0.25, center, 0);
  ground.CreateFixture(box, 0);
  Box2D.destroy(center);
  Box2D.destroy(box);
  return world;
}

function bodyAngleClip(value) {
  return {
    key: 'tilt',
    name: 'tilt',
    loop: false,
    hold: true,
    layer: 0,
    blend: 'override',
    length: 1,
    fadeIn: 0,
    fadeOut: 0,
    speed: 1,
    tracks: [{ target: 'root', channel: 'bodyAngle', keys: [{ t: 0, v: value, interp: 'linear' }] }],
    events: [],
  };
}

function standingRun({ balance = true, strength = 1, target = 0, push = 0, seconds = 10 } = {}) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const json = sample();
  json.clips.push(bodyAngleClip(target));
  const world = groundWorld();
  const rag = RagImporter.parse(json).spawn(world, { x: 0, y: 0.01 - lowestPoint(json) });
  const root = rag.bodies.get(json.ragdoll.rootBody);
  const goal = root.GetAngle() + target;
  rag.setBalance(balance);
  rag.setStrength(strength);
  rag.play('tilt');
  let peak = 0;
  let late = 0;
  let flips = 0;
  let previous = 0;
  try {
    for (let i = 0; i < seconds / STEP; i++) {
      if (i === 30 && push !== 0) root.SetAngularVelocity(push);
      rag.update(STEP);
      world.Step(STEP, 8, 3);
      const error = Math.abs(root.GetAngle() - goal);
      peak = Math.max(peak, error);
      if (i * STEP < seconds / 2) continue;
      late = Math.max(late, error);
      const omega = root.GetAngularVelocity();
      if (Math.abs(omega) > 0.05 && Math.sign(omega) !== Math.sign(previous)) flips++;
      previous = omega;
    }
    return { peak: peak / DEGREE, late: late / DEGREE, flips };
  } finally {
    rag.destroy();
    Box2D.destroy(world);
  }
}

test('b2Body exposes ApplyTorque(torque, wake), a continuous GetAngle and GetAngularVelocity', () => {
  const gravity = new Box2D.b2Vec2(0, 0);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const bodyDef = new Box2D.b2BodyDef();
  bodyDef.set_type(Box2D.b2_dynamicBody);
  const body = world.CreateBody(bodyDef);
  Box2D.destroy(bodyDef);
  const box = new Box2D.b2PolygonShape();
  box.SetAsBox(0.25, 0.25);
  body.CreateFixture(box, 4);
  Box2D.destroy(box);
  try {
    assert.equal(Box2D.b2Body.prototype.ApplyTorque.length, 2);
    const inertia = body.GetInertia();
    body.ApplyTorque(6, true);
    world.Step(STEP, 8, 3);
    assert.equal(typeof body.GetAngularVelocity(), 'number');
    assert.ok(Math.abs(body.GetAngularVelocity() - (6 * STEP) / inertia) < 1e-4);
    body.SetAngularVelocity(30);
    for (let i = 0; i < 60; i++) world.Step(STEP, 8, 3);
    assert.ok(body.GetAngle() > 2 * Math.PI, `angle ${body.GetAngle()}`);
  } finally {
    Box2D.destroy(world);
  }
});

test('the sample stickman keeps rootBody upright after a 3 rad/s push with balance on', () => {
  const on = standingRun({ push: 3 });
  assert.ok(on.peak < 3, `peak ${on.peak}°`);
  assert.ok(on.late < 0.2, `last 5 s ${on.late}°`);
  assert.ok(on.flips < 5, `sign flips ${on.flips}`);
  const off = standingRun({ push: 3, balance: false });
  assert.ok(off.late > on.late, `off ${off.late}° vs on ${on.late}°`);
});

test('the sample stickman holds at root strength 0.3', () => {
  const loose = standingRun({ push: 3, strength: 0.3 });
  assert.ok(loose.late < 0.5, `last 5 s ${loose.late}°`);
  assert.ok(loose.flips < 5, `sign flips ${loose.flips}`);
});

test('the sample stickman follows a keyed 90° bodyAngle', () => {
  const tilted = standingRun({ target: Math.PI / 2 });
  assert.ok(tilted.late < 1, `last 5 s ${tilted.late}°`);
  assert.ok(tilted.flips < 5, `sign flips ${tilted.flips}`);
});
