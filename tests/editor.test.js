import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { Selection } from '../js/model/selection.js';
import { Modes } from '../js/modes.js';
import { ActionRegistry } from '../js/actions.js';
import { setProps } from '../js/commands/props.js';
import { Settings } from '../js/settings.js';
import { Camera } from '../js/viewport/camera.js';
import { ToolRegistry } from '../js/tools/registry.js';
import { TOOL_SPECS } from '../js/tools/tool.js';
import { defaultsOf } from '../lib/schema.js';
import { dispatchKey } from '../js/hotkeys.js';

function addClip(editor) {
  const { tracks, events, ...props } = defaultsOf('clip');
  return editor.history.execute({
    label: 'Add clip',
    run: (tx) => tx.add(ROOT_UID, 'clips', undefined, { type: 'clip', props }),
  });
}

test('createEditor builds the core objects', () => {
  const editor = createEditor();
  assert.ok(Object.isFrozen(editor));
  assert.ok(editor.model instanceof Model);
  assert.ok(editor.history instanceof History);
  assert.ok(editor.selection instanceof Selection);
  assert.ok(editor.modes instanceof Modes);
  assert.ok(editor.actions instanceof ActionRegistry);
  for (const id of ['undo', 'redo', 'escape']) assert.equal(editor.actions.has(id), true, id);
  for (const id of ['new', 'load', 'save', 'play', 'pause', 'next-frame', 'stop', 'toggle-play']) {
    assert.equal(editor.actions.reason(id), 'not available yet', id);
  }
});

test('createEditor owns default settings and a camera when no settings are given', () => {
  const editor = createEditor();
  assert.ok(editor.settings instanceof Settings);
  assert.deepEqual(editor.settings.toJSON(), new Settings().toJSON());
  assert.ok(editor.camera instanceof Camera);
  assert.deepEqual(editor.camera.center, { x: 0, y: 0 });
  assert.notEqual(createEditor().settings, editor.settings);
  assert.notEqual(createEditor().camera, editor.camera);
});

test('createEditor uses the given settings instance', () => {
  const { settings } = Settings.restore({ version: 1, grid: { size: 2 }, display: { mode: 'shapes' } });
  const editor = createEditor({ settings });
  assert.equal(editor.settings, settings);
  assert.equal(editor.settings.get('grid.size'), 2);
  assert.equal(editor.settings.get('display.mode'), 'shapes');
  assert.throws(() => createEditor({ settings: { get: () => 1 } }), TypeError);
});

test('settings, camera and mode changes stay out of history', () => {
  const editor = createEditor();
  const { history, settings, camera, modes } = editor;
  settings.set('snap.grid', true);
  camera.setSize(800, 600);
  camera.zoomAt({ x: 100, y: 100 }, 2);
  history.beginGesture();
  modes.startSimulate();
  assert.equal(history.canUndo, false);
  assert.equal(settings.get('snap.grid'), true);
  assert.equal(camera.scale, 64);
});

test('the editor registers no viewport or settings actions', () => {
  const { actions } = createEditor();
  for (const id of ['settings', 'frame-selection', 'frame-all']) {
    assert.equal(actions.has(id), false, id);
    assert.equal(actions.reason(id), 'not available yet', id);
  }
});

test('undo and redo actions follow the history state with no reason', () => {
  const { history, actions } = createEditor();
  assert.equal(actions.isEnabled('undo'), false);
  assert.equal(actions.reason('undo'), null);
  history.execute(setProps([ROOT_UID], { 'meta.name': 'hero' }));
  assert.equal(actions.isEnabled('undo'), true);
  assert.equal(actions.run('undo'), true);
  assert.equal(history.canUndo, false);
  assert.equal(actions.isEnabled('redo'), true);
  assert.equal(actions.run('redo'), true);
  assert.equal(actions.isRepeatable('undo'), true);
  assert.equal(actions.isRepeatable('redo'), true);
  assert.equal(actions.isRepeatable('escape'), false);
});

test('undo and redo are disabled in Simulate with the mode reason', () => {
  const editor = createEditor();
  const { history, modes, actions } = editor;
  history.execute(setProps([ROOT_UID], { 'meta.name': 'a' }));
  history.execute(setProps([ROOT_UID], { 'meta.name': 'b' }));
  history.undo();
  modes.startSimulate();
  assert.equal(actions.isEnabled('undo'), false);
  assert.equal(actions.isEnabled('redo'), false);
  assert.equal(actions.reason('undo'), 'not available in Simulate mode');
  assert.equal(actions.reason('redo'), 'not available in Simulate mode');
  assert.equal(actions.run('undo'), false);
  assert.equal(editor.model.prop(ROOT_UID, 'meta.name'), 'a');
  modes.stopSimulate();
  assert.equal(actions.isEnabled('undo'), true);
});

test('a mode change cancels the open gesture', () => {
  const editor = createEditor();
  const { history, modes, model } = editor;
  const clip = addClip(editor);
  history.beginGesture();
  history.execute(setProps([ROOT_UID], { 'meta.name': 'dragged' }));
  modes.openClip(clip);
  assert.equal(history.inGesture, false);
  assert.equal(model.prop(ROOT_UID, 'meta.name'), 'ragdoll');
  assert.equal(history.state.undoLabel, 'Add clip');
});

test('the cancel listener runs before other mode listeners', () => {
  const editor = createEditor();
  const { history, modes } = editor;
  let sawGesture = null;
  modes.on('mode', () => {
    sawGesture = history.inGesture;
  });
  history.beginGesture();
  modes.startSimulate();
  assert.equal(sawGesture, false);
});

test('escape cancels an open gesture, else clears the selection', () => {
  const editor = createEditor();
  const { history, selection, actions, model } = editor;
  selection.set([ROOT_UID]);
  history.beginGesture();
  history.execute(setProps([ROOT_UID], { 'meta.name': 'x' }));
  assert.equal(actions.run('escape'), true);
  assert.equal(history.inGesture, false);
  assert.equal(model.prop(ROOT_UID, 'meta.name'), 'ragdoll');
  assert.deepEqual(selection.objects, [ROOT_UID]);
  actions.run('escape');
  assert.deepEqual(selection.objects, []);
});

const SELECTION_TOOLS = ['select', 'select-box'];
const CREATION_TOOLS = ['circle', 'box', 'hinge'];
const REGISTERED_TOOLS = [...SELECTION_TOOLS, ...CREATION_TOOLS];

test('createEditor builds a tool registry with the built tools, Select active', () => {
  const editor = createEditor();
  assert.ok(editor.tools instanceof ToolRegistry);
  assert.notEqual(createEditor().tools, editor.tools);
  assert.deepEqual(editor.tools.list().map((tool) => tool.id).sort(), [...REGISTERED_TOOLS].sort());
  assert.equal(editor.tools.active?.id, 'select');
});

test('tool actions of registered tools activate them in Edit mode and follow the mode policy in Simulate', () => {
  const { actions, tools, modes } = createEditor();
  for (const id of REGISTERED_TOOLS) {
    const action = `tool:${id}`;
    assert.equal(actions.has(action), true, action);
    assert.equal(actions.isEnabled(action), true, action);
    actions.run(action);
    assert.equal(tools.active?.id, id, action);
  }
  modes.startSimulate();
  for (const id of SELECTION_TOOLS) {
    const action = `tool:${id}`;
    assert.equal(actions.isEnabled(action), true, action);
    assert.equal(actions.reason(action), null, action);
  }
  for (const id of CREATION_TOOLS) {
    const action = `tool:${id}`;
    assert.equal(actions.isEnabled(action), false, action);
    assert.equal(actions.reason(action), 'not available in Simulate mode', action);
  }
});

test('entering Animate with Circle active activates Select', () => {
  const editor = createEditor();
  const { actions, tools, modes } = editor;
  actions.run('tool:circle');
  modes.openClip(addClip(editor));
  assert.equal(tools.active?.id, 'select');
});

test('tool actions of unregistered tools report not available yet', () => {
  const { actions, tools } = createEditor();
  for (const { id } of TOOL_SPECS.filter((row) => !REGISTERED_TOOLS.includes(row.id))) {
    const action = `tool:${id}`;
    assert.equal(tools.has(id), false, id);
    assert.equal(actions.has(action), false, action);
    assert.equal(actions.isEnabled(action), false, action);
    assert.equal(actions.reason(action), 'not available yet', action);
    assert.equal(actions.run(action), false, action);
  }
});

test('escape cancels through the tool registry, else clears the selection', () => {
  const editor = createEditor();
  const { history, selection, actions, tools, model } = editor;
  selection.set([ROOT_UID]);
  history.beginGesture();
  history.execute(setProps([ROOT_UID], { 'meta.name': 'x' }));
  assert.equal(tools.cancel(), true);
  assert.equal(model.prop(ROOT_UID, 'meta.name'), 'ragdoll');
  history.beginGesture();
  actions.run('escape');
  assert.equal(history.inGesture, false);
  assert.deepEqual(selection.objects, [ROOT_UID]);
  assert.equal(tools.cancel(), false);
  actions.run('escape');
  assert.deepEqual(selection.objects, []);
});

test('tool:hinge is enabled in Edit mode and refused in Animate mode', () => {
  const editor = createEditor();
  const { actions, tools, modes } = editor;
  assert.equal(actions.isEnabled('tool:hinge'), true);
  assert.equal(actions.run('tool:hinge'), true);
  assert.equal(tools.active?.id, 'hinge');
  modes.openClip(addClip(editor));
  assert.equal(actions.isEnabled('tool:hinge'), false);
  assert.equal(actions.reason('tool:hinge'), 'not available in Animate mode');
  assert.notEqual(tools.active?.id, 'hinge');
});

test('manipulate is not registered and M is no tool hotkey', () => {
  const { actions, tools } = createEditor();
  assert.equal(tools.has('manipulate'), false);
  assert.equal(actions.has('tool:manipulate'), false);
  assert.equal(TOOL_SPECS.some((row) => row.id === 'manipulate' || row.hotkey === 'M'), false);
});

test('pivot-mode toggles gizmo.pivot in every mode and is disabled during a gesture', () => {
  const editor = createEditor();
  const { actions, settings, modes, history } = editor;
  assert.equal(settings.get('gizmo.pivot'), 'center');
  assert.equal(actions.isEnabled('pivot-mode'), true);
  assert.equal(actions.reason('pivot-mode'), null);
  assert.equal(actions.run('pivot-mode'), true);
  assert.equal(settings.get('gizmo.pivot'), 'last');
  modes.openClip(addClip(editor));
  assert.equal(actions.run('pivot-mode'), true);
  assert.equal(settings.get('gizmo.pivot'), 'center');
  modes.startSimulate();
  assert.equal(actions.run('pivot-mode'), true);
  assert.equal(settings.get('gizmo.pivot'), 'last');
  modes.stopSimulate();
  history.beginGesture();
  assert.equal(actions.isEnabled('pivot-mode'), false);
  assert.equal(actions.reason('pivot-mode'), null);
  assert.equal(actions.run('pivot-mode'), false);
  assert.equal(settings.get('gizmo.pivot'), 'last');
  history.cancelGesture();
  assert.equal(actions.isEnabled('pivot-mode'), true);
  const event = { key: 'z', target: { tagName: 'BODY' }, preventDefault() {} };
  assert.equal(dispatchKey(event, { actions, tools: editor.tools, viewportFocused: true }), true);
  assert.equal(settings.get('gizmo.pivot'), 'center');
});

test('undo through the action during a gesture only cancels it', () => {
  const { history, actions, model } = createEditor();
  history.execute(setProps([ROOT_UID], { 'meta.name': 'kept' }));
  history.beginGesture();
  history.execute(setProps([ROOT_UID], { 'meta.name': 'dragged' }));
  actions.run('undo');
  assert.equal(model.prop(ROOT_UID, 'meta.name'), 'kept');
});

const EDIT_ACTIONS = ['delete', 'add-shape', 'add-joint'];

function deleteKey() {
  return {
    key: 'Delete',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    target: { tagName: 'BODY' },
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

test('add-shape creates a selected default box body at the origin as one Add shape step', () => {
  const { model, history, selection, actions } = createEditor();
  assert.equal(actions.isEnabled('add-shape'), true);
  assert.equal(actions.isRepeatable('add-shape'), false);
  assert.equal(actions.run('add-shape'), true);
  const [body] = model.children(ROOT_UID, 'bodies');
  const [shape] = model.children(body, 'fixtures');
  assert.deepEqual(selection.objects, [shape]);
  assert.deepEqual([...model.prop(body, 'position')], [0, 0]);
  assert.equal(model.prop(body, 'angle'), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(model.prop(shape, 'shape'))), defaultsOf('shape', 'box').shape);
  assert.equal(model.prop(shape, 'name'), 'box_1');
  assert.equal(model.prop(ROOT_UID, 'rootBody'), model.prop(body, 'id'));
  assert.equal(history.state.undoLabel, 'Add shape');
  history.undo();
  assert.deepEqual(model.children(ROOT_UID, 'bodies'), []);
  assert.equal(model.prop(ROOT_UID, 'rootBody'), null);
});

test('add-joint creates a selected unassigned joint at the origin as one Add joint step', () => {
  const { model, history, selection, actions } = createEditor();
  assert.equal(actions.run('add-joint'), true);
  const [joint] = model.children(ROOT_UID, 'joints');
  assert.deepEqual(selection.objects, [joint]);
  assert.equal(model.prop(joint, 'bodyA'), null);
  assert.equal(model.prop(joint, 'bodyB'), null);
  assert.deepEqual([...model.prop(joint, 'anchor')], [0, 0]);
  assert.equal(model.prop(joint, 'limits.enabled'), false);
  assert.equal(model.prop(joint, 'name'), 'joint_1');
  assert.equal(history.state.undoLabel, 'Add joint');
  history.undo();
  assert.deepEqual(model.children(ROOT_UID, 'joints'), []);
});

test('delete removes the selection as one Delete step and is disabled when nothing can be deleted', () => {
  const { model, history, selection, actions } = createEditor();
  assert.equal(actions.isEnabled('delete'), false);
  assert.equal(actions.reason('delete'), null);
  selection.set([ROOT_UID]);
  assert.equal(actions.isEnabled('delete'), false);
  assert.equal(actions.reason('delete'), 'the ragdoll root cannot be deleted');
  actions.run('add-shape');
  const shape = selection.objects[0];
  selection.add([ROOT_UID]);
  assert.equal(actions.isEnabled('delete'), true);
  assert.equal(actions.isRepeatable('delete'), false);
  assert.equal(actions.run('delete'), true);
  assert.deepEqual(model.children(ROOT_UID, 'bodies'), []);
  assert.deepEqual(selection.objects, [ROOT_UID]);
  assert.equal(history.state.undoLabel, 'Delete');
  history.undo();
  assert.equal(model.get(shape).type, 'shape');
});

test('with only the root selected, the mode reason wins over the root reason, and a gesture shows none', () => {
  const editor = createEditor();
  const { history, selection, actions, modes } = editor;
  selection.set([ROOT_UID]);
  history.beginGesture();
  assert.equal(actions.reason('delete'), null);
  history.endGesture();
  assert.equal(actions.reason('delete'), 'the ragdoll root cannot be deleted');
  modes.openClip(addClip(editor));
  selection.set([ROOT_UID]);
  assert.equal(actions.reason('delete'), 'not available in Animate mode');
  modes.openClip(null);
  modes.startSimulate();
  selection.set([ROOT_UID]);
  assert.equal(actions.reason('delete'), 'not available in Simulate mode');
});

test('delete is disabled with no reason while the timeline holds the selection focus', () => {
  const editor = createEditor();
  const { history, selection, actions } = editor;
  actions.run('add-shape');
  const clip = addClip(editor);
  const key = history.execute({
    label: 'Add track',
    run: (tx) => {
      const track = tx.add(clip, 'tracks', undefined, {
        type: 'track',
        props: { target: 'root', channel: 'strength' },
        children: { keys: [{ type: 'key', props: { time: 0, value: 1 } }] },
      });
      return tx.model.children(track, 'keys')[0];
    },
  });
  selection.set([key]);
  assert.equal(actions.isEnabled('delete'), false);
  assert.equal(actions.reason('delete'), null);
});

test('delete, add-shape and add-joint are refused with the mode reason in Animate and Simulate', () => {
  const editor = createEditor();
  const { selection, actions, modes } = editor;
  actions.run('add-shape');
  const shape = selection.objects[0];
  modes.openClip(addClip(editor));
  selection.set([shape]);
  for (const id of EDIT_ACTIONS) {
    assert.equal(actions.isEnabled(id), false, id);
    assert.equal(actions.reason(id), 'not available in Animate mode', id);
    assert.equal(actions.run(id), false, id);
  }
  modes.openClip(null);
  modes.startSimulate();
  selection.set([shape]);
  for (const id of EDIT_ACTIONS) assert.equal(actions.reason(id), 'not available in Simulate mode', id);
  assert.equal(editor.model.get(shape).type, 'shape');
});

test('delete, add-shape and add-joint are disabled with no reason during a gesture', () => {
  const { model, history, selection, actions } = createEditor();
  actions.run('add-shape');
  history.beginGesture();
  for (const id of EDIT_ACTIONS) {
    assert.equal(actions.isEnabled(id), false, id);
    assert.equal(actions.reason(id), null, id);
    assert.equal(actions.run(id), false, id);
  }
  assert.equal(model.children(ROOT_UID, 'bodies').length, 1);
  assert.equal(selection.objects.length, 1);
  history.endGesture();
});

test('deleting the open clip during a gesture does not throw', () => {
  const editor = createEditor();
  const { history, selection, actions, modes } = editor;
  const clip = addClip(editor);
  modes.openClip(clip);
  selection.set([clip]);
  history.beginGesture();
  assert.doesNotThrow(() => actions.run('delete'));
  assert.equal(history.inGesture, true);
  assert.equal(modes.clip, clip);
  history.cancelGesture();
});

test('Del through dispatchKey deletes the selection', () => {
  const { model, selection, actions } = createEditor();
  actions.run('add-joint');
  actions.run('add-shape');
  selection.add([model.children(ROOT_UID, 'joints')[0]]);
  const event = deleteKey();
  assert.equal(dispatchKey(event, { actions }), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(model.children(ROOT_UID, 'bodies'), []);
  assert.deepEqual(model.children(ROOT_UID, 'joints'), []);
  assert.deepEqual(selection.objects, []);
});
