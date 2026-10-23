import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter } from '../lib/ragimporter.js';
import { createSimulateSession } from '../js/physics/simulate-session.js';
import { ClipSimulation } from '../js/physics/clip-simulation.js';
import { SIMULATE_STEP } from '../js/timeline-player.js';
import { ragFile } from './helpers/rag-file.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

class Container {
  constructor() {
    this.children = [];
    this.parent = null;
    this.sortableChildren = false;
  }

  addChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children.splice(this.children.indexOf(child), 1);
    child.parent = null;
    return child;
  }

  destroy() {}
}

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function continuousPoses(json, options, stepCounts) {
  const session = createSimulateSession(Box2D, json, options);
  const poses = new Map();
  try {
    let steps = 0;
    for (const target of [...stepCounts].sort((a, b) => a - b)) {
      for (; steps < target; steps++) session.step(SIMULATE_STEP);
      poses.set(target, session.pose());
    }
  } finally {
    session.destroy();
  }
  return poses;
}

function settled(json, loop) {
  const frames = [];
  const clock = { request: (callback) => frames.push(callback), cancel: () => {}, now: () => 0 };
  const sim = new ClipSimulation((document, options) => createSimulateSession(Box2D, document, options), clock);
  sim.open({ json, clip: 'walk', length: 2, speed: 1, loop });
  for (let i = 0; i < 100 && frames.length > 0; i++) frames.shift()();
  return sim;
}

test('the clip simulation stores exactly the poses continuous stepping reaches, read back in any order', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const json = ragFile();
  json.clips[0].loop = false;
  const sim = settled(json, false);
  const expected = continuousPoses(json, { clip: 'walk', pose: null }, [40, 120]);
  assert.deepEqual(sim.pose(1, 2).pose, expected.get(120));
  assert.deepEqual(sim.pose(1, 40 * SIMULATE_STEP).pose, expected.get(40));
  assert.deepEqual(sim.pose(1, 2).pose, expected.get(120));
  sim.close();
});

test('a looping clip runs continuously from its pose at 0: cycle 2 starts where cycle 1 ended, not at the spawn', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const json = ragFile();
  json.clips[0].tracks[0].keys = [{ t: 0, v: 0.15, interp: 'linear' }];
  const sim = settled(json, true);
  const expected = continuousPoses(json, { clip: 'walk', pose: 'walk' }, [0, 120, 180]);
  assert.deepEqual(sim.pose(1, 0).pose, expected.get(0));
  assert.deepEqual(sim.pose(2, 0).pose, expected.get(120));
  assert.deepEqual(sim.pose(1, 2).pose, sim.pose(2, 0).pose);
  assert.deepEqual(sim.pose(2, 1).pose, expected.get(180));
  assert.notDeepEqual(sim.pose(2, 0).pose, sim.pose(1, 0).pose);
  const ghost = continuousPoses(json, { clip: 'walk', pose: null }, [60]);
  assert.deepEqual(sim.ghostPose(1).pose, ghost.get(60));
  sim.close();
});
