import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter } from '../lib/ragimporter.js';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { loadJson } from '../js/model/io.js';
import { createSimulateSession } from '../js/physics/simulate-session.js';
import { SIMULATE_STEP, TimelinePlayer } from '../js/timeline-player.js';
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

function continuousPoses(json, clip, stepCounts) {
  const session = createSimulateSession(Box2D, json, { clip });
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

function scrubbedPose(player, frames, t) {
  let pose = null;
  const off = player.on('pose', (value) => {
    pose = value;
  });
  try {
    player.scrub(t);
    while (frames.length > 0) frames.shift()();
  } finally {
    off();
  }
  return pose;
}

test('scrubbing back re-simulates to the exact pose continuous stepping reaches', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const json = ragFile();
  const editor = createEditor();
  assert.equal(loadJson(editor.model, JSON.stringify(json)).ok, true);
  const clip = editor.model.children(ROOT_UID, 'clips').find((uid) => editor.model.prop(uid, 'key') === 'walk');
  editor.modes.openClip(clip);
  const frames = [];
  const clock = {
    request: (callback) => frames.push(callback),
    cancel: () => {
      frames.length = 0;
    },
  };
  const player = new TimelinePlayer(editor.model, editor.modes, clock, (document, options) =>
    createSimulateSession(Box2D, document, options),
  );
  const length = editor.model.prop(clip, 'length');
  const late = Math.round(length / SIMULATE_STEP);
  const early = Math.round(late / 3);
  const expected = continuousPoses(json, 'walk', [early, late]);
  assert.notDeepEqual(expected.get(early), expected.get(late));

  const forward = scrubbedPose(player, frames, late * SIMULATE_STEP);
  const back = scrubbedPose(player, frames, early * SIMULATE_STEP);
  editor.modes.openClip(null);

  for (const [steps, pose] of [[late, forward], [early, back]]) {
    assert.ok(pose instanceof Map, `no pose at step ${steps}`);
    for (const [id, transform] of expected.get(steps)) {
      assert.deepEqual(pose.get(editor.model.uidOf(id)), transform, `${id} at step ${steps}`);
    }
  }
});
