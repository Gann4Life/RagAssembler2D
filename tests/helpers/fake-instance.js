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

/**
 * Builds a `RagInstance` over a fake world with two fake joints, `j_a` and `j_b`, and no bodies.
 * @param {object} [options] Definition data overrides.
 * @param {{ strength: number, gain: number, damping: number }} [options.channels] Root channels.
 * @param {ReadonlyArray<object>} [options.clips] Clips as in the frozen definition data.
 * @param {boolean} [options.flipX] Mirror flag.
 * @param {number} [options.angle] Initial angle of both joints, radians.
 * @param {number} [options.speed] Initial speed of both joints, rad/s.
 * @returns {{ rag: RagInstance, joints: Map<string, object> }} The instance and its fake joints.
 */
export function fakeInstance({ channels = { strength: 1, gain: 1, damping: 1 }, clips = [], flipX = false, angle = 0, speed = 0 } = {}) {
  const joints = new Map([['j_a', fakeJoint(angle, speed)], ['j_b', fakeJoint(angle, speed)]]);
  const data = {
    channels,
    bodies: [],
    joints: [{ id: 'j_a', motor: MOTOR }, { id: 'j_b', motor: { ...MOTOR, gain: 4, maxTorque: 10 } }],
    clips,
  };
  const rag = new RagInstance({
    world: { IsLocked: () => false, DestroyJoint() {}, DestroyBody() {} },
    bodies: new Map(),
    joints,
    byName: { body: new Map(), joint: new Map(), shape: new Map() },
    root: null,
    view: { parent: null, destroy() {} },
    flipX,
    aimAxes: new Map(),
    data,
  });
  return { rag, joints };
}
