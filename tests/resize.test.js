import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { snapLength, snapPoint } from '../js/viewport/snap.js';
import { COLORS, GIZMO_SIZE, LINE_WIDTH } from '../js/viewport/style.js';
import {
  drawResizeHandles,
  formatSize,
  resizeCursor,
  resizedBox,
  resizeHandles,
  resizeShapes,
  startResize,
} from '../js/tools/resize.js';
import { defaultsOf } from '../lib/schema.js';

const EPSILON = 1e-9;
const NONE = { shift: false, ctrl: false, alt: false };

function shape(id, record) {
  return { type: 'shape', props: { ...defaultsOf('shape', record.type), id, name: id, shape: record } };
}

function box(id, center, width, height, angle = 0) {
  return shape(id, { type: 'box', center, width, height, angle });
}

function circle(id, center, radius) {
  return shape(id, { type: 'circle', center, radius });
}

function polygon(id) {
  return shape(id, { type: 'polygon', vertices: [[0, 0], [1, 0], [0, 1]] });
}

function body(id, position, angle, fixtures) {
  const { fixtures: omitted, ...props } = defaultsOf('body');
  return { type: 'body', props: { ...props, id, name: id, position, angle }, children: { fixtures } };
}

function joint(id, bodyA, bodyB, anchor) {
  return { type: 'joint', props: { ...defaultsOf('joint'), id, name: id, bodyA, bodyB, anchor } };
}

function documentWith({ position = [0, 0], angle = 0, bodies, joints = [], snap = false }) {
  const editor = createEditor();
  const { model, history, settings } = editor;
  const { meta, units, preview } = defaultsOf('document');
  model.reset({
    type: 'root',
    props: { ...defaultsOf('root'), position, angle, meta, units, preview },
    children: { bodies, joints, clips: [] },
  });
  settings.set('snap.grid', snap);
  const ctx = {
    model,
    history,
    snapPoint: (p) => snapPoint(p, settings),
    snapLength: (length) => snapLength(length, settings),
  };
  const uid = (id) => (id === 'root' ? ROOT_UID : model.uidOf(id));
  return { model, history, settings, ctx, uid };
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message ?? ''} expected ${expected}, got ${actual}`);
}

function nearPoint(actual, expected, message) {
  near(actual.x, expected.x, message);
  near(actual.y, expected.y, message);
}

function pointer(world, modifiers = {}) {
  return { world, screen: { x: 0, y: 0 }, button: 0, ...NONE, ...modifiers };
}

function handleOf(model, uid, id) {
  return resizeHandles(model, uid).find((entry) => entry.id === id);
}

function drag(ctx, shapeUid, id, from, to, modifiers = {}) {
  const resize = startResize(ctx, { shape: shapeUid, handle: id, press: pointer(from), pivot: { x: 7, y: 8 } });
  ctx.history.beginGesture();
  resize.apply(pointer(to, modifiers));
  ctx.history.endGesture();
  return resize;
}

function geometry(model, uid) {
  return model.prop(uid, 'shape');
}

function mixedDocument() {
  return documentWith({
    bodies: [
      body('b_1', [0, 0], 0, [box('f_1', [0, 0], 1, 1), circle('f_2', [0, 0], 0.3)]),
      body('b_2', [2, 0], 0, [box('f_3', [0, 0], 1, 1), circle('f_4', [0, 0], 0.2), polygon('f_5')]),
      body('b_3', [4, 0], 0, [box('f_6', [0, 0], 0, 1), polygon('f_7'), circle('f_8', [0, 0], 0.4)]),
    ],
    joints: [joint('j_1', 'b_1', 'b_2', [1, 0])],
  });
}

test('resizeShapes lists the circles and boxes of the selection in resize order', () => {
  const { model, uid } = mixedDocument();
  const ids = (objects) => resizeShapes(model, objects.map(uid)).map((entry) => model.prop(entry, 'id'));
  assert.deepEqual(ids(['f_1']), ['f_1']);
  assert.deepEqual(ids(['f_2']), ['f_2']);
  assert.deepEqual(ids(['b_2']), ['f_3', 'f_4']);
  assert.deepEqual(ids(['f_2', 'b_2']), ['f_2', 'f_3', 'f_4']);
  assert.deepEqual(ids(['b_2', 'f_2']), ['f_3', 'f_4', 'f_2']);
  assert.deepEqual(ids(['f_4', 'b_2']), ['f_4', 'f_3']);
  assert.deepEqual(ids(['b_3']), ['f_8']);
  assert.deepEqual(ids(['f_6', 'f_7']), []);
  assert.deepEqual(ids(['j_1']), []);
  assert.deepEqual(ids(['j_1', 'f_1']), ['f_1']);
  assert.deepEqual(ids(['f_1', 'root']), []);
  assert.deepEqual(ids([]), []);
  assert.ok(Object.isFrozen(resizeShapes(model, [uid('b_1')])));
});

test('resizeHandles: box handles under a moved and rotated root, in tie order with signs and outward angles', () => {
  const { model, uid } = documentWith({
    position: [1, 2],
    angle: Math.PI / 2,
    bodies: [body('b_1', [1, 0], 0, [box('f_1', [0.5, 0], 2, 1)])],
  });
  const handles = resizeHandles(model, uid('f_1'));
  const expected = [
    ['resize-ne', 1, 1, { x: 0.5, y: 4.5 }],
    ['resize-nw', -1, 1, { x: 0.5, y: 2.5 }],
    ['resize-sw', -1, -1, { x: 1.5, y: 2.5 }],
    ['resize-se', 1, -1, { x: 1.5, y: 4.5 }],
    ['resize-e', 1, 0, { x: 1, y: 4.5 }],
    ['resize-n', 0, 1, { x: 0.5, y: 3.5 }],
    ['resize-w', -1, 0, { x: 1, y: 2.5 }],
    ['resize-s', 0, -1, { x: 1.5, y: 3.5 }],
  ];
  assert.equal(handles.length, expected.length);
  handles.forEach((entry, index) => {
    const [id, x, y, point] = expected[index];
    assert.equal(entry.id, id);
    assert.equal(entry.shape, uid('f_1'));
    assert.deepEqual(entry.sign, { x, y });
    nearPoint(entry.point, point, id);
    near(entry.outward, Math.atan2(y, x) + Math.PI / 2, id);
  });
  assert.ok(Object.isFrozen(handles) && Object.isFrozen(handles[0]));
});

test('resizeHandles: a rotated body and shape turn the box handles; the circle handle turns with root and body', () => {
  const { model, uid } = documentWith({
    angle: Math.PI / 2,
    bodies: [
      body('b_1', [0, 0], Math.PI / 4, [box('f_1', [0, 0], 2, 1, Math.PI / 4)]),
      body('b_2', [0, 0], Math.PI / 6, [circle('f_2', [0.5, 0], 0.3)]),
    ],
  });
  const ne = handleOf(model, uid('f_1'), 'resize-ne');
  nearPoint(ne.point, { x: -1, y: -0.5 });
  near(ne.outward, Math.PI / 4 + Math.PI);
  const e = handleOf(model, uid('f_1'), 'resize-e');
  nearPoint(e.point, { x: -1, y: 0 });
  const handles = resizeHandles(model, uid('f_2'));
  assert.equal(handles.length, 1);
  const turn = (2 * Math.PI) / 3;
  assert.equal(handles[0].id, 'resize-r');
  assert.deepEqual(handles[0].sign, { x: 1, y: 0 });
  nearPoint(handles[0].point, { x: 0.8 * Math.cos(turn), y: 0.8 * Math.sin(turn) });
  near(handles[0].outward, turn);
  assert.deepEqual(resizeHandles(model, uid('b_1')), []);
});

test('resizeHandles: none for polygons and invalid shapes', () => {
  const { model, uid } = mixedDocument();
  assert.deepEqual(resizeHandles(model, uid('f_5')), []);
  assert.deepEqual(resizeHandles(model, uid('f_6')), []);
});

test('resizedBox follows the DESIGN §5.5 worked example', () => {
  const size0 = { width: 2, height: 1 };
  const min = 0.01;
  const rows = [
    ['corner', { x: 2, y: 0.5 }, { x: 1, y: 1 }, {}, [3, 1, 0.5, 0]],
    ['corner SHIFT', { x: 2, y: 0.5 }, { x: 1, y: 1 }, { shift: true }, [3, 1.5, 0.5, 0.25]],
    ['corner ALT', { x: 2, y: 0.5 }, { x: 1, y: 1 }, { centered: true }, [4, 1, 0, 0]],
    ['corner ALT SHIFT', { x: 2, y: 0.5 }, { x: 1, y: 1 }, { centered: true, shift: true }, [4, 2, 0, 0]],
    ['side', { x: 2, y: 0.7 }, { x: 1, y: 0 }, {}, [3, 1, 0.5, 0]],
    ['side SHIFT', { x: 2, y: 0.7 }, { x: 1, y: 0 }, { shift: true }, [3, 1.5, 0.5, 0]],
  ];
  for (const [name, q, sign, options, [width, height, cx, cy]] of rows) {
    const r = resizedBox(size0, q, sign, { shift: false, centered: false, min, ...options });
    near(r.width, width, name);
    near(r.height, height, name);
    nearPoint(r.center, { x: cx, y: cy }, name);
  }
});

test('resizedBox: every handle sign keeps its opposite side, sides keep the other axis', () => {
  const size0 = { width: 2, height: 1 };
  const rows = [
    [{ x: 1, y: 1 }, { x: 1.5, y: 1 }, [2.5, 1.5, 0.25, 0.25]],
    [{ x: -1, y: 1 }, { x: -1.5, y: 1 }, [2.5, 1.5, -0.25, 0.25]],
    [{ x: -1, y: -1 }, { x: -1.5, y: -1 }, [2.5, 1.5, -0.25, -0.25]],
    [{ x: 1, y: -1 }, { x: 1.5, y: -1 }, [2.5, 1.5, 0.25, -0.25]],
    [{ x: 1, y: 0 }, { x: 0.5, y: 9 }, [1.5, 1, -0.25, 0]],
    [{ x: 0, y: 1 }, { x: 9, y: 1 }, [2, 1.5, 0, 0.25]],
    [{ x: -1, y: 0 }, { x: -2, y: 9 }, [3, 1, -0.5, 0]],
    [{ x: 0, y: -1 }, { x: 9, y: -0.25 }, [2, 0.75, 0, 0.125]],
  ];
  for (const [sign, q, [width, height, cx, cy]] of rows) {
    const r = resizedBox(size0, q, sign, { shift: false, centered: false, min: 0.01 });
    const name = JSON.stringify(sign);
    near(r.width, width, name);
    near(r.height, height, name);
    nearPoint(r.center, { x: cx, y: cy }, name);
  }
  const ctrl = resizedBox(size0, { x: -1.5, y: 9 }, { x: -1, y: 0 }, { shift: false, centered: true, min: 0.01 });
  assert.deepEqual([ctrl.width, ctrl.height, ctrl.center.x, ctrl.center.y], [3, 1, 0, 0]);
});

test('resizedBox: the minimum clamps without crossing the fixed side; SHIFT raises k; no -0', () => {
  const size0 = { width: 2, height: 1 };
  const crossed = resizedBox(size0, { x: -5, y: -5 }, { x: 1, y: 1 }, { shift: false, centered: false, min: 0.1 });
  near(crossed.width, 0.1);
  near(crossed.height, 0.1);
  near(crossed.center.x - crossed.width / 2, -1);
  near(crossed.center.y - crossed.height / 2, -0.5);
  const kept = resizedBox(size0, { x: -0.95, y: 9 }, { x: 1, y: 0 }, { shift: true, centered: false, min: 0.1 });
  near(kept.width, 0.2);
  near(kept.height, 0.1);
  near(kept.center.x, -0.9);
  assert.equal(kept.center.y, 0);
  const centered = resizedBox(size0, { x: -3, y: 0 }, { x: 1, y: 0 }, { shift: false, centered: true, min: 0.01 });
  assert.deepEqual([centered.width, centered.center.x], [0.01, 0]);
  const still = resizedBox(size0, { x: -1, y: -0.5 }, { x: -1, y: -1 }, { shift: false, centered: false, min: 0.01 });
  assert.ok(Object.is(still.center.x, 0) && Object.is(still.center.y, 0));
  assert.ok(Object.isFrozen(still) && Object.isFrozen(still.center));
});

test('resizeCursor picks the nearest CSS resize cursor at each 45 degrees and folds the sense', () => {
  const rows = [
    [0, 'ew-resize'],
    [Math.PI / 4, 'nwse-resize'],
    [Math.PI / 2, 'ns-resize'],
    [(3 * Math.PI) / 4, 'nesw-resize'],
    [Math.PI, 'ew-resize'],
    [(5 * Math.PI) / 4, 'nwse-resize'],
    [-Math.PI / 4, 'nesw-resize'],
    [-Math.PI / 2, 'ns-resize'],
    [Math.PI / 9, 'ew-resize'],
    [Math.PI / 7, 'nwse-resize'],
    [(15 * Math.PI) / 16, 'ew-resize'],
    [7 * Math.PI, 'ew-resize'],
  ];
  for (const [angle, cursor] of rows) assert.equal(resizeCursor(angle), cursor, String(angle));
});

test('formatSize shows document pixels with one decimal', () => {
  assert.equal(formatSize({ width: 0.5, height: 0.25 }, 100), 'w: 50.0 px  h: 25.0 px');
  assert.equal(formatSize({ radius: 0.125 }, 100), 'r: 12.5 px');
  assert.equal(formatSize({ radius: 0.12345 }, 100), 'r: 12.3 px');
  assert.equal(formatSize({ width: -0.0001, height: 1 }, 50), 'w: 0.0 px  h: 50.0 px');
  assert.throws(() => formatSize({ radius: 1 }, 0), RangeError);
});

test('drawResizeHandles draws squares last first, the hovered and dragged ones white and larger', () => {
  const calls = [];
  const g = {};
  for (const method of ['rect', 'fill', 'stroke']) {
    g[method] = (...args) => {
      calls.push([method, ...args]);
      return g;
    };
  }
  drawResizeHandles(g, [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 }], { hover: 0, active: 2 });
  const outline = ['stroke', { width: LINE_WIDTH.outline, color: COLORS.handleOutline }];
  const big = GIZMO_SIZE.resizeHandleActive;
  const small = GIZMO_SIZE.resizeHandle;
  assert.deepEqual(calls, [
    ['rect', 50 - big / 2, 60 - big / 2, big, big],
    ['fill', { color: 0xffffff }],
    outline,
    ['rect', 30 - small / 2, 40 - small / 2, small, small],
    ['fill', { color: COLORS.gizmo }],
    outline,
    ['rect', 10 - big / 2, 20 - big / 2, big, big],
    ['fill', { color: 0xffffff }],
    outline,
  ]);
});

test('startResize: the DESIGN §5.5 example with SHIFT, ALT and CTRL read live', () => {
  const { model, ctx, uid } = documentWith({ bodies: [body('b_1', [0, 0], 0, [box('f_1', [0, 0], 2, 1)])] });
  const f = uid('f_1');
  const resize = startResize(ctx, { shape: f, handle: 'resize-ne', press: pointer({ x: 1, y: 0.5 }), pivot: null });
  const rows = [
    [{}, [3, 1, 0.5, 0]],
    [{ shift: true }, [3, 1.5, 0.5, 0.25]],
    [{ alt: true }, [4, 1, 0, 0]],
    [{ ctrl: true }, [4, 1, 0, 0]],
    [{ alt: true, shift: true }, [4, 2, 0, 0]],
    [{}, [3, 1, 0.5, 0]],
  ];
  for (const [modifiers, [width, height, cx, cy]] of rows) {
    resize.apply(pointer({ x: 2, y: 0.5 }, modifiers));
    const record = geometry(model, f);
    const name = JSON.stringify(modifiers);
    near(record.width, width, name);
    near(record.height, height, name);
    near(record.center[0], cx, name);
    near(record.center[1], cy, name);
  }
  assert.equal(resize.pivot(), null);
  const side = startResize(ctx, { shape: f, handle: 'resize-e', press: pointer({ x: 1.5, y: 0 }), pivot: null });
  side.apply(pointer({ x: 2.5, y: 0.7 }, { shift: true }));
  near(geometry(model, f).width, 4);
  near(geometry(model, f).height, 4 / 3);
  near(geometry(model, f).center[1], 0);
});

test('startResize: a box under a rotated root, body and shape keeps its opposite corner in world space', () => {
  const { model, ctx, uid } = documentWith({
    position: [1, 2],
    angle: Math.PI / 2,
    bodies: [body('b_1', [1, 0], Math.PI / 6, [box('f_1', [0.5, 0], 2, 1, Math.PI / 4)])],
  });
  const f = uid('f_1');
  const b = uid('b_1');
  const ne = handleOf(model, f, 'resize-ne');
  const sw = handleOf(model, f, 'resize-sw');
  const grab = { x: ne.point.x + 0.03, y: ne.point.y - 0.02 };
  const resize = startResize(ctx, { shape: f, handle: 'resize-ne', press: pointer(grab), pivot: { x: 3, y: 4 } });
  resize.apply(pointer(grab));
  near(geometry(model, f).width, 2);
  near(geometry(model, f).height, 1);
  resize.apply(pointer({ x: grab.x + 0.3, y: grab.y - 0.2 }));
  nearPoint(handleOf(model, f, 'resize-sw').point, sw.point);
  nearPoint(handleOf(model, f, 'resize-ne').point, { x: ne.point.x + 0.3, y: ne.point.y - 0.2 });
  assert.deepEqual(model.prop(b, 'position'), [1, 0]);
  assert.equal(model.prop(b, 'angle'), Math.PI / 6);
  assert.equal(geometry(model, f).angle, Math.PI / 4);
  assert.deepEqual(model.prop(ROOT_UID, 'position'), [1, 2]);
  assert.deepEqual(resize.pivot(), { x: 3, y: 4 });
});

test('startResize: grid snap of the box handle point, and the minimum at the minor spacing', () => {
  const { model, ctx, uid } = documentWith({ snap: true, bodies: [body('b_1', [0, 0], 0, [box('f_1', [0, 0], 2, 1)])] });
  const f = uid('f_1');
  drag(ctx, f, 'resize-ne', { x: 1, y: 0.5 }, { x: 1.43, y: 0.56 });
  near(geometry(model, f).width, 2.4);
  near(geometry(model, f).height, 1.1);
  near(geometry(model, f).center[0], 0.2);
  near(geometry(model, f).center[1], 0.05);
  const before = { ...geometry(model, f) };
  drag(ctx, f, 'resize-ne', handleOf(model, f, 'resize-ne').point, { x: -9, y: -9 });
  near(geometry(model, f).width, 0.1);
  near(geometry(model, f).height, 0.1);
  near(geometry(model, f).center[0] - 0.05, before.center[0] - before.width / 2);
  near(geometry(model, f).center[1] - 0.05, before.center[1] - before.height / 2);
});

test('startResize: a circle takes the snapped distance to its center, never below the minimum', () => {
  for (const snap of [false, true]) {
    const { model, ctx, uid } = documentWith({
      snap,
      angle: Math.PI / 2,
      bodies: [body('b_1', [1, 0], 0, [circle('f_1', [0.5, 0], 0.3)])],
    });
    const f = uid('f_1');
    const center = { x: 0, y: 1.5 };
    const start = handleOf(model, f, 'resize-r').point;
    nearPoint(start, { x: 0, y: 1.8 });
    const resize = startResize(ctx, { shape: f, handle: 'resize-r', press: pointer(start), pivot: null });
    resize.apply(pointer({ x: start.x + 0.437, y: start.y - 0.3 }));
    near(geometry(model, f).radius, snap ? 0.4 : 0.437, `snap ${snap}`);
    assert.deepEqual(geometry(model, f).center, [0.5, 0]);
    resize.apply(pointer(center));
    near(geometry(model, f).radius, snap ? 0.1 : 0.01, `snap ${snap}`);
  }
});

test('startResize: readout of the last applied size; one undo step, none for a drag back', () => {
  const { model, history, ctx, uid } = documentWith({
    bodies: [body('b_1', [0, 0], 0, [box('f_1', [0, 0], 2, 1), circle('f_2', [3, 0], 0.5)])],
  });
  const f = uid('f_1');
  const ppm = model.prop(ROOT_UID, 'units.pixelsPerMeter');
  const resize = startResize(ctx, { shape: f, handle: 'resize-e', press: pointer({ x: 1, y: 0 }), pivot: null });
  assert.equal(resize.readout(), formatSize({ width: 2, height: 1 }, ppm));
  history.beginGesture();
  resize.apply(pointer({ x: 1.5, y: 0 }));
  assert.equal(resize.readout(), formatSize({ width: 2.5, height: 1 }, ppm));
  resize.apply(pointer({ x: 2, y: 0 }));
  history.endGesture();
  assert.equal(history.state.undoLabel, 'Resize');
  assert.equal(history.undo(), true);
  assert.equal(geometry(model, f).width, 2);
  assert.equal(history.canUndo, false);
  const circleDrag = drag(ctx, uid('f_2'), 'resize-r', { x: 3.5, y: 0 }, { x: 3.5, y: 0 });
  assert.equal(circleDrag.readout(), formatSize({ radius: 0.5 }, ppm));
  assert.equal(history.canUndo, false);
  assert.throws(() => startResize(ctx, { shape: uid('b_1'), handle: 'resize-r', press: pointer({ x: 0, y: 0 }), pivot: null }));
});
