import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter } from '../lib/ragimporter.js';
import { balanceTorqueSuggestion, motorTorqueSuggestions } from '../lib/motor.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

const STEP = 1 / 60;
const SUBSTEPS = 8;
const PARTS = [
  { id: 'trunk', box: [0.33, 0.33], at: [0, 0.95], angle: 0.6 },
  { id: 'hip', parent: 'trunk', box: [0.43, 0.45], at: [0, 0.82], angle: 0.7, anchor: [0.02, 0.94], limit: 1.57 },
  { id: 'thigh', parent: 'hip', box: [0.21, 0.53], at: [0.12, 0.58], angle: -0.76, anchor: [0.2, 0.75], limit: 0.8 },
  { id: 'shin', parent: 'thigh', box: [0.19, 0.6], at: [0.02, 0.3], angle: 0.73, anchor: [-0.06, 0.42], limit: 1 },
  { id: 'foot', parent: 'shin', box: [0.19, 0.08], at: [0.21, 0.02], angle: 0.6, anchor: [0.22, 0.03], limit: 0.26 },
  { id: 'toe', parent: 'foot', box: [0.15, 0.07], at: [0.06, -0.06], angle: 0, anchor: [0.12, -0.05], limit: 0.78 },
  { id: 'heel', parent: 'shin', box: [0.25, 0.09], at: [0.39, 0.02], angle: -0.64, anchor: [0.3, 0.09], limit: 0.52 },
  { id: 'claw', parent: 'heel', box: [0.22, 0.07], at: [0.51, -0.07], angle: 0, anchor: [0.43, -0.05], limit: 0.78 },
  { id: 'tail1', parent: 'trunk', box: [0.47, 0.25], at: [-0.29, 0.92], angle: 0, anchor: [-0.17, 1], limit: 0.52 },
  { id: 'tail2', parent: 'tail1', box: [0.47, 0.23], at: [-0.7, 0.96], angle: -0.16, anchor: [-0.51, 0.93], limit: 0.52 },
  { id: 'tail3', parent: 'tail2', box: [0.48, 0.23], at: [-1.11, 1.11], angle: -0.5, anchor: [-0.92, 1], limit: 0.52 },
  { id: 'neck', parent: 'trunk', box: [0.32, 0.41], at: [0.17, 1.21], angle: -0.48, anchor: [0.08, 1.09], limit: 0.52 },
  { id: 'head', parent: 'neck', circle: 0.3, at: [0.39, 1.34], anchor: [0.33, 1.31], limit: 0.52 },
  { id: 'jaw', parent: 'head', box: [0.37, 0.22], at: [0.7, 1.43], angle: -0.32, anchor: [0.59, 1.43], limit: 0.26 },
  { id: 'arm', parent: 'head', box: [0.08, 0.15], at: [0.63, 1.08], angle: 0.57, anchor: [0.52, 1.15], limit: 1.57 },
  { id: 'hand', parent: 'arm', box: [0.06, 0.13], at: [0.68, 1.02], angle: 1.23, anchor: [0.59, 1.06], limit: 0.78 },
  { id: 'finger', parent: 'hand', circle: 0.044, at: [0.7, 0.98], anchor: [0.68, 1.01], limit: 0.78 },
];

class Container {
  constructor() {
    this.parent = null;
  }

  destroy() {}
}

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function fixtureOf(part) {
  const shape = part.circle === undefined
    ? { type: 'box', center: [0, 0], width: part.box[0], height: part.box[1], angle: 0 }
    : { type: 'circle', center: [0, 0], radius: part.circle };
  return {
    id: `f_${part.id}`,
    name: part.id,
    shape,
    density: 1,
    friction: 0.6,
    restitution: 0,
    isSensor: false,
    selfCollide: false,
    filter: { categoryBits: 1, maskBits: 65535 },
    sprite: null,
    editor: { color: '#8c9eb5' },
  };
}

function lightCreature(motor) {
  return {
    format: 'ragassembler',
    version: 2,
    meta: { name: 'creature', editorVersion: '0.9.0' },
    units: { pixelsPerMeter: 32 },
    preview: { gravity: [0, -10] },
    ragdoll: { id: 'root', name: 'creature', position: [0, 0], angle: 0, rootBody: 'b_trunk', channels: { strength: 1, gain: 1, damping: 1 }, balance: { enabled: false, maxTorque: 80, gain: 10, damping: 0.5, maxSpeed: 20 } },
    sprites: [],
    bodies: PARTS.map((part) => ({
      id: `b_${part.id}`,
      name: part.id,
      position: part.at,
      angle: part.angle ?? 0,
      linearDamping: 0,
      angularDamping: 0,
      fixedRotation: false,
      bullet: false,
      fixtures: [fixtureOf(part)],
    })),
    joints: PARTS.filter((part) => part.parent !== undefined).map((part) => ({
      id: `j_${part.id}`,
      name: part.id,
      type: 'revolute',
      bodyA: `b_${part.parent}`,
      bodyB: `b_${part.id}`,
      anchor: part.anchor,
      collideConnected: false,
      limits: { enabled: true, lower: -part.limit, upper: part.limit },
      motor: { ...motor },
      aimAxis: 0,
    })),
    clips: [],
  };
}

function fitMotorTorque(json) {
  const suggestions = motorTorqueSuggestions(json);
  for (const joint of json.joints) joint.motor.maxTorque = suggestions.get(joint.id);
  return suggestions;
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

function frame(rag, world, substeps) {
  for (let i = 0; i < substeps; i++) {
    rag.update(STEP / substeps);
    world.Step(STEP / substeps, 8, 3);
  }
}

function peakKineticEnergy(motor, seconds, fit = false, substeps = SUBSTEPS) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const world = groundWorld();
  const json = lightCreature(motor);
  if (fit) fitMotorTorque(json);
  const rag = RagImporter.parse(json).spawn(world, { x: 0, y: 0.1 });
  let peak = 0;
  try {
    for (let i = 0; i < seconds / STEP; i++) {
      frame(rag, world, substeps);
      if (i * STEP < seconds / 2) continue;
      let energy = 0;
      for (const body of rag.bodies.values()) {
        const velocity = body.GetLinearVelocity();
        const speed2 = velocity.get_x() ** 2 + velocity.get_y() ** 2;
        energy += 0.5 * body.GetMass() * speed2 + 0.5 * body.GetInertia() * body.GetAngularVelocity() ** 2;
      }
      peak = Math.max(peak, energy);
    }
    return peak;
  } finally {
    rag.destroy();
    Box2D.destroy(world);
  }
}

test('a light creature resting on the ground settles when motor torque matches its inertia', () => {
  const peak = peakKineticEnergy({ maxTorque: 1, gain: 10, damping: 0.5, maxSpeed: 20 }, 8);
  assert.ok(peak < 0.05, `peak kinetic energy ${peak} J`);
});

test('a light creature held at rest by zero-gain motors stays still at the default torque', () => {
  const peak = peakKineticEnergy({ maxTorque: 80, gain: 0, damping: 0.5, maxSpeed: 20 }, 8);
  assert.ok(peak < 0.05, `peak kinetic energy ${peak} J`);
});

test('the suggested torque of the light creature matches the DESIGN §3.1 examples', () => {
  const suggestions = fitMotorTorque(lightCreature({ maxTorque: 80, gain: 10, damping: 0.5, maxSpeed: 20 }));
  assert.equal(suggestions.get('j_finger'), 2.4);
  assert.equal(suggestions.get('j_hip'), 53);
  assert.ok([...suggestions.values()].every((value) => typeof value === 'number' && value >= 0.001));
});

test('a light creature resting on the ground settles with every joint at its suggested torque', () => {
  const peak = peakKineticEnergy({ maxTorque: 80, gain: 10, damping: 0.5, maxSpeed: 20 }, 8, true);
  assert.ok(peak < 0.05, `peak kinetic energy ${peak} J`);
});

test('without substeps the suggested torques make the light creature gain energy (why the editor steps 8 substeps)', () => {
  const peak = peakKineticEnergy({ maxTorque: 80, gain: 10, damping: 0.5, maxSpeed: 20 }, 8, true, 1);
  assert.ok(peak > 0.5, `peak kinetic energy ${peak} J`);
});

function balancedTilt(seconds) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const world = groundWorld();
  const json = lightCreature({ maxTorque: 80, gain: 10, damping: 0.5, maxSpeed: 20 });
  fitMotorTorque(json);
  json.ragdoll.balance = { enabled: true, maxTorque: balanceTorqueSuggestion(json), gain: 10, damping: 0.5, maxSpeed: 20 };
  const rag = RagImporter.parse(json).spawn(world, { x: 0, y: 0.1 });
  const root = rag.bodies.get('b_trunk');
  const goal = root.GetAngle();
  let late = 0;
  let flips = 0;
  let previous = 0;
  try {
    for (let i = 0; i < seconds / STEP; i++) {
      frame(rag, world, SUBSTEPS);
      if (i * STEP < seconds / 2) continue;
      late =Math.max(late, Math.abs(root.GetAngle() - goal) * 180 / Math.PI);
      const omega = root.GetAngularVelocity();
      if (Math.abs(omega) > 0.05 && Math.sign(omega) !== Math.sign(previous)) flips++;
      previous = omega;
    }
    return { late, flips };
  } finally {
    rag.destroy();
    Box2D.destroy(world);
  }
}

test('a light creature with the suggested balance torque holds rootBody within 5° without chatter', () => {
  const { late, flips } = balancedTilt(10);
  assert.ok(late < 5 && flips < 10, `last 5 s ${late}°, ${flips} sign flips`);
});