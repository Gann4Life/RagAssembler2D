import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { boxTest, hitTest } from '../js/viewport/hit.js';
import { COLORS, LINE_WIDTH } from '../js/viewport/style.js';
import { applyClick, clickTarget, selectTool } from '../js/tools/select.js';
import { applyBox, boxAabb, marqueeTool, selectBoxTool } from '../js/tools/select-box.js';
import { defaultsOf } from '../lib/schema.js';

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
  const { tools, selection, uid } = environment();
  send(tools, 'down', 100, 200);
  send(tools, 'move', 103, 200);
  send(tools, 'up', 103, 200);
  assert.deepEqual(selection.objects, [uid('f_1')]);
  selection.clear();
  send(tools, 'down', 100, 200);
  send(tools, 'move', 104, 200);
  send(tools, 'move', 100, 200);
  send(tools, 'up', 100, 200);
  assert.deepEqual(selection.objects, []);
  selection.set([uid('f_2')]);
  send(tools, 'down', 100, 200);
  send(tools, 'up', 104, 200);
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
    [60, 20, 30, 100].forEach((value, index) => near(g.calls[0][index + 1], value, `panned ${index}`));
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
