import { rovingIndex } from './roving-focus.js';

/**
 * @typedef {object} HeaderAction
 * @property {string} id Action identifier, used as `data-action`.
 * @property {string} label Visible button text.
 * @property {string} [shortcut] Human-readable shortcut hint (`DESIGN.md` §5.9).
 * @property {string} [ariaKeyShortcuts] Value for `aria-keyshortcuts`.
 * @property {boolean} [menu] Whether the button opens a menu.
 */

/**
 * Header buttons in display order, split into groups separated visually.
 * @type {ReadonlyArray<ReadonlyArray<Readonly<HeaderAction>>>}
 */
export const HEADER_GROUPS = Object.freeze([
  Object.freeze([
    Object.freeze({ id: 'new', label: 'New' }),
    Object.freeze({ id: 'load', label: 'Load', shortcut: 'Ctrl+O', ariaKeyShortcuts: 'Control+O' }),
    Object.freeze({ id: 'save', label: 'Save', shortcut: 'Ctrl+S', ariaKeyShortcuts: 'Control+S' }),
  ]),
  Object.freeze([
    Object.freeze({ id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', ariaKeyShortcuts: 'Control+Z' }),
    Object.freeze({
      id: 'redo',
      label: 'Redo',
      shortcut: 'Ctrl+Shift+Z / Ctrl+Y',
      ariaKeyShortcuts: 'Control+Shift+Z Control+Y',
    }),
  ]),
  Object.freeze([
    Object.freeze({ id: 'play', label: 'Play', shortcut: 'Space', ariaKeyShortcuts: 'Space' }),
    Object.freeze({ id: 'pause', label: 'Pause', shortcut: 'Space', ariaKeyShortcuts: 'Space' }),
    Object.freeze({ id: 'next-frame', label: 'Next frame', shortcut: '.', ariaKeyShortcuts: '.' }),
    Object.freeze({ id: 'stop', label: 'Stop' }),
  ]),
  Object.freeze([
    Object.freeze({ id: 'window', label: 'Window', menu: true }),
    Object.freeze({ id: 'settings', label: 'Settings' }),
  ]),
]);

const UNAVAILABLE_SUFFIX = ' (not available yet)';

/**
 * Builds the tooltip text of a header action.
 * @param {Readonly<HeaderAction>} action
 * @param {boolean} enabled
 * @returns {string}
 */
export function actionTitle(action, enabled) {
  const base = action.shortcut ? `${action.label} (${action.shortcut})` : action.label;
  return enabled ? base : base + UNAVAILABLE_SUFFIX;
}

/**
 * Enables or disables a header button through `aria-disabled`, keeping it focusable.
 * @param {HTMLButtonElement} button A button created by {@link createHeader}.
 * @param {boolean} enabled
 * @returns {void}
 */
export function setActionEnabled(button, enabled) {
  const action = findAction(button.dataset.action);
  button.setAttribute('aria-disabled', String(!enabled));
  if (action) button.title = actionTitle(action, enabled);
}

/**
 * Creates the editor header toolbar with every action disabled.
 * Enabled buttons dispatch a bubbling `header-action` CustomEvent with `detail.action` on click.
 * @param {Document} doc Document used to create the elements.
 * @returns {HTMLElement} The `<header id="header">` element.
 */
export function createHeader(doc) {
  const header = doc.createElement('header');
  header.id = 'header';
  header.setAttribute('role', 'toolbar');
  header.setAttribute('aria-label', 'Editor');

  HEADER_GROUPS.forEach((group, groupIndex) => {
    if (groupIndex > 0) header.append(createSeparator(doc, groupIndex === HEADER_GROUPS.length - 1));
    for (const action of group) header.append(createButton(doc, action));
  });

  const buttons = [...header.querySelectorAll('button')];
  buttons.forEach((button, index) => {
    button.tabIndex = index === 0 ? 0 : -1;
  });

  header.addEventListener('keydown', (event) => {
    const current = buttons.indexOf(event.target);
    if (current < 0) return;
    const next = rovingIndex(current, event.key, buttons.length);
    if (next < 0) return;
    event.preventDefault();
    focusButton(buttons, next);
  });

  header.addEventListener('focusin', (event) => {
    const index = buttons.indexOf(event.target);
    if (index >= 0) setRovingStop(buttons, index);
  });

  header.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.getAttribute('aria-disabled') === 'true') return;
    header.dispatchEvent(
      new CustomEvent('header-action', { bubbles: true, detail: { action: button.dataset.action } }),
    );
  });

  return header;
}

/**
 * Moves focus from a header button to the previous or next one, wrapping around, and makes it the roving Tab stop.
 * Used when Left/Right close a menu opened from the header.
 * @param {HTMLElement} header The toolbar created by {@link createHeader}.
 * @param {HTMLButtonElement} button The button to move from.
 * @param {'ArrowLeft' | 'ArrowRight'} key Direction of the move.
 * @returns {void}
 */
export function focusAdjacentAction(header, button, key) {
  const buttons = [...header.querySelectorAll('button')];
  const current = buttons.indexOf(button);
  if (current < 0 || (key !== 'ArrowLeft' && key !== 'ArrowRight')) return;
  focusButton(buttons, rovingIndex(current, key, buttons.length));
}

function findAction(id) {
  return HEADER_GROUPS.flat().find((action) => action.id === id);
}

function createButton(doc, action) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'header-button';
  button.textContent = action.label;
  button.dataset.action = action.id;
  if (action.ariaKeyShortcuts) button.setAttribute('aria-keyshortcuts', action.ariaKeyShortcuts);
  if (action.menu) {
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
  }
  button.setAttribute('aria-disabled', 'true');
  button.title = actionTitle(action, false);
  return button;
}

function createSeparator(doc, pushesRight) {
  const separator = doc.createElement('div');
  separator.className = pushesRight ? 'header-separator header-separator-end' : 'header-separator';
  separator.setAttribute('role', 'separator');
  separator.setAttribute('aria-orientation', 'vertical');
  return separator;
}

function setRovingStop(buttons, index) {
  buttons.forEach((button, i) => {
    button.tabIndex = i === index ? 0 : -1;
  });
}

function focusButton(buttons, index) {
  setRovingStop(buttons, index);
  buttons[index].focus();
}
