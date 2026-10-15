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

test('createEditor builds a tool registry with no tools before the tool issues', () => {
  const editor = createEditor();
  assert.ok(editor.tools instanceof ToolRegistry);
  assert.notEqual(createEditor().tools, editor.tools);
  assert.deepEqual(editor.tools.list(), []);
  assert.equal(editor.tools.active, null);
});

test('tool actions of unregistered tools report not available yet', () => {
  const { actions, tools } = createEditor();
  for (const { id } of TOOL_SPECS) {
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

test('undo through the action during a gesture only cancels it', () => {
  const { history, actions, model } = createEditor();
  history.execute(setProps([ROOT_UID], { 'meta.name': 'kept' }));
  history.beginGesture();
  history.execute(setProps([ROOT_UID], { 'meta.name': 'dragged' }));
  actions.run('undo');
  assert.equal(model.prop(ROOT_UID, 'meta.name'), 'kept');
});
