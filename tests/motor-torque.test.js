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

test('MOTOR_TORQUE holds the frozen constants of DESIGN §3.1', () => {
  assert.ok(Object.isFrozen(MOTOR_TORQUE));
  assert.deepEqual({ ...MOTOR_TORQUE }, { alpha: 100, gravity: 10, min: 0.001, overpoweredFactor: 1000, groundBand: 0.05 });
});

function need(a, b, load) {
  return (a.inertia * b.inertia) / (a.inertia + b.inertia) * 100 + load.mass * 10 * load.reach;
}

function roundUp2(value) {
  const scale = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.ceil(value / scale - 1e-9) * scale;
}

function standing() {
  return {
    bodies: [boxBody('foot', [0, 0.05], 0.4, 0.1), boxBody('body', [0, 1.15], 0.2, 2)],
    joints: [joint('ankle', 'foot', 'body', [0, 0.1])],
  };
}

test('a joint above a foot holds the side away from the ground, however heavy', () => {
  const foot = { mass: 0.04, inertia: (0.04 * 0.17) / 12 + 0.04 * 0.05 ** 2, reach: 0.05 };
  const body = { mass: 0.4, inertia: (0.4 * 4.04) / 12 + 0.4 * 1.05 ** 2, reach: 1.05 };
  const value = motorTorqueSuggestions(standing()).get('ankle');
  assert.ok(Math.abs(value - roundUp2(need(foot, body, body))) < 1e-9, `${value}`);
  assert.ok(value > 2 * roundUp2(need(foot, body, foot)));
});

test('each foot of a biped holds the rest of the body; a joint inside one foot and a free arm do not', () => {
  const doc = {
    bodies: [
      boxBody('heel', [-0.6, 0.05], 0.2, 0.1),
      boxBody('toe', [-0.4, 0.05], 0.2, 0.1),
      boxBody('right', [0.5, 0.05], 0.4, 0.1),
      boxBody('legL', [-0.5, 0.6], 0.2, 1),
      boxBody('legR', [0.5, 0.6], 0.2, 1),
      boxBody('hip', [0, 1.2], 1.2, 0.2),
      boxBody('arm', [0.8, 1.2], 0.4, 0.1),
    ],
    joints: [
      joint('toes', 'heel', 'toe', [-0.5, 0.05]),
      joint('ankleL', 'legL', 'heel', [-0.5, 0.1]),
      joint('ankleR', 'legR', 'right', [0.5, 0.1]),
      joint('hipL', 'hip', 'legL', [-0.5, 1.1]),
      joint('hipR', 'hip', 'legR', [0.5, 1.1]),
      joint('shoulder', 'hip', 'arm', [0.6, 1.2]),
    ],
  };
  const result = motorTorqueSuggestions(doc);
  assert.ok(result.get('ankleL') >= 0.72 * 10 * 0.906, `${result.get('ankleL')}`);
  assert.ok(result.get('ankleR') >= 0.72 * 10 * 0.5, `${result.get('ankleR')}`);
  assert.ok(result.get('toes') < 0.5, `${result.get('toes')}`);
  assert.ok(result.get('shoulder') < 0.5, `${result.get('shoulder')}`);
});

test('a chain lying on the ground uses the lighter side at every joint', () => {
  const bodies = [boxBody('a', [0, 0.05], 1, 0.1), boxBody('b', [1, 0.05], 1, 0.1), boxBody('c', [2, 0.05], 1, 0.1)];
  const joints = [joint('ab', 'a', 'b', [0.5, 0.05]), joint('bc', 'b', 'c', [1.5, 0.05])];
  assert.equal(motorTorqueSuggestions({ bodies, joints }).get('ab'), 3.5);
});

test('sensor shapes do not count as ground contact', () => {
  const doc = standing();
  const probe = { shape: { type: 'circle', center: [0, -1.1], radius: 0.2 }, density: 0.0001, isSensor: true };
  doc.bodies[1].fixtures.push(probe);
  const plain = motorTorqueSuggestions(standing()).get('ankle');
  assert.ok(motorTorqueSuggestions(doc).get('ankle') >= plain * 0.99);
  probe.isSensor = false;
  assert.ok(motorTorqueSuggestions(doc).get('ankle') < plain / 2);
});

test('a two-body joint gets roundUp2(I_eff * alpha + M_L * g * r_L)', () => {
  const doc = {
    bodies: [boxBody('b_big', [0, 0], 2, 2), circleBody('b_tip', [1.5, 0], 0.25)],
    joints: [joint('j', 'b_big', 'b_tip', [1, 0])],
  };
  const massBig = 4;
  const inertiaBig = (massBig * 8) / 12 + massBig * 1;
  const massTip = Math.PI / 16;
  const inertiaTip = (massTip * 0.0625) / 2 + massTip * 0.25;
  const effective = (inertiaBig * inertiaTip) / (inertiaBig + inertiaTip);
  const need = effective * 100 + massTip * 10 * 0.5;
  const value = motorTorqueSuggestions(doc).get('j');
  assert.ok(value >= need && value < need * 1.1, `${value} for ${need}`);
  assert.equal(value, 6.5);
  assert.ok(need > 6.4 && need < 6.5);
});

test('rounding up to two significant digits and the minimum', () => {
  const tiny = {
    bodies: [boxBody('a', [0, 0], 1, 1), circleBody('b', [0.5005, 0], 0.0005)],
    joints: [joint('j', 'a', 'b', [0.5, 0])],
  };
  assert.equal(motorTorqueSuggestions(tiny).get('j'), 0.001);
  const large = {
    bodies: [boxBody('a', [0, 0], 4, 4), boxBody('b', [3, 0], 2, 1)],
    joints: [joint('j', 'a', 'b', [2, 0])],
  };
  const massA = 16;
  const inertiaA = (massA * 32) / 12 + massA * 4;
  const massB = 2;
  const inertiaB = (massB * 5) / 12 + massB * 1;
  const need = ((inertiaA * inertiaB) / (inertiaA + inertiaB)) * 100 + massB * 10 * 1;
  const value = motorTorqueSuggestions(large).get('j');
  assert.equal(value, Math.ceil(need / 10) * 10);
  assert.ok(value > need);
});

test('the value does not depend on body order or on which side holds more bodies', () => {
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

test('a loop joint uses its own two bodies as the sides', () => {
  const bodies = [boxBody('a', [0, 0], 1, 1), boxBody('b', [1, 0], 1, 1), boxBody('c', [0.5, 1], 1, 1)];
  const anchor = [0.5, 0];
  const looped = motorTorqueSuggestions({
    bodies,
    joints: [joint('ab', 'a', 'b', anchor), joint('bc', 'b', 'c', [1, 0.5]), joint('ca', 'c', 'a', [0, 0.5])],
  });
  const alone = motorTorqueSuggestions({ bodies: bodies.slice(0, 2), joints: [joint('ab', 'a', 'b', anchor)] });
  assert.equal(looped.get('ab'), alone.get('ab'));
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
