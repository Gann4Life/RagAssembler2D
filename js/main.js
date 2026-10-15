import { createEditor } from './editor.js';
import { dispatchKey } from './hotkeys.js';
import { createHeader, setActionEnabled, focusAdjacentAction } from './header.js';
import { createViewport } from './viewport.js';
import { createDock } from './panels/dock.js';
import { PANELS } from './panels/layout.js';
import { openMenu } from './menu.js';

const { PIXI, Box2D } = globalThis;
if (!PIXI) throw new Error('PIXI.js is not loaded: expected the global PIXI from vendor/pixi.min.js');
if (!Box2D) throw new Error('liquidfun.js is not loaded: expected the global Box2D from vendor/liquidfun.js');

const editor = createEditor();
const { actions, history, modes, selection } = editor;

const header = createHeader(document);
document.getElementById('header').replaceWith(header);

const dock = createDock(document.getElementById('workspace'), {
  viewportElement: document.getElementById('panel-viewport'),
});

const viewportHost = document.getElementById('viewport-host');
const windowButton = header.querySelector('[data-action="window"]');
let windowMenu = null;

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

refreshHeader();
history.on('history', refreshHeader);
modes.on('mode', refreshHeader);
selection.on('selection', refreshHeader);

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

await createViewport(PIXI, viewportHost);
