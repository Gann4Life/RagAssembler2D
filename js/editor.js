import { Model } from './model/model.js';
import { Selection } from './model/selection.js';
import { History } from './commands/history.js';
import { Modes } from './modes.js';
import { ActionRegistry } from './actions.js';

/**
 * Editor core, shared by every UI module.
 * @typedef {object} Editor
 * @property {Model} model Document model.
 * @property {History} history Command stack.
 * @property {Selection} selection Selection.
 * @property {Modes} modes Mode, open clip and playhead.
 * @property {ActionRegistry} actions Action registry with the core actions registered.
 */

const MODE_NAMES = Object.freeze({ edit: 'Edit', animate: 'Animate', simulate: 'Simulate' });

/**
 * Builds the editor core without DOM: model, history, selection, modes and actions. Registers the
 * `undo`, `redo` and `escape` actions, and cancels the gesture in progress on every mode change.
 * @returns {Readonly<Editor>} The editor.
 */
export function createEditor() {
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

  return Object.freeze({ model, history, selection, modes, actions });
}
