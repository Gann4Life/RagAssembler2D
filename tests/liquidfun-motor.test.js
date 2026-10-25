import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter } from '../lib/ragimporter.js';
import { ragFile } from './helpers/rag-file.js';
import { fitTorque, poleRig } from './helpers/rigs.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

class Container {
  constructor() {
    this.parent = null;
  }

  destroy() {}
}

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function withRag(run) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const gravity = new Box2D.b2Vec2(0, 0);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const rag = RagImporter.parse(ragFile()).spawn(world, { x: 1, y: 2 });
  try {
    return run(rag, world);
  } finally {
    rag.destroy();
    Box2D.destroy(world);
  }
}

test('update enables and writes the native revolute motors', () => {
  withRag((rag) => {
    const neck = rag.joint('neck');
    assert.equal(neck.IsMotorEnabled(), 0);
    rag.update(1 / 60);
    for (const joint of rag.joints.values()) {
      assert.equal(joint.IsMotorEnabled(), 1);
      assert.ok(Math.abs(joint.GetMaxMotorTorque() - 80) < 1e-4);
      assert.ok(Math.abs(joint.GetMotorSpeed()) < 1e-6);
    }
    rag.setStrength(0);
    rag.update(1 / 60);
    assert.equal(neck.IsMotorEnabled(), 0);
    assert.equal(neck.GetMaxMotorTorque(), 0);
  });
});

test('a playing clip moves the native joint toward its target angle', () => {
  withRag((rag, world) => {
    rag.play('walk');
    for (let i = 0; i < 120; i++) {
      rag.update(1 / 60);
      world.Step(1 / 60, 8, 3);
    }
    assert.ok(Math.abs(rag.joint('neck').GetJointAngle() - 0.1) < 0.02, `${rag.joint('neck').GetJointAngle()}`);
  });
});

function keyedRun(json, keys, seconds) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const doc = structuredClone(json);
  doc.clips = [{ key: 'move', name: 'move', loop: false, hold: true, layer: 0, blend: 'override', length: keys.at(-1)[0], fadeIn: 0, fadeOut: 0, speed: 1, events: [],
    tracks: [{ target: 'j_pole', channel: 'angle', keys: keys.map(([t, v]) => ({ t, v, interp: 'linear' })) }] }];
  const gravity = new Box2D.b2Vec2(0, 0);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const rag = RagImporter.parse(doc).spawn(world, {});
  const angles = [0];
  try {
    rag.play('move');
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      rag.update(1 / 60);
      world.Step(1 / 60, 16, 3);
      angles.push(rag.joints.get('j_pole').GetJointAngle());
    }
    return angles;
  } finally {
    rag.destroy();
    Box2D.destroy(world);
  }
}

test('a feasible keyed move reaches its keys at their frames at speed, passing them only slightly', () => {
  const { json } = poleRig();
  fitTorque(json);
  const angles = keyedRun(json, [[0, 0], [0.5, 1], [1, 1], [1.25, 0.4], [2, 0.4]], 2.5);
  const degrees = (radians) => (radians * 180) / Math.PI;
  assert.ok(degrees(Math.abs(angles[30] - 1)) < 2.5, `at 0.5 s: ${degrees(angles[30])}°`);
  assert.ok(degrees(Math.abs(angles[75] - 0.4)) < 2.5, `at 1.25 s: ${degrees(angles[75])}°`);
  assert.ok(degrees(Math.max(...angles) - 1) < 3, `above 1 rad by ${degrees(Math.max(...angles) - 1)}°`);
  assert.ok(degrees(0.4 - Math.min(...angles.slice(60))) < 3, `below 0.4 rad by ${degrees(0.4 - Math.min(...angles.slice(60)))}°`);
});