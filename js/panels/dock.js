import { Emitter } from '../../lib/emitter.js';
import { rovingIndex } from '../roving-focus.js';
import { loadLayout, saveLayout, clearLayout } from '../storage.js';
import {
  PANELS,
  defaultLayout,
  restoreLayout,
  activatePanel,
  closePanel,
  openPanel,
  movePanel,
  resizeSplit,
  timelineFold,
  setTimelineFolded,
  computeRects,
  dropAt,
} from './layout.js';

/**
 * @typedef {object} Dock
 * @property {(id: import('./layout.js').PanelId | 'viewport') => HTMLElement | null} panelElement Element a panel mounts into.
 * @property {(id: import('./layout.js').PanelId | 'viewport') => boolean} isOpen
 * @property {(id: import('./layout.js').PanelId) => void} open Reopens a closed panel by the reopen rule and activates it.
 * @property {(id: import('./layout.js').PanelId) => void} close Closes an open panel, repairing focus if it had it.
 * @property {() => void} reset Forgets the stored layout and applies the default.
 * @property {() => import('../menu.js').MenuItem[]} windowItems Items of the Window menu (`DESIGN.md` §5.3).
 * @property {(type: 'layout', fn: (payload: { layout: import('./layout.js').Layout }) => void) => () => void} on
 * @property {(type: 'layout', fn: (payload: { layout: import('./layout.js').Layout }) => void) => void} off
 * @property {() => void} destroy Stops observing and listening.
 */

const SAVE_DELAY = 500;
const DRAG_THRESHOLD = 4;
const KEY_STEP = 10;
const KEY_STEP_LARGE = 50;
const MIDDLE_BUTTON = 1;
const GHOST_OFFSET = 12;
const FADE_WIDTH = 12;
const WHEEL_LINE = 16;
const TIMELINE = 'timeline';
const PANEL_IDS = Object.freeze(Object.keys(PANELS));
const WINDOW_ORDER = Object.freeze(['viewport', ...PANEL_IDS]);
const WIDGET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' ', 'Escape']);

/**
 * Renders the dock layout inside the workspace and turns pointer and keyboard input into layout operations.
 * Restores the stored layout on creation (warning on the console when it is ignored) and saves after every change.
 * @param {HTMLElement} workspace The `#workspace` element; its children are replaced.
 * @param {{ viewportElement: HTMLElement }} options The viewport panel element, kept and positioned by the dock.
 * @returns {Dock}
 */
export function createDock(workspace, { viewportElement }) {
  const doc = workspace.ownerDocument;
  const events = new Emitter();
  const content = doc.createElement('div');
  content.className = 'dock-content';
  workspace.replaceChildren(content);
  viewportElement.classList.add('dock-viewport');
  const preview = doc.createElement('div');
  preview.className = 'dock-preview';
  preview.hidden = true;
  const caret = doc.createElement('div');
  caret.className = 'dock-preview dock-caret';
  caret.hidden = true;
  content.append(viewportElement, preview, caret);

  const foldButton = createFoldButton(doc);
  const panelElements = new Map(PANEL_IDS.map((id) => [id, createPanelElement(doc, id)]));
  const stackElements = new Map();
  const gutterElements = new Map();
  const gutterData = new WeakMap();

  let layout = initialLayout(workspaceSize());
  let saveTimer = 0;
  let tabDrag = null;
  let gutterDrag = null;
  let suppressClick = false;

  render(null);
  const observer = new ResizeObserver(() => place());
  observer.observe(workspace);

  content.addEventListener('pointerdown', onPointerDown);
  content.addEventListener('pointermove', onPointerMove);
  content.addEventListener('pointerup', onPointerUp);
  content.addEventListener('pointercancel', onPointerCancel);
  content.addEventListener('lostpointercapture', onPointerCancel);
  content.addEventListener('click', onClick);
  content.addEventListener('dblclick', onDoubleClick);
  content.addEventListener('auxclick', onAuxClick);
  content.addEventListener('keydown', onKeyDown);
  content.addEventListener('wheel', onWheel, { passive: false });
  content.addEventListener('scroll', onScroll, true);

  function workspaceSize() {
    return { width: workspace.clientWidth, height: workspace.clientHeight };
  }

  function initialLayout(size) {
    const stored = loadLayout();
    if ('value' in stored) {
      const restored = restoreLayout(stored.value, size);
      if (restored.warning) console.warn(restored.warning);
      return restored.layout;
    }
    if (stored.error === 'parse') console.warn('Stored layout ignored: not valid JSON');
    return defaultLayout(size);
  }

  function render(focusPanel) {
    const stacks = collectStacks(layout.tree);
    const live = new Set(stacks.map((node) => node.id));
    for (const [id, element] of stackElements) {
      if (live.has(id)) continue;
      element.remove();
      stackElements.delete(id);
    }
    const fold = timelineFold(layout);
    if (!fold || foldButton.closest('.dock-stack')?.dataset.stack !== fold.stackId) foldButton.remove();
    for (const node of stacks) renderStack(node, fold?.stackId === node.id ? fold : null);
    for (const id of PANEL_IDS) {
      if (!stacks.some((node) => node.panels.includes(id))) panelElements.get(id).remove();
    }
    place();
    if (focusPanel) tabElement(focusPanel)?.focus();
  }

  function renderStack(node, fold) {
    let element = stackElements.get(node.id);
    if (!element) {
      element = createStackElement(doc, node.id);
      stackElements.set(node.id, element);
      content.insertBefore(element, preview);
    }
    const [tabBar, body] = element.children;
    const tablist = tabBar.firstElementChild;
    tablist.setAttribute('aria-label', `${node.panels.map((id) => PANELS[id].title).join(', ')} tabs`);
    tablist.replaceChildren(...node.panels.map((id) => createTab(doc, id, id === node.active)));
    if (fold) {
      updateFoldButton(foldButton, fold.folded);
      if (foldButton.parentElement !== tabBar) tabBar.append(foldButton);
    }
    const folded = fold?.folded === true;
    element.classList.toggle('is-folded', folded);
    for (const id of node.panels) {
      const panel = panelElements.get(id);
      if (panel.parentElement !== body) body.append(panel);
      panel.hidden = id !== node.active || folded;
    }
    for (const child of [...body.children]) {
      if (!node.panels.includes(child.dataset.panel)) child.remove();
    }
  }

  function place() {
    const rects = computeRects(layout, workspaceSize());
    content.style.width = `${rects.width}px`;
    content.style.height = `${rects.height}px`;
    for (const [id, element] of stackElements) setRect(element, rects.stacks.get(id));
    setRect(viewportElement, rects.viewport);
    const keys = new Set();
    for (const gutter of rects.gutters) {
      const key = gutterKey(gutter.path, gutter.index);
      keys.add(key);
      let element = gutterElements.get(key);
      if (!element) {
        element = createGutterElement(doc);
        gutterElements.set(key, element);
        content.insertBefore(element, preview);
      }
      updateGutter(element, gutter);
    }
    for (const [key, element] of gutterElements) {
      if (keys.has(key)) continue;
      element.remove();
      gutterElements.delete(key);
    }
    orderContent();
    for (const node of collectStacks(layout.tree)) revealActiveTab(node);
    for (const element of stackElements.values()) updateFades(tablistOf(element));
    return rects;
  }

  function orderContent() {
    const desired = [];
    const visit = (node, path) => {
      if (node.type === 'viewport') desired.push(viewportElement);
      else if (node.type === 'stack') desired.push(stackElements.get(node.id));
      else {
        node.children.forEach((child, index) => {
          visit(child, [...path, index]);
          const gutter = gutterElements.get(gutterKey(path, index));
          if (gutter && index < node.children.length - 1) desired.push(gutter);
        });
      }
    };
    visit(layout.tree, []);
    desired.push(preview, caret);
    const pivot = desired.findIndex((element) => element.contains(doc.activeElement));
    let anchor = pivot >= 0 ? desired[pivot] : null;
    for (let index = (pivot >= 0 ? pivot : desired.length) - 1; index >= 0; index -= 1) {
      const element = desired[index];
      if (element.parentElement !== content || element.nextElementSibling !== anchor) content.insertBefore(element, anchor);
      anchor = element;
    }
    if (pivot < 0) return;
    anchor = desired[pivot];
    for (const element of desired.slice(pivot + 1)) {
      if (anchor.nextElementSibling !== element) anchor.after(element);
      anchor = element;
    }
  }

  function updateGutter(element, gutter) {
    const node = nodeAt(layout.tree, gutter.path);
    const area = node.children[gutter.controlled];
    gutterData.set(element, { gutter, sign: gutter.controlled === gutter.index ? 1 : -1 });
    element.className = `dock-gutter dock-gutter-${gutter.dir}`;
    element.setAttribute('aria-orientation', gutter.dir === 'row' ? 'vertical' : 'horizontal');
    element.setAttribute('aria-valuenow', String(Math.round(gutter.value)));
    element.setAttribute('aria-valuemin', String(Math.round(gutter.min)));
    element.setAttribute('aria-valuemax', String(Math.round(gutter.max)));
    element.setAttribute('aria-valuetext', `${Math.round(gutter.value)} px`);
    element.setAttribute('aria-label', `${nodeLabel(area)} ${gutter.dir === 'row' ? 'width' : 'height'}`);
    const controls = nodeElementId(area);
    if (controls) element.setAttribute('aria-controls', controls);
    else element.removeAttribute('aria-controls');
    if (gutterDrag?.element === element) element.classList.add('is-dragging');
    setRect(element, gutter.rect);
  }

  function nodeElementId(node) {
    const leaf = representative(node);
    if (leaf.type === 'stack') return `dock-stack-${leaf.id}`;
    return viewportElement.id || null;
  }

  function commit(next, { save = true, focusPanel = focusedTabPanel() } = {}) {
    layout = next;
    render(focusPanel);
    if (save) {
      clearTimeout(saveTimer);
      saveLayout(layout);
    }
    events.emit('layout', { layout });
  }

  function update(next) {
    layout = next;
    place();
    events.emit('layout', { layout });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveLayout(layout), SAVE_DELAY);
  }

  function focusedTabPanel() {
    const tab = doc.activeElement?.closest?.('.dock-tab-label');
    return tab && content.contains(tab) ? tab.dataset.panel : null;
  }

  function tabElement(id) {
    return content.querySelector(`#dock-tab-${id}`);
  }

  function focusViewport() {
    (viewportElement.querySelector('[tabindex]') ?? viewportElement).focus();
  }

  function isOpen(id) {
    if (id === 'viewport') return true;
    return collectStacks(layout.tree).some((node) => node.panels.includes(id));
  }

  function activate(id) {
    const owner = stackOf(layout.tree, id);
    const fold = timelineFold(layout);
    const folded = fold?.folded === true && fold.stackId === owner.id;
    if (owner.active === id && !folded) {
      revealActiveTab(owner);
      tabElement(id)?.focus();
      return;
    }
    commit(activatePanel(layout, id), { focusPanel: id });
  }

  function toggleFold() {
    const fold = timelineFold(layout);
    if (!fold) return;
    const focusInside = !fold.folded && panelElements.get(TIMELINE).contains(doc.activeElement);
    commit(setTimelineFolded(layout, !fold.folded));
    if (focusInside) foldButton.focus();
  }

  function open(id) {
    if (isOpen(id)) return;
    commit(openPanel(layout, id, workspaceSize()));
  }

  function close(id) {
    if (!isOpen(id) || id === 'viewport') return;
    const owner = stackOf(layout.tree, id);
    const hadFocus = doc.activeElement?.closest?.('[data-panel]')?.dataset.panel === id;
    commit(closePanel(layout, id), { focusPanel: hadFocus ? null : focusedTabPanel() });
    if (!hadFocus) return;
    const remaining = collectStacks(layout.tree).find((node) => node.id === owner.id);
    if (remaining) tabElement(remaining.active)?.focus();
    else focusViewport();
  }

  function onClick(event) {
    if (suppressClick) return;
    if (event.target.closest('.dock-fold')) {
      toggleFold();
      return;
    }
    const closeButton = event.target.closest('.dock-tab-close');
    if (closeButton) {
      close(closeButton.dataset.panel);
      return;
    }
    const tab = event.target.closest('.dock-tab-label');
    if (tab) activate(tab.dataset.panel);
  }

  function onDoubleClick(event) {
    const tabBar = event.target.closest?.('.dock-tabbar');
    if (!tabBar || event.target.closest('.dock-tab, .dock-fold')) return;
    if (tabBar.closest('.dock-stack').dataset.stack === timelineFold(layout)?.stackId) toggleFold();
  }

  function onWheel(event) {
    const list = event.target.closest?.('.dock-tablist');
    if (!list || event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const max = list.scrollWidth - list.clientWidth;
    if (max <= 0) return;
    const delta = event.deltaY * wheelUnit(event, list);
    const canScroll = delta < 0 ? list.scrollLeft > 0 : list.scrollLeft < max - 0.5;
    if (!canScroll) return;
    event.preventDefault();
    list.scrollLeft += delta;
  }

  function onScroll(event) {
    if (event.target.classList?.contains('dock-tablist')) updateFades(event.target);
  }

  function onAuxClick(event) {
    if (event.button !== MIDDLE_BUTTON) return;
    const tab = event.target.closest('.dock-tab');
    if (!tab) return;
    event.preventDefault();
    close(tab.dataset.panel);
  }

  function onKeyDown(event) {
    const tab = event.target.closest?.('.dock-tab-label');
    if (tab) {
      onTabKey(event, tab);
      return;
    }
    const gutter = event.target.closest?.('.dock-gutter');
    if (gutter) onGutterKey(event, gutter);
  }

  function onTabKey(event, tab) {
    if (!WIDGET_KEYS.has(event.key)) return;
    event.preventDefault();
    const tabs = [...tab.closest('.dock-tablist').querySelectorAll('.dock-tab-label')];
    const current = tabs.indexOf(tab);
    const next = rovingIndex(current, event.key, tabs.length);
    if (next >= 0) {
      if (next !== current) activate(tabs[next].dataset.panel);
    } else if (event.key === 'Enter' || event.key === ' ') {
      activate(tab.dataset.panel);
    }
  }

  function onGutterKey(event, element) {
    if (!WIDGET_KEYS.has(event.key)) return;
    event.preventDefault();
    const { gutter, sign } = gutterData.get(element);
    const [back, forward] = gutter.dir === 'row' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    let value;
    if (event.key === forward) value = gutter.value + step * sign;
    else if (event.key === back) value = gutter.value - step * sign;
    else if (event.key === 'Home') value = gutter.min;
    else if (event.key === 'End') value = gutter.max;
    else return;
    update(resizeSplit(layout, gutter.path, gutter.index, value, workspaceSize()));
    scheduleSave();
  }

  function onPointerDown(event) {
    if (tabDrag || gutterDrag) return;
    const gutter = event.target.closest('.dock-gutter');
    if (gutter && event.button === 0) {
      startGutterDrag(event, gutter);
      return;
    }
    const tab = event.target.closest('.dock-tab');
    if (!tab) return;
    if (event.button === MIDDLE_BUTTON) {
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || event.target.closest('.dock-tab-close')) return;
    tabDrag = {
      panelId: tab.dataset.panel,
      pointerId: event.pointerId,
      source: tab,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      workspace: null,
      rects: null,
      result: null,
      ghost: null,
    };
  }

  function onPointerMove(event) {
    if (gutterDrag && event.pointerId === gutterDrag.pointerId) {
      moveGutter(event);
      return;
    }
    if (!tabDrag || event.pointerId !== tabDrag.pointerId) return;
    if (!tabDrag.active) {
      if (Math.hypot(event.clientX - tabDrag.startX, event.clientY - tabDrag.startY) <= DRAG_THRESHOLD) return;
      beginTabDrag();
    }
    moveTabDrag(event);
  }

  function onPointerUp(event) {
    if (gutterDrag && event.pointerId === gutterDrag.pointerId) {
      const changed = gutterDrag.layout !== layout;
      endGutterDrag();
      if (changed) {
        clearTimeout(saveTimer);
        saveLayout(layout);
      }
      return;
    }
    if (!tabDrag || event.pointerId !== tabDrag.pointerId) return;
    const { active, result, panelId } = tabDrag;
    endTabDrag();
    if (!active) return;
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    if (result) commit(movePanel(layout, panelId, result.drop, workspaceSize()), { focusPanel: panelId });
  }

  function onPointerCancel(event) {
    if (gutterDrag && event.pointerId === gutterDrag.pointerId) cancelGutterDrag();
    else if (tabDrag && event.pointerId === tabDrag.pointerId) endTabDrag();
  }

  function onDragKey(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (gutterDrag) cancelGutterDrag();
    if (tabDrag) endTabDrag();
  }

  function beginTabDrag() {
    tabDrag.active = true;
    tabDrag.source.setPointerCapture(tabDrag.pointerId);
    tabDrag.workspace = workspaceSize();
    tabDrag.rects = { ...computeRects(layout, tabDrag.workspace), tabs: measureTabs() };
    const ghost = doc.createElement('div');
    ghost.className = 'dock-ghost';
    ghost.textContent = PANELS[tabDrag.panelId].title;
    doc.body.append(ghost);
    tabDrag.ghost = ghost;
    doc.body.classList.add('dock-dragging');
    doc.addEventListener('keydown', onDragKey, true);
  }

  function moveTabDrag(event) {
    tabDrag.ghost.style.left = `${event.clientX + GHOST_OFFSET}px`;
    tabDrag.ghost.style.top = `${event.clientY + GHOST_OFFSET}px`;
    const origin = content.getBoundingClientRect();
    const point = { x: event.clientX - origin.left, y: event.clientY - origin.top };
    const result = dropAt(layout, tabDrag.rects, point, tabDrag.panelId, tabDrag.workspace);
    tabDrag.result = result;
    doc.body.classList.toggle('dock-no-drop', !result);
    preview.hidden = !result;
    caret.hidden = !result?.caret;
    if (result) setRect(preview, result.preview);
    if (result?.caret) setRect(caret, result.caret);
  }

  function endTabDrag() {
    if (!tabDrag) return;
    const drag = tabDrag;
    tabDrag = null;
    if (!drag.active) return;
    drag.ghost?.remove();
    preview.hidden = true;
    caret.hidden = true;
    doc.body.classList.remove('dock-dragging', 'dock-no-drop');
    doc.removeEventListener('keydown', onDragKey, true);
    if (drag.source.hasPointerCapture?.(drag.pointerId)) drag.source.releasePointerCapture(drag.pointerId);
  }

  function measureTabs() {
    const origin = content.getBoundingClientRect();
    const tabs = new Map();
    for (const [id, element] of stackElements) {
      tabs.set(id, [...element.querySelectorAll('.dock-tab')].map((tab) => {
        const box = tab.getBoundingClientRect();
        return { x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height };
      }));
    }
    return tabs;
  }

  function startGutterDrag(event, element) {
    event.preventDefault();
    const { gutter, sign } = gutterData.get(element);
    element.setPointerCapture(event.pointerId);
    element.classList.add('is-dragging');
    gutterDrag = {
      element,
      pointerId: event.pointerId,
      start: gutter.dir === 'row' ? event.clientX : event.clientY,
      gutter,
      sign,
      layout,
    };
    doc.body.classList.add(`dock-resizing-${gutter.dir}`);
    doc.addEventListener('keydown', onDragKey, true);
  }

  function moveGutter(event) {
    const { gutter, sign, start } = gutterDrag;
    const position = gutter.dir === 'row' ? event.clientX : event.clientY;
    const value = gutter.value + (position - start) * sign;
    update(resizeSplit(gutterDrag.layout, gutter.path, gutter.index, value, workspaceSize()));
  }

  function cancelGutterDrag() {
    if (!gutterDrag) return;
    const original = gutterDrag.layout;
    endGutterDrag();
    if (original !== layout) update(original);
  }

  function endGutterDrag() {
    const drag = gutterDrag;
    gutterDrag = null;
    drag.element.classList.remove('is-dragging');
    doc.body.classList.remove(`dock-resizing-${drag.gutter.dir}`);
    doc.removeEventListener('keydown', onDragKey, true);
    if (drag.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
  }

  function revealActiveTab(node) {
    const tab = tabElement(node.active)?.parentElement;
    const list = tab?.parentElement;
    if (!list) return;
    const left = tab.offsetLeft - FADE_WIDTH;
    const right = tab.offsetLeft + tab.offsetWidth + FADE_WIDTH;
    if (left < list.scrollLeft) list.scrollLeft = Math.max(0, left);
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  }

  return {
    panelElement(id) {
      if (id === 'viewport') return viewportElement;
      return panelElements.get(id) ?? null;
    },
    isOpen,
    open,
    close,
    reset() {
      clearTimeout(saveTimer);
      clearLayout();
      commit(defaultLayout(workspaceSize()), { save: false });
    },
    windowItems() {
      return WINDOW_ORDER.map((id) => ({
        id,
        label: id === 'viewport' ? 'Viewport' : PANELS[id].title,
        kind: 'checkbox',
        checked: isOpen(id),
        disabled: id === 'viewport',
      })).concat(
        { id: 'separator', label: '', kind: 'separator' },
        { id: 'reset-layout', label: 'Reset layout', kind: 'item', checked: false, disabled: false },
      );
    },
    on(type, fn) {
      return events.on(type, fn);
    },
    off(type, fn) {
      events.off(type, fn);
    },
    destroy() {
      endTabDrag();
      if (gutterDrag) endGutterDrag();
      clearTimeout(saveTimer);
      observer.disconnect();
      content.removeEventListener('pointerdown', onPointerDown);
      content.removeEventListener('pointermove', onPointerMove);
      content.removeEventListener('pointerup', onPointerUp);
      content.removeEventListener('pointercancel', onPointerCancel);
      content.removeEventListener('lostpointercapture', onPointerCancel);
      content.removeEventListener('click', onClick);
      content.removeEventListener('dblclick', onDoubleClick);
      content.removeEventListener('auxclick', onAuxClick);
      content.removeEventListener('keydown', onKeyDown);
      content.removeEventListener('wheel', onWheel);
      content.removeEventListener('scroll', onScroll, true);
      events.clear();
    },
  };
}

function createPanelElement(doc, id) {
  const panel = doc.createElement('section');
  panel.className = 'dock-panel';
  panel.id = `panel-${id}`;
  panel.dataset.panel = id;
  panel.tabIndex = 0;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `dock-tab-${id}`);
  const placeholder = doc.createElement('p');
  placeholder.className = 'dock-placeholder';
  placeholder.textContent = `${PANELS[id].title} (not available yet)`;
  panel.append(placeholder);
  return panel;
}

function createStackElement(doc, id) {
  const element = doc.createElement('div');
  element.className = 'dock-stack';
  element.id = `dock-stack-${id}`;
  element.dataset.stack = id;
  const tabBar = doc.createElement('div');
  tabBar.className = 'dock-tabbar';
  const tablist = doc.createElement('div');
  tablist.className = 'dock-tablist';
  tablist.setAttribute('role', 'tablist');
  tabBar.append(tablist);
  const body = doc.createElement('div');
  body.className = 'dock-body';
  element.append(tabBar, body);
  return element;
}

function tablistOf(stackElement) {
  return stackElement.firstElementChild.firstElementChild;
}

function createFoldButton(doc) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'dock-fold';
  button.setAttribute('aria-controls', 'panel-timeline');
  button.setAttribute('aria-label', 'Timeline content');
  return button;
}

function updateFoldButton(button, folded) {
  button.textContent = folded ? '▸' : '▾';
  button.title = folded ? 'Expand' : 'Fold';
  button.setAttribute('aria-expanded', String(!folded));
}

function updateFades(list) {
  const max = list.scrollWidth - list.clientWidth;
  list.classList.toggle('is-clipped-start', list.scrollLeft > 0.5);
  list.classList.toggle('is-clipped-end', list.scrollLeft < max - 0.5);
}

function wheelUnit(event, list) {
  if (event.deltaMode === 1) return WHEEL_LINE;
  if (event.deltaMode === 2) return list.clientWidth;
  return 1;
}

function gutterKey(path, index) {
  return `${path.join('.')}:${index}`;
}

function createTab(doc, id, active) {
  const title = PANELS[id].title;
  const wrapper = doc.createElement('div');
  wrapper.className = active ? 'dock-tab is-active' : 'dock-tab';
  wrapper.dataset.panel = id;
  wrapper.setAttribute('role', 'presentation');
  const tab = doc.createElement('button');
  tab.type = 'button';
  tab.className = 'dock-tab-label';
  tab.id = `dock-tab-${id}`;
  tab.dataset.panel = id;
  tab.textContent = title;
  tab.tabIndex = active ? 0 : -1;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', String(active));
  tab.setAttribute('aria-controls', `panel-${id}`);
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'dock-tab-close';
  close.dataset.panel = id;
  close.tabIndex = -1;
  close.title = `Close ${title}`;
  close.setAttribute('aria-label', `Close ${title}`);
  close.textContent = '×';
  wrapper.append(tab, close);
  return wrapper;
}

function createGutterElement(doc) {
  const element = doc.createElement('div');
  element.tabIndex = 0;
  element.setAttribute('role', 'separator');
  const grip = doc.createElement('span');
  grip.className = 'dock-grip';
  element.append(grip);
  return element;
}

function setRect(element, rect) {
  element.style.left = `${rect.x}px`;
  element.style.top = `${rect.y}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

function nodeLabel(node) {
  const leaf = representative(node);
  return leaf.type === 'viewport' ? 'Viewport' : PANELS[leaf.active].title;
}

function representative(node) {
  if (node.type !== 'split') return node;
  return representative(node.children.find(containsViewport) ?? node.children[0]);
}

function containsViewport(node) {
  if (node.type === 'viewport') return true;
  return node.type === 'split' && node.children.some(containsViewport);
}

function collectStacks(node, out = []) {
  if (node.type === 'stack') out.push(node);
  else if (node.type === 'split') node.children.forEach((child) => collectStacks(child, out));
  return out;
}

function stackOf(tree, id) {
  return collectStacks(tree).find((node) => node.panels.includes(id));
}

function nodeAt(tree, path) {
  return path.reduce((node, index) => node.children[index], tree);
}
