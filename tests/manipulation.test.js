import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { createJoint, createShapeBody } from '../js/commands/create.js';
import { setProps } from '../js/commands/props.js';
import { ToolRegistry } from '../js/tools/registry.js';
import { defineTool } from '../js/tools/tool.js';
import {
  canRotate,
  gizmoPivot,
  lastTargetObject,
  manipulationTarget,
  rotationPivot,
  startMove,
  startRotation,
  sweepTracker,
} from '../js/tools/manipulation.js';
import { formatMove } from '../js/tools/transform-gizmo.js';
import { defaultsOf } from '../lib/schema.js';

const EPSILON = 1e-9;
const DEG = Math.PI / 180;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message ?? ''} expected ${expected}, got ${actual}`);
}

function nearPair(actual, expected, message) {
  assert.equal(actual.length, 2, message);
  near(actual[0], expected[0], message);
  near(actual[1], expected[1], message);
}

function nearPoint(actual, expected, message) {
  near(actual.x, expected.x, message);
  near(actual.y, expected.y, message);
}

function addClip(history) {
  const { tracks, events, ...props } = defaultsOf('clip');
  return history.execute({
    label: 'Add clip',
    run: (tx) => tx.add(ROOT_UID, 'clips', undefined, { type: 'clip', props: { ...props, length: 1 } }),
  });
}

function environment({ snap = false } = {}) {
  const editor = createEditor();
  const { model, history, selection, modes, settings, camera } = editor;
  settings.set('snap.grid', snap);
  camera.setSize(400, 400);
  camera.zoomAt({ x: 200, y: 200 }, 100 / camera.scale);
  const shapes = [0, 1, 2, 3].map((x) =>
    history.execute(createShapeBody({ position: { x, y: 0 }, angle: x === 2 ? 0.5 : 0, shape: { type: 'circle', radius: 0.4 } })),
  );
  const bodies = shapes.map((uid) => model.get(uid).parent);
  const joints = [0, 1, 2].map((index) =>
    history.execute(createJoint({ bodyA: bodies[index], bodyB: bodies[index + 1], anchor: { x: index + 0.5, y: 0 } })),
  );
  let ctx = null;
  const probe = defineTool({
    id: 'select',
    activate(context) {
      ctx = context;
    },
  });
  new ToolRegistry({ model, history, selection, modes, settings, camera }, [probe]);
  return { ...editor, ctx, shapes, bodies, joints };
}

function event(env, world, modifiers = {}) {
  return { world, screen: env.camera.worldToScreen(world), shift: false, ctrl: false, alt: false, ...modifiers };
}

function position(model, uid) {
  return model.prop(uid, 'position');
}

function anchor(model, uid) {
  return model.prop(uid, 'anchor');
}

function onCircle(center, radius, angle) {
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
}

test('manipulationTarget: the root is ignored, shapes give their body once, joints are kept, other types ignored', () => {
  const { model, history, shapes, bodies, joints } = environment();
  const clip = addClip(history);
  assert.deepEqual(manipulationTarget(model, [shapes[1], ROOT_UID, joints[0]]), { bodies: [bodies[1]], joints: [joints[0]] });
  assert.deepEqual(manipulationTarget(model, [ROOT_UID]), { bodies: [], joints: [] });
  assert.deepEqual(manipulationTarget(model, [shapes[2], bodies[1], bodies[2], joints[1], clip, 999, shapes[1]]), {
    bodies: [bodies[2], bodies[1]],
    joints: [joints[1]],
  });
  assert.deepEqual(manipulationTarget(model, []), { bodies: [], joints: [] });
  assert.ok(Object.isFrozen(manipulationTarget(model, [bodies[0]])));
});

test('rotationPivot: parent anchor, origin for rootBody, with CTRL and for an unplaced anchor', () => {
  const { model, history, bodies, joints } = environment();
  assert.deepEqual(rotationPivot(model, bodies[1], false), { x: 0.5, y: 0 });
  assert.deepEqual(rotationPivot(model, bodies[1], true), { x: 1, y: 0 });
  assert.deepEqual(rotationPivot(model, bodies[0], false), { x: 0, y: 0 });
  history.execute(setProps([joints[1]], { anchor: null }));
  assert.deepEqual(rotationPivot(model, bodies[2], false), { x: 2, y: 0 });
  history.execute(setProps([bodies[3]], { position: undefined }));
  assert.deepEqual(rotationPivot(model, bodies[3], true), { x: 0, y: 0 });
});

test('lastTargetObject maps the last selection entry to a target object', () => {
  const { model, history, shapes, bodies, joints } = environment();
  const clip = addClip(history);
  const last = (objects) => lastTargetObject(model, objects, manipulationTarget(model, objects));
  assert.deepEqual(last([shapes[1], ROOT_UID]), { type: 'body', uid: bodies[1] });
  assert.equal(last([ROOT_UID]), null);
  assert.deepEqual(last([bodies[1], shapes[2]]), { type: 'body', uid: bodies[2] });
  assert.deepEqual(last([shapes[2], joints[0]]), { type: 'joint', uid: joints[0] });
  assert.deepEqual(last([joints[0], bodies[3], clip, 999]), { type: 'body', uid: bodies[3] });
  assert.equal(last([clip]), null);
  assert.equal(last([]), null);
});

test('gizmoPivot: one object uses its own pivot', () => {
  const { model, history, shapes, bodies, joints } = environment();
  const pivot = (objects, options = {}) => gizmoPivot(model, objects, { mode: 'center', ctrl: false, ...options });
  assert.equal(pivot([ROOT_UID]), null);
  assert.deepEqual(pivot([ROOT_UID, bodies[1]]), { x: 0.5, y: 0 });
  assert.deepEqual(pivot([bodies[1]]), { x: 0.5, y: 0 });
  assert.deepEqual(pivot([shapes[1]]), { x: 0.5, y: 0 });
  assert.deepEqual(pivot([shapes[1]], { ctrl: true }), { x: 1, y: 0 });
  assert.deepEqual(pivot([bodies[0]]), { x: 0, y: 0 });
  assert.deepEqual(pivot([joints[1]]), { x: 1.5, y: 0 });
  history.execute(setProps([joints[1]], { anchor: null }));
  assert.deepEqual(pivot([bodies[2]]), { x: 2, y: 0 });
  assert.equal(pivot([joints[1]]), null);
  assert.equal(pivot([]), null);
});

test('gizmoPivot: several objects by the pivot mode', () => {
  const { model, history, shapes, bodies, joints } = environment();
  const pivot = (objects, mode, ctrl = false) => gizmoPivot(model, objects, { mode, ctrl });
  assert.deepEqual(pivot([bodies[1], shapes[2]], 'center'), { x: 1.5, y: 0 });
  assert.deepEqual(pivot([bodies[1], joints[2]], 'center'), { x: 1.75, y: 0 });
  assert.deepEqual(pivot([bodies[1], joints[2]], 'center', true), { x: 1.75, y: 0 });
  assert.deepEqual(pivot([bodies[1], shapes[2]], 'last'), { x: 1.5, y: 0 });
  assert.deepEqual(pivot([bodies[1], shapes[2]], 'last', true), { x: 2, y: 0 });
  assert.deepEqual(pivot([shapes[2], joints[0]], 'last'), { x: 0.5, y: 0 });
  assert.deepEqual(pivot([shapes[2], joints[0]], 'last', true), { x: 0.5, y: 0 });
  history.execute(setProps([joints[2]], { anchor: [Number.NaN, 0] }));
  assert.deepEqual(pivot([bodies[1], joints[2]], 'center'), { x: 1, y: 0 });
  assert.equal(pivot([joints[2], joints[2]], 'center'), null);
});

test('gizmoPivot works in world meters under a moved and rotated root', () => {
  const { model, history, bodies } = environment();
  history.execute(setProps([ROOT_UID], { position: [1, 2], angle: Math.PI / 2 }));
  nearPoint(gizmoPivot(model, [bodies[1]], { mode: 'center', ctrl: false }), { x: 1, y: 2.5 });
  nearPoint(gizmoPivot(model, [bodies[1], bodies[3]], { mode: 'center', ctrl: false }), { x: 1, y: 4 });
  assert.equal(gizmoPivot(model, [ROOT_UID], { mode: 'last', ctrl: true }), null);
});

test('canRotate: any body, or two joints', () => {
  assert.equal(canRotate({ bodies: [3], joints: [] }), true);
  assert.equal(canRotate({ bodies: [], joints: [4] }), false);
  assert.equal(canRotate({ bodies: [], joints: [4, 5] }), true);
  assert.equal(canRotate({ bodies: [], joints: [] }), false);
});

test('startMove moves along X, Y or freely; the pivot follows the move', () => {
  for (const [axis, expected] of [['xy', [1.23, 0.17]], ['x', [1.23, 0]], ['y', [1, 0.17]]]) {
    const env = environment();
    const { model, ctx, selection, bodies, joints } = env;
    selection.set([bodies[1]]);
    const target = manipulationTarget(model, selection.objects);
    const press = event(env, { x: 0.5, y: 0 });
    const drag = startMove(ctx, { target, ref: { x: 0.5, y: 0 }, axis, press });
    nearPoint(drag.pivot(), { x: 0.5, y: 0 });
    drag.apply(event(env, { x: 0.73, y: 0.17 }));
    nearPair(position(model, bodies[1]), expected, axis);
    nearPair(position(model, bodies[3]), [expected[0] + 2, expected[1]], axis);
    nearPair(anchor(model, joints[0]), [expected[0] - 0.5, expected[1]], axis);
    assert.deepEqual(position(model, bodies[0]), [0, 0]);
    nearPoint(drag.pivot(), { x: expected[0] - 0.5, y: expected[1] }, axis);
    assert.equal(drag.readout(), formatMove({ x: expected[0] - 1, y: expected[1] }, model.prop(ROOT_UID, 'units.pixelsPerMeter')));
    assert.equal(env.history.state.undoLabel, 'Move');
  }
});

test('startMove snaps the reference point on its axis under a moved and rotated root', () => {
  const cases = [
    ['x', [1, -0.27], { x: 0.3, y: 0.54 }],
    ['y', [1.16, 0], { x: 0.03, y: 0.7 }],
    ['xy', [1.16, -0.27], { x: 0.3, y: 0.7 }],
  ];
  for (const [axis, local, world] of cases) {
    const env = environment({ snap: true });
    const { model, ctx, history, selection, bodies, joints } = env;
    history.execute(setProps([ROOT_UID], { position: [0.03, 0.04], angle: Math.PI / 2 }));
    selection.set([bodies[1]]);
    const ref = gizmoPivot(model, selection.objects, { mode: 'center', ctrl: false });
    nearPoint(ref, { x: 0.03, y: 0.54 });
    const target = manipulationTarget(model, selection.objects);
    const drag = startMove(ctx, { target, ref, axis, press: event(env, ref) });
    drag.apply(event(env, { x: 0.29, y: 0.67 }));
    nearPair(position(model, bodies[1]), local, axis);
    nearPoint(ctx.toWorld({ x: anchor(model, joints[0])[0], y: anchor(model, joints[0])[1] }), world, axis);
    nearPoint(drag.pivot(), world, axis);
  }
});

test('startMove: ALT is read live and moves the bodies alone; the root never moves', () => {
  const env = environment();
  const { model, ctx, history, selection, bodies, joints } = env;
  selection.set([bodies[2]]);
  const drag = startMove(ctx, { target: manipulationTarget(model, selection.objects), ref: { x: 2, y: 0 }, axis: 'xy', press: event(env, { x: 2, y: 0 }) });
  drag.apply(event(env, { x: 2.5, y: 0 }));
  nearPair(position(model, bodies[3]), [3.5, 0]);
  drag.apply(event(env, { x: 2.5, y: 0 }, { alt: true }));
  nearPair(position(model, bodies[2]), [2.5, 0]);
  assert.deepEqual(position(model, bodies[3]), [3, 0]);
  nearPair(anchor(model, joints[1]), [2, 0]);
  assert.deepEqual(anchor(model, joints[2]), [2.5, 0]);
  drag.apply(event(env, { x: 2.6, y: 0 }));
  nearPair(position(model, bodies[3]), [3.6, 0]);
  selection.set([ROOT_UID, bodies[0]]);
  const both = startMove(ctx, { target: manipulationTarget(model, selection.objects), ref: { x: 0, y: 0 }, axis: 'y', press: event(env, { x: 0, y: 0 }) });
  both.apply(event(env, { x: 0.3, y: 0.4 }));
  nearPair(position(model, bodies[0]), [0, 0.4]);
  assert.deepEqual(model.prop(ROOT_UID, 'position'), [0, 0]);
  assert.equal(history.state.undoLabel, 'Move');
});

test('startRotation never turns the root, also when it is selected with a body', () => {
  const env = environment();
  const { model, ctx, history, selection, bodies } = env;
  selection.set([ROOT_UID, bodies[0]]);
  const target = manipulationTarget(model, selection.objects);
  const drag = startRotation(ctx, { target, press: event(env, { x: 1, y: 0 }), mode: 'center' });
  drag.apply(event(env, { x: 0, y: 1 }));
  near(model.prop(bodies[0], 'angle'), Math.PI / 2);
  assert.equal(model.prop(ROOT_UID, 'angle'), 0);
  assert.deepEqual(model.prop(ROOT_UID, 'position'), [0, 0]);
  assert.equal(history.state.undoLabel, 'Rotate');
});

test('startRotation of one body turns its subtree around the parent anchor; CTRL restarts the sweep only when the pivot moves', () => {
  const env = environment();
  const { model, ctx, history, selection, bodies, joints } = env;
  selection.set([bodies[1]]);
  const drag = startRotation(ctx, { target: manipulationTarget(model, selection.objects), press: event(env, { x: 1.5, y: 0 }), mode: 'center' });
  drag.apply(event(env, { x: 0.5, y: 1 }));
  nearPair(position(model, bodies[1]), [0.5, 0.5]);
  near(model.prop(bodies[1], 'angle'), Math.PI / 2);
  nearPair(position(model, bodies[2]), [0.5, 1.5]);
  near(model.prop(bodies[2], 'angle'), 0.5 + Math.PI / 2);
  nearPair(anchor(model, joints[0]), [0.5, 0]);
  nearPair(anchor(model, joints[1]), [0.5, 1]);
  assert.equal(history.state.undoLabel, 'Rotate');
  nearPoint(drag.pivot(), { x: 0.5, y: 0 });
  drag.apply(event(env, { x: 0.5, y: 1 }, { ctrl: true }));
  nearPoint(drag.pivot(), { x: 1, y: 0 });
  const theta = Math.atan2(1, -0.5);
  near(model.prop(bodies[1], 'angle'), theta);
  nearPair(position(model, bodies[1]), [1, 0]);
  const root = environment();
  root.selection.set([root.bodies[0]]);
  const turn = startRotation(root.ctx, { target: manipulationTarget(root.model, root.selection.objects), press: event(root, { x: 1, y: 0 }), mode: 'center' });
  turn.apply(event(root, { x: 0, y: 1 }));
  turn.apply(event(root, { x: 0, y: 1 }, { ctrl: true }));
  near(root.model.prop(root.bodies[0], 'angle'), Math.PI / 2);
});

test('startRotation: SHIFT snaps one body root-local angle, ALT turns the body alone, the sweep passes half a turn', () => {
  const env = environment();
  const { model, ctx, history, selection, bodies } = env;
  history.execute(setProps([ROOT_UID], { angle: 0.2 }));
  selection.set([bodies[2]]);
  const pivot = gizmoPivot(model, selection.objects, { mode: 'center', ctrl: false });
  const target = manipulationTarget(model, selection.objects);
  const drag = startRotation(ctx, { target, press: event(env, onCircle(pivot, 1, 0.7)), mode: 'center' });
  drag.apply(event(env, onCircle(pivot, 1, 0.7 + 10 * DEG), { shift: true }));
  near(model.prop(bodies[2], 'angle'), 45 * DEG);
  drag.apply(event(env, onCircle(pivot, 1, 0.7 + 10 * DEG), { alt: true }));
  assert.deepEqual(position(model, bodies[3]), [3, 0]);
  near(model.prop(bodies[2], 'angle'), 0.5 + 10 * DEG);
  history.undo();
  history.undo();
  history.undo();
  selection.set([bodies[1]]);
  const full = startRotation(ctx, { target: manipulationTarget(model, selection.objects), press: event(env, { x: 1.5, y: 0 }), mode: 'center' });
  for (const step of [90, 180, 270, 360, 450]) full.apply(event(env, onCircle({ x: 0.5, y: 0 }, 1, step * DEG)));
  near(model.prop(bodies[1], 'angle'), 2 * Math.PI + Math.PI / 2);
});

test('startRotation of two bodies with overlapping subtrees turns each body once about the fixed shared pivot', () => {
  const env = environment();
  const { model, ctx, selection, shapes, bodies, joints } = env;
  selection.set([bodies[1], shapes[2]]);
  const target = manipulationTarget(model, selection.objects);
  const drag = startRotation(ctx, { target, press: event(env, { x: 2.5, y: 0 }), mode: 'center' });
  drag.apply(event(env, { x: 1.5, y: 1 }));
  nearPair(position(model, bodies[1]), [1.5, -0.5]);
  nearPair(position(model, bodies[2]), [1.5, 0.5]);
  nearPair(position(model, bodies[3]), [1.5, 1.5]);
  near(model.prop(bodies[1], 'angle'), Math.PI / 2);
  near(model.prop(bodies[2], 'angle'), 0.5 + Math.PI / 2);
  nearPair(anchor(model, joints[0]), [1.5, -1]);
  nearPair(anchor(model, joints[2]), [1.5, 1]);
  assert.deepEqual(position(model, bodies[0]), [0, 0]);
  nearPoint(drag.pivot(), { x: 1.5, y: 0 });
  assert.equal(drag.readout(), 'Δθ: 90.0°');
  drag.apply(event(env, onCircle({ x: 1.5, y: 0 }, 1, 10 * DEG), { shift: true }));
  near(model.prop(bodies[1], 'angle'), 15 * DEG);
  near(model.prop(bodies[2], 'angle'), 0.5 + 15 * DEG);
  assert.equal(drag.readout(), 'Δθ: 15.0°');
});

test('startRotation of two joints turns only their anchors; Last selected uses the last one alone', () => {
  const env = environment();
  const { model, ctx, selection, bodies, joints } = env;
  selection.set([joints[0], joints[2]]);
  const target = manipulationTarget(model, selection.objects);
  const drag = startRotation(ctx, { target, press: event(env, { x: 2.5, y: 0 }), mode: 'center' });
  drag.apply(event(env, { x: 1.5, y: 1 }));
  drag.apply(event(env, { x: 0.5, y: 0 }));
  nearPair(anchor(model, joints[0]), [2.5, 0]);
  nearPair(anchor(model, joints[2]), [0.5, 0]);
  assert.deepEqual(anchor(model, joints[1]), [1.5, 0]);
  for (const [index, x] of [[0, 0], [1, 1], [2, 2], [3, 3]]) assert.deepEqual(position(model, bodies[index]), [x, 0]);
  env.history.undo();
  env.history.undo();
  const last = startRotation(ctx, { target, press: event(env, { x: 3.5, y: 0 }), mode: 'last' });
  nearPoint(last.pivot(), { x: 2.5, y: 0 });
  last.apply(event(env, { x: 2.5, y: 1 }));
  nearPair(anchor(model, joints[0]), [2.5, -2]);
  nearPair(anchor(model, joints[2]), [2.5, 0]);
});

test('sweepTracker accumulates past half a turn, ignores the 1 px dead zone and restarts', () => {
  const env = environment();
  const pivot = { x: 1, y: 1 };
  const tracker = sweepTracker(env.ctx, pivot, onCircle(pivot, 1, 0));
  near(tracker.update(onCircle(pivot, 1, 90 * DEG)), 90 * DEG);
  near(tracker.update(onCircle(pivot, 1, 179 * DEG)), 179 * DEG);
  near(tracker.update(onCircle(pivot, 1, -170 * DEG)), 190 * DEG);
  near(tracker.update(onCircle(pivot, 1, 0)), 360 * DEG);
  near(tracker.update(onCircle(pivot, 0.009, 180 * DEG)), 360 * DEG);
  near(tracker.update(onCircle(pivot, 1, -30 * DEG)), 330 * DEG);
  tracker.restart({ x: 0, y: 0 }, { x: 0, y: 1 });
  near(tracker.update({ x: -1, y: 0 }), 90 * DEG);
  near(tracker.update({ x: 0, y: -1 }), 180 * DEG);
  const backwards = sweepTracker(env.ctx, pivot, onCircle(pivot, 1, 0));
  near(backwards.update(onCircle(pivot, 1, -100 * DEG)), -100 * DEG);
  near(backwards.update(onCircle(pivot, 1, 160 * DEG)), -200 * DEG);
});
