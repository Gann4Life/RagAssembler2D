import { rovingIndex } from './roving-focus.js';

/**
 * @typedef {object} MenuItem
 * @property {string} id Value passed to `onSelect`.
 * @property {string} label Visible text.
 * @property {'item' | 'checkbox' | 'separator'} kind
 * @property {boolean} [checked] State of a checkbox item.
 * @property {boolean} [disabled] Disabled items stay focusable but cannot be chosen.
 */

/**
 * @typedef {object} MenuOptions
 * @property {(item: MenuItem) => void} [onSelect] Called after the menu closed, with the chosen item.
 * @property {(key: 'ArrowLeft' | 'ArrowRight') => void} [onNavigate] Called after Left/Right closed the menu; focus is on the button.
 * @property {'first' | 'last'} [focus] Item focused on open; `'first'` by default.
 */

let menuCount = 0;

/**
 * Opens a popup menu below a button, aligned to its right edge, and moves focus into it. The menu is labelled
 * with the button's `aria-label`, or its text content when it has none. Sets `aria-expanded` and `aria-controls` on the button while open. Closes on choice, Esc, Tab,
 * Left/Right and outside pointer presses.
 * @param {HTMLElement} button The menu button.
 * @param {ReadonlyArray<MenuItem>} items
 * @param {MenuOptions} [options]
 * @returns {{ close: () => void }} Closing is idempotent and does not move focus.
 */
export function openMenu(button, items, { onSelect, onNavigate, focus = 'first' } = {}) {
  const doc = button.ownerDocument;
  const menu = doc.createElement('div');
  menu.className = 'menu';
  menu.id = `menu-${++menuCount}`;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', button.getAttribute('aria-label') || button.textContent);

  const entries = [];
  for (const item of items) {
    if (item.kind === 'separator') {
      const separator = doc.createElement('div');
      separator.className = 'menu-separator';
      separator.setAttribute('role', 'separator');
      menu.append(separator);
      continue;
    }
    const element = createItem(doc, item);
    entries.push({ item, element });
    menu.append(element);
  }

  const anchor = button.getBoundingClientRect();
  menu.style.top = `${Math.round(anchor.bottom + 2)}px`;
  menu.style.right = `${Math.round(doc.documentElement.clientWidth - anchor.right)}px`;
  doc.body.append(menu);
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-controls', menu.id);

  let open = true;
  const elements = entries.map((entry) => entry.element);

  const close = () => {
    if (!open) return;
    open = false;
    doc.removeEventListener('pointerdown', onOutsidePointer, true);
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-controls');
  };

  const choose = (entry) => {
    if (entry.item.disabled) return;
    close();
    button.focus();
    onSelect?.(entry.item);
  };

  const onOutsidePointer = (event) => {
    if (menu.contains(event.target) || button.contains(event.target)) return;
    close();
  };

  menu.addEventListener('keydown', (event) => {
    const current = elements.indexOf(event.target);
    if (current < 0) return;
    const next = rovingIndex(current, event.key, elements.length, 'vertical');
    if (next >= 0) {
      event.preventDefault();
      elements[next].focus();
      return;
    }
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(entries[current]);
        return;
      case 'Escape':
        event.preventDefault();
        close();
        button.focus();
        return;
      case 'Tab':
        close();
        button.focus();
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
        event.preventDefault();
        close();
        button.focus();
        onNavigate?.(event.key);
    }
  });

  menu.addEventListener('click', (event) => {
    const entry = entries.find((candidate) => candidate.element.contains(event.target));
    if (entry) choose(entry);
  });

  menu.addEventListener('pointermove', (event) => {
    const element = elements.find((candidate) => candidate.contains(event.target));
    if (element && doc.activeElement !== element) element.focus();
  });

  doc.addEventListener('pointerdown', onOutsidePointer, true);
  elements[focus === 'last' ? elements.length - 1 : 0]?.focus();

  return { close };
}

function createItem(doc, item) {
  const element = doc.createElement('div');
  element.className = 'menu-item';
  element.tabIndex = -1;
  element.dataset.id = item.id;
  element.setAttribute('role', item.kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitem');
  if (item.kind === 'checkbox') element.setAttribute('aria-checked', String(Boolean(item.checked)));
  if (item.disabled) element.setAttribute('aria-disabled', 'true');
  const check = doc.createElement('span');
  check.className = 'menu-check';
  check.setAttribute('aria-hidden', 'true');
  check.textContent = item.kind === 'checkbox' && item.checked ? '✓' : '';
  const label = doc.createElement('span');
  label.textContent = item.label;
  element.append(check, label);
  return element;
}
