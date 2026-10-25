import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter } from '../lib/ragimporter.js';
import { fkPose } from '../lib/evaluate.js';
import { bodyMassData, composeTransforms, shapeBounds } from '../lib/geometry.js';
import { addHoldClip, bipedRig, creatureRig, fitTorque, holdRun, humanoidRig, poleRig, snakeRig } from './helpers/rigs.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

const STEP = 1 / 60;
const SUBSTEPS = 8;
const DEG = 180 / Math.PI;

class Container {
  constructor() {
    this.parent = null;
  }

  destroy() {}
}

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function lowest(json, pose, turn) {
  let low = Infinity;
  for (const body of json.bodies) {
    const local = pose === null ? { x: body.position[0], y: body.position[1], angle: body.angle } : pose.get(body.id);
    const placed = composeTransforms({ x: 0, y: 0, angle: turn }, local);
    for (const entry of body.fixtures) low = Math.min(low, shapeBounds(entry.shape, placed).minY);
  }
  return low;
}

function scene(json, turn = 0) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const gravity = new Box2D.b2Vec2(0, -10);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const groundDef = new Box2D.b2BodyDef();
  const ground = world.CreateBody(groundDef);
  Box2D.destroy(groundDef);
  const shape = new Box2D.b2PolygonShape();
  const center = new Box2D.b2Vec2(0, lowest(json, null, turn) - 0.5);
  shape.SetAsBox(50, 0.5, center, 0);
  ground.CreateFixture(shape, 0).SetFriction(0.8);
  Box2D.destroy(center);
  Box2D.destroy(shape);
  const rag = RagImporter.parse(json).spawn(world, { x: 0, y: 0, angle: turn });
  return {
    rag,
    step() {
      for (let i = 0; i < SUBSTEPS; i++) {
        rag.update(STEP / SUBSTEPS);
        world.Step(STEP / SUBSTEPS, 8, 3);
      }
    },
    destroy() {
      rag.destroy();
      world.DestroyBody(ground);
      Box2D.destroy(world);
    },
  };
}

function push(json, bodyId, deltaV) {
  const run = scene(json);
  const { rag } = run;
  let peak = 0;
  let worst = null;
  let sign = 0;
  let reversals = 0;
  const errors = [];
  try {
    for (let i = 0; i < 2 / STEP; i++) run.step();
    const body = rag.bodies.get(bodyId);
    const impulse = new Box2D.b2Vec2(body.GetMass() * deltaV, 0);
    body.ApplyLinearImpulse(impulse, body.GetWorldCenter(), true);
    Box2D.destroy(impulse);
    for (let i = 0; i < 3 / STEP; i++) {
      run.step();
      let largest = 0;
      for (const [id, joint] of rag.joints) {
        const error = Math.abs(joint.GetJointAngle()) * DEG;
        largest = Math.max(largest, error);
        if (error > peak) {
          peak = error;
          worst = id;
        }
      }
      errors.push(largest);
      const error = worst === null ? 0 : -rag.joints.get(worst).GetJointAngle() * DEG;
      if (Math.abs(error) > 0.5) {
        if (sign !== 0 && Math.sign(error) !== sign) reversals++;
        sign = Math.sign(error);
      }
    }
  } finally {
    run.destroy();
  }
  let settled = errors.length;
  while (settled > 0 && errors[settled - 1] < 1) settled--;
  return { peak, worst, settle: settled * STEP, reversals, final: errors.at(-1) };
}

function treeDepth(json) {
  const depth = new Map([[json.ragdoll.rootBody, 0]]);
  const queue = [json.ragdoll.rootBody];
  for (let head = 0; head < queue.length; head++) {
    for (const joint of json.joints) {
      if (joint.bodyA !== queue[head] && joint.bodyB !== queue[head]) continue;
      const other = joint.bodyA === queue[head] ? joint.bodyB : joint.bodyA;
      if (depth.has(other)) continue;
      depth.set(other, depth.get(queue[head]) + 1);
      queue.push(other);
    }
  }
  return depth;
}

function farthestBody(json) {
  return [...treeDepth(json)].sort((a, b) => b[1] - a[1])[0][0];
}

const RIGS = [
  ['the robot-like biped', bipedRig],
  ['a two-body pole', poleRig],
  ['a ten-segment snake', () => snakeRig(10)],
  ['a humanoid', humanoidRig],
  ['the light-root creature', creatureRig],
];

for (const [name, build] of RIGS) {
  test(`${name}: a 3 m/s push on a limb end and on rootBody deflects under 5°, settles within 0.5 s and does not ring`, () => {
    const json = fitTorque(build().json);
    for (const bodyId of [farthestBody(json), json.ragdoll.rootBody]) {
      const result = push(json, bodyId, 3);
      const text = `${bodyId}: peak ${result.peak.toFixed(2)}° at ${result.worst}, settle ${result.settle.toFixed(2)} s, reversals ${result.reversals}, final ${result.final.toFixed(2)}°`;
      assert.ok(result.peak < 5, text);
      assert.ok(result.settle < 0.5, text);
      assert.ok(result.reversals <= 1, text);
      assert.ok(result.final < 1, text);
    }
  });
}

test('the robot-like biped holds a bent-knee pose within 1° without trembling', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const { json, pose } = bipedRig();
  const result = holdRun(Box2D, RagImporter, fitTorque(json), { pose, seconds: 6 });
  const text = `error ${result.jointError.toFixed(2)}° at ${result.worstJoint}, tremble ${result.tremble.toFixed(3)} rad/s, energy ${result.energy.toFixed(4)} J`;
  assert.ok(result.jointError < 1, text);
  assert.ok(result.tremble < 0.2, text);
});

function limbShare(json, joint) {
  const mass = new Map(json.bodies.map((body) => [body.id, bodyMassData(body.fixtures).mass]));
  const depth = treeDepth(json);
  const child = depth.get(joint.bodyA) > depth.get(joint.bodyB) ? joint.bodyA : joint.bodyB;
  const seen = new Set([joint.bodyA, joint.bodyB]);
  const queue = [child];
  for (let head = 0; head < queue.length; head++) {
    for (const other of json.joints) {
      if (other === joint || (other.bodyA !== queue[head] && other.bodyB !== queue[head])) continue;
      const next = other.bodyA === queue[head] ? other.bodyB : other.bodyA;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  const total = [...mass.values()].reduce((sum, value) => sum + value, 0);
  return queue.reduce((sum, id) => sum + mass.get(id), 0) / total;
}

function liftCases(json) {
  const cases = [];
  const restLow = lowest(json, null, Math.PI / 2);
  for (const joint of json.joints) {
    if (limbShare(json, joint) > 0.4) continue;
    for (const angle of [-1, 1]) {
      const value = joint.limits.enabled ? Math.min(Math.max(angle, joint.limits.lower), joint.limits.upper) : angle;
      const depth = restLow - lowest(json, fkPose(json, new Map([[joint.id, { angle: value }]])), Math.PI / 2);
      if (depth > 0.1) cases.push({ joint: joint.id, value, depth });
    }
  }
  return cases;
}

function centerHeight(rag) {
  let mass = 0;
  let height = 0;
  for (const body of rag.bodies.values()) {
    mass += body.GetMass();
    height += body.GetMass() * body.GetWorldCenter().get_y();
  }
  return height / mass;
}

test('every light limb keyed into the ground lifts the whole ragdoll lying beside it', () => {
  for (const build of [bipedRig, humanoidRig]) {
    const rig = fitTorque(build().json);
    const cases = liftCases(rig);
    assert.ok(cases.some((entry) => entry.joint.includes('upper')), `${rig.ragdoll.name}: no arm presses the ground`);
    for (const target of cases) {
      const json = structuredClone(rig);
      addHoldClip(json, new Map([[target.joint, target.value]]), 1);
      const run = scene(json, Math.PI / 2);
      let rise;
      try {
        run.rag.play('hold');
        run.step();
        const start = centerHeight(run.rag);
        for (let i = 0; i < 4 / STEP; i++) run.step();
        rise = centerHeight(run.rag) - start;
      } finally {
        run.destroy();
      }
      assert.ok(rise > 0.6 * target.depth, `${rig.ragdoll.name} ${target.joint}: rose ${rise.toFixed(3)} m of ${target.depth.toFixed(3)} m`);
    }
  }
});
