import { Model } from './model/model.js';
import { Selection } from './model/selection.js';
import { History } from './commands/history.js';
import { Modes } from './modes.js';
import { ActionRegistry } from './actions.js';
import { Settings } from './settings.js';
import { Camera } from './viewport/camera.js';

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
 */

const MODE_NAMES = Object.freeze({ edit: 'Edit', animate: 'Animate', simulate: 'Simulate' });

/**
 * Builds the editor core without DOM: model, history, selection, modes, actions, settings and camera.
 * Registers the `undo`, `redo` and `escape` actions, and cancels the gesture in progress on every mode change.
 * @param {{ settings?: Settings }} [options] Restored editor settings; defaults when omitted.
 * @returns {Readonly<Editor>} The editor.
 * @throws {TypeError} When `settings` is given and is not a `Settings` instance.
 */
export function createEditor({ settings = Settings.restore(undefined).settings } = {}) {
  if (!(settings instanceof Settings)) throw new TypeError('settings must be a Settings instance');
  const model = new Model();
  const history = new History(model);
  const selection = new Selection(model);
  const modes = new Modes(model);
  const actions = new ActionRegistry();

  modes.on('mode', () => {
    history.cancelGesture();
  });

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
      if (!history.cancelGesture()) selection.clear();
    },
  });

  return Object.freeze({ model, history, selection, modes, actions, settings, camera: new Camera() });
}
