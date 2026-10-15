import { createEditor } from './editor.js';
import { dispatchKey } from './hotkeys.js';
import { createHeader, setActionEnabled, focusAdjacentAction } from './header.js';
import { createViewport } from './viewport.js';
import { createDock } from './panels/dock.js';
import { PANELS } from './panels/layout.js';
import { openMenu } from './menu.js';
import { Settings } from './settings.js';
import { openSettings } from './settings-dialog.js';
import { loadSettings, saveSettings } from './storage.js';
import { ROOT_UID } from './model/model.js';
import { setProps } from './commands/props.js';

const { PIXI, Box2D } = globalThis;
if (!PIXI) throw new Error('PIXI.js is not loaded: expected the global PIXI from vendor/pixi.min.js');
if (!Box2D) throw new Error('liquidfun.js is not loaded: expected the global Box2D from vendor/liquidfun.js');

const VIEWPORT_INSET = 16;

const storedSettings = loadSettings();
if (storedSettings.error === 'parse') console.warn('Stored settings ignored: not valid JSON');
const restored = Settings.restore(storedSettings.value);
for (const warning of restored.warnings) console.warn(warning);

const editor = createEditor({ settings: restored.settings });
const { actions, history, modes, selection, model, settings, camera } = editor;
settings.on('settings', () => saveSettings(settings.toJSON()));

const header = createHeader(document);
document.getElementById('header').replaceWith(header);

const dock = createDock(document.getElementById('workspace'), {
  viewportElement: document.getElementById('panel-viewport'),
});

const viewportHost = document.getElementById('viewport-host');
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

function refreshDocumentViews() {
  refreshHeader();
  if (settingsOpen()) settingsPopover.refresh();
}

refreshHeader();
history.on('history', refreshDocumentViews);
modes.on('mode', refreshDocumentViews);
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
  dispatchKey(event, { actions, tools: null, viewportFocused: viewportHost.contains(document.activeElement) });
});

const viewport = await createViewport(PIXI, viewportHost, {
  model,
  camera,
  settings,
  insets: () => ({ top: VIEWPORT_INSET, right: VIEWPORT_INSET, bottom: VIEWPORT_INSET, left: VIEWPORT_INSET }),
  onSpaceTap: () => actions.run('toggle-play'),
});

actions.register('settings', { run: toggleSettings, isEnabled: () => modes.can('settings.editor') });
actions.register('frame-selection', { run: () => viewport.frame(selection.objects), isEnabled: () => modes.can('camera') });
actions.register('frame-all', { run: () => viewport.frame(null), isEnabled: () => modes.can('camera') });
refreshHeader();
