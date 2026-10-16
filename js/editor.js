import { defaultsOf } from '../lib/schema.js';
import { Model, ROOT_UID } from './model/model.js';
import { createJoint, createShapeBody } from './commands/create.js';
import { deleteObjects, deletionPlan } from './commands/delete.js';
import { Selection } from './model/selection.js';
import { History } from './commands/history.js';
import { Modes } from './modes.js';
import { ActionRegistry } from './actions.js';
import { Settings } from './settings.js';
import { Camera } from './viewport/camera.js';
import { ToolRegistry } from './tools/registry.js';
import { selectTool } from './tools/select.js';
import { selectBoxTool } from './tools/select-box.js';
import { poseTool } from './tools/pose.js';
import { circleTool } from './tools/circle.js';
import { boxTool } from './tools/box.js';
import { hingeTool } from './tools/hinge.js';

/**
 * Editor core, shared by every UI module.
 * @typedef {object} Editor
 * @property {Model} model Document model.
 * @property {History} history Command stack.
 * @property {Selection} selection Selection.
 * @property {Modes} modes Mode, open clip and playhead.
 * @property {ActionRegistry} actions Action registry with the core actions registered.
 * @property {Settings} settings Editor settings; not undoable.
 * @property {Camera} camera Viewport camera; not undoable.
 * @property {ToolRegistry} tools Viewport tool registry; not undoable.
 */

const MODE_NAMES = Object.freeze({ edit: 'Edit', animate: 'Animate', simulate: 'Simulate' });

const TOOLS = Object.freeze([selectTool, selectBoxTool, poseTool, circleTool, boxTool, hingeTool]);

/**
 * Builds the editor core without DOM: model, history, selection, modes, settings, camera, tool registry and
 * actions. The tool registry is the first `mode` listener, so a mode change cancels the operation in progress
 * before anything else hears it. Registers the `undo`, `redo` and `escape` actions, one `tool:<id>` action
 * per registered tool, the `pivot-mode` action that toggles the `gizmo.pivot` setting (refused during a gesture),
 * and the `delete`, `add-shape` and `add-joint` actions.
 * @param {{ settings?: Settings, physics?: import('./tools/tool.js').PhysicsService|null }} [options] Restored editor
 *   settings, defaults when omitted; physics service for the Pose tool, `null` when omitted.
 * @returns {Readonly<Editor>} The editor.
 * @throws {TypeError} When `settings` is given and is not a `Settings` instance.
 */
export function createEditor({ settings = Settings.restore(undefined).settings, physics = null } = {}) {
  if (!(settings instanceof Settings)) throw new TypeError('settings must be a Settings instance');
  const model = new Model();
  const history = new History(model);
  const selection = new Selection(model);
  const modes = new Modes(model);
  const camera = new Camera();
  const tools = new ToolRegistry(
    { model, history, selection, modes, settings, camera, physics },
    TOOLS.map((createTool) => createTool()),
  );
  const actions = new ActionRegistry();

  const modeReason = (capability) => (modes.can(capability) ? null : `not available in ${MODE_NAMES[modes.mode]} mode`);

  actions.register('undo', {
    run: () => history.undo(),
    isEnabled: () => modes.can('history') && history.canUndo,
    reason: () => modeReason('history'),
    repeatable: true,
  });
  actions.register('redo', {
    run: () => history.redo(),
    isEnabled: () => modes.can('history') && history.canRedo,
    reason: () => modeReason('history'),
    repeatable: true,
  });
  actions.register('escape', {
    run: () => {
      if (!tools.cancel()) selection.clear();
    },
  });
  for (const tool of tools.list()) {
    actions.register(`tool:${tool.id}`, {
      run: () => tools.activate(tool.id),
      isEnabled: () => tools.canActivate(tool.id),
      reason: () => modeReason(tool.capability),
    });
  }

  actions.register('pivot-mode', {
    run: () => settings.set('gizmo.pivot', settings.get('gizmo.pivot') === 'center' ? 'last' : 'center'),
    isEnabled: () => !history.inGesture,
  });

  const canEditRest = () => modes.can('edit.rest') && !history.inGesture;
  actions.register('delete', {
    run: () => history.execute(deleteObjects(selection.objects)),
    isEnabled: () =>
      selection.focus === 'objects' && canEditRest() && !deletionPlan(model, selection.objects).empty,
    reason: () => {
      if (selection.focus !== 'objects') return null;
      const byMode = modeReason('edit.rest');
      if (byMode !== null) return byMode;
      const rootOnly = selection.objects.length === 1 && selection.objects[0] === ROOT_UID;
      return rootOnly && !history.inGesture ? 'the ragdoll root cannot be deleted' : null;
    },
  });
  actions.register('add-shape', {
    run: () => {
      const { width, height } = defaultsOf('shape', 'box').shape;
      const uid = history.execute(
        createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'box', width, height } }, 'Add shape'),
      );
      selection.set([uid]);
    },
    isEnabled: canEditRest,
    reason: () => modeReason('edit.rest'),
  });
  actions.register('add-joint', {
    run: () => {
      const uid = history.execute(createJoint({ bodyA: null, bodyB: null, anchor: { x: 0, y: 0 } }, 'Add joint'));
      selection.set([uid]);
    },
    isEnabled: canEditRest,
    reason: () => modeReason('edit.rest'),
  });

  return Object.freeze({ model, history, selection, modes, actions, settings, camera, tools });
}
