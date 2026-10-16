import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { createJoint, createShapeBody } from '../js/commands/create.js';
import { setProps } from '../js/commands/props.js';
import { hingeLimits, hingePair, hingeTool } from '../js/tools/hinge.js';
import { placement } from '../js/viewport/placement.js';
import { COLORS, GIZMO_SIZE, LINE_WIDTH } from '../js/viewport/style.js';
import { defaultsOf } from '../lib/schema.js';

const EPSILON = 1e-9;
const NO_MODIFIERS = { shift: false, ctrl: false, alt: false };
const DEG = Math.PI / 180;
const STROKE = ['stroke', { width: LINE_WIDTH.outline, color: COLORS.highlight }];

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

function addCircle(history, x, y) {
  return history.execute(createShapeBody({ position: { x, y }, angle: 0, shape: { type: 'circle', radius: 0.75 } }));
}

function environment({ snap = false, positions = [[0, 0], [1, 0]] } = {}) {
  const editor = createEditor();
  const { model, history, settings, camera, tools } = editor;
  settings.set('snap.grid', snap);
  camera.setSize(400, 400);
  camera.zoomAt({ x: 200, y: 200 }, 100 / camera.scale);
  const shapes = positions.map(([x, y]) => addCircle(history, x, y));
  const bodies = shapes.map((uid) => model.get(uid).parent);
  const view = { hits: [], cursor: [], invalidations: 0 };
  tools.bindView({
    hitTest: () => view.hits,
    setCursor: (css) => view.cursor.push(css),
    invalidateOverlay: () => {
      view.invalidations++;
    },
  });
  tools.activate('hinge');
  return { ...editor, registry: tools, view, shapes, bodies };
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

function jointsOf(model) {
  return model.children(ROOT_UID, 'joints');
}

function lastJoint(model) {
  const uid = jointsOf(model).at(-1);
  return { uid, props: model.get(uid).props };
}

function addTwoShapeBody(model, history) {
  const { fixtures, ...bodyProps } = defaultsOf('body');
  const bodyUid = history.execute({
    label: 'Add body',
    run: (tx) =>
      tx.add(ROOT_UID, 'bodies', undefined, {
        type: 'body',
        props: { ...bodyProps, id: 'b_50', name: 'body_50' },
        children: { fixtures: [{ type: 'shape', props: { id: 'f_50' } }, { type: 'shape', props: { id: 'f_51' } }] },
      }),
  });
  return { bodyUid, shapes: [...model.children(bodyUid, 'fixtures')] };
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
  for (const method of ['circle', 'moveTo', 'lineTo', 'arc', 'stroke']) {
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

function nearCall(call, expected) {
  assert.equal(call[0], expected[0]);
  assert.equal(call.length, expected.length, `${expected[0]} argument count`);
  expected.slice(1).forEach((value, index) => {
    if (typeof value === 'number') near(call[index + 1], value, `${expected[0]} argument ${index}`);
    else assert.deepEqual(call[index + 1], value);
  });
}

test('hingePair skips non-shapes and takes the first two distinct bodies, ordered', () => {
  const { model, history, shapes, bodies } = environment({ positions: [[0, 0], [1, 0], [2, 0]] });
  const joint = history.execute(createJoint({ bodyA: bodies[1], bodyB: bodies[2], anchor: { x: 1.5, y: 0 } }));
  assert.deepEqual(hingePair(model, [ROOT_UID, joint, bodies[0], 999, shapes[1], shapes[0], shapes[2]]), {
    bodyA: bodies[0],
    bodyB: bodies[1],
  });
  assert.deepEqual(hingePair(model, [shapes[0], shapes[1]]), { bodyA: bodies[0], bodyB: bodies[1] });
  assert.equal(hingePair(model, [shapes[1], shapes[2], shapes[0]]), null);
  assert.equal(hingePair(model, [shapes[2], shapes[1]]), null);
  assert.equal(hingePair(model, []), null);
  assert.equal(hingePair(model, [shapes[0]]), null);
  assert.equal(hingePair(model, [ROOT_UID, joint, bodies[0], bodies[1]]), null);
});

test('hingePair counts two shapes of one body once', () => {
  const { model, history, shapes, bodies } = environment();
  const twin = addTwoShapeBody(model, history);
  assert.equal(hingePair(model, twin.shapes), null);
  assert.deepEqual(hingePair(model, [...twin.shapes, shapes[1]]), { bodyA: bodies[1], bodyB: twin.bodyUid });
});

const LIMIT_TABLE = [
  [0, {}, 0, 0],
  [37.4, {}, 0, 37],
  [-37.6, {}, -38, 0],
  [37, { shift: true }, 0, 30],
  [-38, { shift: true }, -45, 0],
  [3, { shift: true }, 0, 0],
  [45, { alt: true }, -45, 45],
  [-45, { alt: true }, -45, 45],
  [0, { alt: true }, 0, 0],
  [-20, { alt: true, shift: true }, -15, 15],
  [0.4, {}, 0, 0],
  [-0.4, {}, 0, 0],
  [180, {}, 0, 180],
  [-179.6, {}, -180, 0],
];

for (const [degrees, modifiers, lower, upper] of LIMIT_TABLE) {
  test(`hingeLimits(${degrees}, ${JSON.stringify(modifiers)}) is ${lower} / ${upper} degrees`, () => {
    const limits = hingeLimits(degrees * DEG, { shift: false, alt: false, ...modifiers });
    near(limits.lower, lower * DEG);
    near(limits.upper, upper * DEG);
    assert.ok(!Object.is(limits.lower, -0));
    assert.ok(!Object.is(limits.upper, -0));
  });
}

test('the tool has a crosshair cursor, no hover, and its own state per factory call', () => {
  const tool = hingeTool();
  assert.equal(tool.id, 'hinge');
  assert.equal(tool.cursor, 'crosshair');
  assert.equal(tool.hover, false);
  assert.equal(tool.keyDown({ key: 'a' }), false);
  assert.equal(tool.cancel(), false);
  assert.notEqual(hingeTool(), hingeTool());
  const { view, registry } = environment();
  assert.equal(registry.active.id, 'hinge');
  assert.equal(view.cursor.at(-1), 'crosshair');
});

test('a click on an overlap creates a pin at the snapped point and selects it', () => {
  const { model, registry, view, selection, history, shapes, bodies } = environment({ snap: true });
  view.hits = [shapes[1], shapes[0]];
  gesture(registry, [[px(0.47), py(0.03)]]);
  const { uid, props } = lastJoint(model);
  assert.equal(jointsOf(model).length, 1);
  assert.equal(props.bodyA, model.prop(bodies[0], 'id'));
  assert.equal(props.bodyB, model.prop(bodies[1], 'id'));
  nearAll(props.anchor, [0.5, 0]);
  assert.deepEqual(props.limits, defaultsOf('joint').limits);
  assert.equal(props.collideConnected, false);
  assert.equal(props.aimAxis, 0);
  assert.deepEqual(props.motor, defaultsOf('joint').motor);
  assert.equal(props.name, 'joint_1');
  assert.deepEqual(selection.objects, [uid]);
  assert.equal(registry.active.id, 'hinge');
  assert.equal(history.state.undoLabel, 'Create joint');
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'b_1');
});

test('a click without grid snap anchors at the raw point', () => {
  const { model, registry, view, shapes } = environment();
  view.hits = [shapes[1], shapes[0]];
  gesture(registry, [[px(0.47), py(0.03)]]);
  nearAll(lastJoint(model).props.anchor, [0.47, 0.03]);
});

test('under a moved and rotated root the anchor is snapped in world and stored root-local', () => {
  const { model, registry, view, history, shapes } = environment({ snap: true });
  history.execute(setProps([ROOT_UID], { position: [1, 2], angle: Math.PI / 2 }, 'Move root'));
  view.hits = [shapes[1], shapes[0]];
  gesture(registry, [[px(0.47), py(0.03)]]);
  nearAll(lastJoint(model).props.anchor, [-2, 0.5]);
});

function limitsAre(model, lower, upper) {
  const { limits } = lastJoint(model).props;
  assert.equal(limits.enabled, true);
  near(limits.lower, lower * DEG, 'lower');
  near(limits.upper, upper * DEG, 'upper');
}

test('a drag counter-clockwise of the zero direction creates 0 / phi, clockwise phi / 0, with ALT plus or minus phi', () => {
  const cases = [
    [[300, 150], {}, 0, 45],
    [[300, 250], {}, -45, 0],
    [[300, 150], { alt: true }, -45, 45],
    [[300, 250], { alt: true }, -45, 45],
    [[200, 200], {}, 0, 180],
    [[250 + 40, 200 - 20], {}, 0, 27],
  ];
  for (const [[x, y], modifiers, lower, upper] of cases) {
    const { model, registry, view, shapes } = environment();
    view.hits = [shapes[1], shapes[0]];
    gesture(registry, [[px(0.5), py(0)], [x, y], [x, y]], modifiers);
    limitsAre(model, lower, upper);
  }
});

test('phi is measured against a rotated root and a zero direction that is not +X', () => {
  const { model, registry, view, history, shapes } = environment();
  history.execute(setProps([ROOT_UID], { angle: Math.PI / 2 }, 'Turn root'));
  view.hits = [shapes[1], shapes[0]];
  gesture(registry, [[px(0), py(0.5)], [px(0) - 30, py(0.5) - 30], [px(0) - 30, py(0.5) - 30]]);
  nearAll(lastJoint(model).props.anchor, [0.5, 0]);
  limitsAre(model, 0, 45);
  view.hits = [shapes[1], shapes[0]];
  history.undo();
  gesture(registry, [[px(0), py(0.5)], [px(0) + 30, py(0.5) - 30], [px(0) + 30, py(0.5) - 30]]);
  limitsAre(model, -45, 0);
});

test('phi is measured from the anchor on screen after a pan mid-drag', () => {
  const { model, registry, view, camera, shapes } = environment();
  view.hits = [shapes[1], shapes[0]];
  send(registry, 'down', 250, 200);
  send(registry, 'move', 300, 170);
  camera.panBy(20, 0);
  send(registry, 'move', 300, 170);
  const arc = overlayOf(registry).find((call) => call[0] === 'arc');
  nearCall(arc, ['arc', 270, 200, GIZMO_SIZE.jointArc, 0, -45 * DEG, true]);
  send(registry, 'up', 300, 170);
  limitsAre(model, 0, 45);
  nearAll(lastJoint(model).props.anchor, [0.5, 0]);
});

test('SHIFT and ALT pressed and released mid-drag, re-sent as moves, change the limits', () => {
  const { model, registry, view, shapes } = environment();
  view.hits = [shapes[1], shapes[0]];
  const pointer = [290, 180];
  send(registry, 'down', 250, 200);
  send(registry, 'move', ...pointer);
  nearCall(overlayOf(registry).find((call) => call[0] === 'arc'), ['arc', 250, 200, GIZMO_SIZE.jointArc, 0, -27 * DEG, true]);
  send(registry, 'move', ...pointer, { shift: true });
  nearCall(overlayOf(registry).find((call) => call[0] === 'arc'), ['arc', 250, 200, GIZMO_SIZE.jointArc, 0, -30 * DEG, true]);
  send(registry, 'move', ...pointer, { shift: true, alt: true });
  nearCall(overlayOf(registry).find((call) => call[0] === 'arc'), ['arc', 250, 200, GIZMO_SIZE.jointArc, 30 * DEG, -30 * DEG, true]);
  send(registry, 'move', ...pointer, { alt: true });
  send(registry, 'move', ...pointer);
  send(registry, 'up', ...pointer, { shift: true });
  limitsAre(model, 0, 30);
});

test('the pointer back within 1 px of the anchor keeps the last phi; a drag ending on the zero direction is a pin', () => {
  const { model, registry, view, history, shapes } = environment({ positions: [[0, 0], [1, 0], [0.5, 1]] });
  view.hits = [shapes[1], shapes[0]];
  gesture(registry, [[250, 200], [250, 150], [250.5, 200], [250.5, 200]]);
  limitsAre(model, 0, 90);
  history.undo();
  gesture(registry, [[250, 200], [250, 150], [300, 200], [300, 200]]);
  assert.deepEqual(lastJoint(model).props.limits, defaultsOf('joint').limits);
  view.hits = [shapes[2], shapes[0]];
  gesture(registry, [[250, 200], [253, 200], [253, 200]]);
  assert.equal(jointsOf(model).length, 2);
  assert.deepEqual(lastJoint(model).props.limits, defaultsOf('joint').limits);
});

test('readout: the limits next to the pointer during a drag, null before the latch and after the release', () => {
  const { registry, view, shapes } = environment();
  view.hits = [shapes[1], shapes[0]];
  assert.equal(registry.readout(), null);
  send(registry, 'down', 250, 200);
  assert.equal(registry.readout(), null);
  send(registry, 'move', 252, 200);
  assert.equal(registry.readout(), null);
  send(registry, 'move', 300, 250);
  assert.deepEqual(registry.readout(), { text: 'lower: -45.0°  upper: 0.0°', screen: { x: 316, y: 266 } });
  send(registry, 'move', 300, 250, { alt: true });
  assert.equal(registry.readout().text, 'lower: -45.0°  upper: 45.0°');
  send(registry, 'up', 300, 250);
  assert.equal(registry.readout(), null);
});

test('refused presses record nothing and keep the selection', () => {
  const { model, registry, view, history, selection, shapes, bodies } = environment();
  const twin = addTwoShapeBody(model, history);
  history.execute(createJoint({ bodyA: bodies[0], bodyB: bodies[1], anchor: { x: 0.5, y: 0 } }));
  selection.set([ROOT_UID]);
  for (const hits of [[], [shapes[0]], twin.shapes, [shapes[1], shapes[0]], [shapes[0], shapes[1]], [ROOT_UID]]) {
    view.hits = hits;
    gesture(registry, [[250, 200], [300, 200], [300, 200]]);
    gesture(registry, [[250, 200]]);
    assert.equal(jointsOf(model).length, 1, JSON.stringify(hits));
    assert.equal(history.state.undoLabel, 'Create joint');
    assert.equal(history.state.gesture, false);
    assert.deepEqual(selection.objects, [ROOT_UID]);
    assert.deepEqual(overlayOf(registry), []);
  }
});

test('each joint is one undo step and undo prunes it from the selection', () => {
  const { model, registry, view, history, selection, shapes } = environment({ positions: [[0, 0], [1, 0], [2, 0]] });
  view.hits = [shapes[1], shapes[0]];
  gesture(registry, [[250, 200]]);
  view.hits = [shapes[2], shapes[1]];
  gesture(registry, [[350, 200], [380, 200], [380, 200]]);
  assert.equal(jointsOf(model).length, 2);
  assert.equal(registry.active.id, 'hinge');
  assert.equal(history.undo(), true);
  assert.equal(jointsOf(model).length, 1);
  assert.deepEqual(selection.objects, []);
  assert.equal(history.undo(), true);
  assert.deepEqual(jointsOf(model), []);
  assert.equal(history.state.undoLabel, 'Create circle');
  assert.equal(history.redo(), true);
  assert.equal(model.prop(jointsOf(model)[0], 'id'), 'j_1');
});

test('Esc mid-drag creates nothing, then the next press works', () => {
  const { model, registry, view, selection, actions, shapes } = environment();
  selection.set([ROOT_UID]);
  view.hits = [shapes[1], shapes[0]];
  send(registry, 'down', 250, 200);
  send(registry, 'move', 300, 200);
  actions.run('escape');
  assert.deepEqual(overlayOf(registry), []);
  send(registry, 'move', 310, 200);
  send(registry, 'up', 310, 200);
  assert.deepEqual(jointsOf(model), []);
  assert.deepEqual(selection.objects, [ROOT_UID]);
  gesture(registry, [[250, 200]]);
  assert.equal(jointsOf(model).length, 1);
});

test('Esc without a press clears the selection', () => {
  const { registry, selection, actions } = environment();
  selection.set([ROOT_UID]);
  assert.equal(registry.cancel(), false);
  actions.run('escape');
  assert.deepEqual(selection.objects, []);
});

test('Undo mid-drag aborts the drag and undoes nothing else', () => {
  const { model, registry, view, history, shapes } = environment();
  view.hits = [shapes[1], shapes[0]];
  send(registry, 'down', 250, 200);
  send(registry, 'move', 300, 200);
  assert.equal(history.undo(), true);
  send(registry, 'up', 300, 200);
  assert.deepEqual(jointsOf(model), []);
  assert.equal(model.children(ROOT_UID, 'bodies').length, 2);
  assert.deepEqual(overlayOf(registry), []);
});

test('a mode change mid-drag creates nothing and the tool leaves', () => {
  const { model, registry, view, history, modes, shapes } = environment();
  const clip = addClip(history);
  view.hits = [shapes[1], shapes[0]];
  send(registry, 'down', 250, 200);
  send(registry, 'move', 300, 200);
  modes.openClip(clip);
  send(registry, 'up', 300, 200);
  assert.deepEqual(jointsOf(model), []);
  assert.notEqual(registry.active?.id, 'hinge');
  assert.equal(registry.canActivate('hinge'), false);
});

test('the right button is ignored, alone or during a left drag', () => {
  const { model, registry, view, shapes } = environment();
  view.hits = [shapes[1], shapes[0]];
  send(registry, 'down', 250, 200, { button: 2, buttons: 2 });
  send(registry, 'up', 250, 200, { button: 2 });
  assert.deepEqual(overlayOf(registry), []);
  assert.deepEqual(jointsOf(model), []);
  send(registry, 'down', 250, 200);
  send(registry, 'move', 290, 160);
  send(registry, 'down', 290, 160, { button: 2, buttons: 3 });
  send(registry, 'up', 290, 160, { button: 2 });
  send(registry, 'up', 290, 160);
  assert.equal(jointsOf(model).length, 1);
  limitsAre(model, 0, 45);
});

test('bodyA is the body closer to rootBody along a chain, whatever is on top', () => {
  const { model, registry, view, history, shapes, bodies } = environment({ positions: [[0, 0], [1, 0], [2, 0]] });
  history.execute(createJoint({ bodyA: bodies[0], bodyB: bodies[1], anchor: { x: 0.5, y: 0 } }));
  for (const hits of [[shapes[2], shapes[1]], [shapes[1], shapes[2]]]) {
    view.hits = hits;
    gesture(registry, [[350, 200]]);
    const { props } = lastJoint(model);
    assert.equal(props.bodyA, 'b_2');
    assert.equal(props.bodyB, 'b_3');
    history.undo();
  }
});

test('two unlinked bodies are ordered by bodies order', () => {
  const { model, registry, view, history, shapes } = environment({ positions: [[0, 0], [1, 0], [2, 0]] });
  history.execute(setProps([ROOT_UID], { rootBody: null }, 'Clear root body'));
  for (const hits of [[shapes[2], shapes[1]], [shapes[1], shapes[2]]]) {
    view.hits = hits;
    gesture(registry, [[350, 200]]);
    const { props } = lastJoint(model);
    assert.equal(props.bodyA, 'b_2');
    assert.equal(props.bodyB, 'b_3');
    history.undo();
  }
});

test('the cursor is not-allowed where a press would be refused and the crosshair elsewhere', () => {
  const { registry, view, history, shapes, bodies } = environment({ positions: [[0, 0], [1, 0], [2, 0]] });
  history.execute(createJoint({ bodyA: bodies[1], bodyB: bodies[2], anchor: { x: 1.5, y: 0 } }));
  const cases = [
    [[], 'not-allowed'],
    [[shapes[1], shapes[0]], 'crosshair'],
    [[shapes[0]], 'not-allowed'],
    [[shapes[0], shapes[1]], 'crosshair'],
    [[shapes[2], shapes[1]], 'not-allowed'],
  ];
  for (const [hits, cursor] of cases) {
    view.hits = hits;
    hover(registry, 250, 200);
    assert.equal(view.cursor.at(-1), cursor, JSON.stringify(hits));
  }
  view.hits = [];
  hover(registry, 250, 200);
  view.hits = [shapes[1], shapes[0]];
  send(registry, 'down', 250, 200);
  assert.equal(view.cursor.at(-1), 'crosshair');
  view.hits = [];
  send(registry, 'move', 300, 200);
  assert.equal(view.cursor.at(-1), 'crosshair');
  send(registry, 'up', 300, 200);
  registry.activate('circle');
  assert.equal(view.cursor.at(-1), 'crosshair');
});

test('a refused press leaves the not-allowed cursor to the next moves', () => {
  const { registry, view } = environment();
  view.hits = [];
  send(registry, 'down', 250, 200);
  send(registry, 'move', 260, 200);
  assert.equal(view.cursor.at(-1), 'not-allowed');
  send(registry, 'up', 260, 200);
});

test('overlay: circle and needle after the press, the arc from lower to upper once phi is not 0, nothing after release or cancel', () => {
  const { registry, view, shapes } = environment();
  view.hits = [shapes[1], shapes[0]];
  assert.deepEqual(overlayOf(registry), []);
  send(registry, 'down', 250, 200);
  const pin = overlayOf(registry);
  assert.equal(pin.length, 4);
  nearCall(pin[0], ['circle', 250, 200, GIZMO_SIZE.jointCircle]);
  nearCall(pin[1], ['moveTo', 250, 200]);
  nearCall(pin[2], ['lineTo', 250 + GIZMO_SIZE.jointNeedle, 200]);
  assert.deepEqual(pin[3], STROKE);
  send(registry, 'move', 252, 200);
  assert.equal(overlayOf(registry).length, 4);
  send(registry, 'move', 250, 240);
  const limited = overlayOf(registry);
  assert.equal(limited.length, 6);
  nearCall(limited[3], ['moveTo', 250, 200 + GIZMO_SIZE.jointArc]);
  nearCall(limited[4], ['arc', 250, 200, GIZMO_SIZE.jointArc, 90 * DEG, 0, true]);
  assert.deepEqual(limited[5], STROKE);
  send(registry, 'up', 250, 240);
  assert.deepEqual(overlayOf(registry), []);
  view.hits = [shapes[1], shapes[0]];
  send(registry, 'down', 250, 300);
  assert.equal(overlayOf(registry).length, 0);
  send(registry, 'up', 250, 300);
});

test('overlay: the needle points along the root +X, not toward bodyB, and cancel clears it', () => {
  const { registry, view, history, shapes } = environment();
  view.hits = [shapes[0], shapes[1]];
  send(registry, 'down', px(0.5), py(-0.5));
  nearCall(overlayOf(registry)[2], ['lineTo', px(0.5) + GIZMO_SIZE.jointNeedle, py(-0.5)]);
  assert.equal(registry.cancel(), true);
  assert.deepEqual(overlayOf(registry), []);
  send(registry, 'up', px(0.5), py(-0.5));
  history.execute(setProps([ROOT_UID], { angle: Math.PI / 2 }, 'Turn root'));
  send(registry, 'down', 200, 150);
  nearCall(overlayOf(registry)[2], ['lineTo', 200, 150 - GIZMO_SIZE.jointNeedle]);
  registry.cancel();
  send(registry, 'up', 200, 150);
});

test('phi is measured from the root +X even when bodyB lies elsewhere: up is upper 90, down is lower -90', () => {
  for (const [to, lower, upper] of [
    [[250, 100], 0, 90],
    [[250, 300], -90, 0],
  ]) {
    const { model, registry, view, shapes } = environment({ positions: [[0.5, -1], [0.5, 1]] });
    view.hits = [shapes[1], shapes[0]];
    gesture(registry, [[250, 200], to, to]);
    limitsAre(model, lower, upper);
  }
});

test('the created joint gets the gizmo the preview showed', () => {
  const { model, registry, view, shapes } = environment({ snap: true });
  view.hits = [shapes[1], shapes[0]];
  send(registry, 'down', px(0.47), py(-0.48));
  const preview = overlayOf(registry);
  send(registry, 'up', px(0.47), py(-0.48));
  const { uid, props } = lastJoint(model);
  const { anchor } = props;
  nearCall(preview[0], ['circle', px(anchor[0]), py(anchor[1]), GIZMO_SIZE.jointCircle]);
  const zero = placement(model).zero.get(uid);
  near(zero, 0);
  nearCall(preview[2], [
    'lineTo',
    px(anchor[0]) + Math.cos(zero) * GIZMO_SIZE.jointNeedle,
    py(anchor[1]) - Math.sin(zero) * GIZMO_SIZE.jointNeedle,
  ]);
});

test('presses and moves invalidate the overlay', () => {
  const { registry, view, shapes } = environment();
  view.hits = [shapes[1], shapes[0]];
  const before = view.invalidations;
  send(registry, 'down', 250, 200);
  const afterPress = view.invalidations;
  send(registry, 'move', 260, 200);
  const afterMove = view.invalidations;
  send(registry, 'up', 260, 200);
  assert.ok(afterPress > before);
  assert.ok(afterMove > afterPress);
  assert.ok(view.invalidations > afterMove);
});
