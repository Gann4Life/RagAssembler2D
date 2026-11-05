import { RagImporter } from '../../lib/ragimporter.js';
import { shortestDelta } from '../../lib/evaluate.js';
import { composeTransforms, invertTransform } from '../../lib/geometry.js';

/**
 * Pose test constants: `step` and `maxSteps` in s and steps, damping in s⁻¹, `forcePerKg` in N/kg,
 * `frequencyHz` in Hz, `dampingRatio` and the rotation motor's `correction` factor without unit.
 * @type {Readonly<{ step: number, maxSteps: number, linearDamping: number, angularDamping: number,
 *   forcePerKg: number, frequencyHz: number, dampingRatio: number, correction: number }>}
 */
export const POSE = Object.freeze({
  step: 1 / 60,
  maxSteps: 4,
  linearDamping: 10,
  angularDamping: 10,
  forcePerKg: 1000,
  frequencyHz: 5,
  dampingRatio: 0.7,
  correction: 0.3,
});

const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
const STEP_EPSILON = 1e-9;
const PIVOT_DEAD_ZONE = 0.001;

/**
 * Shortest signed angle the pointer turns around a pivot when it moves from one point to another. Pure.
 * @param {import('../../lib/geometry.js').Vec2} pivot Pivot, meters.
 * @param {import('../../lib/geometry.js').Vec2} from Previous pointer, meters.
 * @param {import('../../lib/geometry.js').Vec2} to Next pointer, meters.
 * @returns {number} Radians in `(−π, π]`, counterclockwise positive; 0 when either point is within 1 mm of the pivot.
 */
export function turnAbout(pivot, from, to) {
  const fx = from.x - pivot.x;
  const fy = from.y - pivot.y;
  const tx = to.x - pivot.x;
  const ty = to.y - pivot.y;
  if (Math.hypot(fx, fy) < PIVOT_DEAD_ZONE || Math.hypot(tx, ty) < PIVOT_DEAD_ZONE) return 0;
  return shortestDelta(Math.atan2(fy, fx), Math.atan2(ty, tx));
}

function samePointer(Box2D, a, b) {
  return Box2D.getPointer(a) === Box2D.getPointer(b);
}

function pivotOf(Box2D, rag, grabbed, jointId) {
  if (jointId === null || jointId === undefined) {
    const center = grabbed.GetWorldCenter();
    return { x: center.get_x(), y: center.get_y() };
  }
  const joint = rag.joints.get(jointId);
  if (joint === undefined) throw new Error(`Pose: unknown joint "${jointId}"`);
  const anchor = samePointer(Box2D, joint.GetBodyA(), grabbed) ? joint.GetAnchorA() : joint.GetAnchorB();
  return { x: anchor.get_x(), y: anchor.get_y() };
}

function loadAbout(bodies, pivot) {
  let mass = 0;
  let inertia = 0;
  for (const body of bodies.values()) {
    const center = body.GetWorldCenter();
    const m = body.GetMass();
    const dx = center.get_x() - pivot.x;
    const dy = center.get_y() - pivot.y;
    const local = body.GetLocalCenter();
    const own = body.GetInertia() - m * (local.get_x() ** 2 + local.get_y() ** 2);
    mass += m;
    inertia += own + m * (dx * dx + dy * dy);
  }
  return { mass, inertia };
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

/**
 * Starts a pose test: a zero-gravity LiquidFun world holding the ragdoll at `options.root` in rest pose, or with the
 * bodies of `options.start` placed at those root-local transforms, every body damped, motors off, and a mouse joint
 * pulling `options.bodyId` from `options.point`. With `options.rotate`, a motor joint instead turns the grabbed body
 * about a pivot fixed when the rotation starts: the anchor of `rotate.joint`, or the body's center of mass when it is
 * `null`; `setRotate` switches between the two during the test. Every body, `rootBody` included, moves freely. Owns
 * every native object it creates until `destroy`.
 * @param {*} Box2D The liquidfun.js namespace.
 * @param {object} json A `.rag.json` document.
 * @param {import('../tools/tool.js').PoseSessionOptions} options Root transform, grabbed body id, press point, start
 *   pose and rotation.
 * @returns {import('../tools/tool.js').PoseSession} The session.
 * @throws {import('../../lib/ragimporter.js').RagFormatError} When the document has validation errors; nothing
 *   native is created.
 * @throws {Error} When the body or joint id is unknown or a native call fails; everything built is released first.
 */
export function createPoseSession(Box2D, json, { root, bodyId, point, start = null, rotate = null }) {
  const def = RagImporter.parse(poseTestJson(json));
  const gravity = new Box2D.b2Vec2(0, 0);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const scratch = new Box2D.b2Vec2(0, 0);
  const target = { x: point.x, y: point.y };
  const previous = { x: point.x, y: point.y };
  let rag = null;
  let ground = null;
  let grabbed = null;
  let mouse = null;
  let motor = null;
  let pivot = null;
  let origin = null;
  let localGrab = null;
  let rotation = 0;

  const release = () => {
    if (mouse !== null) world.DestroyJoint(mouse);
    if (motor !== null) world.DestroyJoint(motor);
    if (rag !== null) rag.destroy();
    if (ground !== null) world.DestroyBody(ground);
    Box2D.destroy(scratch);
    Box2D.destroy(world);
  };

  const bodyTransform = () => {
    const position = grabbed.GetPosition();
    return { x: position.get_x(), y: position.get_y(), angle: grabbed.GetAngle() };
  };

  const grabPoint = () => {
    if (mouse !== null) {
      const anchor = mouse.GetAnchorB();
      return { x: anchor.get_x(), y: anchor.get_y() };
    }
    const placed = composeTransforms(bodyTransform(), localGrab);
    return { x: placed.x, y: placed.y };
  };

  const detach = () => {
    if (mouse !== null) world.DestroyJoint(mouse);
    if (motor !== null) world.DestroyJoint(motor);
    mouse = null;
    motor = null;
  };

  const attachMouse = (anchor) => {
    const jointDef = new Box2D.b2MouseJointDef();
    try {
      scratch.set_x(anchor.x);
      scratch.set_y(anchor.y);
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
    pivot = null;
    scratch.set_x(target.x);
    scratch.set_y(target.y);
    mouse.SetTarget(scratch);
  };

  const attachMotor = (nextPivot, anchor) => {
    origin = bodyTransform();
    localGrab = composeTransforms(invertTransform(origin), { x: anchor.x, y: anchor.y, angle: 0 });
    const load = loadAbout(rag.bodies, nextPivot);
    const jointDef = new Box2D.b2MotorJointDef();
    try {
      scratch.set_x(origin.x);
      scratch.set_y(origin.y);
      jointDef.set_bodyA(ground);
      jointDef.set_bodyB(grabbed);
      jointDef.set_linearOffset(scratch);
      jointDef.set_angularOffset(origin.angle);
      jointDef.set_maxForce(POSE.forcePerKg * load.mass);
      jointDef.set_maxTorque(POSE.forcePerKg * load.inertia);
      jointDef.set_correctionFactor(POSE.correction);
      motor = Box2D.castObject(world.CreateJoint(jointDef), Box2D.b2MotorJoint);
    } finally {
      Box2D.destroy(jointDef);
    }
    pivot = nextPivot;
    rotation = 0;
    previous.x = target.x;
    previous.y = target.y;
  };

  try {
    rag = def.spawn(world, { x: root.x, y: root.y, angle: root.angle, flipX: false });
    const bodies = rag.bodies;
    grabbed = bodies.get(bodyId) ?? null;
    if (grabbed === null) throw new Error(`Pose: unknown body "${bodyId}"`);
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
    if (rotate === null || rotate === undefined) attachMouse(point);
    else attachMotor(pivotOf(Box2D, rag, grabbed, rotate.joint), point);
    grabbed.SetAwake(true);
  } catch (error) {
    release();
    throw error;
  }

  const toRoot = invertTransform(root);
  let accumulated = 0;
  let destroyed = false;

  const alive = () => {
    if (destroyed) throw new Error('Pose session is destroyed');
  };

  const turn = (next) => {
    const step = turnAbout(pivot, previous, next);
    if (step === 0 && Math.hypot(next.x - pivot.x, next.y - pivot.y) < PIVOT_DEAD_ZONE) return;
    rotation += step;
    previous.x = next.x;
    previous.y = next.y;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const dx = origin.x - pivot.x;
    const dy = origin.y - pivot.y;
    scratch.set_x(pivot.x + cos * dx - sin * dy);
    scratch.set_y(pivot.y + sin * dx + cos * dy);
    motor.SetLinearOffset(scratch);
    motor.SetAngularOffset(origin.angle + rotation);
  };

  return Object.freeze({
    drag(next) {
      alive();
      target.x = next.x;
      target.y = next.y;
      if (motor !== null) {
        turn(next);
        return;
      }
      scratch.set_x(next.x);
      scratch.set_y(next.y);
      mouse.SetTarget(scratch);
    },
    setRotate(next) {
      alive();
      const anchor = grabPoint();
      if (next === null || next === undefined) {
        if (mouse !== null) return;
        detach();
        attachMouse(anchor);
      } else {
        const nextPivot = pivotOf(Box2D, rag, grabbed, next.joint);
        detach();
        attachMotor(nextPivot, anchor);
      }
      grabbed.SetAwake(true);
    },
    advance(seconds) {
      alive();
      accumulated += seconds;
      const whole = Math.floor(accumulated / POSE.step + STEP_EPSILON);
      accumulated = Math.max(0, accumulated - whole * POSE.step);
      const steps = Math.min(whole, POSE.maxSteps);
      for (let i = 0; i < steps; i++) {
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
      return {
        anchor: grabPoint(),
        target: { x: target.x, y: target.y },
        pivot: pivot === null ? null : { x: pivot.x, y: pivot.y },
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      release();
    },
  });
}
