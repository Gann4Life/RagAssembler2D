import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { createJoint, createShapeBody } from '../js/commands/create.js';
import { setProps } from '../js/commands/props.js';
import { manipulateTool, manipulationTarget, rotationPivot } from '../js/tools/manipulate.js';
import { COLORS, GIZMO_SIZE, LINE_WIDTH } from '../js/viewport/style.js';
import { defaultsOf } from '../lib/schema.js';

const EPSILON = 1e-9;
const NO_MODIFIERS = { shift: false, ctrl: false, alt: false };
const DEG = Math.PI / 180;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message ?? ''} expected ${expected}, got ${actual}`);
}

function nearPair(actual, expected, message) {
  assert.equal(actual.length, 2, message);
  near(actual[0], expected[0], message);
  near(actual[1], expected[1], message);
}

function px(worldX) {
  return 200 + worldX * 100;
}

function py(worldY) {
  return 200 - worldY * 100;
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
  const view = { hits: [], cursor: [], invalidations: 0 };
  tools.bindView({
    hitTest: () => view.hits,
    setCursor: (css) => view.cursor.push(css),
    invalidateOverlay: () => {
      view.invalidations++;
    },
  });
  tools.activate('manipulate');
  return { ...editor, registry: tools, view, shapes, bodies, joints };
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

function hover(registry, x, y, extra = {}) {
  send(registry, 'move', x, y, { buttons: 0, ...extra });
}

function drag(registry, points, extra = {}) {
  const [first, ...rest] = points;
  send(registry, 'down', first[0], first[1], extra);
  for (const [x, y] of rest) send(registry, 'move', x, y, extra);
  const last = rest.at(-1) ?? first;
  send(registry, 'up', last[0], last[1], extra);
}

function position(model, uid) {
  return model.prop(uid, 'position');
}

function anchor(model, uid) {
  return model.prop(uid, 'anchor');
}

function snapshot(model, env) {
  return JSON.stringify([
    model.prop(ROOT_UID, 'position'),
    model.prop(ROOT_UID, 'angle'),
    ...env.bodies.map((uid) => [position(model, uid), model.prop(uid, 'angle')]),
    ...env.joints.map((uid) => anchor(model, uid)),
  ]);
}

function fakeGraphics() {
  const calls = [];
  const g = {
    calls,
    clear() {
      calls.length = 0;
    },
  };
  for (const method of ['circle', 'moveTo', 'lineTo', 'stroke', 'fill']) {
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

function knobCalls(pivot, knob) {
  const arm = GIZMO_SIZE.pivot;
  return [
    ['moveTo', pivot.x, pivot.y],
    ['lineTo', knob.x, knob.y],
    ['moveTo', pivot.x - arm, pivot.y],
    ['lineTo', pivot.x + arm, pivot.y],
    ['moveTo', pivot.x, pivot.y - arm],
    ['lineTo', pivot.x, pivot.y + arm],
    ['stroke', { width: LINE_WIDTH.outline, color: COLORS.highlight }],
    ['circle', knob.x, knob.y, GIZMO_SIZE.rotateKnob],
    ['fill', { color: COLORS.highlight }],
  ];
}

function assertOverlay(calls, pivot, knob) {
  const expected = knobCalls(pivot, knob);
  assert.equal(calls.length, expected.length);
  expected.forEach((call, index) => {
    assert.equal(calls[index][0], call[0]);
    call.slice(1).forEach((value, arg) => {
      if (typeof value === 'number') near(calls[index][arg + 1], value, `${call[0]} ${arg}`);
      else assert.deepEqual(calls[index][arg + 1], value);
    });
  });
}

test('manipulationTarget: the root wins, shapes give their body once, joints are kept, other types ignored', () => {
  const { model, history, shapes, bodies, joints } = environment();
  const clip = addClip(history);
  assert.deepEqual(manipulationTarget(model, [shapes[1], ROOT_UID, joints[0]]), { root: true, bodies: [], joints: [] });
  assert.deepEqual(manipulationTarget(model, [shapes[2], bodies[1], bodies[2], joints[1], clip, 999, shapes[1]]), {
    root: false,
    bodies: [bodies[2], bodies[1]],
    joints: [joints[1]],
  });
  assert.deepEqual(manipulationTarget(model, []), { root: false, bodies: [], joints: [] });
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

test('the tool is registered with a default cursor and hover, and M activates it', () => {
  const tool = manipulateTool();
  assert.equal(tool.id, 'manipulate');
  assert.equal(tool.cursor, 'default');
  assert.equal(tool.hover, true);
  assert.equal(tool.hotkey, 'M');
  assert.equal(tool.cancel(), false);
  assert.notEqual(manipulateTool(), manipulateTool());
});

test('dragging a selected body moves its subtree and the anchors it carries', () => {
  const env = environment();
  const { model, registry, view, selection, history, shapes, bodies, joints } = env;
  selection.set([bodies[1]]);
  view.hits = [shapes[1]];
  drag(registry, [[px(1), py(0)], [px(1) + 20, py(0)], [px(1) + 50, py(0) + 20]]);
  nearPair(position(model, bodies[0]), [0, 0]);
  nearPair(position(model, bodies[1]), [1.5, -0.2]);
  nearPair(position(model, bodies[2]), [2.5, -0.2]);
  nearPair(position(model, bodies[3]), [3.5, -0.2]);
  assert.equal(model.prop(bodies[2], 'angle'), 0.5);
  nearPair(anchor(model, joints[0]), [1, -0.2]);
  nearPair(anchor(model, joints[1]), [2, -0.2]);
  nearPair(anchor(model, joints[2]), [3, -0.2]);
  assert.deepEqual(selection.objects, [bodies[1]]);
  assert.equal(history.state.undoLabel, 'Move');
});

test('ALT moves only the body and its parent anchor; pressing and releasing it mid-drag puts the children back and moves them again', () => {
  const { model, registry, view, selection, shapes, bodies, joints } = environment();
  selection.set([shapes[2]]);
  view.hits = [shapes[2]];
  send(registry, 'down', px(2), py(0));
  send(registry, 'move', px(2) + 50, py(0));
  nearPair(position(model, bodies[3]), [3.5, 0]);
  send(registry, 'move', px(2) + 50, py(0), { alt: true });
  nearPair(position(model, bodies[2]), [2.5, 0]);
  assert.deepEqual(position(model, bodies[3]), [3, 0]);
  nearPair(anchor(model, joints[1]), [2, 0]);
  assert.deepEqual(anchor(model, joints[2]), [2.5, 0]);
  assert.deepEqual(position(model, bodies[1]), [1, 0]);
  send(registry, 'move', px(2) + 60, py(0));
  nearPair(position(model, bodies[3]), [3.6, 0]);
  nearPair(anchor(model, joints[2]), [3.1, 0]);
  send(registry, 'up', px(2) + 60, py(0));
  assert.deepEqual(selection.objects, [shapes[2]]);
});

test('a selection of bodies and joints moves the union once', () => {
  const { model, registry, view, selection, shapes, bodies, joints } = environment();
  selection.set([bodies[2], joints[0], shapes[3]]);
  view.hits = [shapes[3]];
  drag(registry, [[px(3), py(0)], [px(3), py(0) - 30]]);
  assert.deepEqual(position(model, bodies[1]), [1, 0]);
  nearPair(position(model, bodies[2]), [2, 0.3]);
  nearPair(position(model, bodies[3]), [3, 0.3]);
  nearPair(anchor(model, joints[0]), [0.5, 0.3]);
  nearPair(anchor(model, joints[1]), [1.5, 0.3]);
  nearPair(anchor(model, joints[2]), [2.5, 0.3]);
});

test('dragging only joints moves just their anchors', () => {
  const { model, registry, view, selection, bodies, joints } = environment();
  selection.set([joints[1]]);
  view.hits = [joints[1]];
  drag(registry, [[px(1.5), py(0)], [px(1.5) + 10, py(0) - 10]]);
  nearPair(anchor(model, joints[1]), [1.6, 0.1]);
  assert.deepEqual(anchor(model, joints[0]), [0.5, 0]);
  for (const [index, x] of [[0, 0], [1, 1], [2, 2], [3, 3]]) assert.deepEqual(position(model, bodies[index]), [x, 0]);
});

test('dragging the root moves the whole ragdoll through its position', () => {
  const env = environment();
  const { model, registry, view, selection, history, shapes, bodies } = env;
  selection.set([ROOT_UID, shapes[1]]);
  view.hits = [shapes[1]];
  drag(registry, [[px(1), py(0)], [px(1) + 30, py(0) - 40]]);
  nearPair(model.prop(ROOT_UID, 'position'), [0.3, 0.4]);
  assert.deepEqual(position(model, bodies[1]), [1, 0]);
  assert.equal(history.state.undoLabel, 'Move ragdoll');
});

test('a press on an unselected hit selects only it, with any modifier, and drags it', () => {
  const { model, registry, view, selection, shapes, bodies } = environment();
  selection.set([bodies[0]]);
  view.hits = [shapes[3], shapes[2]];
  drag(registry, [[px(3), py(0)], [px(3) + 20, py(0)]], { shift: true, ctrl: true });
  assert.deepEqual(selection.objects, [shapes[3]]);
  nearPair(position(model, bodies[3]), [3.2, 0]);
  assert.deepEqual(position(model, bodies[2]), [2, 0]);
  view.hits = [ROOT_UID];
  drag(registry, [[px(0), py(0)], [px(0), py(0) - 20]]);
  assert.deepEqual(selection.objects, [ROOT_UID]);
  nearPair(model.prop(ROOT_UID, 'position'), [0, 0.2]);
});

test('a click only selects, an empty click clears and an empty drag changes nothing', () => {
  const env = environment();
  const { model, registry, view, selection, history, shapes, bodies } = env;
  const before = snapshot(model, env);
  selection.set([bodies[0]]);
  view.hits = [shapes[2]];
  drag(registry, [[px(2), py(0)], [px(2) + 3, py(0)]]);
  assert.deepEqual(selection.objects, [shapes[2]]);
  assert.equal(snapshot(model, env), before);
  assert.equal(history.state.undoLabel, 'Create joint');
  view.hits = [];
  drag(registry, [[10, 10], [60, 60]], { shift: true });
  assert.deepEqual(selection.objects, [shapes[2]]);
  drag(registry, [[10, 10]], { ctrl: true });
  assert.deepEqual(selection.objects, []);
  assert.equal(snapshot(model, env), before);
});

test('grid snap puts the pressed object point on the grid under a moved and rotated root', () => {
  const { model, registry, view, selection, history, shapes, bodies, joints } = environment({ snap: true });
  history.execute(setProps([ROOT_UID], { position: [0.03, 0.04], angle: Math.PI / 2 }));
  selection.set([bodies[1]]);
  view.hits = [shapes[1]];
  drag(registry, [[px(0.1), py(1.04)], [px(0.3), py(1.14)]]);
  nearPair(position(model, bodies[1]), [1.06, -0.17]);
  nearPair(position(model, bodies[2]), [2.06, -0.17]);
  history.undo();
  selection.set([joints[0]]);
  view.hits = [joints[0]];
  drag(registry, [[px(0.03), py(0.54)], [px(0.14), py(0.56)]]);
  nearPair(anchor(model, joints[0]), [0.56, -0.07]);
  assert.deepEqual(position(model, bodies[1]), [1, 0]);
  history.undo();
  selection.set([ROOT_UID]);
  view.hits = [ROOT_UID];
  drag(registry, [[px(0.03), py(0.04)], [px(0.23), py(0.24)]]);
  nearPair(model.prop(ROOT_UID, 'position'), [0.2, 0.2]);
});

test('the rotate knob rotates a body and its subtree around the parent anchor', () => {
  const { model, registry, view, selection, history, bodies, joints } = environment();
  selection.set([bodies[1]]);
  view.hits = [];
  send(registry, 'down', 290, 208);
  assert.equal(view.cursor.at(-1), 'pointer');
  registry.cancel();
  send(registry, 'up', 290, 208);
  send(registry, 'down', 290, 200);
  send(registry, 'move', 250, 160);
  send(registry, 'up', 250, 160);
  nearPair(position(model, bodies[1]), [0.5, 0.5]);
  near(model.prop(bodies[1], 'angle'), Math.PI / 2);
  nearPair(position(model, bodies[2]), [0.5, 1.5]);
  near(model.prop(bodies[2], 'angle'), 0.5 + Math.PI / 2);
  nearPair(anchor(model, joints[0]), [0.5, 0]);
  nearPair(anchor(model, joints[1]), [0.5, 1]);
  nearPair(anchor(model, joints[2]), [0.5, 2]);
  assert.equal(history.state.undoLabel, 'Rotate');
  assert.deepEqual(selection.objects, [bodies[1]]);
});

test('a press 9 px from the knob is not a rotation', () => {
  const env = environment();
  const { model, registry, selection } = env;
  selection.set([env.bodies[1]]);
  const before = snapshot(model, env);
  drag(registry, [[290, 209], [250, 160]]);
  assert.equal(snapshot(model, env), before);
});

test('rootBody and a body with an unplaced parent anchor rotate around their origin', () => {
  const { model, registry, selection, history, bodies, joints } = environment();
  selection.set([bodies[0]]);
  drag(registry, [[240, 200], [200, 160]]);
  near(model.prop(bodies[0], 'angle'), Math.PI / 2);
  nearPair(position(model, bodies[0]), [0, 0]);
  nearPair(position(model, bodies[1]), [0, 1]);
  history.undo();
  history.execute(setProps([joints[1]], { anchor: null }));
  selection.set([bodies[2]]);
  const knob = { x: px(2) + 40 * Math.cos(0.5), y: py(0) - 40 * Math.sin(0.5) };
  drag(registry, [[knob.x, knob.y], [px(2), py(0) - 40]]);
  near(model.prop(bodies[2], 'angle'), Math.PI / 2);
  nearPair(position(model, bodies[2]), [2, 0]);
  nearPair(position(model, bodies[3]), [2 + Math.sin(0.5), Math.cos(0.5)]);
});

test('CTRL is read live: the pivot moves to the origin and the sweep restarts from the press point', () => {
  const { model, registry, selection, bodies } = environment();
  selection.set([bodies[1]]);
  send(registry, 'down', 290, 200);
  send(registry, 'move', 250, 160);
  near(model.prop(bodies[1], 'angle'), Math.PI / 2);
  send(registry, 'move', 250, 160, { ctrl: true });
  const theta = Math.atan2(0.4, -0.5) - Math.PI;
  nearPair(position(model, bodies[1]), [1, 0]);
  near(model.prop(bodies[1], 'angle'), theta);
  send(registry, 'up', 250, 160, { ctrl: true });
  near(model.prop(bodies[2], 'angle'), 0.5 + theta);
  nearPair(position(model, bodies[2]), [1 + Math.cos(theta), Math.sin(theta)]);
});

test('ALT rotates only the body, read live', () => {
  const { model, registry, selection, bodies, joints } = environment();
  selection.set([bodies[1]]);
  send(registry, 'down', 290, 200);
  send(registry, 'move', 250, 160, { alt: true });
  near(model.prop(bodies[1], 'angle'), Math.PI / 2);
  assert.deepEqual(position(model, bodies[2]), [2, 0]);
  assert.equal(model.prop(bodies[2], 'angle'), 0.5);
  assert.deepEqual(anchor(model, joints[1]), [1.5, 0]);
  send(registry, 'move', 250, 160);
  nearPair(position(model, bodies[2]), [0.5, 1.5]);
  send(registry, 'up', 250, 160);
});

test('SHIFT rounds the body root-local angle and the root angle to 15 degrees', () => {
  const { model, registry, selection, history, bodies } = environment();
  history.execute(setProps([ROOT_UID], { angle: 0.2 }));
  selection.set([bodies[2]]);
  const pivot = { x: px(1.5 * Math.cos(0.2)), y: py(1.5 * Math.sin(0.2)) };
  const start = 0.5 + 0.2;
  const knob = { x: pivot.x + 40 * Math.cos(start), y: pivot.y - 40 * Math.sin(start) };
  const end = start + 10 * DEG;
  drag(registry, [[knob.x, knob.y], [pivot.x + 40 * Math.cos(end), pivot.y - 40 * Math.sin(end)]], { shift: true });
  near(model.prop(bodies[2], 'angle'), 45 * DEG);
  selection.set([ROOT_UID]);
  const rootKnob = { x: 200 + 40 * Math.cos(0.2), y: 200 - 40 * Math.sin(0.2) };
  const rootEnd = 0.2 + 20 * DEG;
  drag(registry, [[rootKnob.x, rootKnob.y], [200 + 40 * Math.cos(rootEnd), 200 - 40 * Math.sin(rootEnd)]], { shift: true });
  near(model.prop(ROOT_UID, 'angle'), 30 * DEG);
  assert.equal(history.state.undoLabel, 'Rotate ragdoll');
});

test('the sweep follows the pointer past half a turn', () => {
  const { model, registry, selection, bodies } = environment();
  selection.set([bodies[1]]);
  drag(registry, [[290, 200], [250, 160], [210, 200], [250, 240], [290, 200], [250, 160]]);
  near(model.prop(bodies[1], 'angle'), 2 * Math.PI + Math.PI / 2);
});

test('each drag is one undo step, and a drag back to the start leaves none', () => {
  const env = environment();
  const { model, registry, view, selection, history, shapes, bodies } = env;
  selection.set([bodies[1]]);
  view.hits = [shapes[1]];
  const before = snapshot(model, env);
  drag(registry, [[px(1), py(0)], [px(1) + 30, py(0)], [px(1) + 60, py(0)], [px(1), py(0)]]);
  assert.equal(history.state.undoLabel, 'Create joint');
  assert.equal(snapshot(model, env), before);
  drag(registry, [[px(1), py(0)], [px(1) + 30, py(0)], [px(1) + 60, py(0)]]);
  assert.equal(history.undo(), true);
  assert.equal(snapshot(model, env), before);
  assert.equal(history.state.undoLabel, 'Create joint');
  history.redo();
  nearPair(position(model, bodies[1]), [1.6, 0]);
});

test('Esc, Undo, a tool switch and a mode change mid-drag restore every value and keep the press selection', () => {
  const aborts = [
    (env) => env.actions.run('escape'),
    (env) => env.history.undo(),
    (env) => env.registry.activate('select'),
    (env) => env.modes.openClip(env.clip),
  ];
  for (const abort of aborts) {
    const env = environment();
    env.clip = addClip(env.history);
    const { model, registry, view, selection, shapes } = env;
    const before = snapshot(model, env);
    view.hits = [shapes[2]];
    send(registry, 'down', px(2), py(0));
    send(registry, 'move', px(2) + 50, py(0));
    assert.notEqual(snapshot(model, env), before);
    abort(env);
    send(registry, 'move', px(2) + 60, py(0));
    send(registry, 'up', px(2) + 60, py(0));
    assert.equal(snapshot(model, env), before, abort.toString());
    assert.deepEqual(selection.objects, [shapes[2]], abort.toString());
    assert.equal(env.history.state.undoLabel, 'Add clip', abort.toString());
  }
});

test('in Animate mode presses select, nothing moves, there is no knob and the cursor stays default', () => {
  const env = environment();
  const { model, registry, view, selection, modes, history, shapes, bodies } = env;
  modes.openClip(addClip(history));
  assert.equal(registry.active.id, 'manipulate');
  const before = snapshot(model, env);
  selection.set([bodies[1]]);
  assert.deepEqual(overlayOf(registry), []);
  view.hits = [shapes[2]];
  hover(registry, px(2), py(0));
  assert.equal(view.cursor.at(-1), 'default');
  drag(registry, [[px(2), py(0)], [px(2) + 50, py(0)]]);
  assert.deepEqual(selection.objects, [shapes[2]]);
  view.hits = [];
  drag(registry, [[290, 200], [250, 160]]);
  assert.equal(snapshot(model, env), before);
  assert.deepEqual(selection.objects, [shapes[2]]);
  drag(registry, [[10, 10]]);
  assert.deepEqual(selection.objects, []);
  assert.equal(view.cursor.at(-1), 'default');
});

test('cursors: move over an object, pointer over the knob, default elsewhere and after a drag', () => {
  const { registry, view, selection, shapes, bodies } = environment();
  selection.set([bodies[1]]);
  view.hits = [shapes[1]];
  hover(registry, px(1), py(0));
  assert.equal(view.cursor.at(-1), 'move');
  view.hits = [];
  hover(registry, 296, 200);
  assert.equal(view.cursor.at(-1), 'pointer');
  hover(registry, 340, 200);
  assert.equal(view.cursor.at(-1), 'default');
  hover(registry, 340, 200, { ctrl: true });
  assert.equal(view.cursor.at(-1), 'pointer');
  view.hits = [shapes[1]];
  send(registry, 'down', px(1), py(0));
  assert.equal(view.cursor.at(-1), 'move');
  send(registry, 'up', px(1) + 30, py(0));
  assert.equal(view.cursor.at(-1), 'default');
});

test('overlay: the knob, line and pivot cross of a rotatable target, nothing otherwise', () => {
  const { registry, selection, history, shapes, bodies, joints } = environment();
  assert.deepEqual(overlayOf(registry), []);
  selection.set([shapes[1]]);
  assertOverlay(overlayOf(registry), { x: 250, y: 200 }, { x: 290, y: 200 });
  hover(registry, 10, 10, { ctrl: true });
  assertOverlay(overlayOf(registry), { x: 300, y: 200 }, { x: 340, y: 200 });
  hover(registry, 10, 10);
  history.execute(setProps([ROOT_UID], { position: [0, 1], angle: Math.PI / 2 }));
  selection.set([ROOT_UID]);
  assertOverlay(overlayOf(registry), { x: 200, y: 100 }, { x: 200, y: 60 });
  for (const objects of [[bodies[1], bodies[2]], [joints[0]], [bodies[1], joints[0]], []]) {
    selection.set(objects);
    assert.deepEqual(overlayOf(registry), [], JSON.stringify(objects));
  }
});

test('overlay: the knob turns with the body during a rotation', () => {
  const { registry, selection, bodies } = environment();
  selection.set([bodies[1]]);
  send(registry, 'down', 290, 200);
  send(registry, 'move', 250, 160);
  assertOverlay(overlayOf(registry), { x: 250, y: 200 }, { x: 250, y: 160 });
  send(registry, 'up', 250, 160);
});

test('the right button is ignored', () => {
  const env = environment();
  const { model, registry, view, selection, shapes } = env;
  const before = snapshot(model, env);
  view.hits = [shapes[1]];
  send(registry, 'down', px(1), py(0), { button: 2, buttons: 2 });
  send(registry, 'move', px(1) + 50, py(0), { buttons: 2 });
  send(registry, 'up', px(1) + 50, py(0), { button: 2 });
  assert.deepEqual(selection.objects, []);
  assert.equal(snapshot(model, env), before);
});
