import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { createJoint, createShapeBody } from '../js/commands/create.js';
import { setProps } from '../js/commands/props.js';
import { ToolRegistry } from '../js/tools/registry.js';
import { defineTool } from '../js/tools/tool.js';
import {
  drawLimitHandles,
  drawLimitRange,
  formatLimits,
  limitJoint,
  limitLayout,
  limitRange,
  limitValues,
  startLimitDrag,
} from '../js/tools/joint-limits.js';
import { COLORS, GIZMO_SIZE, LINE_WIDTH } from '../js/viewport/style.js';

const EPSILON = 1e-9;
const DEG = Math.PI / 180;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message ?? ''} expected ${expected}, got ${actual}`);
}

function notNegativeZero(value, message) {
  assert.ok(!Object.is(value, -0), message);
}

function environment({ limits = { enabled: true, lower: -30 * DEG, upper: 45 * DEG }, root = null } = {}) {
  const editor = createEditor();
  const { model, history, selection, modes, settings, camera } = editor;
  settings.set('snap.grid', false);
  camera.setSize(400, 400);
  camera.zoomAt({ x: 200, y: 200 }, 100 / camera.scale);
  const shapes = [0, 1, 2].map((x) =>
    history.execute(createShapeBody({ position: { x, y: 0 }, angle: 0, shape: { type: 'circle', radius: 0.4 } })),
  );
  const bodies = shapes.map((uid) => model.get(uid).parent);
  const joint = history.execute(createJoint({ bodyA: bodies[0], bodyB: bodies[1], anchor: { x: 0.5, y: 0 }, limits }));
  const other = history.execute(createJoint({ bodyA: bodies[1], bodyB: bodies[2], anchor: { x: 1.5, y: 0 } }));
  if (root) history.execute(setProps([ROOT_UID], root, 'Move root'));
  let ctx = null;
  const probe = defineTool({
    id: 'select',
    activate(context) {
      ctx = context;
    },
  });
  new ToolRegistry({ model, history, selection, modes, settings, camera }, [probe]);
  return { ...editor, ctx, shapes, bodies, joint, other };
}

function onCircle(center, radius, angle) {
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
}

function event(env, world, modifiers = {}) {
  return { world, screen: env.camera.worldToScreen(world), shift: false, ctrl: false, alt: false, ...modifiers };
}

function limitsOf(model, uid) {
  return model.get(uid).props.limits;
}

function fakeGraphics() {
  const calls = [];
  const g = { calls };
  for (const method of ['moveTo', 'lineTo', 'arc', 'closePath', 'circle', 'fill', 'stroke']) {
    g[method] = (...args) => {
      calls.push([method, ...args]);
      return g;
    };
  }
  return g;
}

test('limitJoint: one joint with editable limits, else null', () => {
  const { model, history, shapes, bodies, joint, other } = environment();
  assert.equal(limitJoint(model, [joint]), joint);
  assert.equal(limitJoint(model, [joint, shapes[0]]), null);
  assert.equal(limitJoint(model, [joint, bodies[2]]), null);
  assert.equal(limitJoint(model, [joint, other]), null);
  assert.equal(limitJoint(model, [joint, ROOT_UID]), null);
  assert.equal(limitJoint(model, []), null);
  const cases = [
    { bodyB: null },
    { bodyA: 'b_99' },
    { anchor: null },
    { 'limits.lower': 0.1 },
    { 'limits.upper': -0.1 },
    { 'limits.upper': Number.POSITIVE_INFINITY },
    { 'limits.lower': 'x' },
  ];
  for (const values of cases) {
    history.execute(setProps([joint], values));
    assert.equal(limitJoint(model, [joint]), null, JSON.stringify(values));
    history.undo();
    assert.equal(limitJoint(model, [joint]), joint);
  }
  history.execute(setProps([joint], { limits: undefined }));
  assert.equal(limitJoint(model, [joint]), joint);
  history.execute(setProps([joint], { 'limits.enabled': false, 'limits.lower': 0, 'limits.upper': 0 }));
  assert.equal(limitJoint(model, [joint]), joint);
});

const RANGE_TABLE = [
  [-30, 45, -45, 30],
  [0, 0, 0, 0],
  [-180, 180, 0, 0],
  [-200, 10, 0, 170],
  [0, 90, -90, 0],
  [-90, 0, 0, 90],
];

for (const [lower, upper, min, max] of RANGE_TABLE) {
  test(`limitRange(${lower} / ${upper}) is [${min}, ${max}] degrees`, () => {
    const range = limitRange({ lower: lower * DEG, upper: upper * DEG });
    near(range.min, min * DEG);
    near(range.max, max * DEG);
    notNegativeZero(range.min);
    notNegativeZero(range.max);
  });
}

const VALUE_TABLE = [
  [[-30, 45], 'limit-upper', -20, false, [-30, 25]],
  [[-30, 45], 'limit-upper', -20, true, [-30, 30]],
  [[-30, 45], 'limit-range', 50, false, [0, 75]],
  [[-30, 45], 'limit-range', -20, false, [-50, 25]],
  [[-30, 45], 'limit-range', -200, false, [-75, 0]],
  [[-30, 45], 'limit-range', 22, true, [-15, 60]],
  [[-30, 45], 'limit-lower', 25, false, [-5, 45]],
  [[-30, 45], 'limit-lower', 60, false, [0, 45]],
  [[-30, 45], 'limit-lower', -200, false, [-180, 45]],
  [[-30, 45], 'limit-lower', -8, true, [-45, 45]],
  [[-30, 45], 'limit-upper', -90, false, [-30, 0]],
  [[-30, 45], 'limit-upper', 300, false, [-30, 180]],
  [[-200, 10], 'limit-lower', -30, false, [-200, 10]],
  [[-200, 10], 'limit-lower', 30, false, [-170, 10]],
  [[-10, 200], 'limit-upper', 20, false, [-10, 200]],
  [[-10, 200], 'limit-upper', -50, false, [-10, 150]],
  [[-200, 10], 'limit-range', -20, false, [-200, 10]],
  [[-200, 10], 'limit-range', 30, false, [-170, 40]],
  [[-180, 180], 'limit-range', 30, false, [-180, 180]],
  [[0, 0], 'limit-upper', 30, false, [0, 30]],
];

for (const [[lower, upper], handle, sweep, shift, expected] of VALUE_TABLE) {
  test(`limitValues(${lower} / ${upper}, ${handle}, ${sweep}, ${shift}) is ${expected.join(' / ')} degrees`, () => {
    const values = limitValues({ lower: lower * DEG, upper: upper * DEG }, handle, sweep * DEG, shift);
    near(values.lower, expected[0] * DEG);
    near(values.upper, expected[1] * DEG);
    notNegativeZero(values.lower);
    notNegativeZero(values.upper);
  });
}

test('limitLayout puts the handles on the ring at zero plus each limit, lower first, with defaults', () => {
  const center = { x: 100, y: 50 };
  const zero = 30 * DEG;
  const layout = limitLayout(center, zero, { enabled: true, lower: -30 * DEG, upper: 45 * DEG });
  assert.equal(layout.enabled, true);
  near(layout.zero, zero);
  near(layout.lower, -30 * DEG);
  assert.deepEqual(layout.handles.map((entry) => entry.id), ['limit-lower', 'limit-upper']);
  near(layout.handles[0].screen.x, 100 + GIZMO_SIZE.rotateRing);
  near(layout.handles[0].screen.y, 50);
  near(layout.handles[1].screen.x, 100 + GIZMO_SIZE.rotateRing * Math.cos(75 * DEG));
  near(layout.handles[1].screen.y, 50 - GIZMO_SIZE.rotateRing * Math.sin(75 * DEG));
  const empty = limitLayout(center, 0, {});
  assert.equal(empty.enabled, false);
  assert.equal(empty.lower, 0);
  assert.equal(empty.upper, 0);
  assert.ok(Object.isFrozen(layout) && Object.isFrozen(layout.handles));
});

test('formatLimits shows degrees with one decimal and 0.0 for values rounding to zero', () => {
  assert.equal(formatLimits(-30 * DEG, 45 * DEG), 'lower: -30.0°  upper: 45.0°');
  assert.equal(formatLimits(-0.0001 * DEG, 0), 'lower: 0.0°  upper: 0.0°');
  assert.equal(formatLimits(-12.34 * DEG, 180 * DEG), 'lower: -12.3°  upper: 180.0°');
});

test('startLimitDrag moves each handle under a rotated root, with SHIFT live, and keeps the pivot', () => {
  const env = environment({ root: { position: [1, 2], angle: Math.PI / 2 } });
  const { model, ctx, history, joint } = env;
  const pivot = { x: 1, y: 2.5 };
  const zero = Math.PI / 2;
  history.beginGesture();
  const upper = startLimitDrag(ctx, { joint, handle: 'limit-upper', press: event(env, onCircle(pivot, 0.72, zero + 45 * DEG)) });
  near(upper.pivot().x, pivot.x);
  near(upper.pivot().y, pivot.y);
  upper.apply(event(env, onCircle(pivot, 0.5, zero + 25 * DEG)));
  near(limitsOf(model, joint).upper, 25 * DEG);
  near(limitsOf(model, joint).lower, -30 * DEG);
  assert.equal(upper.readout(), 'lower: -30.0°  upper: 25.0°');
  upper.apply(event(env, onCircle(pivot, 0.5, zero + 25 * DEG), { shift: true }));
  near(limitsOf(model, joint).upper, 30 * DEG);
  near(upper.pivot().x, pivot.x);
  history.endGesture();
  assert.equal(history.state.undoLabel, 'Edit limits');
  history.beginGesture();
  const lower = startLimitDrag(ctx, { joint, handle: 'limit-lower', press: event(env, onCircle(pivot, 0.72, zero - 30 * DEG)) });
  lower.apply(event(env, onCircle(pivot, 0.72, zero - 100 * DEG)));
  near(limitsOf(model, joint).lower, -100 * DEG);
  lower.apply(event(env, onCircle(pivot, 0.72, zero - 179 * DEG)));
  lower.apply(event(env, onCircle(pivot, 0.72, zero + 160 * DEG)));
  near(limitsOf(model, joint).lower, -180 * DEG);
  history.endGesture();
  history.beginGesture();
  const range = startLimitDrag(ctx, { joint, handle: 'limit-range', press: event(env, onCircle(pivot, 0.72, zero)) });
  range.apply(event(env, onCircle(pivot, 0.72, zero + 10 * DEG)));
  near(limitsOf(model, joint).lower, -170 * DEG);
  near(limitsOf(model, joint).upper, 40 * DEG);
  range.apply(event(env, onCircle(pivot, 0.72, zero - 10 * DEG)));
  near(limitsOf(model, joint).lower, -180 * DEG);
  near(limitsOf(model, joint).upper, 30 * DEG);
  history.endGesture();
});

test('startLimitDrag: coincident 0 / 0 handles resolve by the first non-zero sweep and keep that side', () => {
  for (const [first, expected] of [
    [20, { lower: 0, upper: 20 }],
    [-20, { lower: -20, upper: 0 }],
  ]) {
    const env = environment({ limits: { enabled: false, lower: 0, upper: 0 } });
    const { model, ctx, history, joint } = env;
    const pivot = { x: 0.5, y: 0 };
    const pressedOn = first > 0 ? 'limit-lower' : 'limit-upper';
    history.beginGesture();
    const drag = startLimitDrag(ctx, { joint, handle: pressedOn, press: event(env, onCircle(pivot, 0.72, 0)) });
    drag.apply(event(env, onCircle(pivot, 0.3, 0)));
    assert.equal(limitsOf(model, joint).enabled, false);
    assert.equal(drag.readout(), 'lower: 0.0°  upper: 0.0°');
    drag.apply(event(env, onCircle(pivot, 0.72, first * DEG)));
    near(limitsOf(model, joint).lower, expected.lower * DEG);
    near(limitsOf(model, joint).upper, expected.upper * DEG);
    assert.equal(limitsOf(model, joint).enabled, true);
    drag.apply(event(env, onCircle(pivot, 0.72, -first * DEG)));
    near(limitsOf(model, joint).lower, 0);
    near(limitsOf(model, joint).upper, 0);
    history.endGesture();
    assert.equal(history.state.undoLabel, 'Create joint');
    assert.equal(limitsOf(model, joint).enabled, false);
  }
});

test('startLimitDrag passes half a turn on a handle and clamps at 180 degrees', () => {
  const env = environment({ limits: { enabled: true, lower: -10 * DEG, upper: 10 * DEG } });
  const { model, ctx, joint } = env;
  const pivot = { x: 0.5, y: 0 };
  const drag = startLimitDrag(ctx, { joint, handle: 'limit-upper', press: event(env, onCircle(pivot, 0.72, 10 * DEG)) });
  for (const step of [90, 170]) drag.apply(event(env, onCircle(pivot, 0.72, step * DEG)));
  near(limitsOf(model, joint).upper, 170 * DEG);
  drag.apply(event(env, onCircle(pivot, 0.72, -160 * DEG)));
  near(limitsOf(model, joint).upper, 180 * DEG);
});

test('startLimitDrag enables limits on change in one Edit limits step; a disabled joint dragged back changes nothing', () => {
  const env = environment({ limits: { enabled: false, lower: -30 * DEG, upper: 45 * DEG } });
  const { model, ctx, history, joint } = env;
  const pivot = { x: 0.5, y: 0 };
  const before = limitsOf(model, joint);
  history.beginGesture();
  const back = startLimitDrag(ctx, { joint, handle: 'limit-upper', press: event(env, onCircle(pivot, 0.72, 45 * DEG)) });
  back.apply(event(env, onCircle(pivot, 0.72, 60 * DEG)));
  assert.equal(limitsOf(model, joint).enabled, true);
  back.apply(event(env, onCircle(pivot, 0.72, 45 * DEG)));
  assert.equal(history.endGesture(), false);
  assert.deepEqual(limitsOf(model, joint), before);
  assert.equal(history.state.undoLabel, 'Create joint');
  history.beginGesture();
  const drag = startLimitDrag(ctx, { joint, handle: 'limit-range', press: event(env, onCircle(pivot, 0.72, 0)) });
  drag.apply(event(env, onCircle(pivot, 0.72, 10 * DEG)));
  drag.apply(event(env, onCircle(pivot, 0.72, 20 * DEG)));
  assert.equal(history.endGesture(), true);
  assert.equal(history.state.undoLabel, 'Edit limits');
  assert.equal(limitsOf(model, joint).enabled, true);
  near(limitsOf(model, joint).lower, -10 * DEG);
  near(limitsOf(model, joint).upper, 65 * DEG);
  assert.equal(drag.readout(), 'lower: -10.0°  upper: 65.0°');
  history.undo();
  assert.deepEqual(limitsOf(model, joint), before);
});

test('drawLimitRange draws the wedge, the reference line and the range arc', () => {
  const g = fakeGraphics();
  const layout = limitLayout({ x: 100, y: 100 }, 0, { enabled: true, lower: -30 * DEG, upper: 45 * DEG });
  drawLimitRange(g, layout);
  const r = GIZMO_SIZE.rotateRing;
  assert.deepEqual(g.calls[0], ['moveTo', 100, 100]);
  assert.equal(g.calls[1][0], 'arc');
  near(g.calls[1][4], 30 * DEG);
  near(g.calls[1][5], -45 * DEG);
  assert.equal(g.calls[1][3], r);
  assert.equal(g.calls[1][6], true);
  assert.deepEqual(g.calls[2], ['closePath']);
  assert.deepEqual(g.calls[3], ['fill', { color: COLORS.gizmoZ, alpha: 0.15 }]);
  assert.deepEqual(g.calls[4], ['moveTo', 100 + GIZMO_SIZE.jointCircle, 100]);
  assert.deepEqual(g.calls[5], ['lineTo', 100 + r, 100]);
  assert.deepEqual(g.calls[6], ['stroke', { width: LINE_WIDTH.outline, color: COLORS.gizmo }]);
  assert.equal(g.calls[7][0], 'moveTo');
  near(g.calls[7][1], 100 + r * Math.cos(30 * DEG));
  near(g.calls[7][2], 100 + r * Math.sin(30 * DEG));
  assert.equal(g.calls[8][0], 'arc');
  assert.deepEqual(g.calls[9], ['stroke', { width: LINE_WIDTH.gizmo, color: COLORS.gizmoZ, alpha: 1 }]);
  assert.equal(g.calls.length, 10);
  const disabled = fakeGraphics();
  drawLimitRange(disabled, { ...layout, enabled: false });
  assert.deepEqual(disabled.calls[3], ['fill', { color: COLORS.gizmoZ, alpha: 0.075 }]);
  assert.deepEqual(disabled.calls[9], ['stroke', { width: LINE_WIDTH.gizmo, color: COLORS.gizmoZ, alpha: 0.5 }]);
  const pin = fakeGraphics();
  drawLimitRange(pin, limitLayout({ x: 100, y: 100 }, 0, { lower: 0, upper: 0 }));
  assert.deepEqual(pin.calls.map(([method]) => method), ['moveTo', 'lineTo', 'stroke']);
});

test('drawLimitHandles draws upper then lower, hover and active white and larger, half opacity when disabled', () => {
  const layout = limitLayout({ x: 100, y: 100 }, 0, { enabled: true, lower: -90 * DEG, upper: 90 * DEG });
  const r = GIZMO_SIZE.rotateRing;
  const circle = (call, y, radius) => {
    assert.equal(call[0], 'circle');
    near(call[1], 100);
    near(call[2], y);
    assert.equal(call[3], radius);
  };
  const g = fakeGraphics();
  drawLimitHandles(g, layout, { hover: null, active: null });
  assert.equal(g.calls.length, 6);
  circle(g.calls[0], 100 - r, GIZMO_SIZE.limitHandle);
  assert.deepEqual(g.calls[1], ['fill', { color: COLORS.gizmo, alpha: 1 }]);
  assert.deepEqual(g.calls[2], ['stroke', { width: LINE_WIDTH.outline, color: COLORS.handleOutline, alpha: 1 }]);
  circle(g.calls[3], 100 + r, GIZMO_SIZE.limitHandle);
  assert.deepEqual(g.calls[4], ['fill', { color: COLORS.gizmo, alpha: 1 }]);
  const hot = fakeGraphics();
  drawLimitHandles(hot, layout, { hover: 'limit-lower', active: 'limit-upper' });
  circle(hot.calls[0], 100 - r, GIZMO_SIZE.limitHandleActive);
  assert.deepEqual(hot.calls[1], ['fill', { color: 0xffffff, alpha: 1 }]);
  circle(hot.calls[3], 100 + r, GIZMO_SIZE.limitHandleActive);
  const disabled = fakeGraphics();
  drawLimitHandles(disabled, { ...layout, enabled: false }, { hover: null, active: null });
  assert.deepEqual(disabled.calls[1], ['fill', { color: COLORS.gizmo, alpha: 0.5 }]);
  assert.deepEqual(disabled.calls[2], ['stroke', { width: LINE_WIDTH.outline, color: COLORS.handleOutline, alpha: 0.5 }]);
});
