import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { createJoint, createShapeBody } from '../js/commands/create.js';
import { setProps } from '../js/commands/props.js';
import { setRootBodyAngleKey } from '../js/commands/keys.js';
import { loadJson, saveJson, toJson } from '../js/model/io.js';
import { animatePose } from '../js/model/animate-preview.js';
import { balanceTorqueSuggestion } from '../lib/motor.js';
import { bodyMassData, transformPoint } from '../lib/geometry.js';
import { ragFile } from './helpers/rag-file.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`);

function loaded(bodyAngle) {
  const doc = ragFile();
  doc.clips[0].tracks.push({ target: 'root', channel: 'bodyAngle', keys: [{ t: 0, v: bodyAngle, interp: 'linear' }] });
  const editor = createEditor();
  assert.equal(loadJson(editor.model, JSON.stringify(doc)).ok, true);
  return { editor, doc, clip: editor.model.children(ROOT_UID, 'clips')[0], uid: (id) => editor.model.uidOf(id) };
}

test('the FK preview turns rootBody about its rest center of mass and the children follow', () => {
  const { editor, doc, clip, uid } = loaded(0.5);
  const pose = animatePose(editor.model, clip, 0);
  const torso = doc.bodies[0];
  const rest = { x: torso.position[0], y: torso.position[1], angle: torso.angle };
  const center = bodyMassData(torso.fixtures).center;
  const posed = pose.get(uid('b_torso'));
  near(posed.angle, torso.angle + 0.5);
  const fixed = transformPoint(posed, center);
  const before = transformPoint(rest, center);
  near(fixed.x, before.x);
  near(fixed.y, before.y);
  near(pose.get(uid('b_arm')).angle, -0.2 + 0.5);
  near(pose.get(uid('b_head')).angle, 0.3 + 0.5 + 0.1);
});

test('without a bodyAngle track rootBody keeps its rest transform', () => {
  const { editor, doc, uid } = loaded(0);
  const clip = editor.model.children(ROOT_UID, 'clips')[0];
  const pose = animatePose(editor.model, clip, 0);
  assert.deepEqual(pose.get(uid('b_torso')), { x: doc.bodies[0].position[0], y: doc.bodies[0].position[1], angle: doc.bodies[0].angle });
});

test('setRootBodyAngleKey creates the root track, updates a key at the same time and rejects a wrong clip', () => {
  const { editor, clip } = loaded(0);
  const { model, history } = editor;
  const key = history.execute(setRootBodyAngleKey(clip, 1, 0.7));
  const track = model.get(key).parent;
  assert.deepEqual([model.prop(track, 'target'), model.prop(track, 'channel')], ['root', 'bodyAngle']);
  assert.equal(history.execute(setRootBodyAngleKey(clip, 1, 0.9)), key);
  assert.equal(model.prop(key, 'v'), 0.9);
  assert.throws(() => history.execute(setRootBodyAngleKey(ROOT_UID, 1, 0.9)), /not a clip/);
});

function balanceScene() {
  const editor = createEditor();
  const { model, history } = editor;
  const shapes = [0, 1].map((x) =>
    history.execute(createShapeBody({ position: { x, y: 0 }, angle: 0, shape: { type: 'box', width: 0.5, height: 0.5 } })),
  );
  const bodies = shapes.map((uid) => model.get(uid).parent);
  history.execute(setProps([ROOT_UID], { rootBody: model.prop(bodies[0], 'id') }));
  const joint = history.execute(createJoint({ bodyA: bodies[0], bodyB: bodies[1], anchor: { x: 0.5, y: 0 } }));
  return { editor, joint, shapes, suggestion: () => balanceTorqueSuggestion(toJson(model, 'dev')) };
}

test('fit-motor-torque also sets the balance torque when no joint or the root is selected, in one undo step', () => {
  const { editor, joint, shapes, suggestion } = balanceScene();
  const { model, history, selection, actions } = editor;
  const original = model.prop(ROOT_UID, 'balance.maxTorque');
  assert.notEqual(original, suggestion());
  selection.set([joint]);
  actions.run('fit-motor-torque');
  assert.equal(model.prop(ROOT_UID, 'balance.maxTorque'), original);
  history.undo();
  selection.set([shapes[0]]);
  actions.run('fit-motor-torque');
  assert.equal(model.prop(ROOT_UID, 'balance.maxTorque'), suggestion());
  assert.equal(history.state.undoLabel, 'Fit motor torque');
  history.undo();
  assert.equal(model.prop(ROOT_UID, 'balance.maxTorque'), original);
  selection.set([ROOT_UID, joint]);
  actions.run('fit-motor-torque');
  assert.equal(model.prop(ROOT_UID, 'balance.maxTorque'), suggestion());
  history.undo();
  assert.equal(model.prop(ROOT_UID, 'balance.maxTorque'), original);
  actions.run('fit-motor-torque');
  const fitted = history.state.undoLabel;
  actions.run('fit-motor-torque');
  assert.equal(history.state.undoLabel, fitted);
});

test('loading a version 1 file migrates it and saving writes version 2', () => {
  const doc = ragFile();
  doc.version = 1;
  delete doc.ragdoll.balance;
  const editor = createEditor();
  const result = loadJson(editor.model, JSON.stringify(doc));
  assert.equal(result.ok, true);
  assert.deepEqual(result.notes, ['Migrated from format version 1 to 2']);
  assert.equal(typeof editor.model.prop(ROOT_UID, 'balance.maxTorque'), 'number');
  const saved = saveJson(editor.model, 'dev');
  assert.equal(saved.ok, true);
  const written = JSON.parse(saved.text);
  assert.equal(written.version, 2);
  assert.deepEqual(Object.keys(written.ragdoll.balance).toSorted(), ['damping', 'enabled', 'gain', 'maxSpeed', 'maxTorque']);
});
