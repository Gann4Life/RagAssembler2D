import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { createClip, createJoint, createShapeBody } from '../js/commands/create.js';
import { setJointAngleKey } from '../js/commands/keys.js';
import { setProps } from '../js/commands/props.js';
import { animateRotationPivot, animateRotationTarget, startAnimateRotation } from '../js/tools/animate-rotation.js';
import { ToolRegistry } from '../js/tools/registry.js';
import { defineTool } from '../js/tools/tool.js';
import { jointAngleRows } from '../js/timeline-rows.js';
import { gizmoHandleAt, gizmoLayout } from '../js/tools/transform-gizmo.js';

const DEG = Math.PI / 180;

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
}

function environment() {
  const editor = createEditor();
  const { model, history, selection, modes, settings, camera } = editor;
  camera.setSize(400, 400);
  camera.zoomAt({ x: 200, y: 200 }, 100 / camera.scale);
  const shapes = [0, 1, 2].map((x) =>
    history.execute(createShapeBody({ position: { x, y: 0 }, angle: 0, shape: { type: 'circle', radius: 0.4 } })),
  );
  const bodies = shapes.map((uid) => model.get(uid).parent);
  history.execute(setProps([ROOT_UID], { rootBody: model.prop(bodies[0], 'id') }));
  const joints = [0, 1].map((index) =>
    history.execute(createJoint({ bodyA: bodies[index], bodyB: bodies[index + 1], anchor: { x: index + 0.5, y: 0 } })),
  );
  const clip = history.execute(createClip());
  let ctx = null;
  const probe = defineTool({
    id: 'select',
    activate(context) {
      ctx = context;
    },
  });
  new ToolRegistry({ model, history, selection, modes, settings, camera }, [probe]);
  return { ...editor, ctx, shapes, bodies, joints, clip };
}

function pointer(env, world, modifiers = {}) {
  return { world, screen: env.camera.worldToScreen(world), shift: false, ctrl: false, alt: false, ...modifiers };
}

test('setJointAngleKey creates the track on the first key, updates a key at the same time and keeps keys in order', () => {
  const env = environment();
  const { model, history, clip, joints } = env;
  const first = history.execute(setJointAngleKey(clip, joints[0], 0.5, 1));
  const [track] = model.children(clip, 'tracks');
  assert.deepEqual(
    [model.prop(track, 'target'), model.prop(track, 'channel')],
    [model.prop(joints[0], 'id'), 'angle'],
  );
  assert.deepEqual(model.get(first).props, { t: 0.5, v: 1, interp: 'linear' });
  history.execute(setJointAngleKey(clip, joints[0], 0, -1));
  const again = history.execute(setJointAngleKey(clip, joints[0], 0.5 + 0.001, 2));
  assert.equal(again, first);
  assert.deepEqual(
    model.children(track, 'keys').map((uid) => [model.prop(uid, 't'), model.prop(uid, 'v')]),
    [[0, -1], [0.5, 2]],
  );
  assert.equal(model.children(clip, 'tracks').length, 1);
});

test('setJointAngleKey snaps the time to 1/30 s, clamps it to the clip, and undoes the track with its key', () => {
  const env = environment();
  const { model, history, clip, joints } = env;
  history.execute(setJointAngleKey(clip, joints[0], 0.5, 1));
  history.execute(setJointAngleKey(clip, joints[1], 99, 1));
  const [, second] = model.children(clip, 'tracks');
  near(model.prop(model.children(second, 'keys')[0], 't'), 1);
  history.undo();
  assert.equal(model.children(clip, 'tracks').length, 1);
  history.undo();
  assert.equal(model.children(clip, 'tracks').length, 0);
  history.redo();
  assert.equal(model.children(clip, 'tracks').length, 1);
});

test('setJointAngleKey refuses a wrong node or a non-finite value without mutating', () => {
  const env = environment();
  const { model, history, clip, joints, bodies } = env;
  assert.throws(() => history.execute(setJointAngleKey(joints[0], joints[0], 0, 1)), /not a clip/);
  assert.throws(() => history.execute(setJointAngleKey(clip, bodies[0], 0, 1)), /not a joint/);
  assert.throws(() => history.execute(setJointAngleKey(clip, joints[0], Number.NaN, 1)), TypeError);
  assert.throws(() => history.execute(setJointAngleKey(clip, joints[0], 0, Infinity)), TypeError);
  assert.equal(model.children(clip, 'tracks').length, 0);
});

test('jointAngleRows lists the angle tracks of the clip in joint order with their keys', () => {
  const env = environment();
  const { model, history, clip, joints } = env;
  assert.deepEqual(jointAngleRows(model, null), []);
  assert.deepEqual(jointAngleRows(model, clip), []);
  history.execute(setJointAngleKey(clip, joints[1], 0.5, 1));
  history.execute(setJointAngleKey(clip, joints[0], 0, 0.25));
  history.execute(setJointAngleKey(clip, joints[1], 0, 0.5));
  const rows = jointAngleRows(model, clip);
  assert.deepEqual(rows.map((row) => row.joint), joints);
  assert.deepEqual(rows[1].keys.map((key) => [key.t, key.v]), [[0, 0.5], [0.5, 1]]);
  assert.equal(rows[0].label, model.prop(joints[0], 'name'));
});

test('animateRotationTarget accepts exactly one body with a parent joint, also through its shape', () => {
  const { model, shapes, bodies, joints } = environment();
  assert.deepEqual(animateRotationTarget(model, [bodies[1]]), { body: bodies[1], joint: joints[0] });
  assert.deepEqual(animateRotationTarget(model, [shapes[2]]), { body: bodies[2], joint: joints[1] });
  assert.equal(animateRotationTarget(model, [bodies[0]]), null);
  assert.equal(animateRotationTarget(model, [bodies[1], bodies[2]]), null);
  assert.equal(animateRotationTarget(model, [joints[0]]), null);
  assert.equal(animateRotationTarget(model, []), null);
});

test('animateRotationPivot is the joint anchor in the displayed pose', () => {
  const { model, joints } = environment();
  assert.deepEqual(animateRotationPivot(model, null, joints[1]), { x: 1.5, y: 0 });
});

test('a ring-only gizmo offers the ring and nothing else', () => {
  const pivot = { x: 100, y: 100 };
  const layout = gizmoLayout(pivot, { ring: true, ringOnly: true });
  assert.equal(layout.ringOnly, true);
  assert.equal(gizmoHandleAt(layout, { x: pivot.x + layout.ring, y: pivot.y }), 'ring');
  assert.equal(gizmoHandleAt(layout, { x: layout.square.x + 2, y: layout.square.y + 2 }), null);
  assert.equal(gizmoHandleAt(layout, { x: layout.x.tip.x, y: layout.x.tip.y }), null);
  assert.equal('ringOnly' in gizmoLayout(pivot, { ring: true }), false);
});

test('rotating a body in Animate mode keys the parent joint at the playhead as one undo step', () => {
  const env = environment();
  const { model, history, modes, ctx, bodies, joints, clip } = env;
  modes.openClip(clip);
  modes.setPlayhead(0.5);
  const target = animateRotationTarget(model, [bodies[1]]);
  const drag = startAnimateRotation(ctx, { target, press: pointer(env, { x: 1.5, y: 0 }) });
  near(drag.pivot().x, 0.5);
  const undoDepth = history.state.undoLabel;
  history.beginGesture();
  drag.apply(pointer(env, { x: 0.5, y: 0.5 }));
  drag.apply(pointer(env, { x: 0.5, y: 1 }));
  history.endGesture();
  const [row] = jointAngleRows(model, clip);
  assert.equal(row.joint, joints[0]);
  assert.equal(row.keys.length, 1);
  near(row.keys[0].t, 0.5);
  near(Math.abs(row.keys[0].v), Math.PI / 2);
  near(Math.abs(drag.sweep().angle), Math.PI / 2);
  assert.equal(history.state.undoLabel, 'Rotate joint');
  history.undo();
  assert.deepEqual(jointAngleRows(model, clip), []);
  assert.equal(history.state.undoLabel, undoDepth);
});

test('Animate rotation updates the existing key, adds from the evaluated angle and CTRL snaps to 15 degrees', () => {
  const env = environment();
  const { model, history, modes, ctx, bodies, joints, clip } = env;
  history.execute(setJointAngleKey(clip, joints[0], 0, 0.3));
  modes.openClip(clip);
  const target = animateRotationTarget(model, [bodies[1]]);
  const drag = startAnimateRotation(ctx, { target, press: pointer(env, { x: 1.5, y: 0 }) });
  drag.apply(pointer(env, { x: 0.5 + Math.cos(20 * DEG), y: Math.sin(20 * DEG) }));
  let [row] = jointAngleRows(model, clip);
  assert.equal(row.keys.length, 1);
  near(row.keys[0].v, 0.3 + 20 * DEG);
  drag.apply(pointer(env, { x: 0.5 + Math.cos(20 * DEG), y: Math.sin(20 * DEG) }, { shift: true }));
  [row] = jointAngleRows(model, clip);
  near(row.keys[0].v, 0.3 + 20 * DEG);
  drag.apply(pointer(env, { x: 0.5 + Math.cos(20 * DEG), y: Math.sin(20 * DEG) }, { ctrl: true }));
  [row] = jointAngleRows(model, clip);
  near(row.keys[0].v, 30 * DEG);
  near(drag.sweep().angle, 30 * DEG - 0.3);
});

test('Animate rotation does not touch the rest pose', () => {
  const env = environment();
  const { model, history, modes, ctx, bodies, clip } = env;
  modes.openClip(clip);
  const rest = JSON.stringify(model.prop(bodies[1], 'angle'));
  const drag = startAnimateRotation(ctx, { target: animateRotationTarget(model, [bodies[1]]), press: pointer(env, { x: 1.5, y: 0 }) });
  history.beginGesture();
  drag.apply(pointer(env, { x: 0.5, y: 1 }));
  history.endGesture();
  assert.equal(JSON.stringify(model.prop(bodies[1], 'angle')), rest);
});
