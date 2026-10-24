import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { loadJson, toJson } from '../js/model/io.js';
import { animatePose } from '../js/model/animate-preview.js';
import { rootBodyPlan, setRootBody } from '../js/commands/root-body.js';
import { dispatchKey } from '../js/hotkeys.js';
import { ragFile } from './helpers/rag-file.js';

const near = (actual, expected, label = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label} ${actual} !== ${expected}`);

function bodyDef(template, id, position, angle) {
  const body = structuredClone(template);
  Object.assign(body, { id, name: id, position, angle });
  body.fixtures[0].id = `f_${id}`;
  body.fixtures[0].name = id;
  body.fixtures[0].sprite = null;
  return body;
}

function jointDef(template, id, bodyA, bodyB, anchor) {
  return { ...structuredClone(template), id, name: id, bodyA, bodyB, anchor };
}

function key(t, v, interp = 'linear') {
  return { t, v, interp };
}

function clipDef(name, tracks, blend = 'override') {
  return {
    key: name,
    name,
    loop: false,
    hold: true,
    layer: 1,
    blend,
    length: 2,
    fadeIn: 0,
    fadeOut: 0,
    speed: 1,
    tracks,
    events: [],
  };
}

function humanoid(rootBody, clips) {
  const doc = ragFile();
  const [bodyTemplate] = doc.bodies;
  const [jointTemplate] = doc.joints;
  doc.sprites = [];
  doc.bodies = [
    bodyDef(bodyTemplate, 'torso', [0, 1], 0.1),
    bodyDef(bodyTemplate, 'head', [0, 1.6], 0.2),
    bodyDef(bodyTemplate, 'thigh', [0.1, 0.5], -0.3),
    bodyDef(bodyTemplate, 'shin', [0.15, 0.1], 0.4),
    bodyDef(bodyTemplate, 'arm', [0.4, 1.2], -0.1),
    bodyDef(bodyTemplate, 'loose', [3, 3], 0),
  ];
  doc.joints = [
    jointDef(jointTemplate, 'neck', 'torso', 'head', [0, 1.4]),
    jointDef(jointTemplate, 'hip', 'torso', 'thigh', [0.1, 0.7]),
    jointDef(jointTemplate, 'knee', 'thigh', 'shin', [0.12, 0.3]),
    jointDef(jointTemplate, 'shoulder', 'arm', 'torso', [0.3, 1.25]),
  ];
  doc.ragdoll.rootBody = rootBody;
  doc.clips = clips;
  const editor = createEditor();
  const result = loadJson(editor.model, JSON.stringify(doc));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return { editor, model: editor.model, uid: (id) => editor.model.uidOf(id) };
}

function bodyAngleKeys(model, clip) {
  const tracks = toJson(model, 'dev').clips.find((entry) => entry.key === clip).tracks;
  return tracks.filter((track) => track.target === 'root' && track.channel === 'bodyAngle').map((track) => track.keys);
}

function clipUid(model, key) {
  return model.children(ROOT_UID, 'clips').find((uid) => model.prop(uid, 'key') === key);
}

function assertSamePoseUpToTranslation(before, after, label) {
  let delta = null;
  for (const [body, posed] of before) {
    const moved = after.get(body);
    near(moved.angle, posed.angle, `${label} angle of ${body}`);
    const offset = { x: moved.x - posed.x, y: moved.y - posed.y };
    delta ??= offset;
    near(offset.x, delta.x, `${label} x of ${body}`);
    near(offset.y, delta.y, `${label} y of ${body}`);
  }
}

test('the worked example of DESIGN §2.1: hip 0.5 and bodyAngle 0.1 become bodyAngle 0.6 on the thigh', () => {
  const { editor, model, uid } = humanoid('torso', [
    clipDef('walk', [
      { target: 'root', channel: 'bodyAngle', keys: [key(0, 0.1)] },
      { target: 'hip', channel: 'angle', keys: [key(0, 0.5)] },
    ]),
  ]);
  const plan = rootBodyPlan(model, uid('thigh'));
  assert.deepEqual(plan.path, [{ joint: uid('hip'), sign: 1 }]);
  editor.history.execute(setRootBody(uid('thigh')));
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'thigh');
  const [keys] = bodyAngleKeys(model, 'walk');
  assert.equal(keys.length, 1);
  near(keys[0].v, 0.6);
  const pose = animatePose(model, clipUid(model, 'walk'), 0);
  near(pose.get(uid('thigh')).angle, -0.3 + 0.6);
  near(pose.get(uid('torso')).angle, 0.1 + 0.1);
  assert.deepEqual(
    toJson(model, 'dev').joints.map(({ bodyA, bodyB }) => [bodyA, bodyB]),
    [['torso', 'head'], ['torso', 'thigh'], ['thigh', 'shin'], ['arm', 'torso']],
  );
});

const LEG_CLIPS = () => [
  clipDef('walk', [
    { target: 'root', channel: 'bodyAngle', keys: [key(0, 0.2), key(1, -0.1), key(2, 0.3, 'ease')] },
    { target: 'knee', channel: 'angle', keys: [key(0, 0.4), key(0.5, -0.2), key(1.5, 0.6)] },
    { target: 'hip', channel: 'angle', keys: [key(0.5, 0.3, 'step'), key(1.5, -0.4)] },
    { target: 'neck', channel: 'angle', keys: [key(0, 0.1), key(2, -0.2)] },
    { target: 'shoulder', channel: 'angle', keys: [key(0.25, 0.5), key(1.75, -0.5)] },
  ]),
  clipDef(
    'sway',
    [
      { target: 'root', channel: 'bodyAngle', keys: [key(0, 0.05), key(2, -0.05)] },
      { target: 'hip', channel: 'angle', keys: [key(0, 0.2), key(1, -0.2)] },
    ],
    'additive',
  ),
];

function reRootPreservesPose(clips, from, to) {
  const { editor, model, uid } = humanoid(from, clips);
  const times = [0, 0.25, 0.5, 1, 1.5, 1.75, 2];
  const clipsUids = model.children(ROOT_UID, 'clips');
  const poses = clipsUids.map((clip) => times.map((t) => animatePose(model, clip, t)));
  editor.history.execute(setRootBody(uid(to)));
  assert.equal(model.prop(ROOT_UID, 'rootBody'), to);
  clipsUids.forEach((clip, c) => {
    times.forEach((t, i) => {
      const after = animatePose(model, clip, t);
      const before = new Map([...poses[c][i]].filter(([body]) => body !== uid('loose')));
      assertSamePoseUpToTranslation(before, after, `clip ${c} at ${t}`);
    });
  });
  return { model, uid };
}

test('re-rooting a humanoid from the shin to the torso keeps every FK pose up to translation at key times', () => {
  const { model } = reRootPreservesPose(LEG_CLIPS(), 'shin', 'torso');
  const [walk] = bodyAngleKeys(model, 'walk');
  assert.deepEqual(walk.map((k) => k.t), [0, 0.5, 1, 1.5, 2]);
});

test('re-rooting from the torso to the shin and back restores the keys values', () => {
  const { editor, model, uid } = humanoid('torso', LEG_CLIPS());
  const before = bodyAngleKeys(model, 'walk')[0];
  editor.history.execute(setRootBody(uid('shin')));
  editor.history.execute(setRootBody(uid('torso')));
  const after = bodyAngleKeys(model, 'walk')[0];
  for (const original of before) {
    const match = after.find((k) => Math.abs(k.t - original.t) < 1e-9);
    near(match.v, original.v, `t=${original.t}`);
  }
});

test('an additive clip is converted with the same formula and keeps its FK pose', () => {
  const { model } = reRootPreservesPose(LEG_CLIPS().slice(1), 'torso', 'shin');
  const [sway] = bodyAngleKeys(model, 'sway');
  assert.deepEqual(sway.map((k) => k.t), [0, 1, 2]);
  near(sway[0].v, 0.05 + 0.2);
  near(sway[1].v, 0 + -0.2);
  near(sway[2].v, -0.05 + -0.2);
});

test('segment interpolation follows the terms that change: step, ease or linear', () => {
  const { editor, model, uid } = humanoid('torso', [
    clipDef('mixed', [
      { target: 'root', channel: 'bodyAngle', keys: [key(0, 0, 'ease'), key(1, 0.5, 'ease'), key(2, 0.5, 'ease')] },
      { target: 'hip', channel: 'angle', keys: [key(0, 0.1, 'ease'), key(1, 0.1, 'step'), key(1.5, 0.4, 'linear')] },
    ]),
  ]);
  editor.history.execute(setRootBody(uid('thigh')));
  const [keys] = bodyAngleKeys(model, 'mixed');
  assert.deepEqual(keys.map((k) => [k.t, k.interp]), [[0, 'ease'], [1, 'step'], [1.5, 'linear'], [2, 'ease']]);
});

test('a clip with angle tracks on the path but no bodyAngle track gains one appended to its tracks', () => {
  const { editor, model, uid } = humanoid('torso', [
    clipDef('kick', [
      { target: 'hip', channel: 'angle', keys: [key(0, 0.3), key(1, -0.3)] },
      { target: 'knee', channel: 'angle', keys: [key(0.5, 0.2)] },
    ]),
    clipDef('nod', [{ target: 'neck', channel: 'angle', keys: [key(0, 0.3)] }]),
  ]);
  const nodBefore = toJson(model, 'dev').clips[1];
  const before = [0, 0.5, 1].map((t) => animatePose(model, clipUid(model, 'kick'), t));
  editor.history.execute(setRootBody(uid('thigh')));
  const kick = toJson(model, 'dev').clips[0];
  assert.equal(kick.tracks.length, 3);
  assert.deepEqual(
    { target: kick.tracks[2].target, channel: kick.tracks[2].channel },
    { target: 'root', channel: 'bodyAngle' },
  );
  assert.deepEqual(kick.tracks[2].keys.map((k) => k.t), [0, 1]);
  near(kick.tracks[2].keys[0].v, 0.3);
  near(kick.tracks[2].keys[1].v, -0.3);
  [0, 0.5, 1].forEach((t, i) => {
    const after = animatePose(model, clipUid(model, 'kick'), t);
    const expected = new Map([...before[i]].filter(([body]) => body !== uid('loose')));
    assertSamePoseUpToTranslation(expected, after, `t=${t}`);
  });
  assert.deepEqual(toJson(model, 'dev').clips[1], nodBefore);
});

test('a disconnected new root leaves every key unchanged', () => {
  const { editor, model, uid } = humanoid('torso', LEG_CLIPS());
  const clipsBefore = toJson(model, 'dev').clips;
  const plan = rootBodyPlan(model, uid('loose'));
  assert.deepEqual([plan.path, plan.tracks], [[], []]);
  editor.history.execute(setRootBody(uid('loose')));
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'loose');
  assert.deepEqual(toJson(model, 'dev').clips, clipsBefore);
});

test('Set as root body is one exact undo step, redone exactly', () => {
  const { editor, model, uid } = humanoid('shin', LEG_CLIPS());
  const before = toJson(model, 'dev');
  editor.selection.set([uid('torso')]);
  editor.actions.run('set-root-body');
  const after = toJson(model, 'dev');
  assert.equal(editor.history.state.undoLabel, 'Set as root body');
  assert.deepEqual(editor.selection.objects, [uid('torso')]);
  editor.history.undo();
  assert.deepEqual(toJson(model, 'dev'), before);
  editor.history.redo();
  assert.deepEqual(toJson(model, 'dev'), after);
});

test('setRootBody refuses a non-body and the current root body without mutating', () => {
  const { editor, model, uid } = humanoid('torso', LEG_CLIPS());
  const before = toJson(model, 'dev');
  assert.throws(() => editor.history.execute(setRootBody(uid('hip'))), /not a body/);
  assert.throws(() => editor.history.execute(setRootBody(uid('torso'))), /already the root body/);
  assert.deepEqual(toJson(model, 'dev'), before);
});

test('set-root-body needs Edit mode, no gesture and exactly one non-root body in the selection', () => {
  const { editor, model, uid } = humanoid('torso', LEG_CLIPS());
  const { actions, selection, modes, history } = editor;
  const enabledFor = (uids) => {
    selection.set(uids);
    return actions.isEnabled('set-root-body');
  };
  const shapeOf = (body) => model.children(uid(body), 'fixtures')[0];
  assert.equal(enabledFor([]), false);
  assert.equal(enabledFor([uid('torso')]), false);
  assert.equal(enabledFor([shapeOf('torso')]), false);
  assert.equal(enabledFor([uid('thigh'), uid('shin')]), false);
  assert.equal(enabledFor([ROOT_UID]), false);
  assert.equal(enabledFor([uid('hip')]), false);
  assert.equal(enabledFor([uid('thigh')]), true);
  assert.equal(enabledFor([shapeOf('thigh')]), true);
  assert.equal(enabledFor([uid('thigh'), shapeOf('thigh'), uid('hip'), ROOT_UID]), true);
  history.beginGesture();
  assert.equal(actions.isEnabled('set-root-body'), false);
  history.cancelGesture();
  modes.openClip(clipUid(model, 'walk'));
  assert.equal(actions.isEnabled('set-root-body'), false);
  assert.equal(actions.reason('set-root-body'), 'only in Edit mode');
  const event = { key: 'R', shiftKey: true, target: { tagName: 'BODY' }, preventDefault() {} };
  dispatchKey(event, { actions });
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'torso');
  modes.openClip(null);
  assert.equal(modes.mode, 'edit');
  assert.equal(dispatchKey(event, { actions }), true);
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'thigh');
  assert.deepEqual(selection.objects, [uid('thigh'), shapeOf('thigh'), uid('hip'), ROOT_UID]);
});
