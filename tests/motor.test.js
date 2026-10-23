import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveMotor } from '../lib/instance.js';
import { MOTOR, fakeJoint, fakeInstance } from './helpers/fake-instance.js';

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test('driveMotor applies the PD formula', () => {
  const joint = fakeJoint(0.2, 1.5);
  driveMotor(joint, { angle: 0.5, S: 0.5, G: 10, D: 0.5 }, MOTOR);
  near(joint.motorSpeed, 10 * 0.3 - 0.5 * 1.5);
  near(joint.maxTorque, 40);
  assert.equal(joint.enabled, true);
});

test('driveMotor clamps the motor speed to maxSpeed', () => {
  const up = fakeJoint(0, 0);
  driveMotor(up, { angle: 10, S: 1, G: 10, D: 0 }, MOTOR);
  assert.equal(up.motorSpeed, 20);
  const down = fakeJoint(0, 0);
  driveMotor(down, { angle: -10, S: 1, G: 10, D: 0 }, MOTOR);
  assert.equal(down.motorSpeed, -20);
});

test('driveMotor disables the motor when S is 0', () => {
  const joint = fakeJoint(0.1, 0);
  driveMotor(joint, { angle: 0, S: 0, G: 10, D: 1 }, MOTOR);
  assert.equal(joint.enabled, false);
  assert.equal(joint.maxTorque, 0);
});

test('update drives every joint toward rest with base motor values', () => {
  const { rag, joints } = fakeInstance({ angle: 0.1, speed: 0.2 });
  rag.update(1 / 60);
  const a = joints.get('j_a');
  near(a.motorSpeed, 10 * -0.1 - 0.5 * 0.2);
  near(a.maxTorque, 80);
  assert.equal(a.enabled, true);
  const b = joints.get('j_b');
  near(b.motorSpeed, 4 * -0.1 - 0.5 * 0.2);
  near(b.maxTorque, 10);
});

test('runtime multipliers scale S, G and D', () => {
  const { rag, joints } = fakeInstance({ angle: 0.1, speed: 0.2 });
  rag.setStrength(0.5);
  rag.setGain(0.5);
  rag.setDamping(0.25);
  rag.update(1 / 60);
  const a = joints.get('j_a');
  near(a.maxTorque, 40);
  near(a.motorSpeed, 5 * -0.1 - 0.125 * 0.2);
});

test('root channels and runtime multipliers combine', () => {
  const { rag, joints } = fakeInstance({ channels: { strength: 0.5, gain: 1, damping: 1 } });
  rag.setStrength(0.5);
  rag.update(0);
  near(joints.get('j_a').maxTorque, 20);
});

test('runtime strength 0 leaves the ragdoll limp', () => {
  const { rag, joints } = fakeInstance({ angle: 0.3 });
  rag.setStrength(0);
  rag.update(1 / 60);
  for (const joint of joints.values()) {
    assert.equal(joint.enabled, false);
    assert.equal(joint.maxTorque, 0);
  }
});

test('runtime multipliers clamp to 0-1 and reject non-numbers', () => {
  const { rag, joints } = fakeInstance();
  rag.setStrength(3);
  rag.update(0);
  near(joints.get('j_a').maxTorque, 80);
  assert.throws(() => rag.setGain(Number.NaN), TypeError);
  assert.throws(() => rag.setDamping('1'), TypeError);
});

test('update rejects a bad dt and does nothing after destroy', () => {
  const { rag, joints } = fakeInstance();
  assert.throws(() => rag.update(-1), TypeError);
  assert.throws(() => rag.update(Number.POSITIVE_INFINITY), TypeError);
  rag.destroy();
  rag.update(1 / 60);
  assert.equal(joints.size, 0);
});
