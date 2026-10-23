import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter } from '../lib/ragimporter.js';
import { ragFile } from './helpers/rag-file.js';

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
