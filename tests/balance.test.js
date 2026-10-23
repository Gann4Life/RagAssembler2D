import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS, migrate } from '../lib/migrate.js';
import { balanceTorqueSuggestion } from '../lib/motor.js';
import { validate } from '../lib/validate.js';
import { fkPose, resolveChannels } from '../lib/evaluate.js';
import { driveBalance } from '../lib/instance.js';
import { ragFile } from './helpers/rag-file.js';
import { BALANCE, fakeBody, fakeInstance } from './helpers/fake-instance.js';

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

function boxBody(id, position, { center = [0, 0], density = 4 } = {}) {
  return {
    id,
    name: id,
    position,
    angle: 0,
    fixtures: [{ id: `f_${id}`, shape: { type: 'box', center, width: 0.5, height: 0.5, angle: 0 }, density }],
  };
}

function hinge(id, bodyA, bodyB, anchor) {
  return { id, bodyA, bodyB, anchor };
}

function versionOne() {
  const json = ragFile();
  json.version = 1;
  delete json.ragdoll.balance;
  return json;
}

function codesAt(json) {
  const { errors, warnings } = validate(json);
  return [...errors, ...warnings].map((problem) => `${problem.code} ${problem.path}`);
}

function rootClip(keys, blend = 'override') {
  return {
    key: 'tilt',
    name: 'tilt',
    loop: true,
    hold: true,
    layer: 0,
    blend,
    length: 1,
    fadeIn: 0,
    fadeOut: 0,
    speed: 1,
    tracks: [{ target: 'root', channel: 'bodyAngle', keys }],
    events: [],
  };
}

test('balanceTorqueSuggestion matches the DESIGN §3.2 example', () => {
  const doc = {
    ragdoll: { rootBody: 'b_root' },
    bodies: [boxBody('b_root', [0, 0]), boxBody('b_top', [0, 0.5])],
    joints: [hinge('j_top', 'b_root', 'b_top', [0, 0.25])],
  };
  assert.equal(balanceTorqueSuggestion(doc), 26);
});

test('balanceTorqueSuggestion ignores unconnected bodies and gives the inertia term alone for a single body', () => {
  const doc = { ragdoll: { rootBody: 'b_root' }, bodies: [boxBody('b_root', [0, 0]), boxBody('b_far', [3, 0])], joints: [] };
  assert.equal(balanceTorqueSuggestion(doc), 4.2);
});

test('balanceTorqueSuggestion is null for an unknown rootBody, zero mass or unreadable input', () => {
  const bodies = [boxBody('b_root', [0, 0], { density: 0 })];
  assert.equal(balanceTorqueSuggestion({ ragdoll: { rootBody: 'b_x' }, bodies, joints: [] }), null);
  assert.equal(balanceTorqueSuggestion({ ragdoll: { rootBody: 'b_root' }, bodies, joints: [] }), null);
  assert.equal(balanceTorqueSuggestion({ ragdoll: { rootBody: null }, bodies, joints: [] }), null);
  assert.equal(balanceTorqueSuggestion(null), null);
  assert.equal(balanceTorqueSuggestion({ ragdoll: 5, bodies: 'x', joints: 7 }), null);
});

test('the 1 → 2 migration adds an enabled balance with the suggested torque and validates', () => {
  const json = versionOne();
  const before = structuredClone(json);
  const result = migrate(json);
  assert.deepEqual(json, before);
  assert.equal(result.json.version, 2);
  assert.deepEqual(result.notes, ['Migrated from format version 1 to 2']);
  assert.deepEqual(result.json.ragdoll.balance, {
    enabled: true,
    maxTorque: balanceTorqueSuggestion(json),
    gain: 10,
    damping: 0.5,
    maxSpeed: 20,
  });
  assert.deepEqual(Object.keys(result.json.ragdoll).slice(-2), ['channels', 'balance']);
  assert.deepEqual(validate(result.json).errors, []);
});

test('the 1 → 2 migration falls back to 80 N·m and skips a non-object ragdoll', () => {
  const massless = versionOne();
  massless.ragdoll.rootBody = 'b_unknown';
  assert.equal(migrate(massless).json.ragdoll.balance.maxTorque, 80);
  for (const ragdoll of [null, 3, []]) {
    const json = { ...versionOne(), ragdoll };
    const result = migrate(json);
    assert.equal(result.json.version, 2);
    assert.equal(result.json.ragdoll, ragdoll);
  }
  assert.deepEqual(MIGRATIONS.map(({ from, to }) => [from, to]), [[1, 2]]);
});

test('ragdoll.balance fields are required, typed and non-negative', () => {
  const missing = ragFile();
  delete missing.ragdoll.balance;
  assert.deepEqual(validate(missing).errors.map((problem) => `${problem.code} ${problem.path}`), ['E_FIELD_MISSING /ragdoll/balance']);
  const partial = ragFile();
  delete partial.ragdoll.balance.maxSpeed;
  assert.ok(codesAt(partial).includes('E_FIELD_MISSING /ragdoll/balance/maxSpeed'));
  const typed = ragFile();
  typed.ragdoll.balance.enabled = 'yes';
  assert.ok(codesAt(typed).includes('E_FIELD_TYPE /ragdoll/balance/enabled'));
  for (const field of ['maxTorque', 'gain', 'damping', 'maxSpeed']) {
    const negative = ragFile();
    negative.ragdoll.balance[field] = -1;
    assert.ok(codesAt(negative).includes(`E_FIELD_RANGE /ragdoll/balance/${field}`), field);
    const zero = ragFile();
    zero.ragdoll.balance[field] = 0;
    assert.deepEqual(validate(zero).errors, [], field);
  }
});

test('a root bodyAngle track is valid, takes any finite angle and is not a joint channel', () => {
  const json = ragFile();
  json.clips[0].tracks.push({ target: 'root', channel: 'bodyAngle', keys: [{ t: 0, v: -7, interp: 'ease' }, { t: 1, v: 9, interp: 'step' }] });
  assert.deepEqual(validate(json).errors, []);
  json.clips[0].tracks[1].keys[0].v = 'x';
  json.clips[0].tracks[1].keys[1].v = null;
  assert.deepEqual(validate(json).errors.map((problem) => `${problem.code} ${problem.path}`), [
    'E_KEY_VALUE /clips/0/tracks/1/keys/0/v',
    'E_KEY_VALUE /clips/0/tracks/1/keys/1/v',
  ]);
  const onJoint = ragFile();
  onJoint.clips[0].tracks.push({ target: 'j_neck', channel: 'bodyAngle', keys: [] });
  assert.ok(codesAt(onJoint).includes('E_TRACK_CHANNEL /clips/0/tracks/1/channel'));
});

test('resolveChannels resolves root bodyAngle: 0 by default, override and additive like an angle', () => {
  const def = { ragdoll: { channels: { strength: 1, gain: 1, damping: 1 } }, joints: [], bodies: [] };
  assert.equal(resolveChannels(def, []).root.bodyAngle, 0);
  const keys = [{ t: 0, v: 0, interp: 'linear' }, { t: 1, v: 2, interp: 'linear' }];
  near(resolveChannels(def, [{ clip: rootClip(keys), time: 0.25 }]).root.bodyAngle, 0.5);
  near(resolveChannels(def, [{ clip: rootClip(keys), time: 0.25, weight: 0.5 }]).root.bodyAngle, 0.25);
  near(resolveChannels(def, [{ clip: rootClip(keys, 'additive'), time: 0.5, weight: 0.5 }]).root.bodyAngle, 0.5);
  near(resolveChannels(def, [{ clip: rootClip([{ t: 0, v: 5, interp: 'linear' }]), time: 0 }]).root.bodyAngle, 5);
});

test('fkPose turns rootBody about its rest center of mass and the tree follows', () => {
  const def = {
    ragdoll: { rootBody: 'b_root' },
    bodies: [boxBody('b_root', [1, 0], { center: [0.5, 0] }), boxBody('b_child', [1.5, 1])],
    joints: [hinge('j_child', 'b_root', 'b_child', [1.5, 0.5])],
  };
  const rest = fkPose(def, new Map());
  assert.deepEqual(rest.get('b_root'), { x: 1, y: 0, angle: 0 });
  assert.deepEqual(fkPose(def, new Map(), 0), rest);
  const turned = fkPose(def, new Map(), Math.PI / 2);
  near(turned.get('b_root').x, 1.5);
  near(turned.get('b_root').y, -0.5);
  near(turned.get('b_root').angle, Math.PI / 2);
  near(turned.get('b_child').x, 0.5);
  near(turned.get('b_child').y, 0);
  near(turned.get('b_child').angle, Math.PI / 2);
  const bent = fkPose(def, new Map([['j_child', { angle: -Math.PI / 2 }]]), Math.PI / 2);
  near(bent.get('b_child').angle, 0);
});

test('fkPose turns a massless rootBody about its origin', () => {
  const def = { ragdoll: { rootBody: 'b_root' }, bodies: [boxBody('b_root', [2, 3], { center: [1, 0], density: 0 })], joints: [] };
  const turned = fkPose(def, new Map(), 1).get('b_root');
  near(turned.x, 2);
  near(turned.y, 3);
  near(turned.angle, 1);
});

test('driveBalance applies the §3.2 velocity servo with the S-blended inertia', () => {
  const body = fakeBody(0.01, 0);
  near(driveBalance(body, 0, { S: 1, G: 10, D: 0.5 }, BALANCE, 1 / 60), -3);
  assert.equal(body.torques.length, 1);
  near(body.torques[0][0], -3);
  assert.equal(body.torques[0][1], true);
  const half = fakeBody(0.01, 0);
  near(driveBalance(half, 0, { S: 0.5, G: 10, D: 0.5 }, BALANCE, 1 / 60), 0.3 * -0.1 * 60);
  const damped = fakeBody(0, 0.4);
  near(driveBalance(damped, 0, { S: 1, G: 10, D: 0.5 }, BALANCE, 0.1), 0.5 * (-0.2 - 0.4) / 0.1);
});

test('driveBalance clamps speed and torque and wraps the error the short way', () => {
  const fast = fakeBody(3, 0);
  near(driveBalance(fast, 0, { S: 1, G: 10, D: 0 }, { ...BALANCE, maxTorque: 1e6 }, 1 / 60), 0.5 * -20 * 60);
  near(driveBalance(fakeBody(3, 0), 0, { S: 0.5, G: 10, D: 0 }, BALANCE, 1 / 60), -25);
  near(driveBalance(fakeBody(2 * Math.PI - 0.01, 0), 0, { S: 1, G: 10, D: 0.5 }, BALANCE, 1 / 60), 3);
  near(driveBalance(fakeBody(-0.01, 0), 4 * Math.PI, { S: 1, G: 10, D: 0.5 }, BALANCE, 1 / 60), 3);
});

test('driveBalance does nothing when S or dt is 0', () => {
  const limp = fakeBody(1, 0);
  assert.equal(driveBalance(limp, 0, { S: 0, G: 10, D: 0.5 }, BALANCE, 1 / 60), 0);
  assert.equal(driveBalance(limp, 0, { S: 1, G: 10, D: 0.5 }, BALANCE, 0), 0);
  assert.deepEqual(limp.torques, []);
});

test('update applies the balance torque to rootBody with root and runtime multipliers', () => {
  const { rag, root } = fakeInstance({ root: fakeBody(0.01, 0) });
  rag.update(1 / 60);
  assert.equal(root.torques.length, 1);
  near(root.torques[0][0], -3);
  rag.setGain(0.5);
  rag.update(1 / 60);
  near(root.torques[1][0], 0.5 * -0.05 * 60);
});

test('update tracks the spawn angle plus bodyAngle, negated with flipX', () => {
  const clip = rootClip([{ t: 0, v: 0.005, interp: 'linear' }]);
  const plain = fakeInstance({ clips: [clip], restAngle: 1, root: fakeBody(1, 0) });
  plain.rag.play('tilt');
  plain.rag.update(1 / 60);
  near(plain.root.torques[0][0], 1.5);
  const mirrored = fakeInstance({ clips: [clip], flipX: true, restAngle: 1, root: fakeBody(1, 0) });
  mirrored.rag.play('tilt');
  mirrored.rag.update(1 / 60);
  near(mirrored.root.torques[0][0], -1.5);
});

test('setBalance, the file switch and dead strength turn the controller off', () => {
  const switched = fakeInstance({ root: fakeBody(0.5, 0) });
  switched.rag.setBalance(false);
  switched.rag.update(1 / 60);
  assert.deepEqual(switched.root.torques, []);
  switched.rag.setBalance(true);
  switched.rag.update(1 / 60);
  assert.equal(switched.root.torques.length, 1);
  assert.throws(() => switched.rag.setBalance(1), TypeError);
  assert.throws(() => switched.rag.setBalance(), TypeError);
  const disabled = fakeInstance({ balance: { ...BALANCE, enabled: false }, root: fakeBody(0.5, 0) });
  disabled.rag.setBalance(true);
  disabled.rag.update(1 / 60);
  assert.deepEqual(disabled.root.torques, []);
  const dead = fakeInstance({ channels: { strength: 0, gain: 1, damping: 1 }, root: fakeBody(0.5, 0) });
  dead.rag.update(1 / 60);
  assert.deepEqual(dead.root.torques, []);
});
