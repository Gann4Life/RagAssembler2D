import { createEditor } from './editor.js';
import { dispatchKey } from './hotkeys.js';
import { createHeader, setActionEnabled, setSegmentPressed, focusAdjacentAction } from './header.js';
import { createViewport } from './viewport.js';
import { createToolbar } from './viewport/toolbar.js';
import { framingInsets } from './viewport/bounds.js';
import { TOOL_SPECS } from './tools/tool.js';
import { createDock } from './panels/dock.js';
import { PANELS } from './panels/layout.js';
import { createHierarchy } from './panels/hierarchy.js';
import { createTimeline } from './panels/timeline.js';
import { TimelinePlayer } from './timeline-player.js';
import { bindAnimateView } from './model/animate-preview.js';
import { ClipSimulation } from './physics/clip-simulation.js';
import { openMenu } from './menu.js';
import { Settings } from './settings.js';
import { openSettings } from './settings-dialog.js';
import { confirmDialog, noticeDialog } from './confirm-dialog.js';
import { RAG_FILE_ACCEPT, attachFileDrop, blockFileNavigation, pickTextFile, saveTextFile } from './files.js';
import { loadSettings, saveSettings } from './storage.js';
import { ROOT_UID } from './model/model.js';
import { renameAnchor, renamePoint } from './rename.js';
import { attachRenameField, openRenamePopup } from './rename-field.js';
import { setProps } from './commands/props.js';
import { createPoseSession } from './physics/pose-session.js';
import { createSimulateSession } from './physics/simulate-session.js';
import { DEV_VERSION, loadVersion } from './version.js';
import { createStatusLine } from './status-line.js';
import { toJson } from './model/io.js';
import { validate } from '../lib/validate.js';
import { RagImporter } from '../lib/ragimporter.js';

const { PIXI, Box2D } = globalThis;
if (!PIXI) throw new Error('PIXI.js is not loaded: expected the global PIXI from vendor/pixi.min.js');
if (!Box2D) throw new Error('liquidfun.js is not loaded: expected the global Box2D from vendor/liquidfun.js');

const storedSettings = loadSettings();
if (storedSettings.error === 'parse') console.warn('Stored settings ignored: not valid JSON');
const restored = Settings.restore(storedSettings.value);
for (const warning of restored.warnings) console.warn(warning);

RagImporter.configure({ Box2D, PIXI });
const physics = Object.freeze({ startPose: (json, options) => createPoseSession(Box2D, json, options) });
let editorVersion = DEV_VERSION;
let player = null;
const statusLine = createStatusLine(document.getElementById('panel-viewport'));
const reportStatus = (text) => statusLine.show(text);
const playback = Object.freeze({
  get playing() {
    return player?.playing ?? false;
  },
  pause: () => player?.pauseAtStep(),
  hold: (pose) => player?.hold(pose),
});
const editor = createEditor({
  settings: restored.settings,
  physics,
  playback,
  status: (text) => reportStatus(text),
  editorVersion: () => editorVersion,
  confirm: (request) => confirmDialog(document, request),
  notify: (notice) => noticeDialog(document, notice),
  uiBusy: () => document.querySelector('.menu, dialog[open]') !== null,
  files: {
    openText: () => pickTextFile(document, RAG_FILE_ACCEPT),
    saveText: (fileName, text) => saveTextFile(document, fileName, text),
  },
});
const { actions, history, modes, selection, model, settings, camera, tools, rename } = editor;
settings.on('settings', () => saveSettings(settings.toJSON()));

const header = createHeader(document);
document.getElementById('header').replaceWith(header);

const dock = createDock(document.getElementById('workspace'), {
  viewportElement: document.getElementById('panel-viewport'),
});
const hierarchy = createHierarchy(dock.panelElement('hierarchy'), editor);
const frameClock = Object.freeze({
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
  now: () => performance.now(),
});
const simulator = (json, options) => createSimulateSession(Box2D, json, options);
player = new TimelinePlayer({
  model,
  modes,
  history,
  clock: frameClock,
  simulator,
  clipSimulation: new ClipSimulation(simulator, frameClock),
  status: (text) => reportStatus(text),
});

function startPlayback(run) {
  try {
    run();
  } catch (error) {
    const items = Array.isArray(error?.errors) ? error.errors.slice(0, 50).map((item) => `${item.code} ${item.path}: ${item.message}`) : [];
    noticeDialog(document, { title: 'Cannot play', message: error?.message ?? String(error), items, closeLabel: 'OK' });
  }
}

let validationErrors = null;
const invalidateErrors = () => {
  validationErrors = null;
};
model.on('change', invalidateErrors);
model.on('reset', invalidateErrors);
const hasErrors = () => {
  validationErrors ??= validate(toJson(model, DEV_VERSION)).errors.length > 0;
  return validationErrors;
};
const FIX_ERRORS = 'fix the errors in Problems';
const busy = () => history.inGesture;
const transportReason = (enabled, stateReason) => () => {
  if (enabled() || busy()) return null;
  if (modes.mode === 'edit') return 'only in Animate and Simulate modes';
  return stateReason();
};
const canStartFromEdit = () => modes.mode !== 'edit' || !hasErrors();
actions.register('toggle-play', {
  run: () => startPlayback(() => player.toggle()),
  isEnabled: () => player.canPlay() && (player.playing || canStartFromEdit()),
  reason: () => (modes.mode === 'edit' && hasErrors() && !busy() ? FIX_ERRORS : null),
});
actions.register('play', {
  run: () => startPlayback(() => player.play()),
  isEnabled: () => player.canPlay() && !player.playing && canStartFromEdit(),
  reason: () => {
    if (busy()) return null;
    if (player.playing) return 'already playing';
    return modes.mode === 'edit' && hasErrors() ? FIX_ERRORS : null;
  },
});
actions.register('pause', {
  run: () => player.pause(),
  isEnabled: () => player.playing,
  reason: transportReason(() => player.playing, () => (modes.mode === 'simulate' ? 'already paused' : 'not playing')),
});
const atCycleLimit = () => modes.clip !== null && model.prop(modes.clip, 'loop') === true;
actions.register('next-frame', {
  run: () => player.nextFrame(),
  isEnabled: () => player.canNextFrame(),
  reason: transportReason(() => player.canNextFrame(), () => (atCycleLimit() ? 'cycle limit reached' : 'at the end of the clip')),
  repeatable: true,
});
actions.register('stop', {
  run: () => player.stop(),
  isEnabled: () => player.canStop(),
  reason: transportReason(() => player.canStop(), () => 'not playing'),
});
actions.register('simulate', {
  run: () => {
    if (modes.mode !== 'simulate') startPlayback(() => player.simulate());
  },
  isEnabled: () => !busy() && (modes.mode === 'simulate' || (modes.can('play') && !hasErrors())),
  reason: () => (busy() ? null : FIX_ERRORS),
});
const timeline = createTimeline(dock.panelElement('timeline'), editor, player);
attachFileDrop(document.getElementById('panel-viewport'), (read) => editor.loadFrom(read), () => actions.isEnabled('load'));
blockFileNavigation(document);

const viewportHost = document.getElementById('viewport-host');
const toolbar = createToolbar(document.getElementById('panel-viewport'), {
  host: viewportHost,
  onActivate: (id) => actions.run('tool:' + id, { label: TOOL_SPECS.find((tool) => tool.id === id)?.label ?? id }),
});
const versionLabel = document.createElement('div');
versionLabel.className = 'version-label';
versionLabel.textContent = 'dev';
document.getElementById('panel-viewport').append(versionLabel);
loadVersion(fetch).then((info) => {
  editorVersion = info.editorVersion;
  versionLabel.textContent = info.label;
});
const windowButton = header.querySelector('[data-action="window"]');
const settingsButton = header.querySelector('[data-action="settings"]');
settingsButton.setAttribute('aria-haspopup', 'dialog');
settingsButton.setAttribute('aria-expanded', 'false');
let windowMenu = null;
let settingsPopover = null;

function windowMenuOpen() {
  return windowButton.getAttribute('aria-expanded') === 'true';
}

function toggleWindowMenu(focus) {
  if (windowMenuOpen()) {
    windowMenu.close();
    return;
  }
  windowMenu = openMenu(windowButton, dock.windowItems(), {
    focus,
    onSelect(item) {
      actions.run(item.id === 'reset-layout' ? 'reset-layout' : `panel:${item.id}`);
    },
    onNavigate(key) {
      focusAdjacentAction(header, windowButton, key);
    },
  });
}

function settingsOpen() {
  return settingsButton.getAttribute('aria-expanded') === 'true';
}

const settingsDocument = {
  pixelsPerMeter: () => model.prop(ROOT_UID, 'units.pixelsPerMeter'),
  setPixelsPerMeter: (value) => {
    history.execute(setProps([ROOT_UID], { 'units.pixelsPerMeter': value }, 'Pixels per meter'));
  },
  editable: () => modes.can('edit.rest') && !history.inGesture,
};

function toggleSettings() {
  if (settingsOpen()) {
    settingsPopover.close();
    settingsButton.focus();
    return;
  }
  settingsPopover = openSettings(settingsButton, { settings, document: settingsDocument });
}

actions.register('window', { run: () => toggleWindowMenu('first') });
for (const id of Object.keys(PANELS)) {
  actions.register(`panel:${id}`, { run: () => (dock.isOpen(id) ? dock.close(id) : dock.open(id)) });
}
actions.register('reset-layout', { run: () => dock.reset() });

const RIG_ITEMS = Object.freeze([
  [
    ['rename', 'Rename', 'F2'],
    ['duplicate', 'Duplicate', 'Ctrl+D'],
    ['delete', 'Delete', 'Del'],
  ],
  [
    ['group', 'Group', 'Ctrl+G'],
    ['ungroup', 'Ungroup', 'Ctrl+Shift+G'],
    ['split', 'Split', 'Alt+G'],
  ],
  [['set-root-body', 'Set as root body', 'Shift+R']],
  [['sprite-edit', 'Sprite edit', 'S', 'checkbox']],
]);
const VIEW_ITEMS = Object.freeze([
  [
    ['frame-selection', 'Frame selection', 'F'],
    ['frame-all', 'Frame all', 'Home'],
  ],
  [['onion-skins', 'Onion skins', undefined, 'checkbox']],
]);
const MENU_CHECKED = Object.freeze({ 'onion-skins': () => settings.get('display.ghosts') });

function actionItems(groups) {
  return groups.flatMap((group, index) => [
    ...(index > 0 ? [{ id: `separator-${index}`, label: '', kind: 'separator' }] : []),
    ...group.map(([id, label, shortcut, kind = 'item']) => ({
      id,
      label,
      shortcut,
      kind,
      checked: MENU_CHECKED[id]?.() ?? false,
      disabled: !actions.isEnabled(id),
      reason: actions.reason(id),
    })),
  ]);
}

const actionMenus = new Map();

function toggleActionMenu(id, groups, align, focus = 'first') {
  const button = header.querySelector(`[data-action="${id}"]`);
  if (button.getAttribute('aria-expanded') === 'true') {
    actionMenus.get(id)?.close();
    return;
  }
  actionMenus.set(
    id,
    openMenu(button, actionItems(groups), {
      focus,
      align,
      onSelect: (item) => actions.run(item.id, { label: item.label }),
      onRefuse: (item) => actions.run(item.id, { label: item.label }),
      onNavigate: (key) => focusAdjacentAction(header, button, key),
    }),
  );
}

actions.register('rig', { run: () => toggleActionMenu('rig', RIG_ITEMS, 'left') });
actions.register('view', { run: () => toggleActionMenu('view', VIEW_ITEMS, 'right') });
for (const [id, groups, align] of [['rig', RIG_ITEMS, 'left'], ['view', VIEW_ITEMS, 'right']]) {
  header.querySelector(`[data-action="${id}"]`).addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (header.querySelector(`[data-action="${id}"]`).getAttribute('aria-expanded') !== 'true') {
      toggleActionMenu(id, groups, align, event.key === 'ArrowUp' ? 'last' : 'first');
    }
  });
}

const headerButtons = [...header.querySelectorAll('button[data-action]')];

const SEGMENT_MODES = Object.freeze({ 'mode:edit': 'edit', 'mode:animate': 'animate', simulate: 'simulate' });

function refreshHeader() {
  for (const button of headerButtons) {
    const id = button.dataset.action;
    const mode = SEGMENT_MODES[id];
    setActionEnabled(button, actions.isEnabled(id), actions.reason(id), mode ? editor.modeTitle(mode) : null);
    if (mode) setSegmentPressed(button, modes.mode === mode);
  }
}

function refreshToolbar() {
  toolbar.setActive(tools.active?.id ?? null);
  for (const { id } of TOOL_SPECS) toolbar.setEnabled(id, actions.isEnabled('tool:' + id), actions.reason('tool:' + id));
}

function refreshDocumentViews() {
  refreshHeader();
  if (settingsOpen()) settingsPopover.refresh();
}

refreshHeader();
history.on('history', refreshDocumentViews);
modes.on('mode', refreshDocumentViews);
modes.on('mode', refreshToolbar);
tools.on('tool', refreshToolbar);
refreshToolbar();
selection.on('selection', refreshHeader);
model.on('reset', refreshDocumentViews);

header.addEventListener('header-action', (event) => {
  const { action, label } = event.detail;
  actions.run(action, { label });
});

windowButton.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  if (!windowMenuOpen()) toggleWindowMenu(event.key === 'ArrowUp' ? 'last' : 'first');
});

function stopsSimulation(event) {
  if (event.key !== 'Escape' || event.defaultPrevented || !player.simulating) return false;
  if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]')) return false;
  return document.querySelector('.menu, dialog[open]') === null;
}

document.addEventListener('keydown', (event) => {
  if (stopsSimulation(event)) {
    event.preventDefault();
    tools.cancel();
    player.stop();
    return;
  }
  dispatchKey(event, { actions, tools, viewportFocused: viewportHost.contains(document.activeElement) });
});

const viewport = await createViewport(PIXI, viewportHost, {
  model,
  camera,
  settings,
  selection,
  modes,
  tools,
  insets: () => framingInsets(toolbar.width()),
  onSpaceTap: () => actions.run('toggle-play'),
});

const animateView = bindAnimateView({
  model,
  modes,
  player,
  clock: frameClock,
  apply: (pose) => viewport.setBasePose(pose),
  applyGhosts: (ghosts) => viewport.setGhosts(ghosts),
  ghostsOn: () => settings.get('display.ghosts'),
});
settings.on('settings', ({ key }) => {
  if (key === 'display.ghosts') animateView.refresh();
});
player.on('playing', refreshHeader);
player.on('view', ({ instant }) => {
  if (instant) refreshHeader();
});

actions.register('settings', { run: toggleSettings, isEnabled: () => modes.can('settings.editor') });
actions.register('frame-selection', { run: () => viewport.frame(selection.objects), isEnabled: () => modes.can('camera') });
actions.register('frame-all', { run: () => viewport.frame(null), isEnabled: () => modes.can('camera') });
refreshHeader();

let pointer = null;
const trackPointer = (event) => {
  pointer = { x: event.clientX, y: event.clientY };
};
document.addEventListener('pointermove', trackPointer, { capture: true, passive: true });
document.addEventListener('pointerdown', trackPointer, { capture: true, passive: true });
document.addEventListener('pointerout', (event) => {
  if (event.relatedTarget === null) pointer = null;
});

function elementUnderPointer() {
  return pointer === null ? null : document.elementFromPoint(pointer.x, pointer.y);
}

function openRenameField(session, returnFocus) {
  const under = elementUnderPointer();
  const inline = under && dock.panelElement('hierarchy').contains(under) ? hierarchy.renameRow(session.uid) : null;
  if (inline) {
    attachRenameField(inline.input, rename, { returnFocus, onClose: inline.restore });
    return;
  }
  const panel = document.getElementById('panel-viewport');
  const viewportRect = viewportHost.getBoundingClientRect();
  const overViewport = under !== null && panel.contains(under);
  const world = renamePoint(model, session.uid, viewport.scene.pose());
  const anchor = renameAnchor({
    pointer: overViewport ? { x: pointer.x - viewportRect.left, y: pointer.y - viewportRect.top } : null,
    point: world === null ? null : camera.worldToScreen(world),
    width: viewportRect.width,
    height: viewportRect.height,
  });
  const popup = openRenamePopup(panel, { anchor, viewport: viewportRect });
  attachRenameField(popup.input, rename, { returnFocus, onClose: () => popup.element.remove() });
}

rename.on('rename', ({ session }) => {
  if (session !== null) openRenameField(session, document.activeElement);
});
