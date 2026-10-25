import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { setProps } from '../js/commands/props.js';
import { Selection } from '../js/model/selection.js';
import { Modes } from '../js/modes.js';
import { Settings } from '../js/settings.js';
import { Camera } from '../js/viewport/camera.js';
import { COLORS, LINE_WIDTH } from '../js/viewport/style.js';
import { defineTool } from '../js/tools/tool.js';
import { ToolRegistry } from '../js/tools/registry.js';
import { dragShapeTool } from '../js/tools/drag-shape.js';
import { circleDraft, circleTool } from '../js/tools/circle.js';
import { boxDraft, boxTool } from '../js/tools/box.js';
import { defaultsOf } from '../lib/schema.js';

const EPSILON = 1e-9;
const NO_MODIFIERS = { shift: false, ctrl: false, alt: false };

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message ?? ''} expected ${expected}, got ${actual}`);
}

function nearAll(actual, expected, message) {
  assert.equal(actual.length, expected.length, message);
  expected.forEach((value, index) => near(actual[index], value, message));
}

function px(worldX) {
  return 200 + worldX * 100;
}

function py(worldY) {
  return 200 - worldY * 100;
}

function environment({ snap = false } = {}) {
  const model = new Model();
  const history = new History(model);
  const selection = new Selection(model);
  const modes = new Modes(model);
  const settings = new Settings();
  settings.set('snap.grid', snap);
  const camera = new Camera();
  camera.setSize(400, 400);
  camera.zoomAt({ x: 200, y: 200 }, 100 / camera.scale);
  const registry = new ToolRegistry({ model, history, selection, modes, settings, camera }, [
    defineTool({ id: 'select' }),
    circleTool(),
    boxTool(),
  ]);
  const calls = { cursor: [], invalidations: 0 };
  registry.bindView({
    hitTest: () => [],
    setCursor: (css) => calls.cursor.push(css),
    invalidateOverlay: () => {
      calls.invalidations++;
    },
  });
  return { model, history, selection, modes, settings, camera, registry, calls };
}

function send(registry, type, x, y, extra = {}) {
  registry.pointer({
    type,
    screen: { x, y },
    button: type === 'move' ? -1 : (extra.button ?? 0),
    buttons: type === 'up' ? 0 : 1,
    ...NO_MODIFIERS,
    clicks: 1,
    ...extra,
  });
}

function hover(registry, x, y) {
  send(registry, 'move', x, y, { buttons: 0 });
}

function gesture(registry, points, extra = {}) {
  const [first, ...rest] = points;
  send(registry, 'down', first[0], first[1], extra);
  for (const [x, y] of rest.slice(0, -1)) send(registry, 'move', x, y, extra);
  const last = rest.at(-1) ?? first;
  send(registry, 'up', last[0], last[1], extra);
}

function bodiesOf(model) {
  return model.children(ROOT_UID, 'bodies');
}

function createdShape(model) {
  const [bodyUid] = bodiesOf(model).slice(-1);
  const [shapeUid] = model.children(bodyUid, 'fixtures');
  return {
    bodyUid,
    shapeUid,
    position: model.prop(bodyUid, 'position'),
    angle: model.prop(bodyUid, 'angle'),
    shape: model.prop(shapeUid, 'shape'),
  };
}

function addClip(history) {
  const { tracks, events, ...props } = defaultsOf('clip');
  return history.execute({
    label: 'Add clip',
    run: (tx) => tx.add(ROOT_UID, 'clips', undefined, { type: 'clip', props: { ...props, length: 1 } }),
  });
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

function overlayOf(registry) {
  const g = fakeGraphics();
  registry.drawOverlay(g);
  return g.calls;
}

const FILL = ['fill', { color: COLORS.highlight, alpha: 0.2 }];
const STROKE = ['stroke', { width: LINE_WIDTH.outline, color: COLORS.highlight }];

function nearCall(call, expected) {
  assert.equal(call[0], expected[0]);
  assert.equal(call.length, expected.length);
  expected.slice(1).forEach((value, index) => near(call[index + 1], value, `${expected[0]} argument ${index}`));
}

const ANCHOR = { x: 0, y: 0 };

test('circleDraft: radius is the snapped distance from the anchor to the pointer', () => {
  const identity = (length) => length;
  const draft = circleDraft({ x: 1, y: 1 }, { x: 4, y: 5 }, identity);
  assert.deepEqual(draft, { center: { x: 1, y: 1 }, shape: { type: 'circle', radius: 5 } });
  const rounded = circleDraft(ANCHOR, { x: 0.37, y: 0 }, (length) => Math.max(0.1, Math.round(length * 10) / 10));
  assert.equal(rounded.shape.radius, 0.4);
  const snappedToMinimum = circleDraft(ANCHOR, { x: 0.01, y: 0 }, (length) => Math.max(0.1, length));
  assert.equal(snappedToMinimum.shape.radius, 0.1);
});

test('circleDraft: a radius of 0 is refused and the center is a copy of the anchor', () => {
  assert.equal(circleDraft({ x: 2, y: 2 }, { x: 2, y: 2 }, (length) => length), null);
  const anchor = { x: 3, y: -1 };
  const draft = circleDraft(anchor, { x: 4, y: -1 }, (length) => length);
  assert.notEqual(draft.center, anchor);
  assert.deepEqual(draft.center, anchor);
});

const BOX_TABLE = [
  ['none', {}, { x: 1, y: 0.5 }, 2, 1],
  ['shift', { shift: true }, { x: 1, y: 1 }, 2, 2],
  ['ctrl', { ctrl: true }, { x: 0, y: 0 }, 4, 2],
  ['alt', { alt: true }, { x: 0, y: 0 }, 4, 2],
  ['ctrl+alt', { ctrl: true, alt: true }, { x: 0, y: 0 }, 4, 2],
  ['shift+ctrl', { shift: true, ctrl: true }, { x: 0, y: 0 }, 4, 4],
  ['shift+alt', { shift: true, alt: true }, { x: 0, y: 0 }, 4, 4],
  ['shift+ctrl+alt', { shift: true, ctrl: true, alt: true }, { x: 0, y: 0 }, 4, 4],
];

for (const [name, modifiers, center, width, height] of BOX_TABLE) {
  test(`boxDraft: the DESIGN example with ${name}`, () => {
    assert.deepEqual(boxDraft(ANCHOR, { x: 2, y: 1 }, modifiers), { center, shape: { type: 'box', width, height } });
  });
}

test('boxDraft: ALT, CTRL and both give the same box for any pointer', () => {
  for (const pointer of [{ x: 2, y: 1 }, { x: -3, y: 0.5 }, { x: 0.25, y: -4 }, { x: -1, y: -2 }]) {
    for (const shift of [false, true]) {
      const viaCtrl = boxDraft({ x: 1, y: -1 }, pointer, { shift, ctrl: true });
      assert.deepEqual(boxDraft({ x: 1, y: -1 }, pointer, { shift, alt: true }), viaCtrl);
      assert.deepEqual(boxDraft({ x: 1, y: -1 }, pointer, { shift, ctrl: true, alt: true }), viaCtrl);
      assert.deepEqual(viaCtrl.center, { x: 1, y: -1 });
    }
  }
});

test('boxDraft: the box grows toward the pointer in each of the four quadrants', () => {
  const anchor = { x: 1, y: 1 };
  const cases = [
    [{ x: 3, y: 2 }, { x: 2, y: 1.5 }],
    [{ x: -1, y: 2 }, { x: 0, y: 1.5 }],
    [{ x: 3, y: 0 }, { x: 2, y: 0.5 }],
    [{ x: -1, y: 0 }, { x: 0, y: 0.5 }],
  ];
  for (const [pointer, center] of cases) {
    const draft = boxDraft(anchor, pointer, NO_MODIFIERS);
    assert.deepEqual(draft.center, center);
    assert.deepEqual([draft.shape.width, draft.shape.height], [2, 1]);
  }
});

test('boxDraft: SHIFT grows the square away from the anchor on both axes', () => {
  const draft = boxDraft({ x: 1, y: 1 }, { x: -1, y: 0 }, { shift: true });
  assert.deepEqual(draft, { center: { x: 0, y: 0 }, shape: { type: 'box', width: 2, height: 2 } });
  const tall = boxDraft({ x: 0, y: 0 }, { x: 1, y: -3 }, { shift: true });
  assert.deepEqual(tall, { center: { x: 1.5, y: -1.5 }, shape: { type: 'box', width: 3, height: 3 } });
});

test('boxDraft: sign(0) is +1 and a zero size is refused', () => {
  const draft = boxDraft(ANCHOR, { x: 0, y: 1 }, { shift: true });
  assert.deepEqual(draft, { center: { x: 0.5, y: 0.5 }, shape: { type: 'box', width: 1, height: 1 } });
  assert.equal(boxDraft(ANCHOR, { x: 0, y: 1 }, NO_MODIFIERS), null);
  assert.equal(boxDraft(ANCHOR, { x: 1, y: 0 }, NO_MODIFIERS), null);
  assert.equal(boxDraft(ANCHOR, { x: 0, y: 1 }, { ctrl: true }), null);
  assert.equal(boxDraft(ANCHOR, { x: 0, y: 1 }, { alt: true }), null);
  assert.equal(boxDraft(ANCHOR, { x: 0, y: 0 }, { shift: true }), null);
  assert.equal(boxDraft(ANCHOR, { x: 0, y: 0 }, { shift: true, ctrl: true }), null);
  assert.deepEqual(boxDraft(ANCHOR, { x: 0, y: 1 }, { shift: true, ctrl: true }).shape, { type: 'box', width: 2, height: 2 });
});

test('boxDraft: centers never contain -0', () => {
  const draft = boxDraft({ x: -0, y: -0 }, { x: 1, y: 1 }, { ctrl: true });
  assert.ok(!Object.is(draft.center.x, -0) && !Object.is(draft.center.y, -0));
  const edge = boxDraft({ x: -1, y: 0 }, { x: -2, y: -1 }, { shift: true });
  assert.ok(!Object.is(edge.center.x, -0) && !Object.is(edge.center.y, -0));
});

test('tools have their own state per factory call, a crosshair cursor and no hover', () => {
  for (const tool of [circleTool(), boxTool()]) {
    assert.equal(tool.cursor, 'crosshair');
    assert.equal(tool.hover, false);
    assert.equal(tool.keyDown({ key: 'a' }), false);
    assert.equal(tool.cancel(), false);
  }
  assert.notEqual(circleTool(), circleTool());
  assert.equal(circleTool().id, 'circle');
  assert.equal(boxTool().id, 'box');
  assert.equal(dragShapeTool({ id: 'circle', click: () => null, drag: () => null }).hover, false);
});

test('activating a creation tool applies the crosshair cursor on the view', () => {
  const { registry, calls } = environment();
  assert.equal(registry.activate('circle'), true);
  assert.equal(calls.cursor.at(-1), 'crosshair');
  assert.equal(registry.active.hover, false);
  assert.equal(registry.activate('select'), true);
  assert.equal(calls.cursor.at(-1), 'default');
});

test('circle click creates the default radius at the click point without snapping', () => {
  const { model, registry, selection } = environment();
  registry.activate('circle');
  gesture(registry, [[px(0.37), py(0.52)]]);
  const created = createdShape(model);
  assert.equal(created.shape.type, 'circle');
  assert.equal(created.shape.radius, defaultsOf('shape', 'circle').shape.radius);
  assert.deepEqual(created.shape.center, [0, 0]);
  nearAll(created.position, [0.37, 0.52]);
  near(created.angle, 0);
  assert.deepEqual(selection.objects, [created.shapeUid]);
});

test('circle click snaps the center to the minor grid when grid snap is on', () => {
  const { model, registry } = environment({ snap: true });
  registry.activate('circle');
  gesture(registry, [[px(0.37), py(0.52)]]);
  nearAll(createdShape(model).position, [0.4, 0.5]);
  assert.equal(createdShape(model).shape.radius, 0.25);
});

test('box click creates the default size centered at the snapped click point under every modifier', () => {
  for (const modifiers of [{}, { shift: true }, { ctrl: true }, { alt: true }, { shift: true, ctrl: true, alt: true }]) {
    const { model, registry } = environment({ snap: true });
    registry.activate('box');
    gesture(registry, [[px(-0.63), py(1.24)]], modifiers);
    const created = createdShape(model);
    const { width, height } = defaultsOf('shape', 'box').shape;
    assert.deepEqual([created.shape.width, created.shape.height], [width, height]);
    nearAll(created.position, [-0.6, 1.2]);
  }
});

test('circle drag sets the radius from the anchor to the pointer, grid snap off', () => {
  const { model, registry } = environment();
  registry.activate('circle');
  gesture(registry, [[px(0), py(0)], [px(0.6), py(0.8)], [px(0.6), py(0.8)]]);
  const created = createdShape(model);
  near(created.shape.radius, 1);
  nearAll(created.position, [0, 0]);
});

test('circle drag with grid snap on rounds the radius from the snapped anchor and the raw pointer', () => {
  const { model, registry } = environment({ snap: true });
  registry.activate('circle');
  gesture(registry, [[px(0.37), py(0)], [px(1.37), py(0)], [px(1.37), py(0)]]);
  near(createdShape(model).shape.radius, 1);
  nearAll(createdShape(model).position, [0.4, 0]);
  gesture(registry, [[px(0), py(0)], [px(0.05), py(0)], [px(0.05), py(0)]]);
  near(createdShape(model).shape.radius, 0.1);
});

test('box drag defines the rectangle against the pointer, snap off', () => {
  const { model, registry } = environment();
  registry.activate('box');
  gesture(registry, [[px(0), py(0)], [px(2), py(1)], [px(2), py(1)]]);
  const created = createdShape(model);
  nearAll(created.position, [1, 0.5]);
  near(created.shape.width, 2);
  near(created.shape.height, 1);
  near(created.shape.angle, 0);
  assert.deepEqual(created.shape.center, [0, 0]);
});

test('box drag snaps the pointer to the grid when grid snap is on', () => {
  const { model, registry } = environment({ snap: true });
  registry.activate('box');
  gesture(registry, [[px(0.02), py(0.01)], [px(2.04), py(-1.03)], [px(2.04), py(-1.03)]]);
  const created = createdShape(model);
  nearAll(created.position, [1, -0.5]);
  near(created.shape.width, 2);
  near(created.shape.height, 1);
});

test('box drag applies the modifiers held on the release', () => {
  for (const [, modifiers, center, width, height] of BOX_TABLE) {
    const { model, registry } = environment();
    registry.activate('box');
    gesture(registry, [[px(0), py(0)], [px(2), py(1)], [px(2), py(1)]], modifiers);
    const created = createdShape(model);
    nearAll(created.position, [center.x, center.y]);
    near(created.shape.width, width);
    near(created.shape.height, height);
  }
});

test('box drag toward the bottom left keeps the size positive', () => {
  const { model, registry } = environment();
  registry.activate('box');
  gesture(registry, [[px(0), py(0)], [px(-2), py(-1)], [px(-2), py(-1)]]);
  const created = createdShape(model);
  nearAll(created.position, [-1, -0.5]);
  near(created.shape.width, 2);
  near(created.shape.height, 1);
});

test('a move under 4 px stays a click and the 4 px threshold latches a drag', () => {
  const { model, registry } = environment();
  registry.activate('circle');
  gesture(registry, [[200, 200], [203, 200], [203, 200]]);
  near(createdShape(model).shape.radius, 0.25);
  gesture(registry, [[200, 200], [204, 200], [204, 200]]);
  near(createdShape(model).shape.radius, 0.04);
});

test('a drag that comes back near the press stays a drag', () => {
  const { model, registry } = environment();
  registry.activate('circle');
  gesture(registry, [[200, 200], [260, 200], [201, 200], [201, 200]]);
  near(createdShape(model).shape.radius, 0.01);
});

test('a drag that comes back exactly to the anchor is refused without grid snap', () => {
  const { model, registry, history, selection } = environment();
  registry.activate('circle');
  gesture(registry, [[200, 200], [260, 200], [200, 200], [200, 200]]);
  assert.deepEqual(bodiesOf(model), []);
  assert.equal(history.state.canUndo, false);
  assert.deepEqual(selection.objects, []);
});

test('a modifier change re-sent as a move updates the preview and the result', () => {
  const { model, registry } = environment();
  registry.activate('box');
  send(registry, 'down', px(0), py(0));
  send(registry, 'move', px(2), py(1));
  nearCall(overlayOf(registry)[0], ['rect', px(0), py(1), 200, 100]);
  send(registry, 'move', px(2), py(1), { ctrl: true });
  nearCall(overlayOf(registry)[0], ['rect', px(-2), py(1), 400, 200]);
  send(registry, 'move', px(2), py(1), { shift: true });
  nearCall(overlayOf(registry)[0], ['rect', px(0), py(2), 200, 200]);
  send(registry, 'up', px(2), py(1), { shift: true });
  const created = createdShape(model);
  nearAll(created.position, [1, 1]);
  near(created.shape.width, 2);
  near(created.shape.height, 2);
});

test('a refused drag records nothing and keeps the selection', () => {
  const { model, registry, history, selection } = environment();
  registry.activate('box');
  selection.set([ROOT_UID]);
  gesture(registry, [[px(0), py(0)], [px(2), py(0)], [px(2), py(0)]]);
  assert.deepEqual(bodiesOf(model), []);
  assert.equal(history.state.canUndo, false);
  assert.equal(history.state.gesture, false);
  assert.deepEqual(selection.objects, [ROOT_UID]);
  assert.equal(model.prop(ROOT_UID, 'rootBody'), null);
});

test('one operation is one undo step, selects the new shape and keeps the tool active', () => {
  const { model, registry, history, selection } = environment();
  registry.activate('box');
  gesture(registry, [[px(0), py(0)], [px(1), py(1)], [px(1), py(1)]]);
  assert.equal(registry.active.id, 'box');
  assert.deepEqual(selection.objects, [createdShape(model).shapeUid]);
  assert.equal(history.state.undoLabel, 'Create box');
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'b_1');
  gesture(registry, [[px(2), py(2)], [px(3), py(3)], [px(3), py(3)]]);
  assert.equal(bodiesOf(model).length, 2);
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'b_1');
  assert.equal(history.undo(), true);
  assert.equal(bodiesOf(model).length, 1);
  assert.equal(history.undo(), true);
  assert.deepEqual(bodiesOf(model), []);
  assert.equal(model.prop(ROOT_UID, 'rootBody'), null);
  assert.equal(history.state.canUndo, false);
  assert.deepEqual(selection.objects, []);
});

test('a click creates one undo step too', () => {
  const { model, registry, history } = environment();
  registry.activate('circle');
  gesture(registry, [[px(1), py(1)]]);
  assert.equal(history.state.undoLabel, 'Create circle');
  history.undo();
  assert.deepEqual(bodiesOf(model), []);
  assert.equal(history.state.canUndo, false);
});

test('Esc mid-drag creates nothing, and the next press works', () => {
  const { model, registry, history, selection, calls } = environment();
  registry.activate('box');
  selection.set([ROOT_UID]);
  send(registry, 'down', px(0), py(0));
  send(registry, 'move', px(2), py(1));
  assert.equal(registry.cancel(), true);
  assert.deepEqual(overlayOf(registry), []);
  send(registry, 'move', px(3), py(1));
  send(registry, 'up', px(3), py(1));
  assert.deepEqual(bodiesOf(model), []);
  assert.deepEqual(selection.objects, [ROOT_UID]);
  assert.equal(history.state.canUndo, false);
  assert.ok(calls.invalidations > 0);
  gesture(registry, [[px(0), py(0)], [px(1), py(1)], [px(1), py(1)]]);
  assert.equal(bodiesOf(model).length, 1);
});

test('Undo mid-drag aborts the drag and undoes nothing else', () => {
  const { model, registry, history } = environment();
  registry.activate('circle');
  gesture(registry, [[px(0), py(0)]]);
  send(registry, 'down', px(1), py(1));
  send(registry, 'move', px(2), py(1));
  assert.equal(history.undo(), true);
  send(registry, 'up', px(2), py(1));
  assert.equal(bodiesOf(model).length, 1);
  assert.equal(history.state.canUndo, true);
  assert.deepEqual(overlayOf(registry), []);
});

test('a mode change mid-drag aborts it and the creation tool stays active but unusable', () => {
  const { model, registry, modes, history } = environment();
  const clip = addClip(history);
  registry.activate('box');
  send(registry, 'down', px(0), py(0));
  send(registry, 'move', px(2), py(1));
  modes.openClip(clip);
  send(registry, 'up', px(2), py(1));
  assert.deepEqual(bodiesOf(model), []);
  assert.equal(registry.active.id, 'box');
  assert.equal(registry.usable, false);
  assert.deepEqual(overlayOf(registry), []);
  assert.equal(registry.canActivate('box'), false);
  assert.equal(registry.canActivate('circle'), false);
});

test('switching tools mid-drag aborts the drag', () => {
  const { model, registry } = environment();
  registry.activate('circle');
  send(registry, 'down', px(0), py(0));
  send(registry, 'move', px(2), py(0));
  registry.activate('box');
  send(registry, 'up', px(2), py(0));
  assert.deepEqual(bodiesOf(model), []);
  assert.deepEqual(overlayOf(registry), []);
});

test('the right button is ignored, alone or during a left drag', () => {
  const { model, registry, history } = environment();
  registry.activate('circle');
  send(registry, 'down', px(0), py(0), { button: 2, buttons: 2 });
  send(registry, 'up', px(0), py(0), { button: 2 });
  assert.deepEqual(overlayOf(registry), []);
  assert.deepEqual(bodiesOf(model), []);
  send(registry, 'down', px(0), py(0));
  send(registry, 'move', px(1), py(0));
  send(registry, 'down', px(5), py(5), { button: 2, buttons: 3 });
  send(registry, 'up', px(5), py(5), { button: 2 });
  send(registry, 'up', px(1), py(0));
  assert.equal(bodiesOf(model).length, 1);
  near(createdShape(model).shape.radius, 1);
  assert.equal(history.state.undoLabel, 'Create circle');
});

test('hover moves without a press draw nothing and create nothing', () => {
  const { model, registry } = environment();
  registry.activate('box');
  hover(registry, px(1), py(1));
  hover(registry, px(2), py(2));
  assert.deepEqual(overlayOf(registry), []);
  assert.deepEqual(bodiesOf(model), []);
});

test('under a moved and rotated root the body keeps the on-screen orientation', () => {
  const { model, registry, history } = environment();
  history.execute(setProps([ROOT_UID], { position: [1, 2], angle: Math.PI / 2 }, 'Move root'));
  registry.activate('box');
  gesture(registry, [[px(0), py(0)], [px(1), py(0.5)], [px(1), py(0.5)]]);
  const created = createdShape(model);
  nearAll(created.position, [-1.75, 0.5]);
  near(created.angle, -Math.PI / 2);
  near(created.angle + model.prop(ROOT_UID, 'angle'), 0);
  near(created.shape.width, 1);
  near(created.shape.height, 0.5);
  near(created.shape.angle, 0);
});

test('under a rotated root the anchor is snapped in world coordinates before the conversion', () => {
  const { model, registry, history } = environment({ snap: true });
  history.execute(setProps([ROOT_UID], { position: [1, 2], angle: Math.PI / 2 }, 'Move root'));
  registry.activate('circle');
  gesture(registry, [[px(0.37), py(0.52)]]);
  const created = createdShape(model);
  nearAll(created.position, [-1.5, 0.6]);
  near(created.angle, -Math.PI / 2);
});

test('a root angle of 0 gives a body angle of +0', () => {
  const { model, registry } = environment();
  registry.activate('circle');
  gesture(registry, [[px(1), py(1)]]);
  assert.ok(Object.is(createdShape(model).angle, 0));
});

test('circle overlay: default preview on press, drag preview, nothing after release or cancel', () => {
  const { registry } = environment();
  registry.activate('circle');
  assert.deepEqual(overlayOf(registry), []);
  send(registry, 'down', px(1), py(1));
  const preview = overlayOf(registry);
  assert.equal(preview.length, 3);
  nearCall(preview[0], ['circle', px(1), py(1), 25]);
  assert.deepEqual(preview.slice(1), [FILL, STROKE]);
  send(registry, 'move', px(1) + 2, py(1));
  nearCall(overlayOf(registry)[0], ['circle', px(1), py(1), 25]);
  send(registry, 'move', px(1) + 50, py(1));
  nearCall(overlayOf(registry)[0], ['circle', px(1), py(1), 50]);
  send(registry, 'up', px(1) + 50, py(1));
  assert.deepEqual(overlayOf(registry), []);
  send(registry, 'down', px(0), py(0));
  registry.cancel();
  assert.deepEqual(overlayOf(registry), []);
});

test('box overlay: default preview on press and the drag rectangle from its top-left corner', () => {
  const { registry, camera } = environment();
  registry.activate('box');
  send(registry, 'down', px(0), py(0));
  const preview = overlayOf(registry);
  assert.equal(preview.length, 3);
  nearCall(preview[0], ['rect', 175, 175, 50, 50]);
  assert.deepEqual(preview.slice(1), [FILL, STROKE]);
  send(registry, 'move', px(2), py(-1));
  nearCall(overlayOf(registry)[0], ['rect', px(0), py(0), 200, 100]);
  send(registry, 'move', px(-2), py(1));
  nearCall(overlayOf(registry)[0], ['rect', px(-2), py(1), 200, 100]);
  send(registry, 'up', px(-2), py(1));
  assert.deepEqual(overlayOf(registry), []);
  camera.zoomAt({ x: 200, y: 200 }, 2);
  send(registry, 'down', 200, 200);
  nearCall(overlayOf(registry)[0], ['rect', 150, 150, 100, 100]);
  send(registry, 'move', 400, 100);
  nearCall(overlayOf(registry)[0], ['rect', 200, 100, 200, 100]);
  send(registry, 'up', 400, 100);
});

test('a refused drag draws nothing', () => {
  const { registry } = environment();
  registry.activate('box');
  send(registry, 'down', px(0), py(0));
  send(registry, 'move', px(2), py(0));
  assert.deepEqual(overlayOf(registry), []);
  send(registry, 'move', px(2), py(1));
  assert.equal(overlayOf(registry).length, 3);
});

test('presses and moves invalidate the overlay', () => {
  const { registry, calls } = environment();
  registry.activate('circle');
  const before = calls.invalidations;
  send(registry, 'down', px(0), py(0));
  const afterPress = calls.invalidations;
  send(registry, 'move', px(1), py(0));
  const afterMove = calls.invalidations;
  send(registry, 'up', px(1), py(0));
  assert.ok(afterPress > before);
  assert.ok(afterMove > afterPress);
  assert.ok(calls.invalidations > afterMove);
});
