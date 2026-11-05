import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS, migrate } from '../lib/migrate.js';
import { balanceTorqueSuggestion } from '../lib/motor.js';
import { validate } from '../lib/validate.js';
import { fkPose, resolveChannels } from '../lib/evaluate.js';
import { driveBalance } from '../lib/instance.js';
import { ragFile } from './helpers/rag-file.js';
import { BALANCE, fakeBody, fakeForce, fakeInstance } from './helpers/fake-instance.js';

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

function boxBody(id, position, { center = [0, 0], mass = 1 } = {}) {
  return {
    id,
    name: id,
    position,
    angle: 0,
    mass,
    fixtures: [{ id: `f_${id}`, shape: { type: 'box', center, width: 0.5, height: 0.5, angle: 0 } }],
  };
}

function hinge(id, bodyA, bodyB, anchor) {
  return { id, bodyA, bodyB, anchor };
}

function versionThree() {
  const json = ragFile();
  json.version = 3;
  delete json.ragdoll.channels.balance;
  return json;
}

function versionTwo() {
  const json = versionThree();
  json.version = 2;
  for (const body of json.bodies) {
    delete body.mass;
    for (const fixture of body.fixtures) fixture.density = 4;
  }
  return json;
}

function versionOne() {
  const json = versionTwo();
  json.version = 1;
  delete json.ragdoll.balance;
  return json;
}

const STEP_ONE = [MIGRATIONS[0]];
const STEP_TWO = [MIGRATIONS[1]];

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
  const bodies = [boxBody('b_root', [0, 0], { mass: 0 })];
  assert.equal(balanceTorqueSuggestion({ ragdoll: { rootBody: 'b_x' }, bodies, joints: [] }), null);
  assert.equal(balanceTorqueSuggestion({ ragdoll: { rootBody: 'b_root' }, bodies, joints: [] }), null);
  assert.equal(balanceTorqueSuggestion({ ragdoll: { rootBody: null }, bodies, joints: [] }), null);
  assert.equal(balanceTorqueSuggestion(null), null);
  assert.equal(balanceTorqueSuggestion({ ragdoll: 5, bodies: 'x', joints: 7 }), null);
});

test('the 1 → 2 migration adds an enabled balance with the suggested torque and validates', () => {
  const json = versionOne();
  const before = structuredClone(json);
  const result = migrate(json, STEP_ONE);
  assert.deepEqual(json, before);
  assert.equal(result.json.version, 2);
  assert.deepEqual(result.notes, ['Migrated from format version 1 to 2']);
  assert.deepEqual(result.json.ragdoll.balance, {
    enabled: true,
    maxTorque: balanceTorqueSuggestion(ragFile()),
    gain: 10,
    damping: 0.5,
    maxSpeed: 20,
  });
  assert.deepEqual(Object.keys(result.json.ragdoll).slice(-2), ['channels', 'balance']);
});

test('the 1 → 2 migration falls back to 80 N·m and skips a non-object ragdoll', () => {
  const massless = versionOne();
  massless.ragdoll.rootBody = 'b_unknown';
  assert.equal(migrate(massless, STEP_ONE).json.ragdoll.balance.maxTorque, 80);
  for (const ragdoll of [null, 3, []]) {
    const json = { ...versionOne(), ragdoll };
    const result = migrate(json, STEP_ONE);
    assert.equal(result.json.version, 2);
    assert.equal(result.json.ragdoll, ragdoll);
  }
  assert.deepEqual(MIGRATIONS.map(({ from, to }) => [from, to]), [[1, 2], [2, 3], [3, 4]]);
});

test('the 2 → 3 migration writes mass 1 after angle on every body and drops fixture density', () => {
  const json = versionTwo();
  json.bodies[0].mass = 7;
  const before = structuredClone(json);
  const result = migrate(json, STEP_TWO);
  assert.deepEqual(json, before);
  assert.equal(result.json.version, 3);
  assert.deepEqual(result.notes, ['Migrated from format version 2 to 3']);
  for (const body of result.json.bodies) {
    assert.equal(body.mass, 1);
    const keys = Object.keys(body);
    assert.equal(keys[keys.indexOf('angle') + 1], 'mass');
    for (const fixture of body.fixtures) assert.equal('density' in fixture, false);
  }
  assert.deepEqual(validate(migrate(result.json).json).errors, []);
  assert.deepEqual(result.json, versionThree());
});

test('the 2 → 3 migration leaves non-object bodies and fixtures for validation', () => {
  const json = versionTwo();
  json.bodies.push(null, 4);
  json.bodies[0].fixtures.push('x');
  const result = migrate(json, STEP_TWO).json;
  assert.deepEqual(result.bodies.slice(-2), [null, 4]);
  assert.equal(result.bodies[0].fixtures.at(-1), 'x');
  assert.equal(migrate({ ...versionTwo(), bodies: 5 }, STEP_TWO).json.bodies, 5);
});

test('a version 1 file migrates through 2 and 3 to 4 and validates', () => {
  const result = migrate(versionOne());
  assert.equal(result.json.version, 4);
  assert.deepEqual(result.notes, [
    'Migrated from format version 1 to 2',
    'Migrated from format version 2 to 3',
    'Migrated from format version 3 to 4',
  ]);
  assert.equal(result.json.ragdoll.channels.balance, 1);
  assert.equal(result.json.ragdoll.balance.maxTorque, balanceTorqueSuggestion(ragFile()));
  assert.deepEqual(validate(result.json).errors, []);
});

function rootTrack(channel, keys) {
  return { target: 'root', channel, keys };
}

function clipWith(tracks, key = 'c') {
  return { key, name: key, loop: false, hold: true, layer: 0, blend: 'override', length: 2, fadeIn: 0, fadeOut: 0, speed: 1, tracks, events: [] };
}

test('the 3 → 4 migration copies root strength into balance, base value and tracks, and validates', () => {
  const json = versionThree();
  json.ragdoll.channels.strength = 0.4;
  const fade = [{ t: 0, v: 1, interp: 'linear' }, { t: 2, v: 0, interp: 'step' }];
  json.clips = [
    clipWith([{ target: 'j_neck', channel: 'angle', keys: [] }, rootTrack('strength', fade), rootTrack('gain', [])]),
    clipWith([{ target: 'j_neck', channel: 'strength', keys: [{ t: 0, v: 0.5, interp: 'linear' }] }], 'd'),
  ];
  const before = structuredClone(json);
  const result = migrate(json);
  assert.deepEqual(json, before);
  assert.equal(result.json.version, 4);
  assert.deepEqual(result.notes, ['Migrated from format version 3 to 4']);
  assert.deepEqual(Object.keys(result.json.ragdoll.channels), ['strength', 'balance', 'gain', 'damping']);
  assert.equal(result.json.ragdoll.channels.balance, 0.4);
  const [first, second] = result.json.clips;
  assert.deepEqual(first.tracks.map((track) => `${track.target}.${track.channel}`), ['j_neck.angle', 'root.strength', 'root.balance', 'root.gain']);
  assert.deepEqual(first.tracks[2].keys, fade);
  assert.notEqual(first.tracks[2].keys, first.tracks[1].keys);
  assert.deepEqual(second, json.clips[1]);
  assert.deepEqual(validate(result.json).errors, []);
});

test('the 3 → 4 migration writes balance 1 without a strength base and leaves odd input for validation', () => {
  const json = versionThree();
  delete json.ragdoll.channels.strength;
  assert.deepEqual(migrate(json).json.ragdoll.channels, { gain: 1, damping: 1, balance: 1 });
  for (const channels of [null, 3, []]) {
    const odd = versionThree();
    odd.ragdoll.channels = channels;
    assert.equal(migrate(odd).json.ragdoll.channels, channels);
  }
  assert.equal(migrate({ ...versionThree(), ragdoll: 5 }).json.ragdoll, 5);
  assert.equal(migrate({ ...versionThree(), clips: 'x' }).json.clips, 'x');
  const kept = versionThree();
  kept.clips = [null, { tracks: 4 }, clipWith([rootTrack('strength', []), rootTrack('balance', [{ t: 0, v: 0, interp: 'linear' }])])];
  const clips = migrate(kept).json.clips;
  assert.equal(clips[0], null);
  assert.deepEqual(clips[1], { tracks: 4 });
  assert.deepEqual(clips[2], kept.clips[2]);
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
  const def = { ragdoll: { rootBody: 'b_root' }, bodies: [boxBody('b_root', [2, 3], { center: [1, 0], mass: 0 })], joints: [] };
  const turned = fkPose(def, new Map(), 1).get('b_root');
  near(turned.x, 2);
  near(turned.y, 3);
  near(turned.angle, 1);
});

function balanceOf(body, target, drive, balance, dt, links = [{ body, mass: 1, inertia: 0.5 }]) {
  return driveBalance(body, links, target, drive, balance, dt, fakeForce());
}

test('driveBalance applies the §3.2 velocity servo with the inertia of the connected bodies', () => {
  const body = fakeBody(0.01, 0);
  near(balanceOf(body, 0, { S: 1, G: 10, D: 0.5 }, BALANCE, 1 / 60), -3);
  assert.equal(body.torques.length, 1);
  near(body.torques[0][0], -3);
  assert.equal(body.torques[0][1], true);
  near(body.forces[0][0], 0);
  near(body.forces[0][1], 0);
  const half = fakeBody(0.01, 0);
  const halfStiffness = 3.5 * (0.5 / 0.5) ** 2 * BALANCE.load;
  near(balanceOf(half, 0, { S: 0.5, G: 10, D: 0.5 }, BALANCE, 1 / 60), -(halfStiffness / 10) * 0.1);
  const damped = fakeBody(0, 0.4);
  near(balanceOf(damped, 0, { S: 1, G: 10, D: 0.5 }, BALANCE, 0.1), 0.5 * (-0.2 - 0.4) / 0.1);
});

test('driveBalance turns the connected bodies as one piece about their center of mass, with no net force', () => {
  const root = fakeBody(0.01, 2, { center: [-1, 0], velocity: [0, -2] });
  const other = fakeBody(0, 2, { center: [1, 0], velocity: [0, 2] });
  const links = [{ body: root, mass: 1, inertia: 0.1 }, { body: other, mass: 1, inertia: 0.1 }];
  const inertia = 0.2 + 2;
  const torque = balanceOf(root, 0, { S: 1, G: 10, D: 0.5 }, { ...BALANCE, maxTorque: 1e6 }, 1 / 60, links);
  near(torque, inertia * (10 * -0.01 - 0.5 * 2 - 2) * 60);
  const alpha = torque / inertia;
  near(root.torques[0][0], 0.1 * alpha);
  near(other.torques[0][0], 0.1 * alpha);
  near(root.forces[0][1], -alpha);
  near(other.forces[0][1], alpha);
  near(root.forces[0][0] + other.forces[0][0], 0);
  near(root.torques[0][0] + other.torques[0][0] + (-1) * root.forces[0][1] + 1 * other.forces[0][1], torque);
});

test('driveBalance clamps speed and torque and wraps the error the short way', () => {
  const fast = fakeBody(3, 0);
  near(balanceOf(fast, 0, { S: 1, G: 10, D: 0 }, { ...BALANCE, maxTorque: 1e6 }, 1 / 60), 0.5 * -20 * 60);
  near(balanceOf(fakeBody(3, 0), 0, { S: 0.5, G: 10, D: 0 }, BALANCE, 1 / 60), -25);
  near(balanceOf(fakeBody(2 * Math.PI - 0.01, 0), 0, { S: 1, G: 10, D: 0.5 }, BALANCE, 1 / 60), 3);
  near(balanceOf(fakeBody(-0.01, 0), 4 * Math.PI, { S: 1, G: 10, D: 0.5 }, BALANCE, 1 / 60), 3);
});

test('driveBalance adds the keyed rate and clamps only the correction', () => {
  const big = { ...BALANCE, maxTorque: 1e6 };
  near(balanceOf(fakeBody(0, 0), 0, { S: 1, G: 10, D: 0.5, rate: 2 }, big, 0.1), 0.5 * 3 / 0.1);
  near(balanceOf(fakeBody(0, 2), 0, { S: 1, G: 10, D: 0.5, rate: 2 }, big, 0.1), 0);
  near(balanceOf(fakeBody(0, 0), 0, { S: 1, G: 10, D: 0.5, rate: 30 }, big, 0.1), 0.5 * 45 / 0.1);
  near(balanceOf(fakeBody(0, 0), 3, { S: 1, G: 10, D: 0.5, rate: 30 }, big, 0.1), 0.5 * 50 / 0.1);
});

test('update feeds the bodyAngle rate forward, negated with flipX', () => {
  const clip = rootClip([{ t: 0, v: 0, interp: 'linear' }, { t: 0.5, v: 1, interp: 'linear' }]);
  const plain = fakeInstance({ clips: [clip], root: fakeBody(0.2, 0) });
  plain.rag.play('tilt');
  plain.rag.update(0.1);
  near(plain.root.torques[0][0], 0.5 * 3 / 0.1);
  const mirrored = fakeInstance({ clips: [clip], flipX: true, root: fakeBody(-0.2, 0) });
  mirrored.rag.play('tilt');
  mirrored.rag.update(0.1);
  near(mirrored.root.torques[0][0], -0.5 * 3 / 0.1);
});

test('driveBalance does nothing when S or dt is 0 or nothing has mass', () => {
  const limp = fakeBody(1, 0);
  assert.equal(balanceOf(limp, 0, { S: 0, G: 10, D: 0.5 }, BALANCE, 1 / 60), 0);
  assert.equal(balanceOf(limp, 0, { S: 1, G: 10, D: 0.5 }, BALANCE, 0), 0);
  assert.equal(balanceOf(limp, 0, { S: 1, G: 10, D: 0.5 }, BALANCE, 1 / 60, []), 0);
  assert.deepEqual(limp.torques, []);
  assert.deepEqual(limp.forces, []);
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

test('setBalance, the file switch, root balance 0 and runtime strength 0 turn the controller off', () => {
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
  const dead = fakeInstance({ channels: { strength: 1, balance: 0, gain: 1, damping: 1 }, root: fakeBody(0.5, 0) });
  dead.rag.update(1 / 60);
  assert.deepEqual(dead.root.torques, []);
  const dropped = fakeInstance({ root: fakeBody(0.5, 0) });
  dropped.rag.setStrength(0);
  dropped.rag.update(1 / 60);
  assert.deepEqual(dropped.root.torques, []);
});

test('root strength scales the joints only; root balance scales the controller only', () => {
  const limp = fakeInstance({ channels: { strength: 0, balance: 1, gain: 1, damping: 1 }, root: fakeBody(0.01, 0) });
  limp.rag.update(1 / 60);
  assert.equal(limp.root.torques.length, 1);
  near(limp.root.torques[0][0], -3);
  for (const joint of limp.joints.values()) assert.equal(joint.maxTorque, 0);
  const balanced = fakeInstance({ channels: { strength: 1, balance: 0, gain: 1, damping: 1 } });
  const resolved = resolveChannels({ ragdoll: { channels: { strength: 1, balance: 0, gain: 1, damping: 1 } }, joints: [{ id: 'j', motor: {} }] }, []);
  assert.equal(resolved.root.balance, 0);
  assert.equal(resolved.joints.get('j').S, 1);
  balanced.rag.update(1 / 60);
  assert.deepEqual(balanced.root.torques, []);
  for (const joint of balanced.joints.values()) assert.ok(joint.maxTorque > 0);
});
