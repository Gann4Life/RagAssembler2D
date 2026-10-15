import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

const liveWorlds = [];

afterEach(() => {
  for (const world of liveWorlds.splice(0)) {
    world.SetContactFilter(null);
    Box2D.destroy(world);
  }
});

function createWorld(filter, gravityY = 0) {
  const gravity = new Box2D.b2Vec2(0, gravityY);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  if (filter) world.SetContactFilter(filter);
  liveWorlds.push(world);
  return world;
}

function addBox(world, x, y, options = {}) {
  const bodyDef = new Box2D.b2BodyDef();
  bodyDef.set_type(options.type ?? Box2D.b2_dynamicBody);
  const position = new Box2D.b2Vec2(x, y);
  bodyDef.set_position(position);
  const body = world.CreateBody(bodyDef);
  const shape = new Box2D.b2PolygonShape();
  shape.SetAsBox(0.5, 0.5);
  const fixture = body.CreateFixture(shape, 1);
  Box2D.destroy(shape);
  Box2D.destroy(position);
  Box2D.destroy(bodyDef);
  if (options.filter) setFilter(fixture, options.filter);
  if (options.userData !== undefined) fixture.SetUserData(options.userData);
  return fixture;
}

function setFilter(fixture, { categoryBits = 1, maskBits = 0xffff, groupIndex = 0 }) {
  const filter = new Box2D.b2Filter();
  filter.set_categoryBits(categoryBits);
  filter.set_maskBits(maskBits);
  filter.set_groupIndex(groupIndex);
  fixture.SetFilterData(filter);
  Box2D.destroy(filter);
}

function overlappingPairContacts(filter, optionsA, optionsB) {
  const world = createWorld(filter);
  addBox(world, 0, 0, optionsA);
  addBox(world, 0.3, 0, optionsB);
  world.Step(1 / 60, 8, 3);
  return world.GetContactCount();
}

function createCountingFilter(decide) {
  const filter = new Box2D.JSContactFilter();
  filter.calls = 0;
  filter.ShouldCollide = (pointerA, pointerB) => {
    filter.calls++;
    return decide(pointerA, pointerB);
  };
  return filter;
}

function shouldCollideLikeBox2D(fixtureA, fixtureB) {
  const a = fixtureA.GetFilterData();
  const b = fixtureB.GetFilterData();
  const groupA = a.get_groupIndex();
  if (groupA === b.get_groupIndex() && groupA !== 0) return groupA > 0;
  const maskA = a.get_maskBits() & 0xffff;
  const maskB = b.get_maskBits() & 0xffff;
  const categoryA = a.get_categoryBits() & 0xffff;
  const categoryB = b.get_categoryBits() & 0xffff;
  return (maskA & categoryB) !== 0 && (maskB & categoryA) !== 0;
}

function createRagImporterStyleFilter(registry) {
  return createCountingFilter((pointerA, pointerB) => {
    const fixtureA = Box2D.wrapPointer(pointerA, Box2D.b2Fixture);
    const fixtureB = Box2D.wrapPointer(pointerB, Box2D.b2Fixture);
    if (!shouldCollideLikeBox2D(fixtureA, fixtureB)) return false;
    const shapeA = registry.get(pointerA);
    const shapeB = registry.get(pointerB);
    if (!shapeA || !shapeB || shapeA.instanceId !== shapeB.instanceId) return true;
    return shapeA.selfCollide && shapeB.selfCollide;
  });
}

const EXCLUDING = [
  { filter: { categoryBits: 1, maskBits: 1 } },
  { filter: { categoryBits: 2, maskBits: 2 } },
];
const SAME_NEGATIVE_GROUP = [
  { filter: { groupIndex: -3 } },
  { filter: { groupIndex: -3 } },
];

test('the JS-implementable callback classes are exactly the six JS* classes', () => {
  const names = Object.keys(Box2D).filter((key) => /^JS[A-Z]/.test(key)).sort();
  assert.deepEqual(names, [
    'JSContactFilter',
    'JSContactListener',
    'JSDestructionListener',
    'JSDraw',
    'JSQueryCallback',
    'JSRayCastCallback',
  ]);
  for (const name of names) assert.equal(typeof Box2D[name], 'function', name);
});

test('without a JS filter the default rules exclude by mask and by negative group', () => {
  assert.equal(overlappingPairContacts(null, {}, {}), 1);
  assert.equal(overlappingPairContacts(null, ...EXCLUDING), 0);
  assert.equal(overlappingPairContacts(null, ...SAME_NEGATIVE_GROUP), 0);
});

test('installing a JSContactFilter replaces the default filtering', () => {
  const filter = createCountingFilter(() => true);
  assert.equal(overlappingPairContacts(filter, ...EXCLUDING), 1);
  assert.equal(overlappingPairContacts(filter, ...SAME_NEGATIVE_GROUP), 1);
  assert.ok(filter.calls >= 2);
});

test('a JS reimplementation of b2ContactFilter::ShouldCollide matches the default', () => {
  const cases = [
    [{}, {}],
    EXCLUDING,
    SAME_NEGATIVE_GROUP,
    [{ filter: { groupIndex: 2 } }, { filter: { groupIndex: 2, maskBits: 0 } }],
    [{ filter: { groupIndex: -2 } }, { filter: { groupIndex: 2 } }],
    [{ filter: { categoryBits: 4, maskBits: 0x8000 } }, { filter: { categoryBits: 0x8000, maskBits: 4 } }],
    [{ filter: { categoryBits: 4, maskBits: 0x8000 } }, { filter: { categoryBits: 0x8000, maskBits: 2 } }],
  ];
  const filter = createCountingFilter((pointerA, pointerB) => shouldCollideLikeBox2D(
    Box2D.wrapPointer(pointerA, Box2D.b2Fixture),
    Box2D.wrapPointer(pointerB, Box2D.b2Fixture),
  ));
  for (const [a, b] of cases) {
    assert.equal(overlappingPairContacts(filter, a, b), overlappingPairContacts(null, a, b), JSON.stringify([a, b]));
  }
});

test('the signed 16-bit maskBits caveat breaks the reimplementation without & 0xffff', () => {
  const world = createWorld();
  const fixture = addBox(world, 0, 0, { filter: { categoryBits: 0x8000, maskBits: 0x8000 } });
  const stored = fixture.GetFilterData();
  assert.ok(stored.get_maskBits() < 0);
  assert.equal(stored.get_maskBits() & 0xffff, 0x8000);
});

test('fixture userData round-trips as an integer through GetUserData / SetUserData', () => {
  const world = createWorld();
  const fixture = addBox(world, 0, 0);
  assert.equal(fixture.GetUserData(), 0);
  fixture.SetUserData(42);
  assert.equal(fixture.GetUserData(), 42);
  assert.equal(typeof fixture.GetUserData(), 'number');
  assert.equal(typeof fixture.set_userData, 'undefined');
  assert.equal(typeof Box2D.b2FixtureDef.prototype.set_userData, 'function');
});

test('the fixture pointer is stable and equals what ShouldCollide receives', () => {
  const received = [];
  const filter = createCountingFilter((pointerA, pointerB) => {
    received.push(pointerA, pointerB);
    return true;
  });
  const world = createWorld(filter);
  const a = addBox(world, 0, 0, { userData: 7 });
  const b = addBox(world, 0.3, 0, { userData: 9 });
  const pointerA = Box2D.getPointer(a);
  const pointerB = Box2D.getPointer(b);
  world.Step(1 / 60, 8, 3);

  assert.deepEqual([...received].sort(), [pointerA, pointerB].sort());
  assert.equal(Box2D.getPointer(a.GetBody().GetFixtureList()), pointerA);
  assert.equal(Box2D.wrapPointer(pointerA, Box2D.b2Fixture), a);
  const userData = received.map((pointer) => Box2D.wrapPointer(pointer, Box2D.b2Fixture).GetUserData());
  assert.deepEqual(userData.sort(), [7, 9]);

  for (let i = 0; i < 10; i++) world.Step(1 / 60, 8, 3);
  assert.equal(Box2D.getPointer(a), pointerA);
});

test('per-shape selfCollide through a pointer registry', () => {
  const registry = new Map();
  const filter = createRagImporterStyleFilter(registry);
  const world = createWorld(filter);
  const make = (instanceId, selfCollide) => {
    const fixture = addBox(world, 0, 0);
    registry.set(Box2D.getPointer(fixture), { instanceId, selfCollide });
    return fixture;
  };
  const probe = (a, b) => {
    const pairWorld = createWorld(filter);
    const copy = (source) => {
      const fixture = addBox(pairWorld, source === a ? 0 : 0.3, 0);
      const entry = registry.get(Box2D.getPointer(source));
      if (entry) registry.set(Box2D.getPointer(fixture), entry);
      return fixture;
    };
    copy(a);
    copy(b);
    pairWorld.Step(1 / 60, 8, 3);
    return pairWorld.GetContactCount();
  };

  const instance1Solid = make(1, false);
  const instance1SelfA = make(1, true);
  const instance1SelfB = make(1, true);
  const instance2Solid = make(2, false);
  const host = addBox(world, 0, 0);

  assert.equal(probe(instance1Solid, instance1SelfA), 0);
  assert.equal(probe(instance1SelfA, instance1SelfB), 1);
  assert.equal(probe(instance1Solid, instance2Solid), 1);
  assert.equal(probe(instance1Solid, host), 1);
});

test('registry filter honours default category and group rules for host bodies', () => {
  const registry = new Map();
  const filter = createRagImporterStyleFilter(registry);
  assert.equal(overlappingPairContacts(filter, ...EXCLUDING), 0);
  assert.equal(overlappingPairContacts(filter, ...SAME_NEGATIVE_GROUP), 0);
  assert.equal(overlappingPairContacts(filter, {}, {}), 1);
});

test('b2World has no GetContactFilter, so a host filter cannot be read back', () => {
  const world = createWorld();
  assert.equal(typeof world.GetContactFilter, 'undefined');
  assert.equal(typeof Box2D.b2World.prototype.GetContactFilter, 'undefined');
  const own = Object.getOwnPropertyNames(Box2D.b2World.prototype).filter((name) => /Filter/.test(name));
  assert.deepEqual(own, ['SetContactFilter']);
});

test('SetContactFilter replaces the previously installed filter', () => {
  const host = createCountingFilter(() => true);
  const replacement = createCountingFilter(() => false);
  const world = createWorld(host);
  world.SetContactFilter(replacement);
  addBox(world, 0, 0);
  addBox(world, 0.3, 0);
  world.Step(1 / 60, 8, 3);
  assert.equal(host.calls, 0);
  assert.ok(replacement.calls > 0);
  assert.equal(world.GetContactCount(), 0);
});

test('a host predicate and a RagImporter predicate can be composed in one filter', () => {
  const hostPredicate = (fixtureA, fixtureB) => fixtureA.GetUserData() !== 99 && fixtureB.GetUserData() !== 99;
  const registry = new Map();
  const ragFilter = createRagImporterStyleFilter(registry);
  const composed = createCountingFilter((pointerA, pointerB) => {
    const a = Box2D.wrapPointer(pointerA, Box2D.b2Fixture);
    const b = Box2D.wrapPointer(pointerB, Box2D.b2Fixture);
    return hostPredicate(a, b) && ragFilter.ShouldCollide(pointerA, pointerB);
  });
  assert.equal(overlappingPairContacts(composed, { userData: 99 }, {}), 0);
  assert.equal(overlappingPairContacts(composed, {}, {}), 1);
  assert.equal(overlappingPairContacts(composed, ...EXCLUDING), 0);
});

test('SetContactFilter(null) and SetContactFilter(0) uninstall the JS filter without restoring the default', () => {
  for (const empty of [null, 0]) {
    const filter = createCountingFilter(() => false);
    const world = createWorld(filter);
    world.SetContactFilter(empty);
    addBox(world, 0, 0, EXCLUDING[0]);
    addBox(world, 0.3, 0, EXCLUDING[1]);
    world.Step(1 / 60, 8, 3);
    assert.equal(filter.calls, 0);
    assert.equal(world.GetContactCount(), 1);
  }
});

test('a filter can be uninstalled, destroyed, and the world keeps stepping', () => {
  const filter = createCountingFilter(() => false);
  const world = createWorld(filter);
  world.SetContactFilter(null);
  Box2D.destroy(filter);
  addBox(world, 0, 0);
  addBox(world, 0.3, 0);
  for (let i = 0; i < 10; i++) world.Step(1 / 60, 8, 3);
  assert.equal(world.GetContactCount(), 1);
});

test('one filter instance can serve several worlds and bodies of several instances', () => {
  const filter = createCountingFilter(() => true);
  const first = createWorld(filter);
  const second = createWorld(filter);
  for (const world of [first, second]) {
    addBox(world, 0, 0);
    addBox(world, 0.3, 0);
    world.Step(1 / 60, 8, 3);
    assert.equal(world.GetContactCount(), 1);
  }
  assert.ok(filter.calls >= 2);
});

test('negative groupIndex per instance disables self-collision without a JS filter', () => {
  const world = createWorld();
  const instance1A = addBox(world, 0, 0, { filter: { groupIndex: -1 } });
  const instance1B = addBox(world, 0.3, 0, { filter: { groupIndex: -1 } });
  const instance2 = addBox(world, 0.1, 0.1, { filter: { groupIndex: -2 } });
  const host = addBox(world, 0.2, -0.1);
  world.Step(1 / 60, 8, 3);

  const pairs = new Set();
  for (let contact = world.GetContactList(); Box2D.getPointer(contact) !== 0; contact = contact.GetNext()) {
    const a = Box2D.getPointer(contact.GetFixtureA());
    const b = Box2D.getPointer(contact.GetFixtureB());
    pairs.add([a, b].sort().join('-'));
  }
  const key = (x, y) => [Box2D.getPointer(x), Box2D.getPointer(y)].sort().join('-');
  assert.equal(pairs.has(key(instance1A, instance1B)), false);
  assert.equal(pairs.has(key(instance1A, instance2)), true);
  assert.equal(pairs.has(key(instance1B, instance2)), true);
  assert.equal(pairs.has(key(instance1A, host)), true);
  assert.equal(pairs.has(key(instance2, host)), true);
});

test('performance: 20 stacked humanoids of 10 shapes with the registry filter', (t) => {
  const run = (useFilter) => {
    const registry = new Map();
    const filter = useFilter ? createRagImporterStyleFilter(registry) : null;
    const world = createWorld(filter, -10);
    addBox(world, 0, -1, { type: Box2D.b2_staticBody });
    for (let instance = 0; instance < 20; instance++) {
      for (let shape = 0; shape < 10; shape++) {
        const fixture = addBox(world, instance * 0.15, 0.6 + shape * 0.55);
        registry.set(Box2D.getPointer(fixture), { instanceId: instance, selfCollide: shape % 2 === 0 });
      }
    }
    const start = process.hrtime.bigint();
    for (let step = 0; step < 300; step++) world.Step(1 / 60, 8, 3);
    const milliseconds = Number(process.hrtime.bigint() - start) / 1e6;
    const calls = filter ? filter.calls : 0;
    world.SetContactFilter(null);
    Box2D.destroy(world);
    liveWorlds.splice(liveWorlds.indexOf(world), 1);
    return { milliseconds, calls };
  };

  const baseline = run(false);
  const filtered = run(true);
  t.diagnostic(`baseline ${baseline.milliseconds.toFixed(1)} ms / 300 steps`);
  t.diagnostic(`filtered ${filtered.milliseconds.toFixed(1)} ms / 300 steps, ${filtered.calls} ShouldCollide calls`);
  assert.ok(filtered.calls > 0);
});
