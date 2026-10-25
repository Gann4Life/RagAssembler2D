import { RagImporter } from '../../lib/ragimporter.js';
import { composeTransforms, invertTransform } from '../../lib/geometry.js';

/**
 * Pose test constants: `step` and `maxSteps` in s and steps, damping in s⁻¹, `forcePerKg` in N/kg,
 * `frequencyHz` in Hz, `dampingRatio` without unit. Falloff (`DESIGN.md` §5.5): a joint whose nearer body is `d` hops
 * from the grabbed body gets friction up to `falloffMax × (1 − falloffRatio^d)` times the pull's current force times
 * the distance from the grabbed point to the joint anchor, so it yields less the farther it is and never holds.
 * @type {Readonly<{ step: number, maxSteps: number, linearDamping: number, angularDamping: number,
 *   forcePerKg: number, frequencyHz: number, dampingRatio: number, falloffMax: number, falloffRatio: number }>}
 */
export const POSE = Object.freeze({
  step: 1 / 60,
  maxSteps: 4,
  linearDamping: 10,
  angularDamping: 10,
  forcePerKg: 1000,
  frequencyHz: 5,
  dampingRatio: 0.7,
  falloffMax: 0.8,
  falloffRatio: 0.5,
});

const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
const STEP_EPSILON = 1e-9;

function hopDistances(json, bodyId) {
  const neighbors = new Map();
  for (const joint of Array.isArray(json?.joints) ? json.joints : []) {
    for (const [from, to] of [[joint?.bodyA, joint?.bodyB], [joint?.bodyB, joint?.bodyA]]) {
      if (typeof from !== 'string' || typeof to !== 'string') continue;
      if (!neighbors.has(from)) neighbors.set(from, []);
      neighbors.get(from).push(to);
    }
  }
  const hops = new Map([[bodyId, 0]]);
  const queue = [bodyId];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const next of neighbors.get(current) ?? []) {
      if (hops.has(next)) continue;
      hops.set(next, hops.get(current) + 1);
      queue.push(next);
    }
  }
  return hops;
}

function frictionShare(hops) {
  return Number.isFinite(hops) ? POSE.falloffMax * (1 - POSE.falloffRatio ** hops) : POSE.falloffMax;
}

/**
 * The document reduced to what the pose test simulates: no sprites, no clips, no shape sprites, and shapes that
 * collide with nothing. Never mutates `json`.
 * @param {object} json A `.rag.json` document.
 * @returns {object} A new document object.
 */
export function poseTestJson(json) {
  const copy = structuredClone(json);
  copy.sprites = [];
  copy.clips = [];
  for (const body of Array.isArray(copy.bodies) ? copy.bodies : []) {
    for (const shape of Array.isArray(body?.fixtures) ? body.fixtures : []) {
      if (shape === null || typeof shape !== 'object') continue;
      shape.sprite = null;
      shape.selfCollide = false;
      shape.filter = { ...(shape.filter ?? {}), maskBits: 0 };
    }
  }
  return copy;
}

function jointFrictions(rag, json, bodyId) {
  const hops = hopDistances(json, bodyId);
  const hopsOf = (id) => hops.get(id) ?? Infinity;
  const frictions = [];
  for (const joint of Array.isArray(json.joints) ? json.joints : []) {
    const native = rag.joints.get(joint.id);
    if (native === undefined) continue;
    native.SetMaxMotorTorque(0);
    native.SetMotorSpeed(0);
    native.EnableMotor(true);
    frictions.push({ joint: native, share: frictionShare(Math.min(hopsOf(joint.bodyA), hopsOf(joint.bodyB))) });
  }
  return frictions;
}

function applyFrictions(frictions, mouse) {
  const reaction = mouse.GetReactionForce(1 / POSE.step);
  const force = Math.hypot(reaction.get_x(), reaction.get_y());
  const grab = mouse.GetAnchorB();
  const gx = grab.get_x();
  const gy = grab.get_y();
  for (const { joint, share } of frictions) {
    const anchor = joint.GetAnchorA();
    joint.SetMaxMotorTorque(share * force * Math.hypot(gx - anchor.get_x(), gy - anchor.get_y()));
  }
}

/**
 * Starts a pose test: a zero-gravity LiquidFun world with the ragdoll at `options.root` in rest pose, or with the
 * bodies of `options.start` placed at those root-local transforms, every body damped, and a mouse joint pulling
 * `options.bodyId` from `options.point`. Every body, `rootBody` included, moves freely; nothing is anchored. Every
 * joint motor runs at zero speed as friction capped below the most torque the pull's current force can exert about
 * it, by joint distance from the grabbed body (see {@link POSE}), so distant joints bend less but always yield. Owns every native object it
 * creates until `destroy`.
 * @param {*} Box2D The liquidfun.js namespace.
 * @param {object} json A `.rag.json` document.
 * @param {import('../tools/tool.js').PoseSessionOptions} options Root transform, grabbed body id and press point.
 * @returns {import('../tools/tool.js').PoseSession} The session.
 * @throws {import('../../lib/ragimporter.js').RagFormatError} When the document has validation errors; nothing
 *   native is created.
 * @throws {Error} When the body id is unknown or a native call fails; everything built is released first.
 */
export function createPoseSession(Box2D, json, { root, bodyId, point, start = null }) {
  const testJson = poseTestJson(json);
  const def = RagImporter.parse(testJson);
  const gravity = new Box2D.b2Vec2(0, 0);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const scratch = new Box2D.b2Vec2(0, 0);
  let rag = null;
  let ground = null;
  let mouse = null;
  let frictions = [];

  const release = () => {
    if (mouse !== null) world.DestroyJoint(mouse);
    if (rag !== null) rag.destroy();
    if (ground !== null) world.DestroyBody(ground);
    Box2D.destroy(scratch);
    Box2D.destroy(world);
  };

  let grabbed;
  try {
    rag = def.spawn(world, { x: root.x, y: root.y, angle: root.angle, flipX: false });
    const bodies = rag.bodies;
    grabbed = bodies.get(bodyId);
    if (grabbed === undefined) throw new Error(`Pose: unknown body "${bodyId}"`);
    for (const [id, local] of start ?? []) {
      const body = bodies.get(id);
      if (body === undefined) continue;
      const placed = composeTransforms(root, local);
      scratch.set_x(placed.x);
      scratch.set_y(placed.y);
      body.SetTransform(scratch, placed.angle);
    }
    for (const body of bodies.values()) {
      body.SetLinearDamping(POSE.linearDamping);
      body.SetAngularDamping(POSE.angularDamping);
    }
    const groundDef = new Box2D.b2BodyDef();
    try {
      ground = world.CreateBody(groundDef);
    } finally {
      Box2D.destroy(groundDef);
    }
    const jointDef = new Box2D.b2MouseJointDef();
    try {
      scratch.set_x(point.x);
      scratch.set_y(point.y);
      jointDef.set_bodyA(ground);
      jointDef.set_bodyB(grabbed);
      jointDef.set_target(scratch);
      jointDef.set_maxForce(POSE.forcePerKg * grabbed.GetMass());
      jointDef.set_frequencyHz(POSE.frequencyHz);
      jointDef.set_dampingRatio(POSE.dampingRatio);
      mouse = Box2D.castObject(world.CreateJoint(jointDef), Box2D.b2MouseJoint);
    } finally {
      Box2D.destroy(jointDef);
    }
    frictions = jointFrictions(rag, testJson, bodyId);
    grabbed.SetAwake(true);
  } catch (error) {
    release();
    throw error;
  }

  const toRoot = invertTransform(root);
  const target = { x: point.x, y: point.y };
  let accumulated = 0;
  let destroyed = false;

  const alive = () => {
    if (destroyed) throw new Error('Pose session is destroyed');
  };

  return Object.freeze({
    drag(next) {
      alive();
      target.x = next.x;
      target.y = next.y;
      scratch.set_x(next.x);
      scratch.set_y(next.y);
      mouse.SetTarget(scratch);
    },
    advance(seconds) {
      alive();
      accumulated += seconds;
      const whole = Math.floor(accumulated / POSE.step + STEP_EPSILON);
      accumulated = Math.max(0, accumulated - whole * POSE.step);
      const steps = Math.min(whole, POSE.maxSteps);
      for (let i = 0; i < steps; i++) {
        applyFrictions(frictions, mouse);
        world.Step(POSE.step, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
      }
    },
    pose() {
      alive();
      const pose = new Map();
      for (const [id, body] of rag.bodies) {
        const position = body.GetPosition();
        const placed = { x: position.get_x(), y: position.get_y(), angle: body.GetAngle() };
        pose.set(id, composeTransforms(toRoot, placed));
      }
      return pose;
    },
    grab() {
      alive();
      const anchor = mouse.GetAnchorB();
      return { anchor: { x: anchor.get_x(), y: anchor.get_y() }, target: { x: target.x, y: target.y } };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      release();
    },
  });
}
