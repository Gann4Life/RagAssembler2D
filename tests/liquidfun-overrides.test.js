import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter, STEP_SETTINGS, stepWorld } from '../lib/ragimporter.js';
import { wrapToPi } from '../lib/evaluate.js';
import { addHoldClip, poleRig } from './helpers/rigs.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

class Container {
  constructor() {
    this.parent = null;
  }

  destroy() {}
}

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

const DEG = 180 / Math.PI;
const LIMIT = 1.5;

function poleDocument() {
  const { json } = poleRig();
  json.joints[0].aimAxis = Math.PI / 2;
  return json;
}

function deadClip(json) {
  const keys = [{ t: 0, v: 0, interp: 'linear' }];
  json.clips.push({
    key: 'dead',
    name: 'dead',
    loop: false,
    hold: true,
    layer: 1,
    blend: 'override',
    length: 1,
    fadeIn: 0,
    fadeOut: 0,
    speed: 1,
    tracks: [{ target: json.ragdoll.id, channel: 'strength', keys }, { target: json.ragdoll.id, channel: 'balance', keys }],
    events: [],
  });
}

function withPole(json, run, spawn = {}) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const gravity = new Box2D.b2Vec2(0, 0);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const rag = RagImporter.parse(json).spawn(world, { x: 0, y: 0, ...spawn });
  try {
    run(rag, (seconds) => {
      for (let i = 0; i < Math.round(seconds / STEP_SETTINGS.dt); i++) stepWorld(world, [rag]);
    });
  } finally {
    rag.destroy();
    Box2D.destroy(world);
  }
}

function aimError(rag, target) {
  const anchor = rag.joint('pole').GetAnchorB();
  const direction = Math.atan2(target.y - anchor.get_y(), target.x - anchor.get_x());
  return Math.abs(wrapToPi(direction - (rag.body('pole').GetAngle() + Math.PI / 2))) * DEG;
}

test('setJointAngle drives the pole to the angle with weight 1 and halfway with weight 0.5', () => {
  for (const [weight, expected] of [[1, 0.8], [0.5, 0.4]]) {
    withPole(poleDocument(), (rag, run) => {
      rag.setJointAngle('pole', 0.8, { weight });
      run(2);
      const angle = rag.joint('pole').GetJointAngle();
      assert.ok(Math.abs(angle - expected) * DEG < 2, `weight ${weight}: ${angle} rad`);
    });
  }
});

test('setJointAngle with flipX mirrors the joint angle', () => {
  withPole(poleDocument(), (rag, run) => {
    rag.setJointAngle('pole', 0.8);
    run(2);
    const angle = rag.joint('pole').GetJointAngle();
    assert.ok(Math.abs(angle + 0.8) * DEG < 2, `${angle} rad`);
  }, { flipX: true });
});

test('lookAt points the pole aimAxis at a world point within a few degrees, with and without flipX', () => {
  for (const flipX of [false, true]) {
    withPole(poleDocument(), (rag, run) => {
      const target = { x: flipX ? 1.5 : -1.5, y: 2.5 };
      rag.lookAt('pole', target);
      run(2);
      const error = aimError(rag, target);
      assert.ok(error < 3, `flipX ${flipX}: ${error.toFixed(2)}°`);
      assert.ok(Math.abs(rag.joint('pole').GetJointAngle()) > 0.3, 'the pole turned');
    }, { flipX });
  }
});

test('a jointControl handle aims the pole like lookAt and sets its angle like setJointAngle', () => {
  withPole(poleDocument(), (rag, run) => {
    const pole = rag.jointControl('pole');
    const target = { x: 1.2, y: 2 };
    pole.lookAt(target);
    run(2);
    assert.ok(aimError(rag, target) < 3, `${aimError(rag, target).toFixed(2)}°`);
    pole.setAngle(0.6);
    run(2);
    assert.ok(Math.abs(rag.joint('pole').GetJointAngle() - 0.6) * DEG < 2);
  });
});

test('lookAt at a point past a limit holds the joint at that limit', () => {
  withPole(poleDocument(), (rag, run) => {
    rag.lookAt('pole', { x: 0.5, y: -2 });
    run(2);
    const angle = rag.joint('pole').GetJointAngle();
    assert.ok(angle >= -LIMIT - 0.03 && angle < -LIMIT + 0.05, `${angle} rad`);
  });
});

test('clearJointOverride fades back to the clip pose', () => {
  const json = poleDocument();
  addHoldClip(json, new Map([['j_pole', 0.5]]), 0.5);
  withPole(json, (rag, run) => {
    rag.play('hold');
    rag.setJointAngle('pole', -0.8);
    run(2);
    assert.ok(Math.abs(rag.joint('pole').GetJointAngle() + 0.8) * DEG < 2);
    rag.clearJointOverride('pole', { fadeOut: 1 });
    run(0.5);
    const middle = rag.joint('pole').GetJointAngle();
    assert.ok(middle > -0.8 + 0.1 && middle < 0.5 - 0.1, `mid fade ${middle} rad`);
    run(2);
    const end = rag.joint('pole').GetJointAngle();
    assert.ok(Math.abs(end - 0.5) * DEG < 2, `after fade ${end} rad`);
  });
});

test('with root strength 0 lookAt applies no torque: the motor is off and the pole stays put', () => {
  const json = poleDocument();
  deadClip(json);
  withPole(json, (rag, run) => {
    rag.setJointAngle('pole', 0.8);
    run(2);
    rag.play('dead');
    rag.lookAt('pole', { x: 2, y: 0.2 }, { strength: 1 });
    run(1);
    assert.equal(rag.joint('pole').IsMotorEnabled(), 0);
    const angle = rag.joint('pole').GetJointAngle();
    assert.ok(Math.abs(angle - 0.8) * DEG < 2, `${angle} rad`);
  });
});
