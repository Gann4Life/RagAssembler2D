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

function groups(rag) {
  const result = [];
  for (const body of rag.bodies.values()) {
    for (let f = body.GetFixtureList(); Box2D.getPointer(f) !== 0; f = f.GetNext()) {
      result.push(f.GetFilterData().get_groupIndex());
    }
  }
  return result;
}

test('spawn writes -instanceId on every fixture, smallest unused id first, freed by destroy', () => {
  withWorld((world) => {
    const def = RagImporter.parse(ragFile());
    const a = def.spawn(world);
    const b = def.spawn(world);
    assert.ok(groups(a).length > 0);
    assert.ok(groups(a).every((g) => g === -1));
    assert.ok(groups(b).every((g) => g === -2));
    a.destroy();
    const c = def.spawn(world);
    assert.ok(groups(c).every((g) => g === -1));
    b.destroy();
    c.destroy();
  });
});

test('shapes of one instance do not collide, different instances do', () => {
  withWorld((world) => {
    const def = RagImporter.parse(ragFile());
    const a = def.spawn(world, { x: 0, y: 0 });
    const b = def.spawn(world, { x: 0, y: 0 });
    const contactBodies = new Set();
    world.Step(1 / 60, 8, 3);
    for (let c = world.GetContactList(); Box2D.getPointer(c) !== 0; c = c.GetNext()) {
      const pair = [c.GetFixtureA(), c.GetFixtureB()].map((f) => f.GetFilterData().get_groupIndex());
      contactBodies.add(pair.join(','));
    }
    assert.ok(contactBodies.has('-1,-2') || contactBodies.has('-2,-1'));
    assert.ok(!contactBodies.has('-1,-1'));
    assert.ok(!contactBodies.has('-2,-2'));
    a.destroy();
    b.destroy();
  });
});

test('selfCollide warns once per RagDef', () => {
  withWorld((world) => {
    const json = ragFile();
    json.bodies[0].fixtures[0].selfCollide = true;
    const def = RagImporter.parse(json);
    const original = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args);
    try {
      def.spawn(world).destroy();
      def.spawn(world).destroy();
      RagImporter.parse(ragFile()).spawn(world).destroy();
    } finally {
      console.warn = original;
    }
    assert.equal(calls.length, 1);
  });
});

test('spawn throws at 32767 live instances and destroy frees an id', () => {
  withWorld(() => {
    const filter = new Box2D.b2Filter();
    const fixture = { GetFilterData: () => filter, SetFilterData: () => {} };
    const body = { CreateFixture: () => fixture };
    const world = {
      CreateBody: () => body,
      DestroyBody: () => {},
      DestroyJoint: () => {},
      IsLocked: () => false,
    };
    const json = ragFile();
    json.bodies = json.bodies.slice(0, 1);
    json.bodies[0].fixtures = json.bodies[0].fixtures.slice(0, 1);
    json.joints = [];
    json.ragdoll.rootBody = json.bodies[0].id;
    json.clips = [];
    const def = RagImporter.parse(json);
    const live = [];
    for (let i = 0; i < 32767; i++) live.push(def.spawn(world));
    assert.throws(() => def.spawn(world), /32767/);
    live.pop().destroy();
    live.push(def.spawn(world));
    assert.throws(() => def.spawn(world), /32767/);
    for (const rag of live) rag.destroy();
    def.spawn(world).destroy();
  });
});