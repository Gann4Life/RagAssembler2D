import { rovingIndex } from '../roving-focus.js';
import { actionTitle } from '../header.js';
import { attachTooltip } from '../tooltip.js';
import { TOOL_SPECS } from '../tools/tool.js';

/**
 * One toolbar button. Compatible with `HeaderAction` for `actionTitle`.
 * @typedef {object} ToolButton
 * @property {import('../tools/tool.js').ToolId} id Tool id.
 * @property {string} label Tool label.
 * @property {string} shortcut Tool hotkey.
 * @property {string} icon SVG child markup for a 24 x 24 `viewBox`, without the `<svg>` wrapper.
 */

/**
 * @typedef {object} Toolbar
 * @property {(id: import('../tools/tool.js').ToolId | null) => void} setActive Presses one button, or none with `null`.
 * @property {(id: import('../tools/tool.js').ToolId, enabled: boolean, reason?: string | null) => void} setEnabled
 *   Enables or disables a button through `aria-disabled` and updates its tooltip.
 * @property {() => number} width Current overlay width, CSS px, from the column count; reads no layout.
 * @property {() => void} destroy Removes the overlay, its observer, listeners and tooltips.
 */

const ICONS = Object.freeze({
  select: '<path d="M6 3v15l4-3.5 3 6 2.5-1.2-3-5.8 5-.5z"/>',
  'select-box':
    '<rect x="3" y="4" width="14" height="11" stroke-dasharray="3 2"/>'
    + '<path d="M12 12v9l2.4-2 1.8 3.2 1.4-.8-1.8-3.1 3-.3z" fill="currentColor"/>',
  pose:
    '<path d="M6 5l5 7-4 7"/>'
    + '<circle cx="6" cy="5" r="1.8" fill="currentColor"/><circle cx="11" cy="12" r="1.8" fill="currentColor"/>'
    + '<circle cx="7" cy="19" r="1.8" fill="currentColor"/>'
    + '<path d="M15 14h6M18.5 11.5 21 14l-2.5 2.5"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  box: '<rect x="4" y="6" width="16" height="12"/>',
  polygon:
    '<path d="M12 3l8.5 6.2-3.2 9.8H6.7L3.5 9.2z"/>'
    + '<circle cx="12" cy="3" r="1.5" fill="currentColor"/><circle cx="20.5" cy="9.2" r="1.5" fill="currentColor"/>'
    + '<circle cx="17.3" cy="19" r="1.5" fill="currentColor"/><circle cx="6.7" cy="19" r="1.5" fill="currentColor"/>'
    + '<circle cx="3.5" cy="9.2" r="1.5" fill="currentColor"/>',
  hinge:
    '<rect x="2.5" y="8" width="12" height="5" rx="1" transform="rotate(-20 8.5 10.5)"/>'
    + '<rect x="9.5" y="11" width="12" height="5" rx="1" transform="rotate(25 15.5 13.5)"/>'
    + '<circle cx="12" cy="12" r="1.8" fill="currentColor"/>'
    + '<path d="M7 21a8 8 0 0 0 10 0"/>',
});

function buildToolButtons() {
  const groups = new Map();
  for (const { id, label, hotkey, group } of TOOL_SPECS) {
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(Object.freeze({ id, label, shortcut: hotkey, icon: ICONS[id] }));
  }
  return Object.freeze([...groups.values()].map((entries) => Object.freeze(entries)));
}

/**
 * Toolbar buttons in groups, from `TOOL_SPECS`.
 * @type {ReadonlyArray<ReadonlyArray<Readonly<ToolButton>>>}
 */
export const TOOL_BUTTONS = buildToolButtons();

/** Margin between the Viewport panel edge and the overlay, CSS px. */
export const TOOLBAR_MARGIN = 8;

const BUTTON_SIZE = 32;
const SEPARATOR_HEIGHT = 5;
const ITEM_GAP = 2;
const EDGE = 4;
const COLUMN_GAP = 4;
const NOT_AVAILABLE_YET = 'not available yet';

function columnHeight(groups) {
  const buttons = groups.reduce((total, group) => total + group.length, 0);
  const items = buttons + groups.length - 1;
  return 2 * EDGE + buttons * BUTTON_SIZE + (groups.length - 1) * SEPARATOR_HEIGHT + (items - 1) * ITEM_GAP;
}

function columnGroups(columns) {
  if (columns === 1) return [TOOL_BUTTONS];
  const half = Math.ceil(TOOL_BUTTONS.length / 2);
  return [TOOL_BUTTONS.slice(0, half), TOOL_BUTTONS.slice(half)];
}

/**
 * Size of the overlay strip for a column count.
 * @param {1 | 2} columns Column count.
 * @returns {{ width: number, height: number }} CSS px.
 * @throws {RangeError} When `columns` is not 1 or 2.
 */
export function toolbarSize(columns) {
  if (columns !== 1 && columns !== 2) throw new RangeError(`Toolbar columns must be 1 or 2, got ${columns}`);
  return {
    width: 2 * EDGE + columns * BUTTON_SIZE + (columns - 1) * COLUMN_GAP,
    height: Math.max(...columnGroups(columns).map(columnHeight)),
  };
}

/**
 * Column count that fits a viewport host height: 2 when the one-column strip and its margins do not fit.
 * @param {number} hostHeight Viewport host height, CSS px.
 * @returns {1 | 2} `1` for a height that is not finite or is not positive (a host not laid out yet).
 */
export function toolbarColumns(hostHeight) {
  if (!Number.isFinite(hostHeight) || hostHeight <= 0) return 1;
  return hostHeight < toolbarSize(1).height + 2 * TOOLBAR_MARGIN ? 2 : 1;
}

function assertTool(id) {
  if (!TOOL_SPECS.some((spec) => spec.id === id)) throw new Error(`Unknown tool "${id}"`);
}

function createSeparator(doc, className = 'tools-separator') {
  const separator = doc.createElement('div');
  separator.className = className;
  separator.setAttribute('role', 'separator');
  separator.setAttribute('aria-orientation', 'horizontal');
  return separator;
}

function createButton(doc, entry) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'tools-button';
  button.dataset.tool = entry.id;
  button.setAttribute('aria-label', entry.label);
  button.setAttribute('aria-keyshortcuts', entry.shortcut);
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-disabled', 'true');
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${entry.icon}</svg>`;
  return button;
}

function createColumn(doc, groups, entries, states) {
  const column = doc.createElement('div');
  column.className = 'tools-column';
  column.setAttribute('role', 'none');
  groups.forEach((group, index) => {
    if (index > 0) column.append(createSeparator(doc));
    for (const entry of group) {
      const button = createButton(doc, entry);
      column.append(button);
      const state = { entry, button, enabled: false, reason: NOT_AVAILABLE_YET, tooltip: null };
      state.tooltip = attachTooltip(button, () => actionTitle(entry, state.enabled, state.reason));
      states.set(entry.id, state);
      entries.push(state);
    }
  });
  return column;
}

/**
 * Creates the Tools overlay and inserts it before `host` in the Viewport panel. Every button starts disabled
 * ("not available yet") and not pressed; the first one is the roving Tab stop. The overlay never activates tools
 * itself: it calls `onActivate` (also for a disabled button, so the caller reports its reason) and is refreshed through
 * `setActive` and `setEnabled`.
 * @param {HTMLElement} panel Viewport panel; the parent of `host`.
 * @param {{ host: HTMLElement, onActivate: (id: import('../tools/tool.js').ToolId) => void }} options `host` is the
 *   viewport host: its height decides the column count and it receives focus after a click.
 * @returns {Toolbar}
 * @throws {DOMException} When `host` is not a child of `panel`.
 */
export function createToolbar(panel, { host, onActivate }) {
  const doc = panel.ownerDocument;
  const overlay = doc.createElement('div');
  overlay.className = 'tools-overlay';
  overlay.setAttribute('role', 'toolbar');
  overlay.setAttribute('aria-label', 'Tools');
  overlay.setAttribute('aria-orientation', 'vertical');

  const states = new Map();
  const ordered = [];
  const [first, second] = columnGroups(2);
  overlay.append(
    createColumn(doc, first, ordered, states),
    createSeparator(doc, 'tools-separator tools-separator-between'),
    createColumn(doc, second, ordered, states),
  );
  const buttons = ordered.map((state) => state.button);
  let columns = 1;
  let pressed = null;

  function setStop(index) {
    buttons.forEach((button, i) => {
      button.tabIndex = i === index ? 0 : -1;
    });
  }

  function restingStop() {
    const index = pressed === null ? 0 : ordered.findIndex((state) => state.entry.id === pressed);
    return Math.max(0, index);
  }

  function applyColumns() {
    columns = toolbarColumns(host.clientHeight);
    overlay.classList.toggle('two-columns', columns === 2);
  }

  function focusAt(index) {
    setStop(index);
    buttons[index].focus();
  }

  function onKeydown(event) {
    const current = buttons.indexOf(event.target);
    if (current < 0) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      return;
    }
    const vertical = rovingIndex(current, event.key, buttons.length, 'vertical');
    const next = vertical >= 0 ? vertical : rovingIndex(current, event.key, buttons.length, 'horizontal');
    if (next < 0) return;
    event.preventDefault();
    focusAt(next);
  }

  function onClick(event) {
    const button = event.target.closest('button[data-tool]');
    if (!button) return;
    if (button.getAttribute('aria-disabled') === 'true') {
      onActivate(button.dataset.tool);
      return;
    }
    if (button.getAttribute('aria-pressed') !== 'true') onActivate(button.dataset.tool);
    if (event.detail > 0) host.focus({ preventScroll: true });
  }

  function onFocusin(event) {
    const index = buttons.indexOf(event.target);
    if (index >= 0) setStop(index);
  }

  function onFocusout(event) {
    if (!overlay.contains(event.relatedTarget)) setStop(restingStop());
  }

  function stop(event) {
    event.stopPropagation();
  }

  function onWheel(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  setStop(0);
  applyColumns();
  const observer = new ResizeObserver(applyColumns);
  observer.observe(host);
  overlay.addEventListener('keydown', onKeydown);
  overlay.addEventListener('click', onClick);
  overlay.addEventListener('focusin', onFocusin);
  overlay.addEventListener('focusout', onFocusout);
  overlay.addEventListener('wheel', onWheel, { passive: false });
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) overlay.addEventListener(type, stop);
  panel.insertBefore(overlay, host);

  return {
    setActive(id) {
      if (id !== null) assertTool(id);
      pressed = id;
      for (const state of ordered) state.button.setAttribute('aria-pressed', String(state.entry.id === id));
      if (!overlay.contains(doc.activeElement)) setStop(restingStop());
    },
    setEnabled(id, enabled, reason = NOT_AVAILABLE_YET) {
      assertTool(id);
      const state = states.get(id);
      state.enabled = enabled;
      state.reason = reason;
      state.button.setAttribute('aria-disabled', String(!enabled));
      state.tooltip.update();
    },
    width() {
      return toolbarSize(columns).width;
    },
    destroy() {
      observer.disconnect();
      for (const state of ordered) state.tooltip.detach();
      overlay.remove();
    },
  };
}
