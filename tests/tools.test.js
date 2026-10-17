import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { setProps } from '../js/commands/props.js';
import { Selection } from '../js/model/selection.js';
import { MODE_POLICY, Modes } from '../js/modes.js';
import { Settings } from '../js/settings.js';
import { Camera } from '../js/viewport/camera.js';
import { DOUBLE_CLICK_TIME, DRAG_THRESHOLD, TOOL_SPECS, defineTool } from '../js/tools/tool.js';
import { ToolRegistry } from '../js/tools/registry.js';
import { defaultsOf } from '../lib/schema.js';

const EPSILON = 1e-9;

function core() {
  const model = new Model();
  const history = new History(model);
  const selection = new Selection(model);
  const modes = new Modes(model);
  const settings = new Settings();
  const camera = new Camera();
  camera.setSize(400, 400);
  camera.zoomAt({ x: 200, y: 200 }, 100 / camera.scale);
  return { model, history, selection, modes, settings, camera };
}

function addClip(history) {
  const { tracks, events, ...props } = defaultsOf('clip');
  return history.execute({
    label: 'Add clip',
    run: (tx) => tx.add(ROOT_UID, 'clips', undefined, { type: 'clip', props: { ...props, length: 1 } }),
  });
}

function rootName(model) {
  return model.prop(ROOT_UID, 'name');
}

function dragTool(id, log = []) {
  let ctx = null;
  let dragging = false;
  let steps = 0;
  const tool = defineTool({
    id,
    activate(context) {
      ctx = context;
      log.push(`${id}:activate`);
    },
    deactivate() {
      log.push(`${id}:deactivate`);
    },
    pointerDown(e) {
      log.push(`${id}:down:${e.button}`);
      if (e.button === 0) dragging = true;
    },
    pointerMove(e) {
      log.push(`${id}:move`);
      if (dragging) ctx.history.execute(setProps([ROOT_UID], { name: `drag ${++steps}` }, 'Drag'));
    },
    pointerUp(e) {
      log.push(`${id}:up:${e.button}`);
      if (e.button === 0 && dragging) {
        dragging = false;
        ctx.history.execute(setProps([ROOT_UID], { name: 'dropped' }, 'Drag'));
      }
    },
    keyDown(e) {
      log.push(`${id}:key:${e.key}`);
      return e.key === 'Enter';
    },
    cancel() {
      log.push(`${id}:cancel`);
      const was = dragging;
      dragging = false;
      return was;
    },
    drawOverlay(g) {
      g.drawn.push(id);
    },
  });
  return { tool, log, context: () => ctx };
}

function input(type, button, x = 200, y = 200, extra = {}) {
  return {
    type,
    screen: { x, y },
    button: type === 'move' ? -1 : button,
    buttons: extra.buttons ?? (type === 'down' || (type === 'move' && button === 0) ? 1 : 0),
    shift: false,
    ctrl: false,
    alt: false,
    clicks: 1,
    ...extra,
  };
}

function drag(registry, steps = 2) {
  registry.pointer(input('down', 0));
  for (let index = 0; index < steps; index++) registry.pointer(input('move', 0, 210 + index, 200));
  registry.pointer(input('up', 0, 220, 200));
}

function fakeView() {
  const calls = { cursor: [], invalidations: 0, hits: [], boxes: [] };
  return {
    calls,
    view: {
      hitTest(screen) {
        calls.hits.push(screen);
        return [ROOT_UID];
      },
      boxTest(box) {
        calls.boxes.push(box);
        return [7, 8];
      },
      setCursor(css) {
        calls.cursor.push(css);
      },
      invalidateOverlay() {
        calls.invalidations++;
      },
    },
  };
}

test('TOOL_SPECS lists the seven tools of DESIGN §5.5 with policy capabilities', () => {
  assert.deepEqual(
    TOOL_SPECS.map((row) => [row.id, row.label, row.hotkey, row.capability, row.group]),
    [
      ['select', 'Select', 'V', 'select', 'selection'],
      ['select-box', 'Select Box', 'B', 'select', 'selection'],
      ['pose', 'Pose', 'D', 'tool.pose', 'manipulation'],
      ['circle', 'Circle', 'C', 'tool.circle', 'creation'],
      ['box', 'Box', 'R', 'tool.box', 'creation'],
      ['polygon', 'Polygon', 'N', 'tool.polygon', 'creation'],
      ['hinge', 'Hinge Joint', 'H', 'tool.hinge', 'joints'],
    ],
  );
  assert.ok(Object.isFrozen(TOOL_SPECS) && TOOL_SPECS.every((row) => Object.isFrozen(row)));
  for (const row of TOOL_SPECS) assert.ok(Object.hasOwn(MODE_POLICY, row.capability), row.id);
  assert.equal(DRAG_THRESHOLD, 4);
  assert.equal(DOUBLE_CLICK_TIME, 400);
});

test('defineTool copies the table row, fills defaults and freezes', () => {
  const tool = defineTool({ id: 'box', label: 'Rectangle', hotkey: 'X', capability: 'select', cursor: 'crosshair', hover: false });
  assert.equal(tool.label, 'Box');
  assert.equal(tool.hotkey, 'R');
  assert.equal(tool.capability, 'tool.box');
  assert.equal(tool.cursor, 'crosshair');
  assert.equal(tool.hover, false);
  assert.ok(Object.isFrozen(tool));
  const plain = defineTool({ id: 'select' });
  assert.equal(plain.cursor, 'default');
  assert.equal(plain.hover, true);
  assert.equal(plain.keyDown({ key: 'a' }), false);
  assert.equal(plain.cancel(), false);
  for (const name of ['activate', 'deactivate', 'pointerDown', 'pointerMove', 'pointerUp', 'drawOverlay']) {
    assert.equal(plain[name](), undefined);
  }
  assert.equal(plain.handleAt({ x: 0, y: 0 }), null);
  assert.equal(plain.readout(), null);
});

test('defineTool rejects handleAt and readout that are not functions', () => {
  assert.throws(() => defineTool({ id: 'select', handleAt: 'x' }), TypeError);
  assert.throws(() => defineTool({ id: 'select', readout: {} }), TypeError);
});

test('the registry forwards handleAt and readout to the active tool, null without a tool or a view', () => {
  const services = core();
  const seen = [];
  const select = defineTool({
    id: 'select',
    handleAt: (screen) => {
      seen.push(screen);
      return 'ring';
    },
    readout: () => ({ text: 'Δθ: 1.0°', screen: { x: 1, y: 2 } }),
  });
  const registry = new ToolRegistry(services, [select, defineTool({ id: 'box' })]);
  assert.equal(registry.handleAt({ x: 5, y: 6 }), null);
  assert.equal(registry.readout(), null);
  const unbind = registry.bindView(fakeView().view);
  assert.equal(registry.handleAt({ x: 5, y: 6 }), 'ring');
  assert.deepEqual(seen, [{ x: 5, y: 6 }]);
  assert.deepEqual(registry.readout(), { text: 'Δθ: 1.0°', screen: { x: 1, y: 2 } });
  registry.activate('box');
  assert.equal(registry.handleAt({ x: 5, y: 6 }), null);
  assert.equal(registry.readout(), null);
  registry.activate('select');
  unbind();
  assert.equal(registry.handleAt({ x: 5, y: 6 }), null);
  assert.equal(registry.readout(), null);
  const empty = new ToolRegistry(core(), [defineTool({ id: 'box' })]);
  empty.bindView(fakeView().view);
  assert.equal(empty.active, null);
  assert.equal(empty.handleAt({ x: 0, y: 0 }), null);
  assert.equal(empty.readout(), null);
});

test('defineTool rejects unknown ids and malformed members', () => {
  assert.throws(() => defineTool({ id: 'lasso' }), /Unknown tool/);
  assert.throws(() => defineTool({}), /Unknown tool/);
  assert.throws(() => defineTool({ id: 'select', pointerDown: 1 }), TypeError);
  assert.throws(() => defineTool({ id: 'select', cursor: 3 }), TypeError);
  assert.throws(() => defineTool({ id: 'select', hover: 'yes' }), TypeError);
});

test('the registry lists tools in TOOL_SPECS order and starts on Select without an event', () => {
  const log = [];
  const box = dragTool('box', log).tool;
  const select = dragTool('select', log).tool;
  const registry = new ToolRegistry(core(), [box, select]);
  assert.deepEqual(registry.list().map((tool) => tool.id), ['select', 'box']);
  assert.equal(registry.active, select);
  assert.equal(registry.get('box'), box);
  assert.equal(registry.get('hinge'), null);
  assert.equal(registry.has('hinge'), false);
  assert.deepEqual(log, ['select:activate']);
});

test('the registry rejects unknown and duplicate tools', () => {
  assert.throws(() => new ToolRegistry(core(), [{ id: 'lasso' }]), /Unknown tool/);
  assert.throws(() => new ToolRegistry(core(), [defineTool({ id: 'box' }), defineTool({ id: 'box' })]), /twice/);
});

test('without Select no tool is active', () => {
  const registry = new ToolRegistry(core(), [dragTool('box').tool]);
  assert.equal(registry.active, null);
  registry.pointer(input('down', 0));
  registry.pointer(input('up', 0));
  assert.equal(registry.key({ key: 'Enter' }), false);
});

test('activate follows the mode policy and emits tool', () => {
  const services = core();
  const log = [];
  const registry = new ToolRegistry(services, [dragTool('select', log).tool, dragTool('box', log).tool, dragTool('pose', log).tool]);
  const events = [];
  registry.on('tool', (event) => events.push(event));
  assert.equal(registry.activate('hinge'), false);
  assert.equal(registry.activate('select'), true);
  assert.deepEqual(events, []);
  assert.equal(registry.activate('box'), true);
  assert.equal(registry.active.id, 'box');
  assert.deepEqual(events, [{ id: 'box', previous: 'select' }]);
  assert.deepEqual(log, ['select:activate', 'select:cancel', 'select:deactivate', 'box:activate']);
  services.modes.openClip(addClip(services.history));
  assert.equal(registry.active.id, 'select');
  assert.equal(registry.canActivate('box'), false);
  assert.equal(registry.activate('box'), false);
  assert.equal(registry.canActivate('pose'), true);
  assert.equal(registry.activate('pose'), true);
  assert.deepEqual(events.slice(1), [{ id: 'select', previous: 'box' }, { id: 'pose', previous: 'select' }]);
});

test('a mode change without Select falls back to no tool', () => {
  const services = core();
  const registry = new ToolRegistry(services, [dragTool('box').tool, dragTool('pose').tool]);
  const events = [];
  registry.on('tool', (event) => events.push(event));
  registry.activate('pose');
  services.modes.openClip(addClip(services.history));
  assert.equal(registry.active.id, 'pose');
  registry.activate('box');
  assert.equal(registry.active.id, 'pose');
  services.modes.openClip(null);
  registry.activate('box');
  services.modes.openClip(addClip(services.history));
  assert.equal(registry.active, null);
  assert.deepEqual(events, [
    { id: 'pose', previous: null },
    { id: 'box', previous: 'pose' },
    { id: null, previous: 'box' },
  ]);
});

test('a left press, drag and release is one undo step', () => {
  const services = core();
  const { tool, log } = dragTool('select');
  const registry = new ToolRegistry(services, [tool]);
  drag(registry, 3);
  assert.equal(rootName(services.model), 'dropped');
  assert.equal(services.history.inGesture, false);
  assert.equal(services.history.undo(), true);
  assert.equal(rootName(services.model), 'root');
  assert.equal(services.history.canUndo, false);
  assert.deepEqual(log.slice(1), ['select:down:0', 'select:move', 'select:move', 'select:move', 'select:up:0']);
});

test('pointer events carry world and root-local coordinates', () => {
  const services = core();
  const seen = [];
  const registry = new ToolRegistry(services, [defineTool({ id: 'select', pointerMove: (e) => seen.push(e) })]);
  services.history.execute(setProps([ROOT_UID], { position: [1, 0], angle: Math.PI / 2 }));
  registry.pointer(input('move', -1, 300, 100, { shift: true }));
  const [event] = seen;
  assert.ok(Object.isFrozen(event));
  assert.equal(event.shift, true);
  assert.deepEqual(event.screen, { x: 300, y: 100 });
  assert.deepEqual(event.world, { x: 1, y: 1 });
  assert.ok(Math.abs(event.local.x - 1) < EPSILON && Math.abs(event.local.y) < EPSILON);
});

test('the context converts, snaps and reaches the view only while bound', () => {
  const services = core();
  const { tool, context } = dragTool('select');
  const registry = new ToolRegistry(services, [tool]);
  const ctx = context();
  assert.ok(Object.isFrozen(ctx));
  for (const name of ['model', 'history', 'selection', 'modes', 'settings', 'camera']) assert.equal(ctx[name], services[name]);
  services.history.execute(setProps([ROOT_UID], { position: [2, 0], angle: Math.PI }));
  const local = ctx.toLocal({ x: 1, y: 0 });
  assert.ok(Math.abs(local.x - 1) < EPSILON && Math.abs(local.y) < EPSILON);
  const world = ctx.toWorld({ x: 1, y: 0 });
  assert.ok(Math.abs(world.x - 1) < EPSILON && Math.abs(world.y) < EPSILON);
  assert.deepEqual(ctx.snapPoint({ x: 0.123, y: 0.456 }), { x: 0.123, y: 0.456 });
  services.settings.set('snap.grid', true);
  assert.deepEqual(ctx.snapPoint({ x: 0.123, y: 0.456 }), { x: 0.1, y: 0.5 });
  assert.equal(ctx.snapLength(0.01), 0.1);
  assert.equal(ctx.snapAngle(0.3, true), Math.PI / 12);
  assert.deepEqual(ctx.hitTest({ x: 1, y: 1 }), []);
  ctx.setCursor('move');
  ctx.invalidateOverlay();
  const { view, calls } = fakeView();
  const unbind = registry.bindView(view);
  assert.deepEqual(calls.cursor, ['move']);
  assert.deepEqual(ctx.hitTest({ x: 1, y: 1 }), [ROOT_UID]);
  ctx.setCursor(null);
  assert.deepEqual(calls.cursor, ['move', 'default']);
  ctx.invalidateOverlay();
  assert.equal(calls.invalidations, 1);
  unbind();
  assert.deepEqual(ctx.hitTest({ x: 1, y: 1 }), []);
  ctx.invalidateOverlay();
  assert.equal(calls.invalidations, 1);
});

test('the context box test forwards to the bound view and is empty unbound', () => {
  const services = core();
  const { tool, context } = dragTool('select');
  const registry = new ToolRegistry(services, [tool]);
  const ctx = context();
  const box = { minX: -1, minY: -2, maxX: 3, maxY: 4 };
  assert.deepEqual(ctx.boxTest(box), []);
  const { view, calls } = fakeView();
  const unbind = registry.bindView(view);
  assert.deepEqual(ctx.boxTest(box), [7, 8]);
  assert.deepEqual(calls.boxes, [box]);
  unbind();
  assert.deepEqual(ctx.boxTest(box), []);
  assert.equal(calls.boxes.length, 1);
});

test('the context setPose forwards to the bound view and does nothing unbound', () => {
  const services = core();
  const { tool, context } = dragTool('select');
  const registry = new ToolRegistry(services, [tool]);
  const ctx = context();
  const pose = new Map([[5, { x: 1, y: 2, angle: 0.5 }]]);
  ctx.setPose(pose);
  const { view } = fakeView();
  const poses = [];
  const unbind = registry.bindView({ ...view, setPose: (value) => poses.push(value) });
  ctx.setPose(pose);
  ctx.setPose(null);
  ctx.setPose(undefined);
  assert.deepEqual(poses, [pose, null, null]);
  unbind();
  ctx.setPose(pose);
  assert.equal(poses.length, 3);
});

test('the context physics is the core service, or null when omitted', () => {
  const physics = { startPose: () => null };
  const withPhysics = dragTool('select');
  new ToolRegistry({ ...core(), physics }, [withPhysics.tool]);
  assert.equal(withPhysics.context().physics, physics);
  const without = dragTool('select');
  new ToolRegistry(core(), [without.tool]);
  assert.equal(without.context().physics, null);
});

test('the context editorVersion is the core getter, or dev when omitted', () => {
  const given = dragTool('select');
  new ToolRegistry({ ...core(), editorVersion: () => '1.2.3' }, [given.tool]);
  assert.equal(given.context().editorVersion(), '1.2.3');
  const without = dragTool('select');
  new ToolRegistry(core(), [without.tool]);
  assert.equal(without.context().editorVersion(), 'dev');
});

test('tick forwards the frame time to the active tool only', () => {
  const ticks = [];
  const registry = new ToolRegistry(core(), [
    defineTool({ id: 'select', tick: (seconds) => ticks.push(['select', seconds]) }),
    defineTool({ id: 'circle', tick: (seconds) => ticks.push(['circle', seconds]) }),
  ]);
  registry.tick(0.016);
  registry.activate('circle');
  registry.tick(0.032);
  assert.deepEqual(ticks, [['select', 0.016], ['circle', 0.032]]);
  assert.doesNotThrow(() => new ToolRegistry(core(), []).tick(1));
  assert.doesNotThrow(() => defineTool({ id: 'box' }).tick(1));
});

test('a tick that throws during a press cancels it and rethrows', () => {
  const services = core();
  let cancels = 0;
  const registry = new ToolRegistry(services, [
    defineTool({
      id: 'select',
      tick: () => {
        throw new Error('tick');
      },
      cancel: () => {
        cancels++;
        return true;
      },
    }),
  ]);
  registry.pointer(input('down', 0));
  assert.throws(() => registry.tick(0.016), { message: 'tick' });
  assert.equal(cancels, 1);
  assert.equal(services.history.inGesture, false);
});

test('activation applies the tool cursor and invalidates the overlay', () => {
  const registry = new ToolRegistry(core(), [
    defineTool({ id: 'select' }),
    defineTool({ id: 'circle', cursor: 'crosshair', hover: false }),
  ]);
  const { view, calls } = fakeView();
  registry.bindView(view);
  registry.activate('circle');
  assert.deepEqual(calls.cursor, ['default', 'crosshair']);
  assert.ok(calls.invalidations >= 1);
});

test('drawOverlay clears the graphics and lets the active tool draw', () => {
  const registry = new ToolRegistry(core(), [dragTool('select').tool]);
  const g = { cleared: 0, drawn: [], clear() { this.cleared++; } };
  registry.drawOverlay(g);
  assert.equal(g.cleared, 1);
  assert.deepEqual(g.drawn, ['select']);
  const empty = new ToolRegistry(core(), []);
  empty.drawOverlay(g);
  assert.equal(g.cleared, 2);
  assert.deepEqual(g.drawn, ['select']);
});

function assertNoStep(services) {
  assert.equal(rootName(services.model), 'root');
  assert.equal(services.history.inGesture, false);
  assert.equal(services.history.canUndo, false);
}

test('Esc during a drag reverts it, leaves no step and swallows the rest of the press', () => {
  const services = core();
  const { tool, log } = dragTool('select');
  const registry = new ToolRegistry(services, [tool]);
  registry.pointer(input('down', 0));
  registry.pointer(input('move', 0, 210, 200));
  assert.equal(registry.key({ key: 'Escape' }), false);
  assert.equal(registry.cancel(), true);
  assertNoStep(services);
  registry.pointer(input('move', 0, 220, 200));
  registry.pointer(input('down', 2));
  registry.pointer(input('up', 0));
  assertNoStep(services);
  assert.deepEqual(log.slice(1), ['select:down:0', 'select:move', 'select:cancel']);
  registry.pointer(input('move', -1, 230, 200));
  assert.deepEqual(log.slice(-1), ['select:move']);
  assert.equal(registry.cancel(), false);
});

test('choosing another tool during a drag reverts it', () => {
  const services = core();
  const select = dragTool('select');
  const registry = new ToolRegistry(services, [select.tool, dragTool('box').tool]);
  registry.pointer(input('down', 0));
  registry.pointer(input('move', 0, 210, 200));
  registry.activate('box');
  assertNoStep(services);
  registry.pointer(input('up', 0));
  assertNoStep(services);
  assert.deepEqual(select.log.slice(-2), ['select:cancel', 'select:deactivate']);
});

test('Undo during a drag reverts it and cancels the tool', () => {
  const services = core();
  const { tool, log } = dragTool('select');
  const registry = new ToolRegistry(services, [tool]);
  registry.pointer(input('down', 0));
  registry.pointer(input('move', 0, 210, 200));
  assert.equal(services.history.undo(), true);
  assert.deepEqual(log.slice(-1), ['select:cancel']);
  registry.pointer(input('move', 0, 220, 200));
  registry.pointer(input('up', 0));
  assertNoStep(services);
});

test('a mode change during a drag reverts it', () => {
  const services = core();
  const clip = addClip(services.history);
  const { tool, log } = dragTool('select');
  const registry = new ToolRegistry(services, [tool]);
  registry.pointer(input('down', 0));
  registry.pointer(input('move', 0, 210, 200));
  services.modes.openClip(clip);
  registry.pointer(input('up', 0));
  assert.equal(rootName(services.model), 'root');
  assert.equal(services.history.inGesture, false);
  assert.equal(services.history.state.undoLabel, 'Add clip');
  assert.ok(log.includes('select:cancel'));
  assert.equal(registry.active, tool);
});

test('a reset during a drag cancels the tool and swallows the release', () => {
  const services = core();
  const { tool, log } = dragTool('select');
  const registry = new ToolRegistry(services, [tool]);
  registry.pointer(input('down', 0));
  registry.pointer(input('move', 0, 210, 200));
  const { meta, units, preview } = defaultsOf('document');
  services.model.reset({ type: 'root', props: { ...defaultsOf('root'), meta, units, preview } });
  assert.ok(log.includes('select:cancel'));
  registry.pointer(input('up', 0));
  assertNoStep(services);
});

test('a press is ignored while a gesture owned elsewhere is open', () => {
  const services = core();
  const { tool, log } = dragTool('select');
  const registry = new ToolRegistry(services, [tool]);
  services.history.beginGesture();
  registry.pointer(input('down', 0));
  registry.pointer(input('up', 0));
  assert.deepEqual(log.slice(1), []);
  assert.equal(registry.cancel(), true);
  assert.equal(services.history.inGesture, false);
});

test('right presses pass without a gesture, but not during a left press', () => {
  const services = core();
  const { tool, log } = dragTool('select');
  const registry = new ToolRegistry(services, [tool]);
  const states = [];
  services.history.on('history', (state) => states.push(state.gesture));
  registry.pointer(input('down', 2));
  registry.pointer(input('up', 2));
  assert.deepEqual(states, []);
  registry.pointer(input('down', 0));
  registry.pointer(input('down', 2));
  registry.pointer(input('up', 2));
  registry.pointer(input('down', 0));
  registry.pointer(input('up', 0));
  assert.deepEqual(log.slice(1), ['select:down:2', 'select:up:2', 'select:down:0', 'select:up:0']);
  assert.equal(services.history.state.undoLabel, 'Drag');
});

test('a cancelled press whose release was lost ends on the next idle move or press', () => {
  const services = core();
  const { tool, log } = dragTool('select');
  const registry = new ToolRegistry(services, [tool]);
  registry.pointer(input('down', 0));
  registry.cancel();
  registry.pointer(input('move', -1, 210, 200, { buttons: 0 }));
  assert.deepEqual(log.slice(-1), ['select:move']);
  registry.pointer(input('down', 0));
  registry.cancel();
  registry.pointer(input('down', 0));
  registry.pointer(input('up', 0));
  assert.equal(rootName(services.model), 'dropped');
});

test('a handler that throws during a press cancels it and rethrows', () => {
  const services = core();
  let fail = false;
  const registry = new ToolRegistry(services, [
    defineTool({
      id: 'select',
      pointerMove() {
        services.history.execute(setProps([ROOT_UID], { name: 'moved' }));
        if (fail) throw new Error('boom');
      },
    }),
  ]);
  registry.pointer(input('down', 0));
  registry.pointer(input('move', 0, 210, 200));
  fail = true;
  assert.throws(() => registry.pointer(input('move', 0, 220, 200)), /boom/);
  assertNoStep(services);
  registry.pointer(input('up', 0));
  assertNoStep(services);
});

test('a release whose handler throws aborts the press and rethrows', () => {
  const services = core();
  let cancels = 0;
  const registry = new ToolRegistry(services, [
    defineTool({
      id: 'select',
      pointerMove() {
        services.history.execute(setProps([ROOT_UID], { name: 'moved' }));
      },
      pointerUp() {
        services.history.execute(setProps([ROOT_UID], { name: 'released' }));
        throw new Error('boom');
      },
      cancel() {
        cancels++;
        return true;
      },
    }),
  ]);
  registry.pointer(input('down', 0));
  registry.pointer(input('move', 0, 210, 200));
  assert.throws(() => registry.pointer(input('up', 0)), /boom/);
  assert.equal(cancels, 1);
  assert.equal(services.history.inGesture, false);
  assert.equal(rootName(services.model), 'root');
  assertNoStep(services);
});

test('keys reach the active tool converted, except Escape', () => {
  const seen = [];
  const registry = new ToolRegistry(core(), [
    defineTool({
      id: 'select',
      keyDown(e) {
        seen.push(e);
        return e.key === 'Enter';
      },
    }),
  ]);
  assert.equal(registry.key({ key: 'Enter', code: 'Enter', metaKey: true, repeat: true }), true);
  assert.equal(registry.key({ key: 'a', shiftKey: true, altKey: true }), false);
  assert.equal(registry.key({ key: 'Escape' }), false);
  assert.deepEqual(seen, [
    { key: 'Enter', code: 'Enter', shift: false, ctrl: true, alt: false, repeat: true },
    { key: 'a', code: '', shift: true, ctrl: false, alt: true, repeat: false },
  ]);
});

test('cancel reports a multi-click operation aborted by the tool', () => {
  let drawing = true;
  const registry = new ToolRegistry(core(), [
    defineTool({
      id: 'select',
      cancel() {
        const was = drawing;
        drawing = false;
        return was;
      },
    }),
  ]);
  assert.equal(registry.cancel(), true);
  assert.equal(registry.cancel(), false);
});
