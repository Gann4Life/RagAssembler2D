import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter, RagFormatError } from '../lib/ragimporter.js';
import { RagDef } from '../lib/def.js';
import { bodyMassData, transformPoint } from '../lib/geometry.js';
import { POSE, createPoseSession, poseTestJson } from '../js/physics/pose-session.js';
import { ragFile } from './helpers/rag-file.js';
import { bipedRig, humanoidRig } from './helpers/rigs.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

const TOLERANCE = 1e-5;
const LIMIT_TOLERANCE = 0.05;
const ROOT = Object.freeze({ x: 5, y: 7, angle: 1.2 });

class Container {
  constructor() {
    this.children = [];
    this.parent = null;
    this.sortableChildren = false;
    this.destroyed = false;
  }

  addChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = null;
    return child;
  }

  destroy() {
    this.destroyed = true;
  }
}

const PIXI = { Container };

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function near(actual, expected, message, tolerance = TOLERANCE) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} != ${expected}`);
}

function heapProbe() {
  const probe = new Box2D.b2Vec2(0, 0);
  const pointer = Box2D.getPointer(probe);
  Box2D.destroy(probe);
  return pointer;
}

function restWorld(json, bodyId) {
  const body = json.bodies.find((item) => item.id === bodyId);
  return transformPoint(ROOT, { x: body.position[0], y: body.position[1] });
}

function capturingSpawn(run) {
  const original = RagDef.prototype.spawn;
  const spawned = [];
  RagDef.prototype.spawn = function spawn(...args) {
    const rag = original.apply(this, args);
    spawned.push(rag);
    return rag;
  };
  try {
    return run(spawned);
  } finally {
    RagDef.prototype.spawn = original;
  }
}

function run(session, seconds) {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += POSE.step) session.advance(POSE.step);
}

function withFreeBody() {
  const json = ragFile();
  json.bodies.push({
    ...structuredClone(json.bodies[3]),
    id: 'b_free',
    name: 'free',
    position: [3, 3],
    fixtures: [{ ...structuredClone(json.bodies[3].fixtures[0]), id: 'f_free', name: 'free' }],
  });
  return json;
}

function create(box2d, json, options) {
  RagImporter.configure({ Box2D, PIXI });
  return createPoseSession(box2d, json, options);
}

function start(json, bodyId, point = restWorld(json, bodyId)) {
  return create(Box2D, json, { root: ROOT, bodyId, point });
}

test('POSE holds the spec constants and is frozen', () => {
  assert.deepEqual(
    { ...POSE },
    {
      step: 1 / 60,
      maxSteps: 4,
      linearDamping: 10,
      angularDamping: 10,
      forcePerKg: 1000,
      frequencyHz: 5,
      dampingRatio: 0.7,
      falloffFrequencyHz: 15,
      falloffVelocityIterations: 64,
      holdScale: 0.1,
      holdBase: 10,
      holdGain: 20,
      holdMaxSpeed: 20,
      holdMaxHops: 6,
    },
  );
  assert.equal(Object.isFrozen(POSE), true);
});

test('poseTestJson drops sprites, clips and shape sprites, disables collision and leaves the input untouched', () => {
  const json = ragFile();
  const before = structuredClone(json);
  const test = poseTestJson(json);
  assert.deepEqual(json, before);
  assert.deepEqual(test.sprites, []);
  assert.deepEqual(test.clips, []);
  for (const body of test.bodies) {
    for (const shape of body.fixtures) {
      assert.equal(shape.sprite, null);
      assert.equal(shape.selfCollide, false);
      assert.equal(shape.filter.maskBits, 0);
      assert.equal(shape.filter.categoryBits, 2);
    }
  }
  assert.deepEqual(test.joints, json.joints);
  assert.deepEqual(test.meta, json.meta);
  assert.deepEqual(RagImporter.validate(test).errors, []);
});

test('pose() equals the rest pose right after start with a rotated root, and grab() starts at the press point', () => {
  const json = ragFile();
  const point = { x: 5.4, y: 7.1 };
  const session = start(json, 'b_torso', point);
  try {
    const pose = session.pose();
    assert.deepEqual([...pose.keys()], json.bodies.map((body) => body.id));
    for (const body of json.bodies) {
      near(pose.get(body.id).x, body.position[0], `${body.id} x`);
      near(pose.get(body.id).y, body.position[1], `${body.id} y`);
      near(pose.get(body.id).angle, body.angle, `${body.id} angle`);
    }
    const { anchor, target } = session.grab();
    near(anchor.x, point.x, 'anchor x');
    near(anchor.y, point.y, 'anchor y');
    assert.deepEqual(target, point);
  } finally {
    session.destroy();
  }
});

test('options.start places the listed bodies at their root-local transforms before the grab', () => {
  const json = ragFile();
  const moved = json.bodies[1];
  const placed = { x: moved.position[0] + 0.2, y: moved.position[1] - 0.1, angle: moved.angle + 0.7 };
  const point = transformPoint(ROOT, { x: placed.x, y: placed.y });
  const session = create(Box2D, json, { root: ROOT, bodyId: moved.id, point, start: new Map([[moved.id, placed]]) });
  try {
    const pose = session.pose();
    near(pose.get(moved.id).x, placed.x, 'x');
    near(pose.get(moved.id).y, placed.y, 'y');
    near(pose.get(moved.id).angle, placed.angle, 'angle');
    for (const body of json.bodies) {
      if (body.id === moved.id) continue;
      near(pose.get(body.id).angle, body.angle, `${body.id} angle`);
    }
    const { anchor } = session.grab();
    near(anchor.x, point.x, 'anchor x');
    near(anchor.y, point.y, 'anchor y');
  } finally {
    session.destroy();
  }
});

test('every body is damped, every motor is off and the grabbed body is pulled by a mouse joint', () => {
  const json = ragFile();
  capturingSpawn((spawned) => {
    const session = start(json, 'b_head');
    try {
      const [rag] = spawned;
      for (const body of rag.bodies.values()) {
        near(body.GetLinearDamping(), POSE.linearDamping, 'linear damping');
        near(body.GetAngularDamping(), POSE.angularDamping, 'angular damping');
      }
      for (const joint of rag.joints.values()) assert.equal(joint.IsMotorEnabled(), 0);
      const world = rag.bodies.get('b_head').GetWorld();
      assert.equal(world.GetJointCount(), json.joints.length + 1);
      assert.equal(world.GetBodyCount(), json.bodies.length + 1);
      const gravity = world.GetGravity();
      assert.equal(gravity.get_x(), 0);
      assert.equal(gravity.get_y(), 0);
    } finally {
      session.destroy();
    }
  });
});

test('bodies not attached to the grabbed one do not move over 2 s without a drag', () => {
  const json = withFreeBody();
  const session = start(json, 'b_torso');
  try {
    run(session, 2);
    const free = session.pose().get('b_free');
    near(free.x, 3, 'free x');
    near(free.y, 3, 'free y');
    near(free.angle, 0, 'free angle');
  } finally {
    session.destroy();
  }
});

test('a drag moves the grabbed body toward the target and its chain follows', () => {
  const json = ragFile();
  const press = restWorld(json, 'b_head');
  const target = { x: press.x + 1, y: press.y - 0.5 };
  const session = start(json, 'b_head', press);
  try {
    session.drag(target);
    assert.deepEqual(session.grab().target, target);
    run(session, 2);
    const anchor = session.grab().anchor;
    assert.ok(Math.hypot(anchor.x - target.x, anchor.y - target.y) < 0.1, 'grabbed point reaches the target');
    const torso = session.pose().get('b_torso');
    const restTorso = json.bodies[0];
    assert.ok(Math.hypot(torso.x - restTorso.position[0], torso.y - restTorso.position[1]) > 0.3, 'torso follows');
  } finally {
    session.destroy();
  }
});

test('joint angles stay within their limits, up to the solver slop, during circling drags', () => {
  const json = ragFile();
  const limited = json.joints.filter((joint) => joint.limits.enabled);
  capturingSpawn((spawned) => {
    for (const bodyId of ['b_arm', 'b_head', 'b_torso']) {
      const press = restWorld(json, bodyId);
      const session = start(json, bodyId, press);
      try {
        const rag = spawned.at(-1);
        for (let i = 0; i < 480; i++) {
          const turn = (i / 480) * Math.PI * 4;
          session.drag({ x: press.x + Math.cos(turn) - 1, y: press.y + Math.sin(turn) });
          session.advance(POSE.step);
          for (const joint of limited) {
            const angle = rag.joints.get(joint.id).GetJointAngle();
            assert.ok(angle > joint.limits.lower - LIMIT_TOLERANCE, `${bodyId} ${joint.id} ${angle} above lower`);
            assert.ok(angle < joint.limits.upper + LIMIT_TOLERANCE, `${bodyId} ${joint.id} ${angle} below upper`);
          }
        }
        for (const joint of rag.joints.values()) assert.equal(joint.IsMotorEnabled(), 0);
      } finally {
        session.destroy();
      }
    }
  });
});

test('two overlapping unjointed bodies do not push apart', () => {
  const json = ragFile();
  json.joints = [];
  json.clips = [];
  json.bodies = json.bodies.slice(0, 2);
  json.bodies[1].position = [...json.bodies[0].position];
  const session = start(json, 'b_torso');
  try {
    run(session, 1);
    const head = session.pose().get('b_head');
    near(head.x, json.bodies[0].position[0], 'head x');
    near(head.y, json.bodies[0].position[1], 'head y');
  } finally {
    session.destroy();
  }
});

test('advance runs whole fixed steps, carries the remainder and caps the steps per call', () => {
  const original = Box2D.b2World.prototype.Step;
  const steps = [];
  Box2D.b2World.prototype.Step = function step(dt, velocity, position) {
    steps.push([dt, velocity, position]);
    return original.call(this, dt, velocity, position);
  };
  const session = start(ragFile(), 'b_torso');
  try {
    session.advance(POSE.step / 2);
    assert.equal(steps.length, 0);
    session.advance(POSE.step / 2);
    assert.equal(steps.length, 1);
    assert.deepEqual(steps[0], [POSE.step, 8, 3]);
    session.advance(POSE.step * 2.5);
    assert.equal(steps.length, 3);
    session.advance(POSE.step / 2);
    assert.equal(steps.length, 4);
    session.advance(1);
    assert.equal(steps.length, 4 + POSE.maxSteps);
    session.advance(POSE.step / 2);
    assert.equal(steps.length, 4 + POSE.maxSteps);
    session.advance(0);
    assert.equal(steps.length, 4 + POSE.maxSteps);
  } finally {
    session.destroy();
    Box2D.b2World.prototype.Step = original;
  }
});

test('a parse error throws RagFormatError and creates no world', () => {
  const json = ragFile();
  json.joints[0].bodyB = 'missing';
  let worlds = 0;
  const counting = new Proxy(Box2D, {
    get(target, key) {
      if (key === 'b2World') worlds++;
      return target[key];
    },
  });
  const before = heapProbe();
  assert.throws(
    () => create(counting, json, { root: ROOT, bodyId: 'b_torso', point: { x: 5, y: 7 } }),
    RagFormatError,
  );
  assert.equal(worlds, 0);
  assert.equal(heapProbe(), before);
});

test('an unknown body id throws after releasing everything it built', () => {
  start(ragFile(), 'b_torso').destroy();
  const before = heapProbe();
  assert.throws(() => start(ragFile(), 'b_nope', { x: 5, y: 7 }), /unknown body "b_nope"/);
  assert.equal(heapProbe(), before);
});

test('destroy is idempotent, empties the world before destroying it, and later calls throw', () => {
  const destroyed = [];
  const recording = new Proxy(Box2D, {
    get(target, key) {
      if (key !== 'destroy') return target[key];
      return (object) => {
        if (typeof object?.GetBodyCount === 'function') {
          destroyed.push({ bodies: object.GetBodyCount(), joints: object.GetJointCount() });
        }
        return target.destroy(object);
      };
    },
  });
  const json = ragFile();
  const session = create(recording, json, { root: ROOT, bodyId: 'b_torso', point: restWorld(json, 'b_torso') });
  session.destroy();
  session.destroy();
  assert.deepEqual(destroyed, [{ bodies: 0, joints: 0 }]);
  assert.throws(() => session.pose(), Error);
  assert.throws(() => session.drag({ x: 0, y: 0 }), Error);
  assert.throws(() => session.advance(1), Error);
  assert.throws(() => session.grab(), Error);
});

test('no heap growth over 500 start, drag, advance, destroy cycles', () => {
  const json = ragFile();
  const press = restWorld(json, 'b_arm');
  const cycle = (i) => {
    const session = start(json, 'b_arm', press);
    session.drag({ x: press.x + (i % 5) * 0.1, y: press.y });
    session.advance(POSE.step * 2);
    session.pose();
    session.grab();
    session.destroy();
  };
  cycle(0);
  const before = heapProbe();
  for (let i = 1; i <= 500; i++) cycle(i);
  assert.equal(heapProbe(), before);
});

const FLAT = Object.freeze({ x: 0, y: 0, angle: 0 });
const KEY_THRESHOLD = (0.1 * Math.PI) / 180;

function massCenter(json, bodyId, pose) {
  const body = json.bodies.find((item) => item.id === bodyId);
  return transformPoint(pose.get(bodyId), bodyMassData(body.fixtures).center);
}

function hopDistances(json, bodyId) {
  const hops = new Map([[bodyId, 0]]);
  for (let grown = true; grown; ) {
    grown = false;
    for (const joint of json.joints) {
      for (const [from, to] of [[joint.bodyA, joint.bodyB], [joint.bodyB, joint.bodyA]]) {
        if (hops.has(from) && !hops.has(to)) {
          hops.set(to, hops.get(from) + 1);
          grown = true;
        }
      }
    }
  }
  return hops;
}

function jointChanges(json, before, after, bodyId) {
  const hops = hopDistances(json, bodyId);
  return json.joints.map((joint) => ({
    id: joint.id,
    d: Math.min(hops.get(joint.bodyA) ?? Infinity, hops.get(joint.bodyB) ?? Infinity),
    change: Math.abs(
      after.get(joint.bodyB).angle - after.get(joint.bodyA).angle - (before.get(joint.bodyB).angle - before.get(joint.bodyA).angle),
    ),
  }));
}

function falloffDrag(json, bodyId, offset, falloff) {
  RagImporter.configure({ Box2D, PIXI });
  const restPose = new Map(json.bodies.map((body) => [body.id, { x: body.position[0], y: body.position[1], angle: body.angle }]));
  const press = massCenter(json, bodyId, restPose);
  const target = { x: press.x + offset.x, y: press.y + offset.y };
  const session = createPoseSession(Box2D, json, { root: FLAT, bodyId, point: press, start: new Map(), falloff });
  try {
    const before = session.pose();
    for (let i = 1; i <= 60; i++) {
      session.drag({ x: press.x + (offset.x * i) / 60, y: press.y + (offset.y * i) / 60 });
      session.advance(POSE.step);
    }
    run(session, 0.5);
    const { anchor } = session.grab();
    return { changes: jointChanges(json, before, session.pose(), bodyId), miss: Math.hypot(anchor.x - target.x, anchor.y - target.y) };
  } finally {
    session.destroy();
  }
}

for (const [name, rig, bodyId, offset] of [
  ['humanoid shin', humanoidRig, 'b_shinR', { x: 0.3, y: 0.2 }],
  ['humanoid forearm', humanoidRig, 'b_foreL', { x: 0.25, y: 0.15 }],
  ['biped shin', bipedRig, 'b_shinR', { x: 0.1, y: 0.08 }],
]) {
  test(`falloff: dragging the ${name} bends the near joints, reaches the pointer and leaves joints two hops away unchanged`, () => {
    const { json } = rig();
    const held = falloffDrag(json, bodyId, offset, true);
    assert.ok(held.miss < 0.05, `grabbed point ${held.miss} m from the pointer`);
    assert.ok(held.changes.some((joint) => joint.d === 0 && joint.change > 0.05), 'a joint of the grabbed body bends');
    for (const joint of held.changes.filter((item) => item.d >= 2)) {
      assert.ok(joint.change < KEY_THRESHOLD, `${joint.id} at ${joint.d} hops changed ${joint.change} rad`);
    }
    const free = falloffDrag(json, bodyId, offset, false);
    assert.ok(free.changes.some((joint) => joint.d >= 2 && joint.change > KEY_THRESHOLD), 'without falloff the drag reaches far joints');
  });
}

test('falloff: every joint motor holds, every other body gets a ground hold, the pull is stiffer and solved longer', () => {
  const { json } = humanoidRig();
  const original = Box2D.b2World.prototype.Step;
  const iterations = [];
  Box2D.b2World.prototype.Step = function step(dt, velocity, position) {
    iterations.push(velocity);
    return original.call(this, dt, velocity, position);
  };
  try {
    capturingSpawn((spawned) => {
      RagImporter.configure({ Box2D, PIXI });
      const press = restWorld(json, 'b_shinR');
      const session = createPoseSession(Box2D, json, { root: FLAT, bodyId: 'b_shinR', point: press, falloff: true });
      try {
        const [rag] = spawned;
        for (const joint of rag.joints.values()) assert.equal(joint.IsMotorEnabled(), 1);
        const world = rag.bodies.get('b_shinR').GetWorld();
        assert.equal(world.GetJointCount(), json.joints.length + 1 + json.bodies.length - 1);
        session.advance(POSE.step);
        assert.deepEqual(iterations, [POSE.falloffVelocityIterations]);
      } finally {
        session.destroy();
      }
    });
  } finally {
    Box2D.b2World.prototype.Step = original;
  }
});

test('falloff: no heap growth over 200 start, drag, advance, destroy cycles', () => {
  const { json } = humanoidRig();
  const press = restWorld(json, 'b_foreL');
  const cycle = (i) => {
    const session = create(Box2D, json, { root: FLAT, bodyId: 'b_foreL', point: press, falloff: true });
    session.drag({ x: press.x + (i % 5) * 0.1, y: press.y });
    session.advance(POSE.step * 2);
    session.destroy();
  };
  cycle(0);
  const before = heapProbe();
  for (let i = 1; i <= 200; i++) cycle(i);
  assert.equal(heapProbe(), before);
});

test('rootBody moves freely: a dragged limb pulls it along and a grabbed rootBody follows the pointer', () => {
  const json = ragFile();
  const rootId = json.ragdoll.rootBody;
  const rootCenter = (pose) => {
    const body = json.bodies.find((item) => item.id === rootId);
    return transformPoint(pose.get(rootId), bodyMassData(body.fixtures).center);
  };
  const press = restWorld(json, 'b_head');
  const limb = create(Box2D, json, { root: ROOT, bodyId: 'b_head', point: press, start: new Map() });
  try {
    const before = rootCenter(limb.pose());
    limb.drag({ x: press.x + 3, y: press.y - 2 });
    run(limb, 2);
    const after = rootCenter(limb.pose());
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 0.2, 'rootBody pulled along');
  } finally {
    limb.destroy();
  }
  const grab = restWorld(json, rootId);
  const moved = create(Box2D, json, { root: ROOT, bodyId: rootId, point: grab, start: new Map() });
  try {
    const before = rootCenter(moved.pose());
    moved.drag({ x: grab.x + 0.5, y: grab.y + 0.5 });
    run(moved, 2);
    const after = rootCenter(moved.pose());
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 0.3, 'rootBody translated');
  } finally {
    moved.destroy();
  }
});