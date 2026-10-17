import { createEditor } from './editor.js';
import { dispatchKey } from './hotkeys.js';
import { createHeader, setActionEnabled, focusAdjacentAction } from './header.js';
import { createViewport } from './viewport.js';
import { createToolbar } from './viewport/toolbar.js';
import { framingInsets } from './viewport/bounds.js';
import { TOOL_SPECS } from './tools/tool.js';
import { createDock } from './panels/dock.js';
import { PANELS } from './panels/layout.js';
import { createHierarchy } from './panels/hierarchy.js';
import { openMenu } from './menu.js';
import { Settings } from './settings.js';
import { openSettings } from './settings-dialog.js';
import { confirmDialog, noticeDialog } from './confirm-dialog.js';
import { RAG_FILE_ACCEPT, attachFileDrop, blockFileNavigation, pickTextFile, saveTextFile } from './files.js';
import { loadSettings, saveSettings } from './storage.js';
import { ROOT_UID } from './model/model.js';
import { renameAnchor, renamePoint } from './model/rename.js';
import { attachRenameField, openRenamePopup } from './rename-field.js';
import { setProps } from './commands/props.js';
import { createPoseSession } from './physics/pose-session.js';
import { DEV_VERSION, loadVersion } from './version.js';
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
const editor = createEditor({
  settings: restored.settings,
  physics,
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
attachFileDrop(document.getElementById('panel-viewport'), (read) => editor.loadFrom(read), () => actions.isEnabled('load'));
blockFileNavigation(document);

const viewportHost = document.getElementById('viewport-host');
const toolbar = createToolbar(document.getElementById('panel-viewport'), {
  host: viewportHost,
  onActivate: (id) => actions.run('tool:' + id),
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

const headerButtons = [...header.querySelectorAll('button[data-action]')];

function refreshHeader() {
  for (const button of headerButtons) {
    const id = button.dataset.action;
    setActionEnabled(button, actions.isEnabled(id), actions.reason(id));
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
  actions.run(event.detail.action);
});

windowButton.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  if (!windowMenuOpen()) toggleWindowMenu(event.key === 'ArrowUp' ? 'last' : 'first');
});

document.addEventListener('keydown', (event) => {
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
