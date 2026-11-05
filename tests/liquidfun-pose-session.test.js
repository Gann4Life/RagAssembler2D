import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter, RagFormatError } from '../lib/ragimporter.js';
import { RagDef } from '../lib/def.js';
import { bodyMassData, transformPoint } from '../lib/geometry.js';
import { POSE, createPoseSession, poseTestJson, turnAbout } from '../js/physics/pose-session.js';
import { ragFile } from './helpers/rag-file.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

const TOLERANCE = 1e-5;
const LIMIT_TOLERANCE = 0.08;
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
    { step: 1 / 60, maxSteps: 4, linearDamping: 10, angularDamping: 10, forcePerKg: 1000, frequencyHz: 5, dampingRatio: 0.7, correction: 0.3 },
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

test('rootBody moves freely: a dragged limb pulls it along and a grabbed rootBody follows the pointer', () => {
  const json = ragFile();
  const rootId = json.ragdoll.rootBody;
  const rootCenter = (pose) => {
    const body = json.bodies.find((item) => item.id === rootId);
    return transformPoint(pose.get(rootId), bodyMassData(body).center);
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
test('turnAbout gives the signed turn around the pivot, wraps across ±π and ignores points at the pivot', () => {
  const pivot = { x: 1, y: 1 };
  near(turnAbout(pivot, { x: 2, y: 1 }, { x: 1, y: 3 }), Math.PI / 2, 'quarter turn');
  near(turnAbout(pivot, { x: 1, y: 3 }, { x: 2, y: 1 }), -Math.PI / 2, 'clockwise');
  const at = (degrees) => ({ x: 1 + Math.cos((degrees * Math.PI) / 180), y: 1 + Math.sin((degrees * Math.PI) / 180) });
  near(turnAbout(pivot, at(170), at(-170)), (20 * Math.PI) / 180, 'across +π');
  near(turnAbout(pivot, at(-170), at(170)), (-20 * Math.PI) / 180, 'across −π');
  assert.equal(turnAbout(pivot, { x: 1.0005, y: 1 }, { x: 1, y: 2 }), 0);
  assert.equal(turnAbout(pivot, { x: 2, y: 1 }, { x: 1, y: 1.0009 }), 0);
});

function withForearm() {
  const json = ragFile();
  json.bodies.push({
    ...structuredClone(json.bodies[3]),
    id: 'b_fore',
    name: 'fore',
    position: [-0.6, 0.4],
    fixtures: [{ ...structuredClone(json.bodies[3].fixtures[0]), id: 'f_fore', name: 'fore' }],
  });
  json.joints.push({ ...structuredClone(json.joints[2]), id: 'j_elbow', name: 'elbow', bodyA: 'b_arm2', bodyB: 'b_fore', anchor: [-0.35, 0.4] });
  return json;
}

function rotateBy(session, pivot, press, degrees, frames = 60) {
  const radius = Math.hypot(press.x - pivot.x, press.y - pivot.y);
  const from = Math.atan2(press.y - pivot.y, press.x - pivot.x);
  for (let i = 1; i <= frames; i++) {
    const angle = from + ((degrees * Math.PI) / 180) * (i / frames);
    session.drag({ x: pivot.x + radius * Math.cos(angle), y: pivot.y + radius * Math.sin(angle) });
    session.advance(POSE.step);
  }
  run(session, 1);
}

function centerOf(json, pose, id) {
  return transformPoint(pose.get(id), bodyMassData(json.bodies.find((body) => body.id === id)).center);
}

test('Shift rotation of a limb turns it about its parent joint anchor; the parent stays and the child follows', () => {
  const json = withForearm();
  const pivotLocal = { x: 0, y: 0.4 };
  const pivot = transformPoint(ROOT, pivotLocal);
  const press = transformPoint(ROOT, { x: -0.3, y: 0.4 });
  capturingSpawn((spawned) => {
    const session = create(Box2D, json, { root: ROOT, bodyId: 'b_arm2', point: press, rotate: { joint: 'j_shoulder2' } });
    try {
      const world = spawned[0].bodies.get('b_arm2').GetWorld();
      assert.equal(world.GetJointCount(), json.joints.length + 1);
      const before = session.pose();
      const foreBefore = centerOf(json, before, 'b_fore');
      near(session.grab().pivot.x, pivot.x, 'pivot x');
      near(session.grab().pivot.y, pivot.y, 'pivot y');
      rotateBy(session, pivot, press, 60);
      const after = session.pose();
      const turned = after.get('b_arm2').angle - before.get('b_arm2').angle;
      near(turned, Math.PI / 3, 'limb turns by the pointer turn', (3 * Math.PI) / 180);
      const anchor = transformPoint(after.get('b_arm2'), { x: 0.2, y: 0 });
      assert.ok(Math.hypot(anchor.x - pivotLocal.x, anchor.y - pivotLocal.y) < 0.01, 'the limb turns about the anchor');
      const torso = after.get('b_torso');
      const torsoBefore = before.get('b_torso');
      assert.ok(Math.hypot(torso.x - torsoBefore.x, torso.y - torsoBefore.y) < 0.02, 'the parent stays in place');
      assert.ok(Math.abs(torso.angle - torsoBefore.angle) < (2 * Math.PI) / 180, 'the parent does not turn');
      const foreAfter = centerOf(json, after, 'b_fore');
      const elbow = transformPoint(after.get('b_fore'), { x: 0.25, y: 0 });
      const elbowTarget = transformPoint(after.get('b_arm2'), { x: -0.15, y: 0 });
      assert.ok(Math.hypot(elbow.x - elbowTarget.x, elbow.y - elbowTarget.y) < 0.01, 'the child stays on its joint');
      assert.ok(Math.hypot(foreAfter.x - foreBefore.x, foreAfter.y - foreBefore.y) > 0.2, 'the child follows');
      for (const joint of spawned[0].joints.values()) assert.equal(joint.IsMotorEnabled(), 0);
    } finally {
      session.destroy();
    }
  });
});

test('Shift rotation of rootBody turns it about its center of mass, continuously past 180 degrees', () => {
  const json = ragFile();
  const before = start(json, 'b_torso');
  const center = transformPoint(ROOT, centerOf(json, before.pose(), 'b_torso'));
  before.destroy();
  const press = transformPoint(ROOT, { x: 0.3, y: 0.45 });
  const session = create(Box2D, json, { root: ROOT, bodyId: 'b_torso', point: press, rotate: { joint: null } });
  try {
    const grab = session.grab();
    near(grab.pivot.x, center.x, 'pivot x');
    near(grab.pivot.y, center.y, 'pivot y');
    const startAngle = session.pose().get('b_torso').angle;
    rotateBy(session, center, press, 200, 120);
    const after = session.pose();
    near(after.get('b_torso').angle - startAngle, (200 * Math.PI) / 180, 'root turns by the pointer turn', (3 * Math.PI) / 180);
    const moved = transformPoint(ROOT, centerOf(json, after, 'b_torso'));
    assert.ok(Math.hypot(moved.x - center.x, moved.y - center.y) < 0.01, 'the center of mass stays');
  } finally {
    session.destroy();
  }
});

test('a rotation with an unknown joint throws after releasing everything it built', () => {
  start(ragFile(), 'b_torso').destroy();
  const before = heapProbe();
  assert.throws(
    () => create(Box2D, ragFile(), { root: ROOT, bodyId: 'b_arm', point: { x: 5, y: 7 }, rotate: { joint: 'j_nope' } }),
    /unknown joint "j_nope"/,
  );
  assert.equal(heapProbe(), before);
});

test('no heap growth over 300 rotation cycles', () => {
  const json = ragFile();
  const press = restWorld(json, 'b_arm');
  const cycle = (i) => {
    const session = create(Box2D, json, { root: ROOT, bodyId: 'b_arm', point: press, rotate: { joint: i % 2 ? 'j_shoulder' : null } });
    session.drag({ x: press.x + 0.1, y: press.y + (i % 5) * 0.1 });
    session.advance(POSE.step * 2);
    session.pose();
    session.grab();
    session.destroy();
  };
  cycle(0);
  cycle(1);
  const before = heapProbe();
  for (let i = 2; i <= 300; i++) cycle(i);
  assert.equal(heapProbe(), before);
});

test('setRotate switches a running test from pull to rotation and back, from the current state', () => {
  const json = withForearm();
  const press = transformPoint(ROOT, { x: -0.3, y: 0.4 });
  capturingSpawn((spawned) => {
    const session = create(Box2D, json, { root: ROOT, bodyId: 'b_arm2', point: press });
    try {
      const world = spawned[0].bodies.get('b_arm2').GetWorld();
      const pulled = { x: press.x, y: press.y + 0.1 };
      session.drag(pulled);
      run(session, 0.5);
      const grabbedBefore = session.grab().anchor;
      const atSwitch = session.pose();
      const pivotLocal = transformPoint(atSwitch.get('b_arm2'), { x: 0.2, y: 0 });
      const pivot = transformPoint(ROOT, pivotLocal);
      session.setRotate({ joint: 'j_shoulder2' });
      assert.equal(world.GetJointCount(), json.joints.length + 1);
      near(session.grab().pivot.x, pivot.x, 'pivot x', 1e-4);
      near(session.grab().pivot.y, pivot.y, 'pivot y', 1e-4);
      near(session.grab().anchor.x, grabbedBefore.x, 'grab point kept x', 1e-6);
      near(session.grab().anchor.y, grabbedBefore.y, 'grab point kept y', 1e-6);
      rotateBy(session, pivot, pulled, 45);
      const turned = session.pose().get('b_arm2').angle - atSwitch.get('b_arm2').angle;
      near(turned, Math.PI / 4, 'turns from the angle at the switch', (3 * Math.PI) / 180);
      const anchor = transformPoint(session.pose().get('b_arm2'), { x: 0.2, y: 0 });
      assert.ok(Math.hypot(anchor.x - pivotLocal.x, anchor.y - pivotLocal.y) < 0.01, 'about the anchor at the switch');
      const grabbed = session.grab().anchor;
      session.setRotate(null);
      assert.equal(world.GetJointCount(), json.joints.length + 1);
      assert.equal(session.grab().pivot, null);
      near(session.grab().anchor.x, grabbed.x, 'pull anchored at the grab point x', 1e-5);
      near(session.grab().anchor.y, grabbed.y, 'pull anchored at the grab point y', 1e-5);
      const target = { x: grabbed.x + 0.5, y: grabbed.y - 0.5 };
      session.drag(target);
      run(session, 2);
      const reached = session.grab().anchor;
      assert.ok(Math.hypot(reached.x - target.x, reached.y - target.y) < 0.1, 'the pull drags again');
      session.setRotate(null);
      assert.equal(world.GetJointCount(), json.joints.length + 1);
      assert.throws(() => session.setRotate({ joint: 'j_nope' }), /unknown joint/);
      assert.equal(session.grab().pivot, null, 'a refused switch keeps the pull');
      session.drag(target);
      session.advance(POSE.step);
    } finally {
      session.destroy();
    }
    assert.throws(() => session.setRotate(null), Error);
  });
});

test('no heap growth over 200 tests with repeated pull and rotation switches', () => {
  const json = ragFile();
  const press = restWorld(json, 'b_arm');
  const cycle = (i) => {
    const session = start(json, 'b_arm', press);
    for (let k = 0; k < 4; k++) {
      session.setRotate(k % 2 === 0 ? { joint: i % 2 ? 'j_shoulder' : null } : null);
      session.drag({ x: press.x + 0.1 * k, y: press.y + (i % 5) * 0.1 });
      session.advance(POSE.step);
      session.grab();
    }
    session.pose();
    session.destroy();
  };
  cycle(0);
  cycle(1);
  const before = heapProbe();
  for (let i = 2; i <= 200; i++) cycle(i);
  assert.equal(heapProbe(), before);
});
