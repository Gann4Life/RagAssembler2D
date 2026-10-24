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
import { createJoint, createShapeBody } from '../js/commands/create.js';
import { toJson } from '../js/model/io.js';
import { balanceTorqueSuggestion, motorTorqueSuggestions } from '../lib/motor.js';

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
  for (const id of ['load', 'save', 'play', 'pause', 'next-frame', 'stop', 'toggle-play']) {
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

test('undo and redo actions follow the history state with their state reasons', () => {
  const { history, actions } = createEditor();
  assert.equal(actions.isEnabled('undo'), false);
  assert.equal(actions.reason('undo'), 'nothing to undo');
  assert.equal(actions.reason('redo'), 'nothing to redo');
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
  assert.equal(actions.reason('undo'), 'only in Edit and Animate modes');
  assert.equal(actions.reason('redo'), 'only in Edit and Animate modes');
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
  assert.equal(model.prop(ROOT_UID, 'meta.name'), 'root');
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
  assert.equal(model.prop(ROOT_UID, 'meta.name'), 'root');
  assert.deepEqual(selection.objects, [ROOT_UID]);
  actions.run('escape');
  assert.deepEqual(selection.objects, []);
});

const SELECTION_TOOLS = ['select', 'select-box'];
const MANIPULATION_TOOLS = ['pose'];
const CREATION_TOOLS = ['circle', 'box', 'hinge'];
const REGISTERED_TOOLS = [...SELECTION_TOOLS, ...MANIPULATION_TOOLS, ...CREATION_TOOLS];

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
  for (const id of [...MANIPULATION_TOOLS, ...CREATION_TOOLS]) {
    const action = `tool:${id}`;
    assert.equal(actions.isEnabled(action), false, action);
    const expected = MANIPULATION_TOOLS.includes(id) ? 'only in Edit and Animate modes' : 'only in Edit mode';
    assert.equal(actions.reason(action), expected, action);
  }
});

test('entering Animate keeps Circle active but unusable; a press only reports the reason', () => {
  const messages = [];
  const editor = createEditor({ status: (text) => messages.push(text) });
  const { actions, tools, modes, history, model } = editor;
  actions.run('tool:circle');
  modes.openClip(addClip(editor));
  assert.equal(tools.active?.id, 'circle');
  assert.equal(tools.usable, false);
  const before = history.state;
  tools.pointer({ type: 'down', button: 0, buttons: 1, screen: { x: 10, y: 10 }, shift: false, ctrl: false, alt: false, clicks: 1 });
  tools.pointer({ type: 'up', button: 0, buttons: 0, screen: { x: 40, y: 40 }, shift: false, ctrl: false, alt: false, clicks: 1 });
  assert.deepEqual(messages, ['Circle: only in Edit mode']);
  assert.deepEqual(history.state, before);
  assert.equal(model.children(ROOT_UID, 'bodies').length, 0);
  actions.run('tool:circle', { label: 'Circle' });
  assert.deepEqual(messages, ['Circle: only in Edit mode', 'Circle: only in Edit mode']);
  modes.openClip(null);
  assert.equal(tools.usable, true);
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
  assert.equal(model.prop(ROOT_UID, 'meta.name'), 'root');
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
  assert.equal(actions.reason('tool:hinge'), 'only in Edit mode');
  assert.equal(tools.active?.id, 'hinge');
  assert.equal(tools.usable, false);
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
  assert.equal(actions.reason('delete'), 'select a body, shape or joint');
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
  assert.equal(actions.reason('delete'), 'only in Edit mode');
  modes.openClip(null);
  modes.startSimulate();
  selection.set([ROOT_UID]);
  assert.equal(actions.reason('delete'), 'only in Edit mode');
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
    assert.equal(actions.reason(id), 'only in Edit mode', id);
    assert.equal(actions.run(id), false, id);
  }
  modes.openClip(null);
  modes.startSimulate();
  selection.set([shape]);
  for (const id of EDIT_ACTIONS) assert.equal(actions.reason(id), 'only in Edit mode', id);
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

test('D activates Pose in Edit mode', () => {
  const { actions, tools } = createEditor({ physics: { startPose: () => null } });
  const event = { key: 'd', target: { tagName: 'BODY' }, preventDefault() {} };
  assert.equal(actions.isEnabled('tool:pose'), true);
  assert.equal(actions.reason('tool:pose'), null);
  assert.equal(dispatchKey(event, { actions, tools, viewportFocused: true }), true);
  assert.equal(tools.active?.id, 'pose');
});
function buildRig(editor, { bodies, joints = [], clips = [], rootBody = null }) {
  const uids = {};
  editor.history.execute({
    label: 'Build',
    run(tx) {
      const { fixtures: _fixtures, ...bodyDefaults } = defaultsOf('body');
      for (const { id, shapes } of bodies) {
        uids[id] = tx.add(ROOT_UID, 'bodies', undefined, {
          type: 'body',
          props: { ...bodyDefaults, id, name: id },
          children: {
            fixtures: shapes.map(([shapeId, radius = 0.25]) => ({
              type: 'shape',
              props: { ...defaultsOf('shape', 'circle'), id: shapeId, name: shapeId, shape: { type: 'circle', center: [0, 0], radius } },
            })),
          },
        });
        shapes.forEach(([shapeId], index) => {
          uids[shapeId] = tx.model.children(uids[id], 'fixtures')[index];
        });
      }
      for (const [id, bodyA, bodyB, name = id] of joints) {
        uids[id] = tx.add(ROOT_UID, 'joints', undefined, { type: 'joint', props: { ...defaultsOf('joint'), id, name, bodyA, bodyB } });
      }
      const { tracks: _tracks, events: _events, ...clipProps } = defaultsOf('clip');
      for (const { key, tracks } of clips) {
        uids[key] = tx.add(ROOT_UID, 'clips', undefined, {
          type: 'clip',
          props: { ...clipProps, key },
          children: {
            tracks: tracks.map(([target, channel, keys]) => ({
              type: 'track',
              props: { target, channel },
              children: { keys: Array.from({ length: keys }, (_, t) => ({ type: 'key', props: { t, value: 0.5 } })) },
            })),
          },
        });
      }
      tx.set(ROOT_UID, 'rootBody', rootBody);
    },
  });
  return uids;
}

const SHAPE_ACTIONS = ['group', 'ungroup', 'split'];

const SHAPE_RIG = {
  bodies: [
    { id: 'b_1', shapes: [['f_1'], ['f_2']] },
    { id: 'b_2', shapes: [['f_3']] },
  ],
  rootBody: 'b_1',
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('group, ungroup and split are enabled in Edit mode and refused with the mode reason in Animate and Simulate', () => {
  const editor = createEditor();
  const { selection, actions, modes } = editor;
  const uids = buildRig(editor, SHAPE_RIG);
  selection.set([uids.f_2, uids.f_3]);
  for (const id of SHAPE_ACTIONS) {
    assert.equal(actions.isEnabled(id), true, id);
    assert.equal(actions.reason(id), null, id);
    assert.equal(actions.isRepeatable(id), false, id);
  }
  modes.openClip(addClip(editor));
  selection.set([uids.f_2, uids.f_3]);
  for (const id of SHAPE_ACTIONS) {
    assert.equal(actions.isEnabled(id), false, id);
    assert.equal(actions.reason(id), 'only in Edit mode', id);
    assert.equal(actions.run(id), false, id);
  }
  modes.openClip(null);
  modes.startSimulate();
  selection.set([uids.f_2, uids.f_3]);
  for (const id of SHAPE_ACTIONS) assert.equal(actions.reason(id), 'only in Edit mode', id);
  assert.equal(editor.model.children(ROOT_UID, 'bodies').length, 2);
});

test('group, ungroup and split are disabled with no reason during a gesture', () => {
  const editor = createEditor();
  const { selection, actions, history } = editor;
  const uids = buildRig(editor, SHAPE_RIG);
  selection.set([uids.f_2, uids.f_3]);
  history.beginGesture();
  for (const id of SHAPE_ACTIONS) {
    assert.equal(actions.isEnabled(id), false, id);
    assert.equal(actions.reason(id), null, id);
    assert.equal(actions.run(id), false, id);
  }
  history.endGesture();
  assert.equal(editor.model.children(ROOT_UID, 'bodies').length, 2);
});

test('group, ungroup and split state reasons', () => {
  const editor = createEditor();
  const { selection, actions } = editor;
  const uids = buildRig(editor, {
    bodies: [
      { id: 'b_1', shapes: [['f_1'], ['f_2']] },
      { id: 'b_2', shapes: [['f_3']] },
      { id: 'b_3', shapes: [['f_4', -1], ['f_5']] },
    ],
    joints: [['j_1', 'b_1', 'b_2']],
  });
  const empty = {
    group: 'select shapes of two or more bodies',
    ungroup: 'each selected body has a single shape',
    split: 'select some, not all, shapes of a body',
  };
  selection.set([]);
  for (const id of SHAPE_ACTIONS) assert.equal(actions.reason(id), empty[id], id);
  selection.set([uids.j_1]);
  for (const id of SHAPE_ACTIONS) {
    assert.equal(actions.isEnabled(id), false, id);
    assert.equal(actions.reason(id), empty[id], id);
  }
  selection.set([uids.f_1, uids.f_2]);
  assert.equal(actions.reason('group'), 'select shapes of two or more bodies');
  assert.equal(actions.reason('split'), 'select some, not all, shapes of a body');
  assert.equal(actions.isEnabled('ungroup'), true);
  selection.set([uids.f_3]);
  assert.equal(actions.reason('ungroup'), 'each selected body has a single shape');
  selection.set([uids.f_1, uids.f_4]);
  assert.equal(actions.isEnabled('group'), false);
  assert.equal(actions.reason('group'), 'a shape has invalid geometry');
  assert.equal(actions.isEnabled('split'), false);
  assert.equal(actions.reason('split'), 'a shape has invalid geometry');
  assert.equal(actions.reason('ungroup'), null);
  selection.set([uids.f_4, uids.f_5]);
  assert.equal(actions.reason('group'), 'select shapes of two or more bodies');
  selection.set([uids.b_3]);
  assert.equal(actions.reason('ungroup'), null);
  assert.equal(actions.isEnabled('ungroup'), true);
  selection.set([uids.f_3, uids.f_1]);
  assert.equal(actions.isEnabled('group'), true);
  assert.equal(actions.reason('group'), null);
});

test('group without internal joints never asks, runs synchronously and selects the group shapes', () => {
  let asked = 0;
  const editor = createEditor({
    confirm: () => {
      asked += 1;
      return Promise.resolve(true);
    },
  });
  const { model, selection, actions, history } = editor;
  const uids = buildRig(editor, SHAPE_RIG);
  selection.set([uids.f_3, uids.f_1]);
  assert.equal(actions.run('group'), true);
  assert.equal(asked, 0);
  assert.deepEqual(model.children(ROOT_UID, 'bodies'), [uids.b_1]);
  assert.deepEqual(selection.objects, [uids.f_1, uids.f_2, uids.f_3]);
  assert.equal(history.state.undoLabel, 'Group');
});

const ARM = {
  bodies: [
    { id: 'b_1', shapes: [['f_1']] },
    { id: 'b_2', shapes: [['f_2']] },
    { id: 'b_3', shapes: [['f_3']] },
  ],
  joints: [
    ['j_1', 'b_1', 'b_2', 'elbow_l'],
    ['j_2', 'b_2', 'b_3', 'wrist_l'],
  ],
  clips: [
    { key: 'walk', tracks: [['j_1', 'angle', 5], ['j_1', 'strength', 3]] },
    { key: 'run', tracks: [['j_1', 'angle', 4]] },
  ],
  rootBody: 'b_1',
};

test('group with internal joints asks once with the group request, then groups as one step', async () => {
  const requests = [];
  const answer = deferred();
  const editor = createEditor({
    confirm: (request) => {
      requests.push(request);
      return answer.promise;
    },
  });
  const { model, selection, actions, history } = editor;
  const uids = buildRig(editor, ARM);
  selection.set([uids.f_3, uids.f_2, uids.f_1]);
  assert.equal(actions.run('group'), true);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    kind: 'group',
    title: 'Delete joints inside the group?',
    message: 'Grouping 3 bodies deletes 2 joints between them, which also removes 3 tracks and 12 keys from 2 clips. Undo restores them.',
    items: ['elbow_l: 3 tracks, 12 keys', 'wrist_l'],
    confirmLabel: 'Group',
    cancelLabel: 'Cancel',
  });
  for (const id of [...SHAPE_ACTIONS, 'delete']) {
    assert.equal(actions.isEnabled(id), false, id);
    assert.equal(actions.reason(id), null, id);
  }
  assert.equal(model.children(ROOT_UID, 'bodies').length, 3);
  answer.resolve(true);
  await answer.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(model.children(ROOT_UID, 'bodies'), [uids.b_1]);
  assert.deepEqual(model.children(ROOT_UID, 'joints'), []);
  assert.deepEqual(selection.objects, [uids.f_1, uids.f_2, uids.f_3]);
  assert.equal(history.state.undoLabel, 'Group');
  history.undo();
  assert.equal(model.children(ROOT_UID, 'bodies').length, 3);
  assert.equal(model.children(ROOT_UID, 'joints').length, 2);
  assert.equal(history.state.undoLabel, 'Build');
});

test('a group request with internal joints but no tracks has no track clause', async () => {
  const requests = [];
  const editor = createEditor({
    confirm: (request) => {
      requests.push(request);
      return Promise.resolve(false);
    },
  });
  const uids = buildRig(editor, { ...ARM, clips: [] });
  editor.selection.set([uids.f_1, uids.f_2]);
  editor.actions.run('group');
  assert.equal(requests[0].message, 'Grouping 2 bodies deletes 1 joint between them. Undo restores them.');
  assert.deepEqual(requests[0].items, ['elbow_l']);
});

for (const [label, settle] of [
  ['false', (answer) => answer.resolve(false)],
  ['a rejection', (answer) => answer.reject(new Error('closed'))],
]) {
  test(`group changes nothing when the confirmation answers ${label}`, async () => {
    const answer = deferred();
    const editor = createEditor({ confirm: () => answer.promise });
    const { model, selection, actions, history } = editor;
    const uids = buildRig(editor, ARM);
    selection.set([uids.f_1, uids.f_2]);
    actions.run('group');
    settle(answer);
    await answer.promise.catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(model.children(ROOT_UID, 'bodies').length, 3);
    assert.equal(history.state.undoLabel, 'Build');
    assert.equal(actions.isEnabled('group'), true);
  });
}

test('a mode change before the answer groups nothing', async () => {
  const answer = deferred();
  const editor = createEditor({ confirm: () => answer.promise });
  const { model, selection, actions, modes } = editor;
  const uids = buildRig(editor, ARM);
  selection.set([uids.f_1, uids.f_2]);
  actions.run('group');
  modes.openClip(uids.walk);
  answer.resolve(true);
  await answer.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(model.children(ROOT_UID, 'bodies').length, 3);
  assert.equal(model.children(ROOT_UID, 'joints').length, 2);
});

test('ungroup and split select the shapes their command returns', () => {
  const editor = createEditor();
  const { model, selection, actions, history } = editor;
  const uids = buildRig(editor, {
    bodies: [{ id: 'b_1', shapes: [['f_1'], ['f_2'], ['f_3']] }],
    rootBody: 'b_1',
  });
  selection.set([uids.f_3, uids.f_2]);
  assert.equal(actions.run('split'), true);
  assert.deepEqual(selection.objects, [uids.f_2, uids.f_3]);
  assert.equal(history.state.undoLabel, 'Split');
  assert.equal(model.children(ROOT_UID, 'bodies').length, 2);
  history.undo();
  selection.set([uids.b_1]);
  assert.equal(actions.run('ungroup'), true);
  assert.deepEqual(selection.objects, [uids.f_1, uids.f_2, uids.f_3]);
  assert.equal(history.state.undoLabel, 'Ungroup');
  assert.equal(model.children(ROOT_UID, 'bodies').length, 3);
});

test('Ctrl+G, Ctrl+Shift+G and Alt+G reach group, ungroup and split', () => {
  const editor = createEditor();
  const { model, selection, actions } = editor;
  const uids = buildRig(editor, SHAPE_RIG);
  const press = (key, init) => dispatchKey({ ...deleteKey(), key, ...init }, { actions });
  selection.set([uids.f_2]);
  assert.equal(press('©', { altKey: true, code: 'KeyG' }), true);
  assert.equal(model.children(ROOT_UID, 'bodies').length, 3);
  selection.set([uids.f_1, uids.f_2, uids.f_3]);
  assert.equal(press('g', { ctrlKey: true }), true);
  assert.equal(model.children(ROOT_UID, 'bodies').length, 1);
  assert.equal(press('G', { ctrlKey: true, shiftKey: true }), true);
  assert.equal(model.children(ROOT_UID, 'bodies').length, 3);
});

function fitScene(editor) {
  const { history, model } = editor;
  const shapeA = history.execute(createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'box', width: 1, height: 1 } }));
  const shapeB = history.execute(createShapeBody({ position: { x: 1, y: 0 }, angle: 0, shape: { type: 'box', width: 1, height: 0.2 } }));
  const shapeC = history.execute(createShapeBody({ position: { x: 2, y: 0 }, angle: 0, shape: { type: 'circle', radius: 0.1 } }));
  const [a, b, c] = [shapeA, shapeB, shapeC].map((uid) => model.get(uid).parent);
  const first = history.execute(createJoint({ bodyA: a, bodyB: b, anchor: { x: 0.5, y: 0 } }));
  const second = history.execute(createJoint({ bodyA: b, bodyB: c, anchor: { x: 1.5, y: 0 } }));
  const free = history.execute(createJoint({ bodyA: null, bodyB: null, anchor: { x: 0, y: 0 } }));
  history.execute(setProps([first, second], { 'motor.maxTorque': 80 }));
  return { shapeA, first, second, free };
}

function atSuggestion(model) {
  const json = toJson(model, 'dev');
  const suggestions = motorTorqueSuggestions(json);
  const joints = model.children(ROOT_UID, 'joints').every((uid) => {
    const value = suggestions.get(model.prop(uid, 'id'));
    return typeof value !== 'number' || model.prop(uid, 'motor.maxTorque') === value;
  });
  const balance = balanceTorqueSuggestion(json);
  return joints && (typeof balance !== 'number' || model.prop(ROOT_UID, 'balance.maxTorque') === balance);
}

test('every rig command sets the motor and balance torque to the suggestion in its own undo step', () => {
  const messages = [];
  const editor = createEditor({ status: (text) => messages.push(text) });
  const { model, history } = editor;
  const { first, second, free } = fitScene(editor);
  assert.equal(atSuggestion(model), true);
  assert.notEqual(model.prop(first, 'motor.maxTorque'), 80);
  assert.equal(model.prop(free, 'motor.maxTorque'), defaultsOf('joint').motor.maxTorque);
  assert.match(messages.at(-1) ?? '', /^Motor torque: /);
  const before = model.prop(first, 'motor.maxTorque');
  const body = model.uidOf(model.prop(second, 'bodyB'));
  history.execute(setProps([body], { position: [4, 1] }));
  assert.equal(history.state.undoLabel, 'Edit properties');
  assert.notEqual(model.prop(first, 'motor.maxTorque'), before);
  assert.equal(atSuggestion(model), true);
  history.undo();
  assert.equal(model.prop(first, 'motor.maxTorque'), before);
  assert.equal(atSuggestion(model), true);
});

test('the automatic torque is computed once at the end of a gesture, never during it, on undo or redo', () => {
  const editor = createEditor();
  const { model, history } = editor;
  const { first, second } = fitScene(editor);
  const body = model.uidOf(model.prop(second, 'bodyB'));
  const settled = model.prop(first, 'motor.maxTorque');
  history.beginGesture();
  history.execute(setProps([body], { position: [6, 0] }));
  assert.equal(model.prop(first, 'motor.maxTorque'), settled);
  history.execute(setProps([body], { position: [8, 0] }));
  history.endGesture();
  const moved = model.prop(first, 'motor.maxTorque');
  assert.notEqual(moved, settled);
  assert.equal(atSuggestion(model), true);
  history.undo();
  assert.equal(model.prop(first, 'motor.maxTorque'), settled);
  history.redo();
  assert.equal(model.prop(first, 'motor.maxTorque'), moved);
  history.beginGesture();
  history.execute(setProps([body], { position: [1, 0] }));
  history.cancelGesture();
  assert.equal(model.prop(first, 'motor.maxTorque'), moved);
});

test('commands that leave the rig alone do not touch the torque or report it', () => {
  const messages = [];
  const editor = createEditor({ status: (text) => messages.push(text) });
  const { model, history } = editor;
  const { first } = fitScene(editor);
  messages.length = 0;
  history.execute(setProps([ROOT_UID], { name: 'hero' }));
  addClip(editor);
  assert.deepEqual(messages, []);
  assert.equal(atSuggestion(model), true);
  assert.equal(typeof model.prop(first, 'motor.maxTorque'), 'number');
});

test('Fit motor torque is gone: no action and no Shift+M hotkey', () => {
  const { actions } = createEditor();
  assert.equal(actions.has('fit-motor-torque'), false);
  let prevented = false;
  const event = { key: 'M', shiftKey: true, target: { tagName: 'BODY' }, preventDefault() { prevented = true; } };
  assert.equal(dispatchKey(event, { actions }), false);
  assert.equal(prevented, false);
});

test('a refused labelled run reports Label: reason through status, never during a gesture', () => {
  const messages = [];
  const { actions, history } = createEditor({ status: (text) => messages.push(text) });
  assert.equal(actions.run('set-root-body', { label: 'Set as root body' }), false);
  assert.deepEqual(messages, ['Set as root body: select one body']);
  actions.run('set-root-body');
  assert.equal(messages.length, 1);
  history.beginGesture();
  actions.run('undo', { label: 'Undo' });
  history.cancelGesture();
  assert.equal(messages.length, 1);
  const event = { key: 'z', ctrlKey: true, target: { tagName: 'BODY' }, preventDefault() {} };
  dispatchKey(event, { actions });
  assert.deepEqual(messages, ['Set as root body: select one body', 'Undo: nothing to undo']);
});

test('mode:animate opens the last opened clip, else the first, else creates one; mode:edit returns', () => {
  const messages = [];
  const editor = createEditor({ status: (text) => messages.push(text) });
  const { actions, modes, model, history } = editor;
  assert.equal(editor.modeTitle('animate'), 'Animate mode: creates a new clip');
  actions.run('mode:animate');
  assert.equal(modes.mode, 'animate');
  const created = modes.clip;
  assert.equal(history.state.undoLabel, 'New clip');
  assert.match(messages.at(-1), /^Created clip /);
  assert.equal(editor.modeTitle('animate'), `Animate mode: ${model.prop(created, 'name')}`);
  actions.run('mode:edit');
  assert.equal(modes.mode, 'edit');
  const second = addClip(editor);
  modes.openClip(second);
  modes.openClip(null);
  assert.equal(editor.modeTitle('animate'), `Animate mode: opens ${model.prop(second, 'name')}`);
  actions.run('mode:animate');
  assert.equal(modes.clip, second);
  assert.equal(model.children(ROOT_UID, 'clips').length, 2);
  assert.equal(editor.modeTitle('edit'), 'Edit mode: rest pose and rig');
  assert.equal(editor.modeTitle('simulate'), 'Simulate mode: live physics test');
});

test('removing the open clip returns to Edit with a status message', () => {
  const messages = [];
  const editor = createEditor({ status: (text) => messages.push(text) });
  const { modes, model, history } = editor;
  const clip = addClip(editor);
  const name = model.prop(clip, 'name');
  modes.openClip(clip);
  history.undo();
  assert.equal(modes.mode, 'edit');
  assert.equal(messages.at(-1), `Clip ${name} removed: Edit mode`);
});
