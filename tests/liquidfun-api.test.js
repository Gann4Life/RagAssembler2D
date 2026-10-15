import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

function createWorld() {
  const gravity = new Box2D.b2Vec2(0, -10);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  return world;
}

function createBox(world, x, angle, type = Box2D.b2_dynamicBody) {
  const bodyDef = new Box2D.b2BodyDef();
  bodyDef.set_type(type);
  const position = new Box2D.b2Vec2(x, 0);
  bodyDef.set_position(position);
  bodyDef.set_angle(angle);
  const body = world.CreateBody(bodyDef);
  const shape = new Box2D.b2PolygonShape();
  shape.SetAsBox(0.5, 0.5);
  const fixture = body.CreateFixture(shape, 1);
  Box2D.destroy(shape);
  Box2D.destroy(position);
  Box2D.destroy(bodyDef);
  return { body, fixture };
}

function createRevolute(world, a, b, anchorX) {
  const anchor = new Box2D.b2Vec2(anchorX, 0);
  const jointDef = new Box2D.b2RevoluteJointDef();
  jointDef.Initialize(a.body, b.body, anchor);
  const referenceAngle = jointDef.get_referenceAngle();
  const joint = world.CreateJoint(jointDef);
  Box2D.destroy(jointDef);
  Box2D.destroy(anchor);
  return { joint, referenceAngle };
}

test('the vendored build loads in Node and is the namespace itself', () => {
  assert.equal(typeof Box2D.b2World, 'function');
  assert.equal(Box2D.Box2D, undefined);
  for (const name of ['castObject', 'wrapPointer', 'destroy', 'getPointer', 'compare']) {
    assert.equal(typeof Box2D[name], 'function', name);
  }
});

test('b2RevoluteJointDef.Initialize computes the reference angle at rest', () => {
  const world = createWorld();
  const a = createBox(world, 0, 0.3);
  const b = createBox(world, 1, 1.0);
  const { referenceAngle } = createRevolute(world, a, b, 0.5);
  assert.ok(Math.abs(referenceAngle - 0.7) < 1e-6);
});

test('b2RevoluteJoint exposes motor, limits, angle and speed after castObject', () => {
  const world = createWorld();
  const a = createBox(world, 0, 0);
  const b = createBox(world, 1, 0);
  const { joint } = createRevolute(world, a, b, 0.5);

  assert.equal(joint.EnableMotor, undefined);
  assert.equal(joint.GetType(), Box2D.e_revoluteJoint);

  const revolute = Box2D.castObject(joint, Box2D.b2RevoluteJoint);
  assert.equal(Box2D.getPointer(revolute), Box2D.getPointer(joint));
  assert.equal(Box2D.wrapPointer(Box2D.getPointer(joint), Box2D.b2RevoluteJoint), revolute);

  revolute.EnableMotor(true);
  revolute.SetMotorSpeed(2);
  revolute.SetMaxMotorTorque(5);
  revolute.SetLimits(-1, 1);
  revolute.EnableLimit(true);

  assert.equal(revolute.IsMotorEnabled(), 1);
  assert.equal(revolute.GetMotorSpeed(), 2);
  assert.equal(revolute.GetMaxMotorTorque(), 5);
  assert.equal(revolute.GetLowerLimit(), -1);
  assert.equal(revolute.GetUpperLimit(), 1);
  assert.equal(revolute.IsLimitEnabled(), 1);
  assert.equal(revolute.GetJointAngle(), 0);
  assert.equal(revolute.GetJointSpeed(), 0);

  b.body.SetAngularVelocity(1);
  world.Step(1 / 60, 8, 3);
  assert.notEqual(revolute.GetJointSpeed(), 0);
});

test('fixture filter data round-trips through b2Filter accessors', () => {
  const world = createWorld();
  const { fixture } = createBox(world, 0, 0);

  const defaults = fixture.GetFilterData();
  assert.equal(defaults.get_categoryBits(), 1);
  assert.equal(defaults.get_groupIndex(), 0);
  assert.equal(defaults.get_maskBits() & 0xffff, 0xffff);

  const filter = new Box2D.b2Filter();
  filter.set_categoryBits(4);
  filter.set_maskBits(0xfffe);
  filter.set_groupIndex(-3);
  fixture.SetFilterData(filter);
  Box2D.destroy(filter);

  const stored = fixture.GetFilterData();
  assert.equal(stored.get_categoryBits(), 4);
  assert.equal(stored.get_maskBits() & 0xffff, 0xfffe);
  assert.equal(stored.get_groupIndex(), -3);
});

test('maskBits is read back as a signed 16-bit value', () => {
  const world = createWorld();
  const { fixture } = createBox(world, 0, 0);
  const stored = fixture.GetFilterData();
  assert.equal(stored.get_maskBits(), -1);
});

test('mouse joint is created and DestroyJoint / DestroyBody update counts', () => {
  const world = createWorld();
  const ground = createBox(world, 0, 0, Box2D.b2_staticBody);
  const a = createBox(world, 0, 0);
  const b = createBox(world, 1, 0);
  const { joint } = createRevolute(world, a, b, 0.5);

  const target = new Box2D.b2Vec2(2, 2);
  const mouseDef = new Box2D.b2MouseJointDef();
  mouseDef.set_bodyA(ground.body);
  mouseDef.set_bodyB(b.body);
  mouseDef.set_target(target);
  mouseDef.set_maxForce(100);
  mouseDef.set_frequencyHz(5);
  mouseDef.set_dampingRatio(0.7);
  const mouse = world.CreateJoint(mouseDef);
  Box2D.destroy(mouseDef);
  Box2D.destroy(target);

  assert.equal(mouse.GetType(), Box2D.e_mouseJoint);
  const mouseJoint = Box2D.castObject(mouse, Box2D.b2MouseJoint);
  const next = new Box2D.b2Vec2(3, 3);
  mouseJoint.SetTarget(next);
  Box2D.destroy(next);
  world.Step(1 / 60, 8, 3);

  assert.equal(world.GetJointCount(), 2);
  world.DestroyJoint(mouse);
  assert.equal(world.GetJointCount(), 1);
  world.DestroyJoint(joint);
  assert.equal(world.GetJointCount(), 0);
  world.DestroyBody(a.body);
  assert.equal(world.GetBodyCount(), 2);
});

test('defs copy the b2Vec2 passed to their setters', () => {
  const bodyDef = new Box2D.b2BodyDef();
  const position = new Box2D.b2Vec2(5, 6);
  bodyDef.set_position(position);
  position.set_x(99);
  assert.equal(bodyDef.get_position().get_x(), 5);
});

test('value-returning getters share one temporary b2Vec2', () => {
  const world = createWorld();
  const a = createBox(world, 0, 0);
  const b = createBox(world, 5, 0);
  const velocity = new Box2D.b2Vec2(1, 2);
  a.body.SetLinearVelocity(velocity);
  velocity.Set(3, 4);
  b.body.SetLinearVelocity(velocity);
  Box2D.destroy(velocity);

  const first = a.body.GetLinearVelocity();
  const second = b.body.GetLinearVelocity();
  assert.equal(first, second);
  assert.equal(first.get_x(), 3);

  assert.notEqual(a.body.GetPosition(), b.body.GetPosition());
  assert.equal(a.body.GetPosition().get_x(), 0);
  assert.equal(b.body.GetPosition().get_x(), 5);
});

test('one temporary b2Vec2 can be reused across SetTransform and ApplyLinearImpulse', () => {
  const world = createWorld();
  const { body } = createBox(world, 0, 0);
  const temp = new Box2D.b2Vec2(0, 0);
  const pointer = Box2D.getPointer(temp);

  temp.set_x(3);
  temp.set_y(4);
  body.SetTransform(temp, 0.5);
  temp.set_x(7);
  temp.set_y(8);
  body.SetTransform(temp, 0.1);
  assert.equal(body.GetPosition().get_x(), 7);
  assert.equal(body.GetPosition().get_y(), 8);
  assert.ok(Math.abs(body.GetAngle() - 0.1) < 1e-6);

  body.SetLinearVelocity(new Box2D.b2Vec2(0, 0));
  temp.Set(0, 5);
  body.ApplyLinearImpulse(temp, body.GetWorldCenter(), true);
  assert.ok(body.GetLinearVelocity().get_y() > 0);
  assert.equal(Box2D.getPointer(temp), pointer);
  Box2D.destroy(temp);
});

test('Box2D.destroy releases a b2Vec2 and its slot is reused', () => {
  const first = new Box2D.b2Vec2(0, 0);
  const pointer = Box2D.getPointer(first);
  Box2D.destroy(first);
  const second = new Box2D.b2Vec2(0, 0);
  assert.equal(Box2D.getPointer(second), pointer);
  Box2D.destroy(second);
});

test('undestroyed b2Vec2 consume 16 bytes each from a fixed 16 MiB heap', () => {
  assert.equal(Box2D.HEAP8.length, 16 * 1024 * 1024);
  const pointers = [];
  for (let i = 0; i < 100; i++) pointers.push(Box2D.getPointer(new Box2D.b2Vec2(0, 0)));
  assert.equal(new Set(pointers).size, pointers.length);
  const strides = pointers.slice(1).map((pointer, i) => pointer - pointers[i]);
  assert.ok(strides.filter((stride) => stride === 16).length >= 90);
  assert.equal(Box2D.HEAP8.length, 16 * 1024 * 1024);
});

test('destroyed or reused b2Vec2 allocations never advance the heap', () => {
  const probeBefore = new Box2D.b2Vec2(0, 0);
  const before = Box2D.getPointer(probeBefore);
  Box2D.destroy(probeBefore);

  for (let i = 0; i < 100000; i++) {
    const vec = new Box2D.b2Vec2(i, i);
    Box2D.destroy(vec);
  }
  const temp = new Box2D.b2Vec2(0, 0);
  for (let i = 0; i < 100000; i++) {
    temp.set_x(i);
    temp.set_y(i);
  }
  Box2D.destroy(temp);

  const probeAfter = new Box2D.b2Vec2(0, 0);
  assert.equal(Box2D.getPointer(probeAfter), before);
  Box2D.destroy(probeAfter);
});

test('spawn and destroy cycles with destroyed defs and shapes do not grow the heap', () => {
  const world = createWorld();
  const probeBefore = new Box2D.b2Vec2(0, 0);
  const before = Box2D.getPointer(probeBefore);
  Box2D.destroy(probeBefore);

  for (let i = 0; i < 20000; i++) {
    const a = createBox(world, 0, 0);
    const b = createBox(world, 1, 0);
    const { joint } = createRevolute(world, a, b, 0.5);
    world.DestroyJoint(joint);
    world.DestroyBody(a.body);
    world.DestroyBody(b.body);
  }

  const probeAfter = new Box2D.b2Vec2(0, 0);
  assert.equal(Box2D.getPointer(probeAfter), before);
  assert.equal(world.GetBodyCount(), 0);
  Box2D.destroy(probeAfter);
});

test('JSContactFilter can be subclassed and installed with SetContactFilter', () => {
  const world = createWorld();
  const ground = createBox(world, 0, 0, Box2D.b2_staticBody);
  const faller = createBox(world, 0, 0);
  faller.body.SetTransform(new Box2D.b2Vec2(0, 5), 0);

  let calls = 0;
  const filter = new Box2D.JSContactFilter();
  filter.ShouldCollide = (fixtureAPointer, fixtureBPointer) => {
    const fixtureA = Box2D.wrapPointer(fixtureAPointer, Box2D.b2Fixture);
    const fixtureB = Box2D.wrapPointer(fixtureBPointer, Box2D.b2Fixture);
    assert.ok(fixtureA.GetBody());
    assert.ok(fixtureB.GetBody());
    calls++;
    return false;
  };
  world.SetContactFilter(filter);

  for (let i = 0; i < 180; i++) world.Step(1 / 60, 8, 3);
  assert.ok(calls > 0);
  assert.ok(faller.body.GetPosition().get_y() < -5);
  assert.ok(ground.body);
});
