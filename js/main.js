import { createHeader, setActionEnabled, focusAdjacentAction } from './header.js';
import { createViewport } from './viewport.js';
import { createDock } from './panels/dock.js';
import { openMenu } from './menu.js';

const { PIXI, Box2D } = globalThis;
if (!PIXI) throw new Error('PIXI.js is not loaded: expected the global PIXI from vendor/pixi.min.js');
if (!Box2D) throw new Error('liquidfun.js is not loaded: expected the global Box2D from vendor/liquidfun.js');

const header = createHeader(document);
document.getElementById('header').replaceWith(header);

const dock = createDock(document.getElementById('workspace'), {
  viewportElement: document.getElementById('panel-viewport'),
});

const windowButton = header.querySelector('[data-action="window"]');
setActionEnabled(windowButton, true);
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
      if (item.id === 'reset-layout') dock.reset();
      else if (dock.isOpen(item.id)) dock.close(item.id);
      else dock.open(item.id);
    },
    onNavigate(key) {
      focusAdjacentAction(header, windowButton, key);
    },
  });
}

header.addEventListener('header-action', (event) => {
  if (event.detail.action === 'window') toggleWindowMenu('first');
});

windowButton.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  if (!windowMenuOpen()) toggleWindowMenu(event.key === 'ArrowUp' ? 'last' : 'first');
});

await createViewport(PIXI, document.getElementById('viewport-host'));
