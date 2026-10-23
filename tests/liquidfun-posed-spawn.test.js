import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter } from '../lib/ragimporter.js';
import { ragFile } from './helpers/rag-file.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

class Container {
  constructor() {
    this.children = [];
    this.parent = null;
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

function withWorld(run) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const gravity = new Box2D.b2Vec2(0, 0);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  try {
    return run(world);
  } finally {
    Box2D.destroy(world);
  }
}

function posedFile() {
  const json = ragFile();
  json.clips[0].tracks = [
    { target: 'j_neck', channel: 'angle', keys: [{ t: 0, v: 0.15, interp: 'linear' }, { t: 1, v: -0.4, interp: 'linear' }] },
    { target: 'j_shoulder', channel: 'angle', keys: [{ t: 0, v: -0.5, interp: 'linear' }] },
    { target: 'root', channel: 'bodyAngle', keys: [{ t: 0, v: 0.3, interp: 'linear' }] },
  ];
  return json;
}

test('spawn with pose starts every body in the clip pose at time 0, joints at the keyed angles', () => {
  withWorld((world) => {
    const def = RagImporter.parse(posedFile());
    for (const flipX of [false, true]) {
      const rag = def.spawn(world, { x: 1, y: 2, angle: 0.4, flipX, pose: 'walk' });
      try {
        const sign = flipX ? -1 : 1;
        assert.ok(Math.abs(rag.joint('neck').GetJointAngle() - sign * 0.15) < 1e-5, `neck flipX ${flipX}`);
        assert.ok(Math.abs(rag.joint('shoulder').GetJointAngle() + sign * 0.5) < 1e-5, `shoulder flipX ${flipX}`);
        assert.ok(Math.abs(rag.angle - (0.4 + sign * (0.1 + 0.3))) < 1e-5, `root flipX ${flipX}`);
        for (const body of rag.bodies.values()) {
          assert.equal(body.GetLinearVelocity().get_x(), 0);
          assert.equal(body.GetAngularVelocity(), 0);
        }
      } finally {
        rag.destroy();
      }
    }
  });
});

test('spawn without pose, or with null, keeps the rest pose', () => {
  withWorld((world) => {
    const def = RagImporter.parse(posedFile());
    for (const pose of [undefined, null]) {
      const rag = def.spawn(world, { pose });
      try {
        assert.ok(Math.abs(rag.joint('neck').GetJointAngle()) < 1e-6);
        assert.ok(Math.abs(rag.angle - 0.1) < 1e-6);
      } finally {
        rag.destroy();
      }
    }
  });
});

test('an unknown pose key or a non-string pose throws before anything is created', () => {
  withWorld((world) => {
    const def = RagImporter.parse(posedFile());
    assert.throws(() => def.spawn(world, { pose: 'missing' }), /unknown clip "missing"/);
    assert.throws(() => def.spawn(world, { pose: 3 }), TypeError);
    assert.equal(world.GetBodyCount(), 0);
  });
});
