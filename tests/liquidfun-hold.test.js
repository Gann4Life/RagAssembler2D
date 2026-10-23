import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { RagImporter } from '../lib/ragimporter.js';
import { creatureRig, fitTorque, holdRun, humanoidRig, poleRig, snakeRig } from './helpers/rigs.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

class Container {
  constructor() {
    this.parent = null;
  }

  destroy() {}
}

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function stickmanRig() {
  const json = JSON.parse(readFileSync(new URL('../demo/assets/sample.rag.json', import.meta.url), 'utf8'));
  json.clips = [];
  return { json, pose: new Map([['j_shoulderL', 1.2], ['j_shoulderR', -0.6], ['j_neck', 0.3], ['j_hipL', 0.5]]) };
}

function run(rig, keyed) {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const json = fitTorque(structuredClone(rig.json));
  return holdRun(Box2D, RagImporter, json, { pose: keyed ? rig.pose : new Map(), seconds: 10 });
}

function describe(result) {
  return Object.entries(result).map(([key, value]) => `${key} ${typeof value === 'number' ? value.toFixed(3) : value}`).join(', ');
}

function assertFirm(result) {
  const text = describe(result);
  assert.ok(result.jointErrorRms < 1, `joint error rms: ${text}`);
  assert.ok(result.jointError < 10, `joint error: ${text}`);
  assert.ok(result.rootTilt < 3, `root tilt: ${text}`);
  assert.ok(result.rootSpin < 3, `root spin: ${text}`);
  assert.ok(result.tremble < 0.3, `tremble: ${text}`);
  assert.ok(result.flips < 10, `flips: ${text}`);
}

const FIRM = [
  ['the demo stickman', stickmanRig],
  ['a two-body pole', poleRig],
  ['a ten-segment snake', () => snakeRig(10)],
  ['a humanoid made of overlapping shapes', humanoidRig],
];

for (const [name, build] of FIRM) {
  test(`${name} holds its rest pose firmly for 10 s with the suggested torques`, () => {
    assertFirm(run(build(), false));
  });

  test(`${name} holds a keyed pose firmly for 10 s with the suggested torques`, () => {
    assertFirm(run(build(), true));
  });
}

test('a creature whose rootBody is 7% of its mass keeps rootBody upright without abrupt turns', () => {
  for (const keyed of [false, true]) {
    const result = run(creatureRig(), keyed);
    assert.ok(result.rootTilt < 5 && result.rootSpin < 3, describe(result));
  }
});

test('a creature standing on 11–23 g pieces under 1.6 kg holds its pose without trembling', { todo: 'DESIGN §12: at 8 velocity iterations its foot pieces and fingers tremble (rms about 4 rad/s)' }, () => {
  assertFirm(run(creatureRig(), false));
});
