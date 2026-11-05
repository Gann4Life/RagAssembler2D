import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter, STEP_SETTINGS, stepWorld } from '../lib/ragimporter.js';
import { resolveChannels } from '../lib/evaluate.js';
import { createSimulateSession } from '../js/physics/simulate-session.js';
import { SIMULATE_STEP } from '../js/timeline-player.js';
import { addHoldClip, fitTorque, humanoidRig } from './helpers/rigs.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

class Container {
  constructor() {
    this.parent = null;
  }

  destroy() {}
}

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function document({ limp }) {
  const { json } = humanoidRig();
  fitTorque(json);
  addHoldClip(json, new Map(), 1);
  if (limp) {
    const keys = [{ t: 0, v: 1, interp: 'linear' }, { t: 0.3, v: 0, interp: 'linear' }];
    for (const channel of ['strength', 'balance']) json.clips[0].tracks.push({ target: json.ragdoll.id, channel, keys });
  }
  return json;
}

function pelvisDrop(json, seconds) {
  const session = createSimulateSession(Box2D, json, { clip: 'hold' });
  try {
    const start = session.pose().get(json.ragdoll.rootBody).y;
    let lowest = start;
    for (let i = 0; i < seconds / SIMULATE_STEP; i++) {
      session.step(SIMULATE_STEP);
      lowest = Math.min(lowest, session.pose().get(json.ragdoll.rootBody).y);
    }
    return start - lowest;
  } finally {
    session.destroy();
  }
}

const BENT_KNEES = new Map([['j_thighL', -0.4], ['j_shinL', 0.8], ['j_footL', -0.4], ['j_thighR', -0.4], ['j_shinR', 0.8], ['j_footR', -0.4]]);

function crouch(strengthKeys, length = 1, balanceKeys = strengthKeys) {
  const { json } = humanoidRig();
  fitTorque(json);
  addHoldClip(json, BENT_KNEES, length);
  const clip = json.clips[0];
  for (const track of clip.tracks) track.keys = [{ t: 0, v: BENT_KNEES.get(track.target), interp: 'linear' }];
  clip.tracks.push({ target: json.ragdoll.id, channel: 'strength', keys: strengthKeys });
  clip.tracks.push({ target: json.ragdoll.id, channel: 'balance', keys: balanceKeys });
  return json;
}

function dropsAt(json, seconds, marks) {
  const session = createSimulateSession(Box2D, json, { clip: 'hold', pose: 'hold' });
  try {
    const start = session.pose().get(json.ragdoll.rootBody).y;
    let lowest = start;
    const drops = [];
    for (let i = 1; i <= Math.round(seconds / SIMULATE_STEP); i++) {
      session.step(SIMULATE_STEP);
      lowest = Math.min(lowest, session.pose().get(json.ragdoll.rootBody).y);
      if (marks.some((mark) => Math.abs(mark - i * SIMULATE_STEP) < SIMULATE_STEP / 2)) drops.push(start - lowest);
    }
    return drops;
  } finally {
    session.destroy();
  }
}

test('a crouching humanoid held at each strength, balance alike, sags more as S falls and collapses at S ≤ 0.25 (§3.4)', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const drop = new Map();
  for (const S of [1, 0.75, 0.5, 0.4, 0.25, 0]) {
    drop.set(S, dropsAt(crouch([{ t: 0, v: S, interp: 'linear' }]), 2, [2])[0]);
  }
  const table = [...drop].map(([S, value]) => `${S}: ${value.toFixed(3)} m`).join(', ');
  assert.ok(drop.get(1) < 0.002, table);
  assert.ok(drop.get(0.75) <= drop.get(0.5) && drop.get(0.5) < drop.get(0.4), table);
  assert.ok(drop.get(0.5) > 0.001 && drop.get(0.4) < 0.2, table);
  assert.ok(drop.get(0.25) > 0.3 && drop.get(0) > 0.8, table);
});

test('a strength and balance key from 1 to 0 over a 2 s clip sags the crouching humanoid gradually, not at the end (§3.4)', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const keys = [{ t: 0, v: 1, interp: 'linear' }, { t: 2, v: 0, interp: 'linear' }];
  const [half, three, late, end] = dropsAt(crouch(keys, 2), 2, [1, 1.5, 1.75, 2]);
  const table = `1 s: ${half.toFixed(3)}, 1.5 s: ${three.toFixed(3)}, 1.75 s: ${late.toFixed(3)}, 2 s: ${end.toFixed(3)} m`;
  assert.ok(half < 0.01, table);
  assert.ok(three > 0.01 && three < late && late < end, table);
  assert.ok(late > 0.1 && end > 0.5, table);
});

function rootPath(json, seconds) {
  const session = createSimulateSession(Box2D, json, { clip: 'hold', pose: 'hold' });
  try {
    const path = [];
    for (let i = 0; i < Math.round(seconds / SIMULATE_STEP); i++) {
      session.step(SIMULATE_STEP);
      const { x, y, angle } = session.pose().get(json.ragdoll.rootBody);
      path.push([x, y, angle]);
    }
    return path;
  } finally {
    session.destroy();
  }
}

test('a death with balance 0 from its start and strength fading 1 → 0 lets rootBody fall with no balance torque (§3.2, §4.6)', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const fade = [{ t: 0, v: 1, interp: 'linear' }, { t: 2, v: 0, interp: 'linear' }];
  const death = rootPath(crouch(fade, 2, [{ t: 0, v: 0, interp: 'linear' }]), 3);
  const unbalanced = crouch(fade, 2, [{ t: 0, v: 1, interp: 'linear' }]);
  unbalanced.ragdoll.balance.enabled = false;
  assert.deepEqual(death, rootPath(unbalanced, 3));
  const balanced = rootPath(crouch(fade, 2, [{ t: 0, v: 1, interp: 'linear' }]), 3);
  assert.notDeepEqual(death, balanced);
  const [, startY, startAngle] = death[0];
  const [, endY, endAngle] = death.at(-1);
  assert.ok(startY - endY > 1, `drop ${startY - endY} m`);
  assert.ok(Math.abs(endAngle - startAngle) > 1, `tilt ${endAngle - startAngle} rad`);
});

test('root strength and balance keys from 1 to 0 over 0.3 s resolve S to 0 for every joint and the balance', () => {
  const json = document({ limp: true });
  const clip = json.clips[0];
  const early = resolveChannels(json, [{ clip, time: 0.15 }]);
  assert.ok(Math.abs(early.root.strength - 0.5) < 1e-9);
  assert.ok(Math.abs(early.root.balance - 0.5) < 1e-9);
  for (const pose of early.joints.values()) assert.ok(Math.abs(pose.S - 0.5) < 1e-9);
  const late = resolveChannels(json, [{ clip, time: 0.5 }]);
  assert.equal(late.root.strength, 0);
  assert.equal(late.root.balance, 0);
  for (const pose of late.joints.values()) assert.equal(pose.S, 0);
});

test('the instance disables every joint motor once the keyed root strength reaches 0', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const json = document({ limp: true });
  const gravity = new Box2D.b2Vec2(0, 0);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const rag = RagImporter.parse(json).spawn(world, { x: 0, y: 0 });
  try {
    rag.play('hold');
    stepWorld(world, [rag], STEP_SETTINGS.dt);
    for (const joint of rag.joints.values()) assert.equal(joint.IsMotorEnabled(), 1);
    for (let i = 0; i < 0.5 / STEP_SETTINGS.dt; i++) stepWorld(world, [rag], STEP_SETTINGS.dt);
    for (const joint of rag.joints.values()) assert.equal(joint.IsMotorEnabled(), 0);
  } finally {
    rag.destroy();
    Box2D.destroy(world);
  }
});

test('in the clip simulation the humanoid stands with full strength and collapses when the strength is keyed to 0', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const standing = pelvisDrop(document({ limp: false }), 3);
  const limp = pelvisDrop(document({ limp: true }), 3);
  assert.ok(standing < 0.15, `standing drop ${standing} m`);
  assert.ok(limp > 0.5, `limp drop ${limp} m`);
});
