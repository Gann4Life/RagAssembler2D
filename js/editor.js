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

/**
 * What a core action asks the user to confirm before a destructive step; rendered by the confirmation dialog.
 * @typedef {object} ConfirmRequest
 * @property {'delete'} kind What asks.
 * @property {string} title Dialog heading.
 * @property {string} message Plain-text sentence or two.
 * @property {ReadonlyArray<string>} items Plain-text list under the message; may be empty.
 * @property {string} confirmLabel Label of the confirm button.
 * @property {string} cancelLabel Label of the cancel button.
 */

const MODE_NAMES = Object.freeze({ edit: 'Edit', animate: 'Animate', simulate: 'Simulate' });

function countOf(count, word) {
  return `${count} ${count === 1 ? word : word === 'body' ? 'bodies' : `${word}s`}`;
}

function joinWords(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function deleteRequest(model, plan) {
  const objects = joinWords(
    [
      [plan.bodies.length, 'body'],
      [plan.shapes.length, 'shape'],
      [plan.joints.length, 'joint'],
    ]
      .filter(([count]) => count > 0)
      .map(([count, word]) => countOf(count, word)),
  );
  const keys = plan.clips.reduce((total, clip) => total + clip.keys, 0);
  return Object.freeze({
    kind: 'delete',
    title: 'Delete animation tracks?',
    message: `Deleting ${objects} also removes ${countOf(plan.tracks.length, 'track')} and ${countOf(keys, 'key')} from ${countOf(plan.clips.length, 'clip')}. Undo restores them.`,
    items: Object.freeze(
      plan.clips.map((clip) => {
        const name = model.prop(clip.uid, 'name');
        const label = typeof name === 'string' && name !== '' ? name : model.prop(clip.uid, 'key');
        return `${label}: ${countOf(clip.tracks, 'track')}, ${countOf(clip.keys, 'key')}`;
      }),
    ),
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
  });
}

const TOOLS = Object.freeze([selectTool, selectBoxTool, poseTool, circleTool, boxTool, hingeTool]);

/**
 * Builds the editor core without DOM: model, history, selection, modes, settings, camera, tool registry and
 * actions. The tool registry is the first `mode` listener, so a mode change cancels the operation in progress
 * before anything else hears it. Registers the `undo`, `redo` and `escape` actions, one `tool:<id>` action
 * per registered tool, the `pivot-mode` action that toggles the `gizmo.pivot` setting (refused during a gesture),
 * and the `delete`, `add-shape` and `add-joint` actions.
 * @param {{ settings?: Settings, physics?: import('./tools/tool.js').PhysicsService|null,
 *   confirm?: (request: ConfirmRequest) => Promise<boolean> }} [options] Restored editor settings, defaults when
 *   omitted; physics service for the Pose tool, `null` when omitted; how actions ask before a destructive step,
 *   always confirming when omitted.
 * @returns {Readonly<Editor>} The editor.
 * @throws {TypeError} When `settings` is given and is not a `Settings` instance, or `confirm` is given and is not
 *   a function.
 */
export function createEditor({ settings = Settings.restore(undefined).settings, physics = null, confirm = () => Promise.resolve(true) } = {}) {
  if (!(settings instanceof Settings)) throw new TypeError('settings must be a Settings instance');
  if (typeof confirm !== 'function') throw new TypeError('confirm must be a function');
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
  let confirming = false;
  const canDelete = (uids) => {
    try {
      return selection.focus === 'objects' && canEditRest() && !deletionPlan(model, uids).empty;
    } catch {
      return false;
    }
  };
  const runDelete = () => {
    const uids = [...selection.objects];
    const plan = deletionPlan(model, uids);
    if (!plan.confirm) {
      history.execute(deleteObjects(uids));
      return undefined;
    }
    confirming = true;
    let asked;
    try {
      asked = Promise.resolve(confirm(deleteRequest(model, plan)));
    } catch (error) {
      asked = Promise.reject(error);
    }
    return asked
      .then(
        (accepted) => accepted === true,
        () => false,
      )
      .then((accepted) => {
        confirming = false;
        if (accepted && canDelete(uids)) history.execute(deleteObjects(uids));
      });
  };
  actions.register('delete', {
    run: runDelete,
    isEnabled: () => !confirming && canDelete(selection.objects),
    reason: () => {
      if (selection.focus !== 'objects') return null;
      const byMode = modeReason('edit.rest');
      if (byMode !== null) return byMode;
      const rootOnly = selection.objects.length === 1 && selection.objects[0] === ROOT_UID;
      return rootOnly && !history.inGesture && !confirming ? 'the ragdoll root cannot be deleted' : null;
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
