import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID, Model } from '../js/model/model.js';
import { loadJson } from '../js/model/io.js';
import { ClipSimulation } from '../js/physics/clip-simulation.js';
import { TimelinePlayer } from '../js/timeline-player.js';
import { serialize } from '../lib/serialize.js';
import { ragFile } from './helpers/rag-file.js';

function versionOneText() {
  const json = ragFile();
  json.version = 1;
  delete json.ragdoll.balance;
  json.clips = [];
  return JSON.stringify(json);
}

function olderVersionTwoText() {
  const json = ragFile();
  for (const joint of json.joints) joint.motor.maxTorque = 80;
  json.ragdoll.balance.maxTorque = 80;
  return JSON.stringify(json);
}

const FIXTURES = Object.freeze([
  ['format version 1', versionOneText],
  ['format version 2 saved before automatic motor torque', olderVersionTwoText],
]);

function fakeClock() {
  const clock = {
    time: 0,
    frames: new Map(),
    next: 1,
    request(callback) {
      const handle = clock.next++;
      clock.frames.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      clock.frames.delete(handle);
    },
    now: () => clock.time,
    settle(limit = 50) {
      for (let i = 0; i < limit && clock.frames.size > 0; i++) {
        clock.time += 16;
        const pending = [...clock.frames.values()];
        clock.frames.clear();
        for (const frame of pending) frame(clock.time);
      }
    },
  };
  return clock;
}

function fakeSimulator(json) {
  return {
    step() {},
    pose: () => new Map(json.bodies.map((body) => [body.id, { x: 0, y: 0, angle: 0 }])),
    destroy() {},
  };
}

async function animating() {
  const notices = [];
  const editor = createEditor({
    confirm: () => Promise.resolve(true),
    notify: (notice) => {
      notices.push(notice);
      return Promise.resolve();
    },
  });
  assert.equal(await editor.loadFrom(() => Promise.resolve(serialize(ragFile()))), true);
  const [clip] = editor.model.children(ROOT_UID, 'clips');
  editor.modes.openClip(clip);
  notices.length = 0;
  return { editor, clip, notices };
}

for (const [label, text] of FIXTURES) {
  test(`${label} loads with migration and automatic motor torque`, () => {
    const result = loadJson(new Model(), text());
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.notEqual(result.torque, null);
  });

  test(`${label} loads while Animate has a clip open`, async () => {
    const { editor, clip, notices } = await animating();
    const reads = [];
    editor.history.on('history', () => {
      if (editor.modes.clip !== null) reads.push(editor.model.prop(editor.modes.clip, 'loop'));
    });
    assert.equal(editor.modes.clip, clip);
    assert.equal(await editor.loadFrom(() => Promise.resolve(text())), true);
    assert.equal(editor.modes.mode, 'edit');
    assert.equal(editor.modes.clip, null);
    assert.deepEqual(reads, []);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].kind, 'load-notes');
    assert.equal(editor.model.prop(ROOT_UID, 'balance.enabled'), true);
  });

  test(`${label} loaded over an open clip simulation reports no clip simulation errors`, async () => {
    const { editor, clip } = await animating();
    editor.modes.openClip(null);
    const clock = fakeClock();
    const statuses = [];
    const player = new TimelinePlayer({
      model: editor.model,
      modes: editor.modes,
      history: editor.history,
      clock,
      simulator: fakeSimulator,
      clipSimulation: new ClipSimulation(fakeSimulator, clock),
      status: (message) => statuses.push(message),
    });
    editor.modes.openClip(clip);
    clock.settle();
    assert.equal(player.simulationAvailable, true);
    assert.equal(await editor.loadFrom(() => Promise.resolve(text())), true);
    clock.settle();
    assert.deepEqual(statuses, []);
  });
}
