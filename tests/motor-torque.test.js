import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOTOR_TORQUE, motorTorqueSuggestions } from '../lib/motor.js';

function circleBody(id, position, radius, density = 1) {
  return { id, position, angle: 0, fixtures: [{ shape: { type: 'circle', center: [0, 0], radius }, density }] };
}

function boxBody(id, position, width, height, density = 1) {
  return { id, position, angle: 0, fixtures: [{ shape: { type: 'box', center: [0, 0], width, height, angle: 0 }, density }] };
}

function joint(id, bodyA, bodyB, anchor) {
  return { id, bodyA, bodyB, anchor };
}

function roundUp2(value) {
  const scale = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.ceil(value / scale - 1e-9) * scale;
}

function boxInertia(mass, width, height, distance) {
  return (mass * (width * width + height * height)) / 12 + mass * distance * distance;
}

function need(a, b, totalMass, lever) {
  return ((a * b) / (a + b)) * 1000 + 2 * totalMass * 10 * lever;
}

test('MOTOR_TORQUE holds the frozen constants of DESIGN §3.1', () => {
  assert.ok(Object.isFrozen(MOTOR_TORQUE));
  assert.deepEqual({ ...MOTOR_TORQUE }, { alpha: 1000, balanceAlpha: 100, gravity: 10, min: 0.001, overpoweredFactor: 1000, margin: 2 });
});

test('the DESIGN §3.1 example: two 1 kg boxes hinged between them get 75 N·m', () => {
  const doc = {
    bodies: [boxBody('a', [0, 0], 0.5, 0.5, 4), boxBody('b', [0, 0.5], 0.5, 0.5, 4)],
    joints: [joint('j', 'a', 'b', [0, 0.25])],
  };
  assert.equal(motorTorqueSuggestions(doc).get('j'), 75);
});

test('a two-body joint gets roundUp2(I_eff * alpha + margin * M * g * shorter reach)', () => {
  const doc = {
    bodies: [boxBody('b_big', [0, 0], 2, 2), circleBody('b_tip', [1.5, 0], 0.25)],
    joints: [joint('j', 'b_big', 'b_tip', [1, 0])],
  };
  const massTip = Math.PI / 16;
  const inertiaBig = boxInertia(4, 2, 2, 1);
  const inertiaTip = (massTip * 0.0625) / 2 + massTip * 0.25;
  const expected = need(inertiaBig, inertiaTip, 4 + massTip, 0.75);
  const value = motorTorqueSuggestions(doc).get('j');
  assert.equal(value, roundUp2(expected));
  assert.ok(value >= expected && value < expected * 1.1);
});

test('the lever is the shorter side reach with every joint of that side straightened', () => {
  const straight = {
    bodies: [boxBody('base', [0, 0], 4, 1), boxBody('upper', [2.5, 0], 1, 0.2), boxBody('lower', [3.5, 0], 1, 0.2)],
    joints: [joint('shoulder', 'base', 'upper', [2, 0]), joint('elbow', 'upper', 'lower', [3, 0])],
  };
  const bent = structuredClone(straight);
  bent.bodies[2] = { ...boxBody('lower', [3, 0.5], 1, 0.2), angle: Math.PI / 2 };
  const straightValue = motorTorqueSuggestions(straight).get('shoulder');
  const bentValue = motorTorqueSuggestions(bent).get('shoulder');
  const arm = boxInertia(0.2, 1, 0.2, 0.5) + boxInertia(0.2, 1, 0.2, 1.5);
  const expected = need(boxInertia(4, 4, 1, 2), arm, 4.4, 1 + Math.hypot(1, 0.1));
  assert.equal(straightValue, roundUp2(expected));
  const bentArm = boxInertia(0.2, 1, 0.2, 0.5) + boxInertia(0.2, 1, 0.2, Math.hypot(1, 0.5));
  assert.equal(bentValue, roundUp2(need(boxInertia(4, 4, 1, 2), bentArm, 4.4, 1 + Math.hypot(1, 0.1))));
});

test('a light limb joint carries the whole ragdoll weight, so a heavier body anywhere raises it', () => {
  const limb = (extra) => ({
    bodies: [boxBody('torso', [0, 0], 1, 1), boxBody('finger', [0.6, 0], 0.2, 0.05), ...extra],
    joints: [joint('knuckle', 'torso', 'finger', [0.5, 0]), ...(extra.length ? [joint('hip', 'torso', 'leg', [0, -0.5])] : [])],
  });
  const light = motorTorqueSuggestions(limb([])).get('knuckle');
  const heavy = motorTorqueSuggestions(limb([boxBody('leg', [0, -1.5], 1, 2, 3)])).get('knuckle');
  assert.ok(heavy > 5 * light, `${heavy} vs ${light}`);
  const fingerReach = Math.hypot(0.2, 0.025);
  assert.ok(heavy >= 2 * (1 + 0.01 + 6) * 10 * fingerReach, `${heavy}`);
});

test('sensor shapes add mass but are no lever', () => {
  const plain = {
    bodies: [boxBody('a', [0, 0], 1, 1), boxBody('b', [1, 0], 1, 0.2)],
    joints: [joint('j', 'a', 'b', [0.5, 0])],
  };
  const probe = structuredClone(plain);
  probe.bodies[1].fixtures.push({ shape: { type: 'circle', center: [3, 0], radius: 0.5 }, density: 1e-6, isSensor: true });
  assert.equal(motorTorqueSuggestions(probe).get('j'), motorTorqueSuggestions(plain).get('j'));
  probe.bodies[1].fixtures[1].isSensor = false;
  assert.ok(motorTorqueSuggestions(probe).get('j') > motorTorqueSuggestions(plain).get('j'));
});

test('rounding up to two significant digits and the minimum', () => {
  const tiny = {
    bodies: [boxBody('a', [0, 0], 0.01, 0.01, 1e-6), boxBody('b', [0.01, 0], 0.01, 0.01, 1e-6)],
    joints: [joint('j', 'a', 'b', [0.005, 0])],
  };
  assert.equal(motorTorqueSuggestions(tiny).get('j'), 0.001);
  const large = {
    bodies: [boxBody('a', [0, 0], 4, 4), boxBody('b', [3, 0], 2, 1)],
    joints: [joint('j', 'a', 'b', [2, 0])],
  };
  const expected = need(boxInertia(16, 4, 4, 2), boxInertia(2, 2, 1, 1), 18, Math.hypot(2, 0.5));
  const value = motorTorqueSuggestions(large).get('j');
  assert.equal(value, roundUp2(expected));
  assert.equal(value, 3600);
  assert.ok(value > expected);
});

test('the value does not depend on body order or on which side is bodyA', () => {
  const bodies = [boxBody('a', [0, 0], 1, 1), boxBody('b', [1, 0], 1, 0.5), boxBody('c', [2, 0], 1, 0.5)];
  const forward = motorTorqueSuggestions({ bodies, joints: [joint('j1', 'a', 'b', [0.5, 0]), joint('j2', 'b', 'c', [1.5, 0])] });
  const backward = motorTorqueSuggestions({
    bodies: [...bodies].reverse(),
    joints: [joint('j2', 'c', 'b', [1.5, 0]), joint('j1', 'b', 'a', [0.5, 0])],
  });
  assert.equal(forward.get('j1'), backward.get('j1'));
  assert.equal(forward.get('j2'), backward.get('j2'));
  assert.ok(forward.get('j1') > forward.get('j2'));
});

test('a loop joint uses its own two bodies as the sides and the whole loop as the weight', () => {
  const bodies = [boxBody('a', [0, 0], 1, 1), boxBody('b', [1, 0], 1, 1), boxBody('c', [0.5, 1], 1, 1)];
  const looped = motorTorqueSuggestions({
    bodies,
    joints: [joint('ab', 'a', 'b', [0.5, 0]), joint('bc', 'b', 'c', [1, 0.5]), joint('ca', 'c', 'a', [0, 0.5])],
  });
  const inertia = boxInertia(1, 1, 1, 0.5);
  const reach = Math.hypot(1, 0.5);
  assert.equal(looped.get('ab'), roundUp2(need(inertia, inertia, 3, reach)));
});

test('joints without a usable pair or mass get null', () => {
  const bodies = [boxBody('a', [0, 0], 1, 1), boxBody('b', [1, 0], 1, 1), boxBody('z', [2, 0], 1, 1, 0)];
  const result = motorTorqueSuggestions({
    bodies,
    joints: [
      joint('unknown', 'a', 'nope', [0.5, 0]),
      joint('unset', null, null, [0, 0]),
      joint('same', 'a', 'a', [0, 0]),
      joint('massless', 'b', 'z', [1.5, 0]),
      joint('anchorless', 'a', 'b', null),
      joint('ok', 'a', 'b', [0.5, 0]),
    ],
  });
  assert.deepEqual([...result.keys()], ['unknown', 'unset', 'same', 'massless', 'anchorless', 'ok']);
  for (const id of ['unknown', 'unset', 'same', 'massless', 'anchorless']) assert.equal(result.get(id), null, id);
  assert.equal(typeof result.get('ok'), 'number');
});

test('bodies are placed root-local through position and angle', () => {
  const straight = motorTorqueSuggestions({
    bodies: [boxBody('a', [0, 0], 1, 1), { ...boxBody('b', [1, 0], 1, 0.2), fixtures: [{ shape: { type: 'box', center: [0.5, 0], width: 1, height: 0.2, angle: 0 }, density: 1 }] }],
    joints: [joint('j', 'a', 'b', [1, 0])],
  });
  const turned = motorTorqueSuggestions({
    bodies: [boxBody('a', [0, 0], 1, 1), { ...boxBody('b', [1, 0], 1, 0.2), angle: Math.PI / 2, fixtures: [{ shape: { type: 'box', center: [0.5, 0], width: 1, height: 0.2, angle: 0 }, density: 1 }] }],
    joints: [joint('j', 'a', 'b', [1, 0])],
  });
  assert.equal(straight.get('j'), turned.get('j'));
  const shifted = motorTorqueSuggestions({
    bodies: [boxBody('a', [0, 0], 1, 1), boxBody('b', [1.5, 0], 1, 0.2)],
    joints: [joint('j', 'a', 'b', [1, 0])],
  });
  assert.equal(shifted.get('j'), straight.get('j'));
});

test('never throws and skips what it cannot read', () => {
  for (const doc of [undefined, null, 42, {}, { bodies: 5, joints: 'x' }, { bodies: [null, 1, { id: 3 }], joints: [null, 7] }]) {
    assert.ok(motorTorqueSuggestions(doc) instanceof Map);
  }
  const broken = motorTorqueSuggestions({
    bodies: [boxBody('a', [0, 0], 1, 1), { id: 'b', position: 'x', angle: 0, fixtures: [] }, { ...boxBody('c', [1, 0], 1, 1), fixtures: [null, { shape: null }] }],
    joints: [joint('ab', 'a', 'b', [0.5, 0]), joint('ac', 'a', 'c', [0.5, 0]), { bodyA: 'a' }],
  });
  assert.deepEqual([...broken], [['ab', null], ['ac', null]]);
});
