import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { boxTest, hitTest } from '../js/viewport/hit.js';
import { COLORS, LINE_WIDTH } from '../js/viewport/style.js';
import { applyClick, clickTarget, selectTool } from '../js/tools/select.js';
import { applyBox, boxAabb, marqueeTool, selectBoxTool } from '../js/tools/select-box.js';
import { defaultsOf } from '../lib/schema.js';
import { createJoint, createShapeBody } from '../js/commands/create.js';
import { setProps } from '../js/commands/props.js';
import { formatMove } from '../js/tools/transform-gizmo.js';
import { formatSize } from '../js/tools/resize.js';

const EPSILON = 1e-9;
const NO_MODIFIERS = { shift: false, ctrl: false, alt: false };

function shape(id, shapeRecord) {
  return { type: 'shape', props: { ...defaultsOf('shape', shapeRecord.type), id, name: id, shape: shapeRecord } };
}

function body(id, position, fixtures) {
  const { fixtures: omitted, ...props } = defaultsOf('body');
  return { type: 'body', props: { ...props, id, name: id, position, angle: 0 }, children: { fixtures } };
}

function joint(id, bodyA, bodyB, anchor) {
  return { type: 'joint', props: { ...defaultsOf('joint'), id, name: id, bodyA, bodyB, anchor } };
}

function clip() {
  const { tracks, events, ...props } = defaultsOf('clip');
  return {
    type: 'clip',
    props: { ...props, key: 'idle', name: 'idle', length: 1 },
    children: { tracks: [], events: [{ type: 'event', props: { t: 0, ...defaultsOf('event') } }] },
  };
}

function environment({ underRoot = false } = {}) {
  const editor = createEditor();
  const { model, camera, tools } = editor;
  const bodies = [
    body('b_1', [-1, 0], [shape('f_1', { type: 'circle', center: [0, 0], radius: 0.5 })]),
    body('b_2', [1, 0], [
      shape('f_2', { type: 'box', center: [0, 0], width: 1, height: 1, angle: 0 }),
      shape('f_3', { type: 'circle', center: [0, 0], radius: 0.3 }),
    ]),
  ];
  if (underRoot) bodies.push(body('b_0', [0, 0], [shape('f_0', { type: 'circle', center: [0, 0], radius: 0.5 })]));
  const { meta, units, preview } = defaultsOf('document');
  model.reset({
    type: 'root',
    props: { ...defaultsOf('root'), position: [0, 0], angle: 0, meta, units, preview },
    children: { bodies, joints: [joint('j_1', 'b_2', 'b_1', [1, 0])], clips: [clip()] },
  });
  camera.setSize(400, 400);
  camera.zoomAt({ x: 200, y: 200 }, 100 / camera.scale);
  const calls = { cursor: [], invalidations: 0 };
  tools.bindView({
    hitTest: (screen) => hitTest(model, camera, screen),
    boxTest: (box) => boxTest(model, box),
    setCursor: (css) => calls.cursor.push(css),
    invalidateOverlay: () => {
      calls.invalidations++;
    },
  });
  const changes = [];
  model.on('change', (payload) => changes.push(payload));
  const uid = (id) => (id === 'root' ? ROOT_UID : model.uidOf(id));
  const [clipUid] = model.children(ROOT_UID, 'clips');
  const [eventUid] = model.children(clipUid, 'events');
  return { editor, ...editor, calls, changes, uid, clipUid, eventUid };
}

function send(tools, type, x, y, extra = {}) {
  tools.pointer({
    type,
    screen: { x, y },
    button: type === 'move' ? -1 : (extra.button ?? 0),
    buttons: type === 'up' ? 0 : 1,
    ...NO_MODIFIERS,
    clicks: 1,
    ...extra,
  });
}

function click(tools, x, y, extra = {}) {
  send(tools, 'down', x, y, extra);
  send(tools, 'up', x, y, extra);
}

function drag(tools, from, to, extra = {}, release = extra) {
  send(tools, 'down', from[0], from[1], extra);
  send(tools, 'move', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, extra);
  send(tools, 'move', to[0], to[1], extra);
  send(tools, 'up', to[0], to[1], release);
}

function fakeGraphics() {
  const calls = [];
  const g = {
    calls,
    clear() {
      calls.length = 0;
    },
  };
  for (const method of ['circle', 'rect', 'fill', 'stroke']) {
    g[method] = (...args) => {
      calls.push([method, ...args]);
      return g;
    };
  }
  return g;
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message ?? ''} expected ${expected}, got ${actual}`);
}

const LEFT_BOX = [[40, 120], [160, 280]];
const RIGHT_BOX = [[240, 140], [360, 260]];
const WHOLE_BOX = [[10, 10], [390, 390]];

test('clickTarget picks the topmost hit, or with ALT the hit below the topmost selected one', () => {
  const hits = [3, 5, 7];
  const none = () => false;
  assert.equal(clickTarget([], none, false), null);
  assert.equal(clickTarget([], none, true), null);
  assert.equal(clickTarget(hits, none, false), 3);
  assert.equal(clickTarget(hits, (uid) => uid === 5, false), 3);
  assert.equal(clickTarget(hits, none, true), 3);
  assert.equal(clickTarget(hits, (uid) => uid === 3, true), 5);
  assert.equal(clickTarget(hits, (uid) => uid === 5, true), 7);
  assert.equal(clickTarget(hits, (uid) => uid === 7, true), 3);
  assert.equal(clickTarget(hits, (uid) => uid === 5 || uid === 7, true), 7);
  assert.equal(clickTarget([9], (uid) => uid === 9, true), 9);
  const selected = new Set();
  const cycle = [];
  for (let index = 0; index < 4; index++) {
    const target = clickTarget(hits, (uid) => selected.has(uid), true);
    selected.clear();
    selected.add(target);
    cycle.push(target);
  }
  assert.deepEqual(cycle, [3, 5, 7, 3]);
});

test('applyClick sets, toggles with SHIFT and removes with CTRL; CTRL wins', () => {
  const { selection, uid, eventUid } = environment();
  const [f1, f2] = [uid('f_1'), uid('f_2')];
  selection.set([eventUid]);
  applyClick(selection, f1, NO_MODIFIERS);
  assert.deepEqual(selection.state, { objects: [f1], timeline: [eventUid], focus: 'objects' });
  applyClick(selection, f2, { shift: true, ctrl: false });
  assert.deepEqual(selection.objects, [f1, f2]);
  applyClick(selection, f1, { shift: true, ctrl: false });
  assert.deepEqual(selection.objects, [f2]);
  applyClick(selection, f2, { shift: true, ctrl: true });
  assert.deepEqual(selection.objects, []);
  applyClick(selection, f1, { shift: false, ctrl: true });
  assert.deepEqual(selection.objects, []);
  applyClick(selection, f1, NO_MODIFIERS);
  applyClick(selection, f2, NO_MODIFIERS);
  assert.deepEqual(selection.objects, [f2]);
  assert.deepEqual(selection.timeline, [eventUid]);
});

test('applyClick on empty space clears without modifiers and does nothing with them', () => {
  const { selection, uid, eventUid } = environment();
  const f1 = uid('f_1');
  selection.set([eventUid]);
  selection.add([f1]);
  applyClick(selection, null, { shift: true, ctrl: false });
  applyClick(selection, null, { shift: false, ctrl: true });
  applyClick(selection, null, { shift: true, ctrl: true });
  assert.deepEqual(selection.state, { objects: [f1], timeline: [eventUid], focus: 'objects' });
  applyClick(selection, null, NO_MODIFIERS);
  assert.deepEqual(selection.objects, []);
  assert.deepEqual(selection.timeline, []);
});

test('applyBox replaces, adds with SHIFT and removes with CTRL; CTRL wins', () => {
  const { selection, uid, eventUid } = environment();
  const [f1, f2, f3] = [uid('f_1'), uid('f_2'), uid('f_3')];
  selection.set([eventUid]);
  applyBox(selection, [f1, f2], NO_MODIFIERS);
  assert.deepEqual(selection.state, { objects: [f1, f2], timeline: [eventUid], focus: 'objects' });
  applyBox(selection, [f2, f3], { shift: true, ctrl: false });
  assert.deepEqual(selection.objects, [f1, f2, f3]);
  assert.deepEqual(selection.timeline, [eventUid]);
  applyBox(selection, [f1, f3], { shift: true, ctrl: true });
  assert.deepEqual(selection.objects, [f2]);
  applyBox(selection, [f2], { shift: false, ctrl: true });
  assert.deepEqual(selection.objects, []);
  applyBox(selection, [f3], NO_MODIFIERS);
  assert.deepEqual(selection.objects, [f3]);
});

test('applyBox with an empty box clears without modifiers and does nothing with them', () => {
  const { selection, uid, eventUid } = environment();
  const f1 = uid('f_1');
  selection.set([eventUid]);
  selection.add([f1]);
  applyBox(selection, [], { shift: true, ctrl: false });
  applyBox(selection, [], { shift: false, ctrl: true });
  assert.deepEqual(selection.state, { objects: [f1], timeline: [eventUid], focus: 'objects' });
  applyBox(selection, [], NO_MODIFIERS);
  assert.deepEqual(selection.state, { objects: [], timeline: [], focus: 'objects' });
});

test('boxAabb spans two world points in any order', () => {
  assert.deepEqual(boxAabb({ x: 2, y: -1 }, { x: -3, y: 4 }), { minX: -3, minY: -1, maxX: 2, maxY: 4 });
  assert.deepEqual(boxAabb({ x: 1, y: 1 }, { x: 1, y: 1 }), { minX: 1, minY: 1, maxX: 1, maxY: 1 });
});

test('Select is active at start; both tools have their cursor and hover', () => {
  const { tools, calls } = environment();
  assert.equal(tools.active.id, 'select');
  assert.equal(tools.get('select').cursor, 'default');
  assert.equal(tools.get('select').hover, true);
  assert.equal(tools.get('select-box').cursor, 'crosshair');
  assert.equal(tools.get('select-box').hover, false);
  assert.equal(selectTool().id, 'select');
  assert.equal(selectBoxTool().id, 'select-box');
  assert.notEqual(selectTool(), selectTool());
  assert.deepEqual(calls.cursor, ['default']);
  tools.activate('select-box');
  assert.deepEqual(calls.cursor, ['default', 'crosshair']);
});

test('a click selects the topmost hit: a joint over shapes, a shape never its body', () => {
  const { tools, selection, uid } = environment();
  click(tools, 300, 200);
  assert.deepEqual(selection.objects, [uid('j_1')]);
  click(tools, 100, 200);
  assert.deepEqual(selection.objects, [uid('f_1')]);
  click(tools, 260, 160);
  assert.deepEqual(selection.objects, [uid('f_2')]);
  click(tools, 200, 200);
  assert.deepEqual(selection.objects, [ROOT_UID]);
});

test('a click selects the root over a shape under it', () => {
  const { tools, selection, uid } = environment({ underRoot: true });
  click(tools, 200, 200);
  assert.deepEqual(selection.objects, [ROOT_UID]);
  click(tools, 200, 230);
  assert.deepEqual(selection.objects, [uid('f_0')]);
});

test('the root never moves: a drag that starts on the root alone draws a selection box', () => {
  const { tools, selection, model, changes, calls, uid } = environment();
  selection.set([ROOT_UID]);
  hover(tools, 200, 200);
  assert.equal(calls.cursor.at(-1), 'default');
  assert.deepEqual(overlay(tools), []);
  send(tools, 'down', 200, 200);
  assert.notEqual(calls.cursor.at(-1), 'move');
  send(tools, 'move', 300, 120);
  send(tools, 'move', 390, 10);
  assert.deepEqual(overlay(tools).map(([method]) => method), ['rect', 'fill', 'stroke']);
  send(tools, 'up', 390, 10);
  assert.deepEqual(model.prop(ROOT_UID, 'position'), [0, 0]);
  assert.equal(model.prop(ROOT_UID, 'angle'), 0);
  assert.deepEqual(changes, []);
  assert.deepEqual(selection.objects, [...boxTest(model, boxAabb({ x: 0, y: 0 }, { x: 1.9, y: 1.9 }))]);
  assert.ok(selection.objects.includes(uid('j_1')));
});

test('the root never moves: a drag on the root over a shape moves the shape under it', () => {
  const { tools, selection, model, history, calls, uid } = environment({ underRoot: true });
  selection.set([ROOT_UID]);
  hover(tools, 200, 200);
  assert.equal(calls.cursor.at(-1), 'move');
  drag(tools, [200, 200], [230, 200]);
  assert.deepEqual(selection.objects, [uid('f_0')]);
  near(model.prop(uid('b_0'), 'position')[0], 0.3);
  assert.deepEqual(model.prop(ROOT_UID, 'position'), [0, 0]);
  assert.equal(history.state.undoLabel, 'Move');
});

test('click modifiers: SHIFT toggles, CTRL removes and wins, ALT cycles overlapping hits', () => {
  const { tools, selection, uid } = environment();
  const [f1, f2, f3, j1] = [uid('f_1'), uid('f_2'), uid('f_3'), uid('j_1')];
  click(tools, 100, 200);
  click(tools, 260, 160, { shift: true });
  assert.deepEqual(selection.objects, [f1, f2]);
  click(tools, 100, 200, { shift: true });
  assert.deepEqual(selection.objects, [f2]);
  click(tools, 260, 160, { shift: true, ctrl: true });
  assert.deepEqual(selection.objects, []);
  click(tools, 100, 200, { ctrl: true });
  assert.deepEqual(selection.objects, []);
  const cycle = [];
  for (let index = 0; index < 4; index++) {
    click(tools, 300, 200, { alt: true });
    cycle.push(...selection.objects);
  }
  assert.deepEqual(cycle, [j1, f3, f2, j1]);
  click(tools, 300, 200, { alt: true, shift: true });
  assert.deepEqual(selection.objects, [j1, f3]);
  click(tools, 300, 200, { alt: true, ctrl: true });
  assert.deepEqual(selection.objects, [j1]);
});

test('a click on empty space clears without modifiers and does nothing with them', () => {
  const { tools, selection, uid } = environment();
  click(tools, 100, 200);
  click(tools, 20, 20, { shift: true });
  click(tools, 20, 20, { ctrl: true });
  assert.deepEqual(selection.objects, [uid('f_1')]);
  click(tools, 20, 20);
  assert.deepEqual(selection.objects, []);
});

test('the click target comes from the press point and modifiers from the release', () => {
  const { tools, selection, uid } = environment();
  send(tools, 'down', 100, 200);
  send(tools, 'move', 102, 201);
  send(tools, 'up', 102, 201, { shift: true });
  assert.deepEqual(selection.objects, [uid('f_1')]);
  send(tools, 'down', 100, 200, { shift: true });
  send(tools, 'up', 100, 200);
  assert.deepEqual(selection.objects, [uid('f_1')]);
});

test('a press latches into a drag at 4 px and stays a drag when it comes back', () => {
  const { tools, selection, history, uid } = environment();
  send(tools, 'down', 100, 200);
  send(tools, 'move', 103, 200);
  send(tools, 'up', 103, 200);
  assert.deepEqual(selection.objects, [uid('f_1')]);
  send(tools, 'down', 100, 200, { shift: true });
  send(tools, 'move', 104, 200, { shift: true });
  send(tools, 'move', 100, 200, { shift: true });
  send(tools, 'up', 100, 200, { shift: true });
  assert.deepEqual(selection.objects, [uid('f_1')]);
  assert.equal(history.canUndo, false);
  selection.set([uid('f_2')]);
  send(tools, 'down', 20, 20);
  send(tools, 'up', 24, 20, { ctrl: true });
  assert.deepEqual(selection.objects, [uid('f_2')]);
  send(tools, 'down', 20, 20);
  send(tools, 'up', 24, 20);
  assert.deepEqual(selection.objects, []);
});

for (const id of ['select', 'select-box']) {
  test(`${id}: a drag selects shapes entirely inside and joint anchors, never the root`, () => {
    const { tools, selection, uid } = environment();
    tools.activate(id);
    drag(tools, ...LEFT_BOX);
    assert.deepEqual(selection.objects, [uid('f_1')]);
    drag(tools, RIGHT_BOX[1], RIGHT_BOX[0]);
    assert.deepEqual(selection.objects, [uid('f_2'), uid('f_3'), uid('j_1')]);
    drag(tools, ...WHOLE_BOX);
    assert.deepEqual(selection.objects, [uid('f_1'), uid('f_2'), uid('f_3'), uid('j_1')]);
    drag(tools, [240, 140], [340, 260]);
    assert.deepEqual(selection.objects, [uid('f_3'), uid('j_1')]);
    drag(tools, [20, 20], [60, 60]);
    assert.deepEqual(selection.objects, []);
  });

  test(`${id}: box modifiers are read at the release`, () => {
    const { tools, selection, uid } = environment();
    tools.activate(id);
    drag(tools, ...LEFT_BOX);
    drag(tools, ...RIGHT_BOX, NO_MODIFIERS, { shift: true });
    assert.deepEqual(selection.objects, [uid('f_1'), uid('f_2'), uid('f_3'), uid('j_1')]);
    drag(tools, ...RIGHT_BOX, { shift: true }, { ctrl: true, shift: true });
    assert.deepEqual(selection.objects, [uid('f_1')]);
    drag(tools, [20, 20], [60, 60], NO_MODIFIERS, { shift: true });
    drag(tools, [20, 20], [60, 60], NO_MODIFIERS, { ctrl: true });
    drag(tools, ...RIGHT_BOX, NO_MODIFIERS, { alt: true, shift: true });
    assert.deepEqual(selection.objects, [uid('f_1'), uid('f_2'), uid('f_3'), uid('j_1')]);
    drag(tools, ...LEFT_BOX, { shift: true }, NO_MODIFIERS);
    assert.deepEqual(selection.objects, [uid('f_1')]);
  });

  test(`${id}: the selection changes only at the release`, () => {
    const { tools, selection } = environment();
    tools.activate(id);
    const events = [];
    selection.on('selection', (state) => events.push(state));
    send(tools, 'down', ...WHOLE_BOX[0]);
    send(tools, 'move', 200, 200);
    send(tools, 'move', ...WHOLE_BOX[1]);
    assert.equal(events.length, 0);
    send(tools, 'up', ...WHOLE_BOX[1]);
    assert.equal(events.length, 1);
  });

  test(`${id}: Esc, a tool switch, a mode change and cancel mid-drag keep the selection`, () => {
    const { tools, selection, actions, modes, uid } = environment();
    const aborts = [
      () => actions.run('escape'),
      () => actions.run(id === 'select' ? 'tool:select-box' : 'tool:select'),
      () => modes.startSimulate(),
      () => tools.cancel(),
    ];
    for (const abort of aborts) {
      if (modes.mode === 'simulate') modes.stopSimulate();
      tools.activate(id);
      selection.set([uid('f_1')]);
      send(tools, 'down', ...WHOLE_BOX[0]);
      send(tools, 'move', ...WHOLE_BOX[1]);
      abort();
      send(tools, 'move', 30, 30);
      send(tools, 'up', 30, 30);
      assert.deepEqual(selection.objects, [uid('f_1')]);
    }
  });

  test(`${id}: the press point keeps its world position when the view pans during the drag`, () => {
    const { tools, selection, camera, uid } = environment();
    tools.activate(id);
    send(tools, 'down', ...LEFT_BOX[0]);
    send(tools, 'move', 100, 200);
    camera.panBy(-100, 0);
    const end = camera.worldToScreen({ x: -0.4, y: -0.8 });
    send(tools, 'move', end.x, end.y);
    send(tools, 'up', end.x, end.y);
    assert.deepEqual(selection.objects, [uid('f_1')]);
  });

  test(`${id}: works in Animate and Simulate and records nothing`, () => {
    const { tools, selection, modes, history, changes, clipUid, uid } = environment();
    tools.activate(id);
    modes.openClip(clipUid);
    assert.equal(tools.active.id, id);
    drag(tools, ...LEFT_BOX);
    assert.deepEqual(selection.objects, [uid('f_1')]);
    modes.openClip(null);
    modes.startSimulate();
    assert.equal(tools.active.id, id);
    drag(tools, ...RIGHT_BOX);
    assert.deepEqual(selection.objects, [uid('f_2'), uid('f_3'), uid('j_1')]);
    modes.stopSimulate();
    click(tools, 100, 200);
    click(tools, 20, 20);
    assert.equal(history.canUndo, false);
    assert.equal(history.inGesture, false);
    assert.deepEqual(changes, []);
  });

  test(`${id}: right presses do nothing`, () => {
    const { tools, selection, uid } = environment();
    tools.activate(id);
    selection.set([uid('f_2')]);
    click(tools, 100, 200, { button: 2 });
    send(tools, 'down', ...WHOLE_BOX[0], { button: 2 });
    send(tools, 'up', ...WHOLE_BOX[1], { button: 2 });
    assert.deepEqual(selection.objects, [uid('f_2')]);
  });

  test(`${id}: drawOverlay draws the box only while dragging`, () => {
    const { tools, camera } = environment();
    tools.activate(id);
    const g = fakeGraphics();
    send(tools, 'down', 40, 120);
    tools.drawOverlay(g);
    assert.deepEqual(g.calls, []);
    send(tools, 'move', 42, 121);
    tools.drawOverlay(g);
    assert.deepEqual(g.calls, []);
    send(tools, 'move', 160, 280);
    tools.drawOverlay(g);
    assert.equal(g.calls.length, 3);
    const [rect, fill, stroke] = g.calls;
    assert.equal(rect[0], 'rect');
    [40, 120, 120, 160].forEach((value, index) => near(rect[index + 1], value, `rect ${index}`));
    assert.deepEqual(fill, ['fill', { color: COLORS.highlight, alpha: 0.1 }]);
    assert.deepEqual(stroke, ['stroke', { width: LINE_WIDTH.outline, color: COLORS.highlight }]);
    send(tools, 'move', 10, 20);
    tools.drawOverlay(g);
    [10, 20, 30, 100].forEach((value, index) => near(g.calls[0][index + 1], value, `flipped ${index}`));
    camera.panBy(50, 0);
    tools.drawOverlay(g);
    [10, 20, 80, 100].forEach((value, index) => near(g.calls[0][index + 1], value, `panned ${index}`));
    send(tools, 'up', 10, 20);
    tools.drawOverlay(g);
    assert.deepEqual(g.calls, []);
    send(tools, 'down', 40, 120);
    send(tools, 'move', 160, 280);
    tools.cancel();
    tools.drawOverlay(g);
    assert.deepEqual(g.calls, []);
  });
}

test('Select Box: a click clears without modifiers and does nothing with them', () => {
  const { tools, selection, uid } = environment();
  tools.activate('select-box');
  selection.set([uid('f_2')]);
  click(tools, 100, 200, { shift: true });
  click(tools, 100, 200, { ctrl: true });
  assert.deepEqual(selection.objects, [uid('f_2')]);
  click(tools, 100, 200);
  assert.deepEqual(selection.objects, []);
});

test('a drag invalidates the overlay only once it is a drag', () => {
  const { tools, calls } = environment();
  const before = calls.invalidations;
  send(tools, 'down', 40, 120);
  send(tools, 'move', 42, 120);
  assert.equal(calls.invalidations, before);
  send(tools, 'move', 60, 120);
  assert.ok(calls.invalidations > before);
  send(tools, 'up', 60, 120);
});

test('marqueeTool builds independent tools around a click handler', () => {
  const clicks = [];
  const tool = marqueeTool({ id: 'select', cursor: 'cell', hover: false, click: (press, release) => clicks.push([press, release]) });
  assert.equal(tool.cursor, 'cell');
  assert.equal(tool.hover, false);
  assert.equal(tool.cancel(), false);
  assert.equal(tool.keyDown({ key: 'a' }), false);
});

function chain({ snap = false } = {}) {
  const editor = createEditor();
  const { model, history, settings, camera, tools } = editor;
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
  const calls = { cursor: [], invalidations: 0 };
  tools.bindView({
    hitTest: (screen) => hitTest(model, camera, screen),
    boxTest: (box) => boxTest(model, box),
    setCursor: (css) => calls.cursor.push(css),
    invalidateOverlay: () => {
      calls.invalidations++;
    },
  });
  return { ...editor, calls, shapes, bodies, joints };
}

function path(tools, points, extra = {}, release = extra) {
  const [first, ...rest] = points;
  send(tools, 'down', first[0], first[1], extra);
  for (const [x, y] of rest) send(tools, 'move', x, y, extra);
  const last = rest.at(-1) ?? first;
  send(tools, 'up', last[0], last[1], release);
}

function hover(tools, x, y, extra = {}) {
  send(tools, 'move', x, y, { buttons: 0, ...extra });
}

function snapshot(env) {
  const { model } = env;
  return JSON.stringify([
    model.prop(ROOT_UID, 'position'),
    model.prop(ROOT_UID, 'angle'),
    ...env.bodies.map((uid) => [model.prop(uid, 'position'), model.prop(uid, 'angle')]),
    ...env.joints.map((uid) => model.prop(uid, 'anchor')),
  ]);
}

function nearPair(actual, expected, message) {
  assert.equal(actual.length, 2, message);
  near(actual[0], expected[0], message);
  near(actual[1], expected[1], message);
}

function recorder() {
  const calls = [];
  const g = {
    calls,
    clear() {
      calls.length = 0;
    },
  };
  for (const method of ['moveTo', 'lineTo', 'arc', 'closePath', 'poly', 'rect', 'circle', 'fill', 'stroke']) {
    g[method] = (...args) => {
      calls.push([method, ...args]);
      return g;
    };
  }
  return g;
}

function overlay(tools) {
  const g = recorder();
  tools.drawOverlay(g);
  return g.calls;
}

function ringAt(all) {
  const calls = all.slice(Math.max(0, all.findIndex(([method]) => method === 'moveTo')));
  const [first, , second] = calls;
  if (first?.[0] !== 'moveTo' || second?.[0] !== 'lineTo') return null;
  return { x: first[1] - 72, y: first[2] };
}

function xArrowStart(calls) {
  const move = calls.find(([method]) => method === 'moveTo');
  return move ? { x: move[1] - 16, y: move[2] } : null;
}

function addClipTo(history) {
  const { tracks, events, ...props } = defaultsOf('clip');
  return history.execute({
    label: 'Add clip',
    run: (tx) => tx.add(ROOT_UID, 'clips', undefined, { type: 'clip', props: { ...props, length: 1 } }),
  });
}

test('Edit: dragging a selected shape moves its body with its subtree and the anchors it carries', () => {
  const env = chain();
  const { model, tools, selection, history, calls, shapes, bodies, joints } = env;
  selection.set([shapes[1]]);
  send(tools, 'down', 300, 232);
  assert.equal(calls.cursor.at(-1), 'move');
  send(tools, 'move', 315, 242);
  send(tools, 'move', 330, 252);
  send(tools, 'up', 330, 252);
  nearPair(model.prop(bodies[1], 'position'), [1.3, -0.2]);
  nearPair(model.prop(bodies[3], 'position'), [3.3, -0.2]);
  nearPair(model.prop(joints[0], 'anchor'), [0.8, -0.2]);
  nearPair(model.prop(joints[2], 'anchor'), [2.8, -0.2]);
  assert.deepEqual(model.prop(bodies[0], 'position'), [0, 0]);
  assert.deepEqual(selection.objects, [shapes[1]]);
  assert.equal(history.state.undoLabel, 'Move');
  assert.equal(calls.cursor.at(-1), 'default');
});

test('Edit: an unselected hit is selected alone at the latch, not at the press, and moves', () => {
  const { model, tools, selection, shapes, bodies, joints } = chain();
  selection.set([shapes[0]]);
  send(tools, 'down', 400, 230);
  assert.deepEqual(selection.objects, [shapes[0]]);
  send(tools, 'move', 402, 230);
  assert.deepEqual(selection.objects, [shapes[0]]);
  send(tools, 'move', 410, 230);
  assert.deepEqual(selection.objects, [shapes[2]]);
  send(tools, 'up', 410, 230);
  nearPair(model.prop(bodies[2], 'position'), [2.1, 0]);
  nearPair(model.prop(bodies[3], 'position'), [3.1, 0]);
  nearPair(model.prop(joints[1], 'anchor'), [1.6, 0]);
  assert.deepEqual(model.prop(bodies[1], 'position'), [1, 0]);
});

test('Edit: an ALT drag starts from the topmost hit and moves only the bodies', () => {
  const { model, tools, selection, shapes, bodies, joints } = chain();
  path(tools, [[400, 230], [450, 230]], { alt: true });
  assert.deepEqual(selection.objects, [shapes[2]]);
  nearPair(model.prop(bodies[2], 'position'), [2.5, 0]);
  assert.deepEqual(model.prop(bodies[3], 'position'), [3, 0]);
  nearPair(model.prop(joints[1], 'anchor'), [2, 0]);
  assert.deepEqual(model.prop(joints[2], 'anchor'), [2.5, 0]);
});

test('Edit: SHIFT and CTRL drags never change what a drag selects', () => {
  const { model, tools, selection, shapes, bodies } = chain();
  selection.set([shapes[1], shapes[2]]);
  path(tools, [[400, 230], [430, 230]], { shift: true });
  assert.deepEqual(selection.objects, [shapes[1], shapes[2]]);
  nearPair(model.prop(bodies[1], 'position'), [1.3, 0]);
  nearPair(model.prop(bodies[2], 'position'), [2.3, 0]);
  nearPair(model.prop(bodies[3], 'position'), [3.3, 0]);
  path(tools, [[200, 232], [200, 262]], { ctrl: true });
  assert.deepEqual(selection.objects, [shapes[0]]);
  nearPair(model.prop(bodies[0], 'position'), [0, -0.3]);
  nearPair(model.prop(bodies[3], 'position'), [3.3, -0.3]);
  path(tools, [[400, 262], [400, 292]], { shift: true });
  assert.deepEqual(selection.objects, [shapes[2]]);
});

test('Edit: a drag on empty space draws a box and moves nothing', () => {
  const env = chain();
  const { tools, selection, history, shapes } = env;
  selection.set([shapes[1]]);
  const before = snapshot(env);
  path(tools, [[20, 380], [380, 260]]);
  assert.deepEqual(selection.objects, []);
  path(tools, [[20, 380], [380, 20]]);
  assert.deepEqual(selection.objects, [shapes[0], shapes[1], env.joints[0], env.joints[1]]);
  assert.equal(snapshot(env), before);
  assert.equal(history.state.undoLabel, 'Create joint');
});

test('gizmo square and arrows move the target with grid snap of the pivot, one axis per arrow', () => {
  const cases = [
    ['square', [[272, 178], [295, 161]], [1.2, 0.2], 'move'],
    ['x', [[290, 200], [313, 230]], [1.2, 0], 'ew-resize'],
    ['y', [[250, 170], [277, 147]], [1, 0.2], 'ns-resize'],
  ];
  const env = chain({ snap: true });
  const { model, tools, selection, history, calls, shapes, bodies, joints } = env;
  selection.set([shapes[1]]);
  const before = snapshot(env);
  for (const [handle, points, expected, cursor] of cases) {
    assert.equal(tools.handleAt({ x: points[0][0], y: points[0][1] }), handle);
    send(tools, 'down', ...points[0]);
    assert.equal(calls.cursor.at(-1), cursor, handle);
    send(tools, 'move', ...points[1]);
    send(tools, 'up', ...points[1]);
    nearPair(model.prop(bodies[1], 'position'), expected, handle);
    nearPair(model.prop(bodies[2], 'position'), [expected[0] + 1, expected[1]], handle);
    nearPair(model.prop(joints[0], 'anchor'), [expected[0] - 0.5, expected[1]], handle);
    assert.deepEqual(selection.objects, [shapes[1]]);
    assert.equal(history.state.undoLabel, 'Move');
    history.undo();
    assert.equal(snapshot(env), before, handle);
  }
});

test('gizmo ring rotates around the parent anchor, SHIFT in 15 degree steps, CTRL around the origin', () => {
  const env = chain();
  const { model, tools, selection, history, shapes, bodies } = env;
  selection.set([shapes[1]]);
  const before = snapshot(env);
  assert.equal(tools.handleAt({ x: 322, y: 200 }), 'ring');
  path(tools, [[322, 200], [301, 149], [250, 128]]);
  nearPair(model.prop(bodies[1], 'position'), [0.5, 0.5]);
  near(model.prop(bodies[1], 'angle'), Math.PI / 2);
  nearPair(model.prop(bodies[2], 'position'), [0.5, 1.5]);
  assert.equal(history.state.undoLabel, 'Rotate');
  history.undo();
  assert.equal(snapshot(env), before);
  const ten = 10 * (Math.PI / 180);
  path(tools, [[322, 200], [250 + 72 * Math.cos(ten), 200 - 72 * Math.sin(ten)]], { shift: true });
  near(model.prop(bodies[1], 'angle'), Math.PI / 12);
  history.undo();
  hover(tools, 10, 10, { ctrl: true });
  assert.equal(tools.handleAt({ x: 372, y: 200 }), 'ring');
  path(tools, [[372, 200], [351, 149], [300, 128]], { ctrl: true });
  nearPair(model.prop(bodies[1], 'position'), [1, 0]);
  near(model.prop(bodies[1], 'angle'), Math.PI / 2);
  nearPair(model.prop(bodies[2], 'position'), [1, 1]);
});

test('gizmo ring rotates a multi-selection around the average pivot, or the last selected one after Z', () => {
  const env = chain();
  const { model, tools, selection, history, actions, shapes, bodies } = env;
  selection.set([shapes[2], shapes[1]]);
  assert.deepEqual(ringAt(overlay(tools)), { x: 350, y: 200 });
  path(tools, [[422, 200], [401, 149], [350, 128]]);
  nearPair(model.prop(bodies[1], 'position'), [1.5, -0.5]);
  nearPair(model.prop(bodies[2], 'position'), [1.5, 0.5]);
  nearPair(model.prop(bodies[3], 'position'), [1.5, 1.5]);
  history.undo();
  actions.run('pivot-mode');
  assert.deepEqual(ringAt(overlay(tools)), { x: 250, y: 200 });
  path(tools, [[322, 200], [301, 149], [250, 128]]);
  nearPair(model.prop(bodies[1], 'position'), [0.5, 0.5]);
  nearPair(model.prop(bodies[2], 'position'), [0.5, 1.5]);
});

test('#127: the joint at the pivot is pressed as an object; a child joint under the X arrow loses to the arrow', () => {
  const env = chain();
  const { model, tools, selection, camera, shapes, bodies, joints } = env;
  selection.set([shapes[1]]);
  assert.equal(tools.handleAt({ x: 252, y: 200 }), null);
  path(tools, [[252, 200], [252, 230]]);
  assert.deepEqual(selection.objects, [joints[0]]);
  nearPair(model.prop(joints[0], 'anchor'), [0.5, -0.3]);
  nearPair(model.prop(bodies[1], 'position'), [1, -0.3]);
  env.history.undo();
  env.history.execute(setProps([shapes[1]], { 'shape.radius': 0.2 }));
  camera.zoomAt({ x: 200, y: 200 }, 0.4);
  selection.set([shapes[1]]);
  const child = camera.worldToScreen({ x: 1.5, y: 0 });
  assert.deepEqual(child, { x: 260, y: 200 });
  assert.equal(tools.handleAt(child), 'x');
  path(tools, [[child.x, child.y], [child.x + 20, child.y + 20]]);
  assert.deepEqual(selection.objects, [shapes[1]]);
  nearPair(model.prop(bodies[1], 'position'), [1.5, 0]);
  nearPair(model.prop(joints[1], 'anchor'), [2, 0]);
});

test('a handle click changes nothing; each drag is one undo step and a drag back leaves none', () => {
  const env = chain();
  const { tools, selection, history, shapes, bodies, model } = env;
  selection.set([shapes[1]]);
  const before = snapshot(env);
  path(tools, [[272, 178], [273, 178]]);
  path(tools, [[322, 200]]);
  assert.deepEqual(selection.objects, [shapes[1]]);
  assert.equal(snapshot(env), before);
  assert.equal(history.state.undoLabel, 'Create joint');
  path(tools, [[300, 232], [330, 232], [360, 232], [300, 232]]);
  assert.equal(history.state.undoLabel, 'Create joint');
  assert.equal(snapshot(env), before);
  path(tools, [[300, 232], [330, 232], [360, 232]]);
  assert.equal(history.undo(), true);
  assert.equal(snapshot(env), before);
  history.redo();
  nearPair(model.prop(bodies[1], 'position'), [1.6, 0]);
});

test('Esc, Undo, a tool switch and a mode change mid-drag restore every value and keep the latch selection', () => {
  const aborts = [
    (env) => env.actions.run('escape'),
    (env) => env.history.undo(),
    (env) => env.tools.activate('select-box'),
    (env) => env.modes.openClip(env.clip),
  ];
  for (const abort of aborts) {
    for (const start of [[400, 230], [322, 200]]) {
      const env = chain();
      env.clip = addClipTo(env.history);
      const { tools, selection, shapes } = env;
      selection.set([shapes[1]]);
      const before = snapshot(env);
      send(tools, 'down', ...start);
      send(tools, 'move', start[0] + 40, start[1] + 40);
      assert.notEqual(snapshot(env), before);
      abort(env);
      send(tools, 'move', start[0] + 60, start[1]);
      send(tools, 'up', start[0] + 60, start[1]);
      const name = `${abort.toString()} ${start}`;
      assert.equal(snapshot(env), before, name);
      assert.deepEqual(selection.objects, start[0] === 400 ? [shapes[2]] : [shapes[1]], name);
      assert.equal(env.history.state.undoLabel, 'Add clip', name);
    }
  }
});

test('handleAt, cursors and the readout', () => {
  const { model, tools, selection, calls, shapes } = chain();
  assert.equal(tools.handleAt({ x: 272, y: 178 }), null);
  selection.set([shapes[1]]);
  const expected = [
    [272, 178, 'square', 'move'],
    [290, 200, 'x', 'ew-resize'],
    [250, 170, 'y', 'ns-resize'],
    [322, 200, 'ring', 'pointer'],
    [252, 200, null, 'move'],
    [400, 230, null, 'move'],
    [20, 20, null, 'default'],
  ];
  for (const [x, y, handle, cursor] of expected) {
    assert.equal(tools.handleAt({ x, y }), handle, `${x},${y}`);
    hover(tools, x, y);
    assert.equal(calls.cursor.at(-1), cursor, `${x},${y}`);
  }
  assert.equal(tools.readout(), null);
  send(tools, 'down', 272, 178);
  send(tools, 'move', 274, 178);
  assert.equal(tools.readout(), null);
  send(tools, 'move', 302, 168);
  const ppm = model.prop(ROOT_UID, 'units.pixelsPerMeter');
  assert.deepEqual(tools.readout(), { text: formatMove({ x: 0.3, y: 0.1 }, ppm), screen: { x: 318, y: 184 } });
  send(tools, 'up', 302, 168);
  assert.equal(tools.readout(), null);
  send(tools, 'down', 352, 190);
  send(tools, 'move', 280, 118);
  assert.match(tools.readout().text, /^Δθ: -?\d+\.\d°$/);
  tools.cancel();
  assert.equal(tools.readout(), null);
});

test('Animate and Simulate: no gizmo, object drags draw a box and nothing moves', () => {
  const env = chain();
  const { tools, selection, modes, history, calls, shapes } = env;
  const before = snapshot(env);
  selection.set([shapes[1]]);
  modes.openClip(addClipTo(history));
  for (const mode of ['animate', 'simulate']) {
    if (mode === 'simulate') modes.startSimulate();
    assert.deepEqual(overlay(tools), [], mode);
    assert.equal(tools.handleAt({ x: 322, y: 200 }), null, mode);
    hover(tools, 300, 232);
    assert.equal(calls.cursor.at(-1), 'default', mode);
    selection.set([shapes[1]]);
    send(tools, 'down', 400, 230);
    send(tools, 'move', 420, 300);
    const box = overlay(tools);
    assert.equal(box.length, 3, mode);
    assert.equal(box[0][0], 'rect', mode);
    send(tools, 'up', 420, 300);
    assert.deepEqual(selection.objects, [], mode);
    path(tools, [[322, 200], [250, 128]]);
    assert.equal(snapshot(env), before, mode);
  }
});

test('Select Box shows no gizmo and draws a box over the gizmo and objects', () => {
  const env = chain();
  const { tools, selection, shapes } = env;
  const before = snapshot(env);
  selection.set([shapes[1]]);
  tools.activate('select-box');
  assert.deepEqual(overlay(tools), []);
  assert.equal(tools.handleAt({ x: 272, y: 178 }), null);
  path(tools, [[272, 178], [290, 120], [360, 245]]);
  assert.equal(snapshot(env), before);
  assert.deepEqual(selection.objects, [env.joints[1]]);
});

test('overlay: no gizmo for the root alone, the gizmo for one body, one joint with a ring, and several objects with each pivot mark', () => {
  const env = chain();
  const { tools, selection, actions, history, shapes, joints } = env;
  assert.deepEqual(overlay(tools), []);
  history.execute(setProps([ROOT_UID], { position: [0, 1], angle: Math.PI / 2 }));
  selection.set([ROOT_UID]);
  assert.deepEqual(overlay(tools), []);
  assert.equal(tools.handleAt({ x: 200, y: 100 }), null);
  history.undo();
  selection.set([shapes[1]]);
  const body = overlay(tools);
  assert.deepEqual(ringAt(body), { x: 250, y: 200 });
  assert.deepEqual(body.at(-1), ['stroke', { width: LINE_WIDTH.outline, color: COLORS.gizmo }]);
  selection.set([joints[1]]);
  const joint = overlay(tools);
  assert.deepEqual(joint.slice(0, 3), [['moveTo', 356, 200], ['lineTo', 422, 200], ['stroke', { width: LINE_WIDTH.outline, color: COLORS.gizmo }]]);
  assert.deepEqual(ringAt(joint.slice(3)), { x: 350, y: 200 });
  selection.set([shapes[2], shapes[1], joints[2]]);
  near(ringAt(overlay(tools)).x, 200 + (100 * (2 + 1 + 2.5)) / 3);
  actions.run('pivot-mode');
  const last = overlay(tools);
  assert.deepEqual(ringAt(last), { x: 450, y: 200 });
  assert.deepEqual(last.slice(-4)[0], ['circle', 450, 200, 4]);
  actions.run('pivot-mode');
  assert.equal(overlay(tools).at(-5)[0], 'moveTo');
});

test('overlay: the gizmo follows a move, stays during a rotation, highlights hover and the dragged handle, and gives way to a box', () => {
  const { tools, selection, shapes } = chain();
  selection.set([shapes[1]]);
  hover(tools, 272, 178);
  const hovered = overlay(tools);
  const rect = hovered.findLastIndex(([method]) => method === 'rect');
  assert.deepEqual(hovered[rect + 1], ['fill', { color: 0xffffff, alpha: 0.4 }]);
  send(tools, 'down', 272, 178);
  send(tools, 'move', 302, 168);
  assert.deepEqual(ringAt(overlay(tools)), { x: 280, y: 190 });
  send(tools, 'up', 302, 168);
  hover(tools, 10, 10);
  assert.deepEqual(ringAt(overlay(tools)), { x: 280, y: 190 });
  send(tools, 'down', 352, 190);
  send(tools, 'move', 280, 118);
  const turning = overlay(tools);
  assert.deepEqual(ringAt(turning), { x: 280, y: 190 });
  assert.deepEqual(turning[99], ['stroke', { width: LINE_WIDTH.gizmo + 1, color: 0xffffff }]);
  send(tools, 'up', 280, 118);
  send(tools, 'down', 20, 380);
  send(tools, 'move', 60, 300);
  const box = overlay(tools);
  assert.deepEqual(box.map(([method]) => method), ['rect', 'fill', 'stroke']);
  tools.cancel();
  assert.deepEqual(ringAt(overlay(tools)), { x: 280, y: 190 });
});
function resizeEnv() {
  const editor = createEditor();
  const { model, camera, tools } = editor;
  const { meta, units, preview } = defaultsOf('document');
  model.reset({
    type: 'root',
    props: { ...defaultsOf('root'), position: [0, 0], angle: 0, meta, units, preview },
    children: {
      bodies: [
        body('b_1', [0, 0], [
          shape('f_1', { type: 'box', center: [0, 0], width: 1, height: 0.6, angle: 0 }),
          shape('f_2', { type: 'circle', center: [0, 0], radius: 0.2 }),
          shape('f_3', { type: 'polygon', vertices: [[0, 0], [0.1, 0], [0, 0.1]] }),
        ]),
        body('b_2', [2, 0], [shape('f_4', { type: 'box', center: [0, 0], width: 0.6, height: 0.6, angle: 0 })]),
      ],
      joints: [joint('j_1', 'b_1', 'b_2', [1.7, 0])],
      clips: [],
    },
  });
  camera.setSize(400, 400);
  camera.zoomAt({ x: 200, y: 200 }, 100 / camera.scale);
  const calls = { cursor: [], invalidations: 0 };
  tools.bindView({
    hitTest: (screen) => hitTest(model, camera, screen),
    boxTest: (box) => boxTest(model, box),
    setCursor: (css) => calls.cursor.push(css),
    invalidateOverlay: () => {
      calls.invalidations++;
    },
  });
  const uid = (id) => (id === 'root' ? ROOT_UID : model.uidOf(id));
  const record = (id) => model.prop(uid(id), 'shape');
  const geometryOf = () => JSON.stringify(['f_1', 'f_2', 'f_4'].map(record));
  return { ...editor, calls, uid, record, geometryOf };
}

function handleRects(calls) {
  return calls.filter(([method, , , width]) => method === 'rect' && (width === 8 || width === 10));
}

test('resize handles: a selected box only, a selected body on its circles and boxes, a multi-selection as the union', () => {
  const env = resizeEnv();
  const { tools, selection, uid, history } = env;
  selection.set([uid('f_1')]);
  assert.equal(handleRects(overlay(tools)).length, 8);
  assert.equal(tools.handleAt({ x: 250, y: 170 }), 'resize-ne');
  assert.equal(tools.handleAt({ x: 220, y: 200 }), 'x');
  selection.set([uid('b_1')]);
  assert.equal(handleRects(overlay(tools)).length, 9);
  assert.equal(tools.handleAt({ x: 220, y: 200 }), 'resize-r');
  selection.set([uid('f_1'), uid('b_2'), uid('j_1')]);
  assert.equal(handleRects(overlay(tools)).length, 16);
  assert.equal(tools.handleAt({ x: 430, y: 170 }), 'resize-ne');
  selection.set([uid('f_3')]);
  assert.equal(handleRects(overlay(tools)).length, 0);
  selection.set([uid('f_1'), ROOT_UID]);
  assert.equal(handleRects(overlay(tools)).length, 8);
  selection.set([ROOT_UID]);
  assert.equal(handleRects(overlay(tools)).length, 0);
  selection.set([uid('f_1')]);
  path(tools, [[222, 178], [242, 178]]);
  nearPair(env.model.prop(uid('b_1'), 'position'), [0.2, 0]);
  history.undo();
});

test('resize priority: square, nearest point handle, arrows, ring; a joint at the pivot wins', () => {
  const env = resizeEnv();
  const { tools, selection, uid, history, model } = env;
  selection.set([uid('f_1')]);
  assert.equal(tools.handleAt({ x: 250, y: 200 }), 'resize-e');
  assert.equal(tools.handleAt({ x: 200, y: 170 }), 'resize-n');
  history.execute(setProps([uid('j_1')], { anchor: [0.5, 0.3] }));
  assert.equal(tools.handleAt({ x: 250, y: 170 }), 'resize-ne');
  path(tools, [[250, 170], [260, 160]]);
  assert.deepEqual(selection.objects, [uid('f_1')]);
  near(env.record('f_1').width, 1.1);
  history.undo();
  history.undo();
  selection.set([uid('f_4')]);
  assert.equal(tools.handleAt({ x: 370, y: 200 }), null);
  path(tools, [[370, 200], [370, 230]]);
  assert.deepEqual(selection.objects, [uid('j_1')]);
  assert.equal(env.record('f_4').width, 0.6);
  history.undo();
  selection.set([uid('f_1')]);
  history.execute(setProps([uid('f_1')], { 'shape.width': 0.44, 'shape.height': 0.44 }));
  assert.equal(tools.handleAt({ x: 222, y: 178 }), 'square');
  history.execute(setProps([uid('b_1')], { position: [-1, 0] }));
  history.execute(setProps([uid('f_1')], { 'shape.width': 0.3, 'shape.height': 0.06 }));
  assert.equal(tools.handleAt({ x: 115, y: 199.5 }), 'resize-e');
  assert.equal(tools.handleAt({ x: 115, y: 198.5 }), 'resize-ne');
  history.execute(setProps([uid('f_2')], { 'shape.radius': 0.05 }));
  selection.set([uid('f_2')]);
  assert.equal(tools.handleAt({ x: 105, y: 200 }), 'resize-r');
  history.execute(setProps([uid('b_1')], { position: [0, 0] }));
  assert.equal(tools.handleAt({ x: 205, y: 200 }), null);
  assert.ok(hitTest(model, env.camera, { x: 205, y: 200 }).some((hit) => model.get(hit).type === 'root'));
});

test('resize priority: an exact tie across shapes goes to the earlier shape in resize order', () => {
  const env = resizeEnv();
  const { tools, selection, uid, history } = env;
  history.execute(setProps([uid('f_2')], { 'shape.radius': 0.5 }));
  selection.set([uid('f_2'), uid('f_1')]);
  assert.equal(tools.handleAt({ x: 250, y: 200 }), 'resize-r');
  selection.set([uid('f_1'), uid('f_2')]);
  assert.equal(tools.handleAt({ x: 250, y: 200 }), 'resize-e');
  assert.equal(tools.handleAt({ x: 252, y: 200 }), 'resize-e');
});

test('a resize drag changes only its shape, keeps the gizmo, shows the size and is one undo step', () => {
  const env = resizeEnv();
  const { tools, selection, uid, history, model, calls } = env;
  selection.set([uid('f_1'), uid('f_4')]);
  const ring = ringAt(overlay(tools));
  assert.deepEqual(ring, { x: 300, y: 200 });
  const before = { f_2: env.record('f_2'), f_4: env.record('f_4') };
  hover(tools, 250, 170);
  assert.equal(calls.cursor.at(-1), 'nesw-resize');
  hover(tools, 200, 170);
  assert.equal(calls.cursor.at(-1), 'ns-resize');
  hover(tools, 250, 200);
  assert.equal(calls.cursor.at(-1), 'ew-resize');
  send(tools, 'down', 250, 200);
  assert.equal(calls.cursor.at(-1), 'ew-resize');
  send(tools, 'move', 260, 200);
  send(tools, 'move', 270, 205);
  const ppm = model.prop(ROOT_UID, 'units.pixelsPerMeter');
  assert.deepEqual(tools.readout(), { text: formatSize({ width: 1.2, height: 0.6 }, ppm), screen: { x: 286, y: 221 } });
  const drawing = overlay(tools);
  assert.deepEqual(ringAt(drawing), ring);
  const active = handleRects(drawing).filter(([, , , width]) => width === 10);
  assert.equal(active.length, 1);
  assert.deepEqual(active[0].slice(1, 3), [265, 195]);
  send(tools, 'up', 270, 205);
  near(env.record('f_1').width, 1.2);
  near(env.record('f_1').height, 0.6);
  near(env.record('f_1').center[0], 0.1);
  assert.deepEqual(env.record('f_4'), before.f_4);
  assert.deepEqual(env.record('f_2'), before.f_2);
  assert.deepEqual(model.prop(uid('b_1'), 'position'), [0, 0]);
  assert.deepEqual(selection.objects, [uid('f_1'), uid('f_4')]);
  assert.equal(history.state.undoLabel, 'Resize');
  history.undo();
  assert.equal(env.record('f_1').width, 1);
  assert.equal(history.canUndo, false);
  path(tools, [[250, 200], [280, 200], [250, 200]]);
  assert.equal(history.canUndo, false);
  path(tools, [[250, 200]]);
  assert.equal(history.canUndo, false);
  assert.equal(env.record('f_1').width, 1);
});

test('Esc, Undo, a tool switch and a mode change mid-resize restore the shape', () => {
  const aborts = [
    (env) => env.actions.run('escape'),
    (env) => env.history.undo(),
    (env) => env.tools.activate('select-box'),
    (env) => env.modes.openClip(env.clip),
  ];
  for (const abort of aborts) {
    const env = resizeEnv();
    env.clip = addClipTo(env.history);
    const { tools, selection, uid } = env;
    selection.set([uid('f_1')]);
    const before = env.geometryOf();
    send(tools, 'down', 250, 170);
    send(tools, 'move', 290, 140);
    assert.notEqual(env.geometryOf(), before);
    abort(env);
    send(tools, 'move', 300, 120);
    send(tools, 'up', 300, 120);
    const name = abort.toString();
    assert.equal(env.geometryOf(), before, name);
    assert.deepEqual(selection.objects, [uid('f_1')], name);
    assert.equal(env.history.state.undoLabel, 'Add clip', name);
  }
});

test('Animate and Simulate show no resize handles and resize nothing', () => {
  const env = resizeEnv();
  const { tools, selection, uid, modes, history } = env;
  selection.set([uid('b_1')]);
  modes.openClip(addClipTo(history));
  const before = env.geometryOf();
  for (const mode of ['animate', 'simulate']) {
    if (mode === 'simulate') modes.startSimulate();
    assert.equal(handleRects(overlay(tools)).length, 0, mode);
    assert.equal(tools.handleAt({ x: 250, y: 170 }), null, mode);
    selection.set([uid('b_1')]);
    path(tools, [[250, 170], [290, 140]]);
    assert.equal(env.geometryOf(), before, mode);
  }
});

const LIMIT_CENTER = { x: 350, y: 200 };

function ringPoint(degrees, radius = 72) {
  const angle = (degrees * Math.PI) / 180;
  return [LIMIT_CENTER.x + radius * Math.cos(angle), LIMIT_CENTER.y - radius * Math.sin(angle)];
}

function limitChain(limits = { enabled: true, lower: -Math.PI / 6, upper: Math.PI / 4 }) {
  const env = chain();
  env.history.execute(setProps([env.joints[1]], { limits }, 'Set limits'));
  env.selection.set([env.joints[1]]);
  return env;
}

function limitsOf(env) {
  return env.model.get(env.joints[1]).props.limits;
}

function limitDegrees(env) {
  const { lower, upper } = limitsOf(env);
  return [Math.round((lower * 180) / Math.PI * 1e6) / 1e6 + 0, Math.round((upper * 180) / Math.PI * 1e6) / 1e6 + 0];
}

test('limits: one joint with a child body shows the ring, which edits the limits only when the range can rotate', () => {
  const cases = [
    [{ enabled: true, lower: -Math.PI / 6, upper: Math.PI / 4 }, 'ring'],
    [{ enabled: false, lower: 0, upper: 0 }, 'ring'],
    [{ enabled: true, lower: -Math.PI, upper: Math.PI }, 'ring'],
  ];
  for (const [limits, expected] of cases) {
    const { tools } = limitChain(limits);
    assert.equal(tools.handleAt({ x: 350, y: 128 }), expected, JSON.stringify(limits));
  }
  const env = limitChain();
  env.history.execute(setProps([env.joints[1]], { bodyB: null }));
  assert.equal(env.tools.handleAt({ x: 278, y: 200 }), null);
  const [x, y] = ringPoint(45);
  assert.equal(env.tools.handleAt({ x, y }), null);
});

test('limits: handles and the reference line use the root +X as zero, not the direction to bodyB', () => {
  const env = limitChain();
  env.history.execute(setProps([env.bodies[2]], { position: [1.5, 1] }));
  env.history.execute(setProps([env.bodies[3]], { position: [1.5, 2] }));
  env.selection.set([env.joints[1]]);
  const [ux, uy] = ringPoint(45);
  const [lx, ly] = ringPoint(-30);
  assert.equal(env.tools.handleAt({ x: ux, y: uy }), 'limit-upper');
  assert.equal(env.tools.handleAt({ x: lx, y: ly }), 'limit-lower');
  const calls = overlay(env.tools);
  const line = calls.findIndex(([method, x, y]) => method === 'moveTo' && x === 356 && y === 200);
  assert.ok(line > 0);
  assert.deepEqual(calls[line + 1], ['lineTo', 422, 200]);
  env.history.execute(setProps([ROOT_UID], { angle: Math.PI / 2 }));
  env.selection.set([env.joints[1]]);
  const anchor = env.camera.worldToScreen({ x: 0, y: 1.5 });
  const turned = (Math.PI / 2) + Math.PI / 4;
  const upper = { x: anchor.x + 72 * Math.cos(turned), y: anchor.y - 72 * Math.sin(turned) };
  assert.equal(env.tools.handleAt(upper), 'limit-upper');
});

test('limits: handles win over the ring, the square still wins, and a lower / upper tie goes to lower', () => {
  const { tools } = limitChain();
  const [ux, uy] = ringPoint(45);
  assert.equal(tools.handleAt({ x: ux, y: uy }), 'limit-upper');
  assert.equal(tools.handleAt({ x: ux + 5, y: uy }), 'limit-upper');
  const [lx, ly] = ringPoint(-30);
  assert.equal(tools.handleAt({ x: lx, y: ly }), 'limit-lower');
  assert.equal(tools.handleAt({ x: 372, y: 172 }), 'square');
  const pin = limitChain({ enabled: false, lower: 0, upper: 0 });
  assert.equal(pin.tools.handleAt({ x: 422, y: 200 }), 'limit-lower');
});

test('limits: a handle drag moves one limit, enables limits, SHIFT live, one Edit limits step', () => {
  const env = limitChain({ enabled: false, lower: -Math.PI / 6, upper: Math.PI / 4 });
  const { tools, history } = env;
  path(tools, [ringPoint(45), ringPoint(35), ringPoint(25)]);
  assert.deepEqual(limitDegrees(env), [-30, 25]);
  assert.equal(limitsOf(env).enabled, true);
  assert.equal(history.state.undoLabel, 'Edit limits');
  history.undo();
  assert.deepEqual(limitDegrees(env), [-30, 45]);
  assert.equal(limitsOf(env).enabled, false);
  path(tools, [ringPoint(45), ringPoint(35), ringPoint(25)], { shift: true });
  assert.deepEqual(limitDegrees(env), [-30, 30]);
  history.undo();
  path(tools, [ringPoint(45), ringPoint(60), ringPoint(45)]);
  assert.equal(history.state.undoLabel, 'Set limits');
  assert.equal(limitsOf(env).enabled, false);
});

test('limits: an ALT handle drag mirrors the other limit from non-zero limits, and ALT does nothing on the ring', () => {
  const env = limitChain({ enabled: true, lower: (-20 * Math.PI) / 180, upper: (70 * Math.PI) / 180 });
  const { tools, history } = env;
  path(tools, [ringPoint(70), ringPoint(60), ringPoint(50)], { alt: true });
  assert.deepEqual(limitDegrees(env), [-50, 50]);
  assert.equal(history.state.undoLabel, 'Edit limits');
  history.undo();
  send(tools, 'down', ...ringPoint(70));
  send(tools, 'move', ...ringPoint(50), { alt: true });
  assert.deepEqual(limitDegrees(env), [-50, 50]);
  send(tools, 'move', ...ringPoint(50));
  assert.deepEqual(limitDegrees(env), [-20, 50]);
  send(tools, 'up', ...ringPoint(50));
  history.undo();
  path(tools, [ringPoint(180), ringPoint(185), ringPoint(190)], { alt: true });
  assert.deepEqual(limitDegrees(env), [-10, 80]);
});

test('limits: a ring drag rotates the range with the clamp, SHIFT live', () => {
  const env = limitChain();
  const { tools, history, model, bodies, joints } = env;
  const anchors = joints.map((uid) => model.prop(uid, 'anchor'));
  path(tools, [ringPoint(180), ringPoint(205), ringPoint(230)]);
  assert.deepEqual(limitDegrees(env), [0, 75]);
  assert.equal(history.state.undoLabel, 'Edit limits');
  assert.deepEqual(joints.map((uid) => model.prop(uid, 'anchor')), anchors);
  assert.deepEqual(model.prop(bodies[2], 'position'), [2, 0]);
  history.undo();
  path(tools, [ringPoint(180), ringPoint(170), ringPoint(160)], { shift: true });
  assert.deepEqual(limitDegrees(env), [-45, 30]);
});

test('limits: Esc, Undo, a tool switch and a mode change mid-drag restore the limits', () => {
  const aborts = [
    (env) => env.actions.run('escape'),
    (env) => env.history.undo(),
    (env) => env.tools.activate('select-box'),
    (env) => env.modes.openClip(env.clip),
  ];
  for (const abort of aborts) {
    for (const start of [ringPoint(45), ringPoint(180)]) {
      const env = limitChain();
      env.clip = addClipTo(env.history);
      env.selection.set([env.joints[1]]);
      const before = JSON.stringify(limitsOf(env));
      send(env.tools, 'down', ...start);
      send(env.tools, 'move', ...ringPoint(start[0] > 350 ? 20 : 200));
      assert.notEqual(JSON.stringify(limitsOf(env)), before);
      abort(env);
      send(env.tools, 'move', ...ringPoint(0));
      send(env.tools, 'up', ...ringPoint(0));
      const name = `${abort.toString()} ${start}`;
      assert.equal(JSON.stringify(limitsOf(env)), before, name);
      assert.equal(env.history.state.undoLabel, 'Add clip', name);
    }
  }
});

test('limits: two joints rotate their anchors; no limit editor for a joint plus a body, the root, Animate or Simulate', () => {
  const env = limitChain();
  const { tools, selection, history, model, joints, shapes, modes } = env;
  const [ux, uy] = ringPoint(45);
  selection.set([joints[0], joints[1]]);
  assert.equal(tools.handleAt({ x: 222, y: 200 }), 'ring');
  path(tools, [[222, 200], [200, 150], [150, 128]]);
  assert.equal(history.state.undoLabel, 'Rotate');
  assert.notDeepEqual(model.prop(joints[1], 'anchor'), [1.5, 0]);
  history.undo();
  for (const objects of [[joints[1], shapes[2]], [ROOT_UID]]) {
    selection.set(objects);
    assert.notEqual(tools.handleAt({ x: ux, y: uy }), 'limit-upper', JSON.stringify(objects));
    assert.equal(overlay(tools).some(([method]) => method === 'arc'), false);
  }
  modes.openClip(addClipTo(history));
  for (const mode of ['animate', 'simulate']) {
    if (mode === 'simulate') modes.startSimulate();
    selection.set([joints[1]]);
    assert.equal(tools.handleAt({ x: ux, y: uy }), null, mode);
    assert.deepEqual(overlay(tools), [], mode);
  }
});

test('limits: overlay draws the range under the gizmo and the handles with hover and active', () => {
  const env = limitChain({ enabled: false, lower: -Math.PI / 6, upper: Math.PI / 4 });
  const { tools } = env;
  const calls = overlay(tools);
  assert.deepEqual(calls[0], ['moveTo', 350, 200]);
  assert.equal(calls[1][0], 'arc');
  assert.deepEqual(calls[3], ['fill', { color: COLORS.gizmoZ, alpha: 0.075 }]);
  const handles = calls.filter(([method, , , radius]) => method === 'circle' && (radius === 5 || radius === 6));
  assert.equal(handles.length, 2);
  hover(tools, ...ringPoint(45));
  const hot = overlay(tools).filter(([method, , , radius]) => method === 'circle' && radius === 6);
  assert.equal(hot.length, 1);
  near(hot[0][1], ringPoint(45)[0]);
  send(tools, 'down', ...ringPoint(45));
  send(tools, 'move', ...ringPoint(30));
  const active = overlay(tools).filter(([method, , , radius]) => method === 'circle' && radius === 6);
  near(active[0][1], ringPoint(30)[0]);
  send(tools, 'up', ...ringPoint(30));
});

test('limits: cursors and readout', () => {
  const env = limitChain();
  const { tools, calls } = env;
  hover(tools, ...ringPoint(45));
  assert.equal(calls.cursor.at(-1), 'pointer');
  hover(tools, ...ringPoint(-30));
  assert.equal(calls.cursor.at(-1), 'pointer');
  hover(tools, ...ringPoint(180));
  assert.equal(calls.cursor.at(-1), 'pointer');
  send(tools, 'down', ...ringPoint(45));
  assert.equal(calls.cursor.at(-1), 'pointer');
  assert.equal(tools.readout(), null);
  const to = ringPoint(25);
  send(tools, 'move', ...to);
  assert.deepEqual(tools.readout(), { text: 'lower: -30.0°  upper: 25.0°', screen: { x: to[0] + 16, y: to[1] + 16 } });
  send(tools, 'up', ...to);
  assert.equal(tools.readout(), null);
});