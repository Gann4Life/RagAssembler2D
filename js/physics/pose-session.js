import { RagImporter } from '../../lib/ragimporter.js';
import { composeTransforms, invertTransform } from '../../lib/geometry.js';

/**
 * Pose test constants: `step` and `maxSteps` in s and steps, damping in s⁻¹, `forcePerKg` in N/kg,
 * `frequencyHz` in Hz, `dampingRatio` without unit.
 * @type {Readonly<{ step: number, maxSteps: number, linearDamping: number, angularDamping: number,
 *   forcePerKg: number, frequencyHz: number, dampingRatio: number }>}
 */
export const POSE = Object.freeze({
  step: 1 / 60,
  maxSteps: 4,
  linearDamping: 10,
  angularDamping: 10,
  forcePerKg: 1000,
  frequencyHz: 5,
  dampingRatio: 0.7,
});

const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
const STEP_EPSILON = 1e-9;
const POSE_TEST_EDITOR_VERSION = '0.0.0';

/**
 * The document reduced to what the pose test simulates: no sprites, no clips, no shape sprites, and shapes that
 * collide with nothing; a missing `meta.editorVersion` (a document never saved) is filled with a placeholder, since
 * meta is not part of the test. Never mutates `json`.
 * @param {object} json A `.rag.json` document.
 * @returns {object} A new document object.
 */
export function poseTestJson(json) {
  const copy = structuredClone(json);
  if (copy.meta !== null && typeof copy.meta === 'object' && copy.meta.editorVersion === undefined) {
    copy.meta.editorVersion = POSE_TEST_EDITOR_VERSION;
  }
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
 * Starts a pose test: a zero-gravity LiquidFun world holding the ragdoll at `options.root` in rest pose, every
 * body damped, motors off, and a mouse joint pulling `options.bodyId` from `options.point`. Owns every native
 * object it creates until `destroy`.
 * @param {*} Box2D The liquidfun.js namespace.
 * @param {object} json A `.rag.json` document.
 * @param {import('../tools/tool.js').PoseSessionOptions} options Root transform, grabbed body id and press point.
 * @returns {import('../tools/tool.js').PoseSession} The session.
 * @throws {import('../../lib/ragimporter.js').RagFormatError} When the document has validation errors; nothing
 *   native is created.
 * @throws {Error} When the body id is unknown or a native call fails; everything built is released first.
 */
export function createPoseSession(Box2D, json, { root, bodyId, point }) {
  const def = RagImporter.parse(poseTestJson(json));
  const gravity = new Box2D.b2Vec2(0, 0);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const scratch = new Box2D.b2Vec2(0, 0);
  let rag = null;
  let ground = null;
  let mouse = null;

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
      for (let i = 0; i < steps; i++) world.Step(POSE.step, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
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
