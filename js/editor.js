import { defaultsOf } from '../lib/schema.js';
import { Model, ROOT_UID } from './model/model.js';
import { applyTorque, torqueMessage, touchesRig } from './model/motor-torque.js';
import { createClip, createJoint, createShapeBody } from './commands/create.js';
import { deleteObjects, deletionPlan } from './commands/delete.js';
import { duplicatePlan, duplicateSelection } from './commands/duplicate.js';
import { groupBodies, groupPlan, splitParts, splitShapes, ungroupBodies, ungroupParts } from './commands/group.js';
import { rootBodyPlan, setRootBody } from './commands/root-body.js';
import { selectedBodies } from './model/queries.js';
import { Selection } from './model/selection.js';
import { Rename, renameTarget } from './rename.js';
import { History } from './commands/history.js';
import { Modes } from './modes.js';
import { ActionRegistry } from './actions.js';
import { Settings } from './settings.js';
import { DEV_VERSION } from './version.js';
import { loadJson, newDocument, saveJson, toJson } from './model/io.js';
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
 * @property {Rename} rename Rename session (F2); not undoable.
 * @property {() => string} editorVersion Version of the running editor; `dev` until known.
 * @property {(read: () => Promise<string|null>) => Promise<boolean>} loadFrom Loads the text `read` supplies
 *   (`null`: nothing chosen), confirming first when there are unsaved changes; resolves whether the document was
 *   replaced and never rejects. `read` is called synchronously. Used by the `load` action and by file drops.
 * @property {(text: string) => void} status Shows a status line message through the `status` option.
 * @property {(mode: 'edit'|'animate'|'simulate') => string} modeTitle Tooltip of a mode switch segment, e.g.
 *   `Animate mode: opens walk` or `Animate mode: creates a new clip`.
 */

/**
 * Browser file I/O injected into the editor.
 * @typedef {object} FileService
 * @property {() => Promise<string|null>} openText Shows the file picker; resolves the chosen file's text, `null`
 *   when cancelled, rejects when the file cannot be read.
 * @property {(fileName: string, text: string) => Promise<boolean>} saveText Writes `text`, suggesting `fileName`;
 *   resolves `true` when saved and `false` when the user cancelled, rejects when it cannot be written.
 */

/**
 * What a core action tells the user; rendered by the message dialog.
 * @typedef {object} Notice
 * @property {'load-error'|'load-notes'|'save-error'} kind What reports.
 * @property {string} title Dialog heading.
 * @property {string} message Plain-text sentence or two.
 * @property {ReadonlyArray<string>} items At most 50 plain-text lines, then `and N more`; may be empty.
 * @property {string} closeLabel Label of the close button.
 */

/**
 * What a core action asks the user to confirm before a destructive step; rendered by the confirmation dialog.
 * @typedef {object} ConfirmRequest
 * @property {'delete'|'new'|'load'|'group'} kind What asks.
 * @property {string} title Dialog heading.
 * @property {string} message Plain-text sentence or two.
 * @property {ReadonlyArray<string>} items Plain-text list under the message; may be empty.
 * @property {string} confirmLabel Label of the confirm button.
 * @property {string} cancelLabel Label of the cancel button.
 */

const INVALID_GEOMETRY = 'a shape has invalid geometry';

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

function labelOf(model, uid) {
  const name = model.prop(uid, 'name');
  return typeof name === 'string' && name !== '' ? name : model.prop(uid, 'id');
}

function groupRequest(model, plan) {
  const { deletion } = plan;
  const keysOf = (tracks) => tracks.reduce((total, track) => total + model.children(track, 'keys').length, 0);
  const tracksPart =
    deletion.tracks.length > 0
      ? `, which also removes ${countOf(deletion.tracks.length, 'track')} and ${countOf(keysOf(deletion.tracks), 'key')} from ${countOf(deletion.clips.length, 'clip')}`
      : '';
  return Object.freeze({
    kind: 'group',
    title: 'Delete joints inside the group?',
    message: `Grouping ${countOf(plan.bodies.length, 'body')} deletes ${countOf(plan.joints.length, 'joint')} between them${tracksPart}. Undo restores them.`,
    items: Object.freeze(
      plan.joints.map((joint) => {
        const tracks = deletion.tracks.filter((track) => {
          const target = model.prop(track, 'target');
          return typeof target === 'string' && model.uidOf(target) === joint;
        });
        const label = labelOf(model, joint);
        return tracks.length === 0
          ? label
          : `${label}: ${countOf(tracks.length, 'track')}, ${countOf(keysOf(tracks), 'key')}`;
      }),
    ),
    confirmLabel: 'Group',
    cancelLabel: 'Cancel',
  });
}

function newRequest() {
  return Object.freeze({
    kind: 'new',
    title: 'Discard unsaved changes?',
    message: 'Starting a new ragdoll discards the changes made since the last save. This cannot be undone.',
    items: Object.freeze([]),
    confirmLabel: 'Discard',
    cancelLabel: 'Cancel',
  });
}

function loadRequest() {
  return Object.freeze({
    kind: 'load',
    title: 'Discard unsaved changes?',
    message: 'Loading a file discards the changes made since the last save. This cannot be undone.',
    items: Object.freeze([]),
    confirmLabel: 'Discard',
    cancelLabel: 'Cancel',
  });
}

const MAX_NOTICE_ITEMS = 50;

function problemLine({ path, message }) {
  return path === '' || path === undefined ? message : `${path}: ${message}`;
}

function cappedItems(lines) {
  if (lines.length <= MAX_NOTICE_ITEMS) return Object.freeze([...lines]);
  return Object.freeze([...lines.slice(0, MAX_NOTICE_ITEMS), `and ${lines.length - MAX_NOTICE_ITEMS} more`]);
}

function notice(kind, title, message, lines) {
  return Object.freeze({ kind, title, message, items: cappedItems(lines), closeLabel: 'OK' });
}

function loadErrorNotice(errors) {
  return notice(
    'load-error',
    'Cannot load file',
    `The file has ${countOf(errors.length, 'error')} and was not loaded. The current ragdoll is unchanged.`,
    errors.map(problemLine),
  );
}

function readErrorNotice() {
  return notice('load-error', 'Cannot load file', 'The file could not be read. The current ragdoll is unchanged.', []);
}

function loadNotesNotice(notes, warnings) {
  return notice(
    'load-notes',
    'File loaded with notes',
    'The file was loaded. Migrations, dropped fields and warnings are listed below.',
    [...notes, ...warnings.map(problemLine)],
  );
}

function saveErrorNotice(errors) {
  return notice(
    'save-error',
    'Cannot save',
    `The ragdoll has ${countOf(errors.length, 'error')}. Fix them and save again.`,
    errors.map(problemLine),
  );
}

function saveWriteErrorNotice() {
  return notice('save-error', 'Cannot save', 'The file could not be written. The ragdoll still has unsaved changes.', []);
}

function countClips(count) {
  return `${count} ${count === 1 ? 'clip' : 'clips'}`;
}

function rootBodyMessage(model, body, plan, torque) {
  const converted = plan.tracks.length > 0 ? `, bodyAngle keys converted in ${countClips(plan.tracks.length)}` : '';
  const balance = torque !== null && torque.balance !== null ? `; ${torqueMessage(torque)}` : '';
  return `Root body: ${labelOf(model, body)}${converted}${balance}`;
}

const TOOLS = Object.freeze([selectTool, selectBoxTool, poseTool, circleTool, boxTool, hingeTool]);

/**
 * Builds the editor core without DOM: model, history, selection, modes, settings, camera, tool registry and
 * actions. The tool registry is the first `mode` listener, so a mode change cancels the operation in progress
 * before anything else hears it. Registers the `undo`, `redo` and `escape` actions, one `tool:<id>` action
 * per registered tool, the `pivot-mode` action that toggles the `gizmo.pivot` setting (refused during a gesture),
 * the `delete`, `group`, `ungroup`, `split`, `duplicate`, `rename`, `add-shape`, `set-root-body`, `add-joint`, `new`
 * actions, the mode switch's `mode:edit` and `mode:animate`, plus `load` and `save` when `files` is given. Every new
 * undo step that changes bodies, joints or `rootBody` also sets the automatic motor torque in the same step.
 * Refused labelled actions and disabled tools report "*Label*: *reason*" through `status`.
 * @param {{ settings?: Settings, physics?: import('./tools/tool.js').PhysicsService|null,
 *   confirm?: (request: ConfirmRequest) => Promise<boolean>, notify?: (notice: Notice) => Promise<void>,
 *   files?: FileService|null, editorVersion?: () => string, uiBusy?: () => boolean,
 *   playback?: import('./tools/tool.js').PlaybackService, autokey?: () => boolean, status?: (text: string) => void }} [options]
 *   Restored editor settings, defaults when
 *   omitted; physics service for the Pose tool, `null` when omitted; how actions ask before a destructive step,
 *   always confirming when omitted; how actions report to the user, ignoring notices when omitted; file picker and
 *   download, `null` when omitted (`load` and `save` are then not registered); getter of the running editor's
 *   version, `dev` when omitted; whether a UI menu or dialog is open, which disables `rename`, never when omitted;
 *   Animate playback for the tools, never playing when omitted; whether autokey is on, on when omitted; status line
 *   messages, ignored when omitted.
 * @returns {Readonly<Editor>} The editor.
 * @throws {TypeError} When `settings` is given and is not a `Settings` instance, `confirm` or `notify` is given
 *   and is not a function, `files` is neither `null` nor an object with `openText` and `saveText` functions, or
 *   `editorVersion`, `uiBusy` or `status` is given and is not a function.
 */
export function createEditor({
  settings = Settings.restore(undefined).settings,
  physics = null,
  confirm = () => Promise.resolve(true),
  notify = () => Promise.resolve(),
  files = null,
  editorVersion = () => DEV_VERSION,
  uiBusy = () => false,
  playback = undefined,
  autokey = () => true,
  status = () => {},
} = {}) {
  if (!(settings instanceof Settings)) throw new TypeError('settings must be a Settings instance');
  if (typeof confirm !== 'function') throw new TypeError('confirm must be a function');
  if (typeof notify !== 'function') throw new TypeError('notify must be a function');
  if (files !== null && (typeof files?.openText !== 'function' || typeof files.saveText !== 'function')) {
    throw new TypeError('files must be null or provide openText and saveText functions');
  }
  if (typeof editorVersion !== 'function') throw new TypeError('editorVersion must be a function');
  if (typeof uiBusy !== 'function') throw new TypeError('uiBusy must be a function');
  if (typeof status !== 'function') throw new TypeError('status must be a function');
  const say = (text) => {
    try {
      status(text);
    } catch {
      return;
    }
  };
  const model = new Model();
  let changing = null;
  model.on('change', ({ changes }) => {
    changing = changes;
  });
  let torqueNote = null;
  let holdTorqueMessage = false;
  const finalize = (tx, ops) => {
    if (!touchesRig(tx.model, ops)) return;
    const change = applyTorque(tx, toJson(tx.model, editorVersion()));
    if (change === null) return;
    torqueNote = change;
    if (!holdTorqueMessage) say(torqueMessage(change));
  };
  const history = new History(model, { finalize });
  const selection = new Selection(model);
  const modes = new Modes(model);
  const camera = new Camera();
  const tools = new ToolRegistry(
    { model, history, selection, modes, settings, camera, physics, editorVersion, playback, autokey, status: say },
    TOOLS.map((createTool) => createTool()),
  );
  let confirming = false;
  const actions = new ActionRegistry({ refused: say, quiet: () => history.inGesture || confirming });
  const rename = new Rename({ model, history, selection, modes });

  const modeReason = (capability) => modes.reason(capability);
  const historyReason = (canStep, nothing) => () => {
    const byMode = modeReason('history');
    if (byMode !== null) return byMode;
    return canStep() || history.inGesture ? null : nothing;
  };

  actions.register('undo', {
    run: () => history.undo(),
    isEnabled: () => modes.can('history') && history.canUndo,
    reason: historyReason(() => history.canUndo, 'nothing to undo'),
    repeatable: true,
  });
  actions.register('redo', {
    run: () => history.redo(),
    isEnabled: () => modes.can('history') && history.canRedo,
    reason: historyReason(() => history.canRedo, 'nothing to redo'),
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
  actions.register('onion-skins', { run: () => settings.set('display.ghosts', !settings.get('display.ghosts')) });

  const canEditRest = () => modes.can('edit.rest') && !history.inGesture;
  const canDelete = (uids) => {
    try {
      return selection.focus === 'objects' && canEditRest() && !deletionPlan(model, uids).empty;
    } catch {
      return false;
    }
  };
  const ask = (request) => {
    confirming = true;
    let asked;
    try {
      asked = Promise.resolve(confirm(request));
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
        return accepted;
      });
  };
  const runDelete = () => {
    const uids = [...selection.objects];
    const plan = deletionPlan(model, uids);
    if (!plan.confirm) {
      history.execute(deleteObjects(uids));
      return undefined;
    }
    return ask(deleteRequest(model, plan)).then((accepted) => {
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
      if (history.inGesture || confirming) return null;
      const rootOnly = selection.objects.length === 1 && selection.objects[0] === ROOT_UID;
      return rootOnly ? 'the ragdoll root cannot be deleted' : 'select a body, shape or joint';
    },
  });
  const canShapeEdit = () => selection.focus === 'objects' && canEditRest();
  const readPlan = (plan, uids) => {
    try {
      return plan(model, uids);
    } catch {
      return null;
    }
  };
  const shapeEditReason = (stateReason) => () => {
    if (selection.focus !== 'objects') return null;
    const byMode = modeReason('edit.rest');
    if (byMode !== null) return byMode;
    if (history.inGesture || confirming) return null;
    return stateReason(selection.objects);
  };
  const groupable = (plan) => plan !== null && !plan.empty && !plan.invalid;
  const canGroup = (uids) => canShapeEdit() && groupable(readPlan(groupPlan, uids));
  const runGroup = () => {
    const uids = [...selection.objects];
    const plan = groupPlan(model, uids);
    const group = () => selection.set(history.execute(groupBodies(uids)));
    if (!plan.confirm) {
      group();
      return undefined;
    }
    return ask(groupRequest(model, plan)).then((accepted) => {
      if (accepted && canGroup(uids)) group();
    });
  };
  actions.register('group', {
    run: runGroup,
    isEnabled: () => !confirming && canGroup(selection.objects),
    reason: shapeEditReason((uids) => {
      const plan = readPlan(groupPlan, uids);
      if (plan === null || plan.bodies.length < 2) return 'select shapes of two or more bodies';
      return plan.invalid ? INVALID_GEOMETRY : null;
    }),
  });
  const splittable = (result) => result !== null && result.parts.length > 0 && !result.invalid;
  const partsReason = (plan, noPart) => (uids) => {
    const result = readPlan(plan, uids);
    if (result === null) return noPart;
    if (result.invalid) return INVALID_GEOMETRY;
    return result.parts.length === 0 ? noPart : null;
  };
  actions.register('ungroup', {
    run: () => selection.set(history.execute(ungroupBodies([...selection.objects]))),
    isEnabled: () => !confirming && canShapeEdit() && splittable(readPlan(ungroupParts, selection.objects)),
    reason: shapeEditReason(partsReason(ungroupParts, 'each selected body has a single shape')),
  });
  actions.register('split', {
    run: () => selection.set(history.execute(splitShapes([...selection.objects]))),
    isEnabled: () => !confirming && canShapeEdit() && splittable(readPlan(splitParts, selection.objects)),
    reason: shapeEditReason(partsReason(splitParts, 'select some, not all, shapes of a body')),
  });
  actions.register('duplicate', {
    run: () => selection.set(history.execute(duplicateSelection([...selection.objects]))),
    isEnabled: () => {
      if (confirming || !canShapeEdit()) return false;
      const plan = readPlan(duplicatePlan, selection.objects);
      return plan !== null && !plan.empty;
    },
    reason: shapeEditReason(() => 'select a body, shape or non-loop joint'),
  });
  actions.register('rename', {
    run: () => rename.start(),
    isEnabled: () => !confirming && !uiBusy() && rename.canStart(),
    reason: () => {
      const byMode = modeReason('edit.rest');
      if (byMode !== null) return byMode;
      if (confirming || uiBusy() || history.inGesture || rename.session !== null) return null;
      return renameTarget(model, selection.objects) === null ? 'select one object' : null;
    },
  });
  let loading = false;
  let saving = false;
  const canFile = () => modes.can('file') && !history.inGesture && !confirming && !loading && !saving;
  const tell = (message) => {
    try {
      Promise.resolve(notify(message)).catch(() => {});
    } catch {
      return;
    }
  };
  actions.register('new', {
    run: () => {
      if (!history.dirty) {
        newDocument(model);
        return undefined;
      }
      return ask(newRequest()).then((accepted) => {
        if (accepted && canFile()) newDocument(model);
      });
    },
    isEnabled: canFile,
    reason: () => modeReason('file'),
  });

  const loadFrom = async (read) => {
    if (!canFile()) return false;
    let text;
    try {
      text = await read();
    } catch {
      tell(readErrorNotice());
      return false;
    }
    if (text === null || !canFile()) return false;
    loading = true;
    try {
      if (history.dirty && !(await ask(loadRequest()))) return false;
      loading = false;
      if (!canFile()) return false;
      loading = true;
      const result = loadJson(model, text);
      if (!result.ok) {
        tell(loadErrorNotice(result.errors));
        return false;
      }
      if (result.torque !== null) history.markUnsaved();
      if (result.notes.length > 0 || result.warnings.length > 0) tell(loadNotesNotice(result.notes, result.warnings));
      return true;
    } finally {
      loading = false;
    }
  };
  if (files !== null) {
    actions.register('load', {
      run: () => loadFrom(files.openText),
      isEnabled: canFile,
      reason: () => modeReason('file'),
    });
    actions.register('save', {
      run: () => {
        const result = saveJson(model, editorVersion());
        if (!result.ok) {
          tell(saveErrorNotice(result.errors));
          return;
        }
        saving = true;
        let pending;
        try {
          pending = Promise.resolve(files.saveText(result.fileName, result.text));
        } catch (error) {
          pending = Promise.reject(error);
        }
        return pending
          .then(
            (saved) => {
              if (saved === true) history.markSaved();
            },
            () => tell(saveWriteErrorNotice()),
          )
          .finally(() => {
            saving = false;
          });
      },
      isEnabled: canFile,
      reason: () => modeReason('file'),
    });
  }
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
  const selectedBody = () => {
    const bodies = readPlan(selectedBodies, selection.objects) ?? [];
    return bodies.length === 1 ? bodies[0] : null;
  };
  const isRootBody = (body) => {
    const rootBody = model.prop(ROOT_UID, 'rootBody');
    return typeof rootBody === 'string' && model.uidOf(rootBody) === body;
  };
  const newRootBody = () => {
    if (confirming || !canEditRest()) return null;
    const body = selectedBody();
    return body === null || isRootBody(body) ? null : body;
  };
  actions.register('set-root-body', {
    run: () => {
      const body = newRootBody();
      if (body === null) return;
      const plan = rootBodyPlan(model, body);
      torqueNote = null;
      holdTorqueMessage = true;
      try {
        history.execute(setRootBody(body));
      } finally {
        holdTorqueMessage = false;
      }
      say(rootBodyMessage(model, body, plan, torqueNote));
    },
    isEnabled: () => newRootBody() !== null,
    reason: () => {
      const byMode = modeReason('edit.rest');
      if (byMode !== null || confirming || history.inGesture) return byMode;
      const body = selectedBody();
      if (body === null) return 'select one body';
      return isRootBody(body) ? 'already the root body' : null;
    },
  });
  actions.register('add-joint', {
    run: () => {
      const uid = history.execute(createJoint({ bodyA: null, bodyB: null, anchor: { x: 0, y: 0 } }, 'Add joint'));
      selection.set([uid]);
    },
    isEnabled: canEditRest,
    reason: () => modeReason('edit.rest'),
  });

  let lastClip = null;
  let openClip = null;
  let openClipLabel = null;
  const clipLabel = (uid) => {
    const name = model.prop(uid, 'name');
    return typeof name === 'string' && name !== '' ? name : model.prop(uid, 'key');
  };
  modes.on('mode', () => {
    const clip = modes.clip !== null && model.get(modes.clip)?.type === 'clip' ? modes.clip : null;
    const removed = openClip !== null && clip !== openClip && changing?.some((change) => change.kind === 'remove' && change.uid === openClip);
    if (removed && modes.mode === 'edit') say(`Clip ${openClipLabel} removed: Edit mode`);
    openClip = clip;
    openClipLabel = clip === null ? null : clipLabel(clip);
    if (clip !== null) lastClip = clip;
  });
  model.on('change', () => {
    changing = null;
    if (openClip !== null && model.get(openClip)?.type === 'clip') openClipLabel = clipLabel(openClip);
  });
  model.on('reset', () => {
    changing = null;
    lastClip = null;
  });
  const animateClip = () => {
    if (lastClip !== null && model.get(lastClip)?.type === 'clip') return lastClip;
    return model.children(ROOT_UID, 'clips')[0] ?? null;
  };
  const leaveSimulate = () => {
    if (modes.mode === 'simulate') actions.run('stop');
    return modes.mode !== 'simulate';
  };
  const canSwitchMode = () => !history.inGesture && !confirming;
  actions.register('mode:edit', {
    run: () => {
      if (leaveSimulate() && modes.mode !== 'edit') modes.openClip(null);
    },
    isEnabled: canSwitchMode,
    reason: () => null,
  });
  actions.register('mode:animate', {
    run: () => {
      if (!leaveSimulate() || modes.mode === 'animate') return;
      let clip = animateClip();
      if (clip === null) {
        clip = history.execute(createClip('New clip'));
        say(`Created clip ${clipLabel(clip)}`);
      }
      modes.openClip(clip);
    },
    isEnabled: canSwitchMode,
    reason: () => null,
  });

  /**
   * Tooltip text of a mode switch segment, without hotkey or reason.
   * @param {'edit'|'animate'|'simulate'} mode Segment.
   * @returns {string}
   */
  const modeTitle = (mode) => {
    if (mode === 'edit') return 'Edit mode: rest pose and rig';
    if (mode === 'simulate') return 'Simulate mode: live physics test';
    if (modes.mode === 'animate' && modes.clip !== null) return `Animate mode: ${clipLabel(modes.clip)}`;
    const clip = animateClip();
    return clip === null ? 'Animate mode: creates a new clip' : `Animate mode: opens ${clipLabel(clip)}`;
  };

  return Object.freeze({
    model,
    history,
    selection,
    modes,
    actions,
    settings,
    camera,
    tools,
    rename,
    editorVersion,
    loadFrom,
    status: say,
    modeTitle,
  });
}
