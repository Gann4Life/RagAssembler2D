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
    json.clips[0].tracks.push({
      target: json.ragdoll.id,
      channel: 'strength',
      keys: [{ t: 0, v: 1, interp: 'linear' }, { t: 0.3, v: 0, interp: 'linear' }],
    });
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

test('a root strength key from 1 to 0 over 0.3 s resolves S to 0 for every joint and the balance', () => {
  const json = document({ limp: true });
  const clip = json.clips[0];
  const early = resolveChannels(json, [{ clip, time: 0.15 }]);
  assert.ok(Math.abs(early.root.strength - 0.5) < 1e-9);
  for (const pose of early.joints.values()) assert.ok(Math.abs(pose.S - 0.5) < 1e-9);
  const late = resolveChannels(json, [{ clip, time: 0.5 }]);
  assert.equal(late.root.strength, 0);
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
