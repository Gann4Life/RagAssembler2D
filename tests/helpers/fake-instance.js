import { RagInstance } from '../../lib/instance.js';

/** Base motor values of joint `j_a`; `j_b` uses gain 4 and maxTorque 10. */
export const MOTOR = Object.freeze({ maxTorque: 80, gain: 10, damping: 0.5, maxSpeed: 20 });

/**
 * Fake `b2RevoluteJoint` that records the motor writes.
 * @param {number} [angle] Joint angle, radians.
 * @param {number} [speed] Joint speed, rad/s.
 * @returns {object} The fake joint; `motorSpeed`, `maxTorque` and `enabled` hold the last writes.
 */
export function fakeJoint(angle = 0, speed = 0) {
  return {
    angle,
    speed,
    motorSpeed: null,
    maxTorque: null,
    enabled: null,
    GetJointAngle() { return this.angle; },
    GetJointSpeed() { return this.speed; },
    SetMotorSpeed(v) { this.motorSpeed = v; },
    SetMaxMotorTorque(v) { this.maxTorque = v; },
    EnableMotor(v) { this.enabled = v; },
  };
}

/** Base balance values of the fake instance; its only balance part is `b_root`, 1 kg and 0.5 kg·m². */
export const BALANCE = Object.freeze({
  enabled: true,
  maxTorque: 50,
  gain: 10,
  damping: 0.5,
  maxSpeed: 20,
  parts: Object.freeze([Object.freeze({ id: 'b_root', mass: 1, inertia: 0.5 })]),
});

function fakeVec(x, y) {
  return { get_x: () => x, get_y: () => y };
}

/**
 * Fake scratch `b2Vec2` that keeps the last `set_x` and `set_y` values.
 * @returns {object} The fake vector.
 */
export function fakeForce() {
  return { x: 0, y: 0, set_x(v) { this.x = v; }, set_y(v) { this.y = v; } };
}

/**
 * Fake `b2Body` that records the applied torques and forces.
 * @param {number} [angle] World angle, radians.
 * @param {number} [angularVelocity] Angular velocity, rad/s.
 * @param {{ center?: number[], velocity?: number[] }} [motion] World center of mass and linear velocity, default 0.
 * @returns {object} The fake body; `torques` lists the `[torque, wake]` pairs and `forces` the `[fx, fy, wake]`
 *   triples applied at the center.
 */
export function fakeBody(angle = 0, angularVelocity = 0, { center = [0, 0], velocity = [0, 0] } = {}) {
  return {
    angle,
    angularVelocity,
    torques: [],
    forces: [],
    GetAngle() { return this.angle; },
    GetAngularVelocity() { return this.angularVelocity; },
    GetWorldCenter() { return fakeVec(...center); },
    GetLinearVelocity() { return fakeVec(...velocity); },
    ApplyTorque(torque, wake) { this.torques.push([torque, wake]); },
    ApplyForce(force, point, wake) { this.forces.push([force.x, force.y, wake]); },
  };
}

/**
 * Builds a `RagInstance` over a fake world with two fake joints, `j_a` and `j_b`, and a fake root body `b_root`.
 * @param {object} [options] Definition data overrides.
 * @param {{ strength: number, gain: number, damping: number }} [options.channels] Root channels.
 * @param {ReadonlyArray<object>} [options.clips] Clips as in the frozen definition data.
 * @param {boolean} [options.flipX] Mirror flag.
 * @param {number} [options.angle] Initial angle of both joints, radians.
 * @param {number} [options.speed] Initial speed of both joints, rad/s.
 * @param {object} [options.balance] Balance data; `BALANCE` by default.
 * @param {object} [options.root] Root body; a new `fakeBody()` by default.
 * @param {number} [options.restAngle] Balance reference angle, radians.
 * @returns {{ rag: RagInstance, joints: Map<string, object>, root: object }} The instance, its fake joints and root body.
 */
export function fakeInstance({ channels = { strength: 1, gain: 1, damping: 1 }, clips = [], flipX = false, angle = 0, speed = 0, balance = BALANCE, root = fakeBody(), restAngle = 0 } = {}) {
  const joints = new Map([['j_a', fakeJoint(angle, speed)], ['j_b', fakeJoint(angle, speed)]]);
  const data = {
    channels,
    balance,
    bodies: [],
    joints: [{ id: 'j_a', motor: MOTOR }, { id: 'j_b', motor: { ...MOTOR, gain: 4, maxTorque: 10 } }],
    clips,
  };
  const rag = new RagInstance({
    world: { IsLocked: () => false, DestroyJoint() {}, DestroyBody() {} },
    bodies: new Map([['b_root', root]]),
    joints,
    byName: { body: new Map(), joint: new Map(), shape: new Map() },
    root,
    view: { parent: null, destroy() {} },
    flipX,
    aimAxes: new Map(),
    data,
    restAngle,
    force: fakeForce(),
  });
  return { rag, joints, root };
}
