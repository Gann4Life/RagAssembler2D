/**
 * Default key binding. `keys` is `[Ctrl+][Shift+][Alt+]<key>`, where `<key>` is an upper-case letter,
 * a digit, `.`, `Space`, `Del`, `Esc` or `Home`.
 * @typedef {object} Hotkey
 * @property {string} keys Key combination, e.g. `Ctrl+Shift+Z`.
 * @property {import('./actions.js').ActionId} action Action run by the combination.
 */

/**
 * Default bindings of `DESIGN.md` §5.9 in table order. Tool rows are added with the tools.
 * @type {ReadonlyArray<Readonly<Hotkey>>}
 */
export const HOTKEYS = Object.freeze(
  [
    { keys: 'S', action: 'sprite-edit' },
    { keys: 'Del', action: 'delete' },
    { keys: 'Ctrl+Z', action: 'undo' },
    { keys: 'Ctrl+Shift+Z', action: 'redo' },
    { keys: 'Ctrl+Y', action: 'redo' },
    { keys: 'Ctrl+S', action: 'save' },
    { keys: 'Ctrl+O', action: 'load' },
    { keys: 'Ctrl+G', action: 'group' },
    { keys: 'Ctrl+Shift+G', action: 'ungroup' },
    { keys: 'Ctrl+D', action: 'duplicate' },
    { keys: 'Space', action: 'toggle-play' },
    { keys: '.', action: 'next-frame' },
    { keys: 'K', action: 'key-selected' },
    { keys: 'F', action: 'frame-selection' },
    { keys: 'Home', action: 'frame-all' },
    { keys: 'Esc', action: 'escape' },
  ].map((row) => Object.freeze(row)),
);

const KEY_NAMES = Object.freeze({ Del: 'Delete', Esc: 'Escape', Space: ' ' });
const SPACE = ' ';
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'image']);

function parseKeys(keys) {
  const parts = keys.split('+');
  const key = parts.pop() || '+';
  return {
    ctrl: parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key: KEY_NAMES[key] ?? key,
  };
}

const BINDINGS = HOTKEYS.map((row) => ({ ...parseKeys(row.keys), action: row.action }));

function eventKey(event) {
  const key = String(event.key ?? '');
  return key.length === 1 ? key.toUpperCase() : key;
}

function isTextField(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !NON_TEXT_INPUTS.has(String(target.type ?? 'text').toLowerCase());
}

function isPageBody(target) {
  return String(target?.tagName ?? '').toUpperCase() === 'BODY';
}

/**
 * Finds the action bound to a keyboard event. `Meta` counts as `Ctrl`, letters match case-insensitively,
 * and Ctrl, Shift and Alt must match exactly.
 * @param {{ key: string, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean, altKey?: boolean }} event Keyboard event.
 * @returns {import('./actions.js').ActionId|null} Bound action, or `null`.
 */
export function matchHotkey(event) {
  const key = eventKey(event);
  const ctrl = Boolean(event.ctrlKey || event.metaKey);
  const shift = Boolean(event.shiftKey);
  const alt = Boolean(event.altKey);
  const binding = BINDINGS.find(
    (row) => row.key === key && row.ctrl === ctrl && row.shift === shift && row.alt === alt,
  );
  return binding?.action ?? null;
}

/**
 * Routes a `keydown` event: ignored when already handled or typed into a text field; offered to the tools
 * while the viewport has focus; otherwise matched against {@link HOTKEYS}. A match calls `preventDefault`
 * and runs the action, except on key repeat for actions that are not repeatable. Space matches only when the
 * viewport has focus or the target is the page body. Reads only the event and its target.
 * @param {KeyboardEvent} event Keyboard event.
 * @param {{ actions: import('./actions.js').ActionRegistry, tools: { key(event: KeyboardEvent): boolean }|null,
 *   viewportFocused: boolean }} context Action registry, tool registry (or `null`) and viewport focus.
 * @returns {boolean} Whether the key was consumed by a tool or a hotkey.
 */
export function dispatchKey(event, { actions, tools = null, viewportFocused = false }) {
  if (event.defaultPrevented || isTextField(event.target)) return false;
  if (viewportFocused && tools && tools.key(event)) return true;
  const action = matchHotkey(event);
  if (action === null) return false;
  if (event.key === SPACE && !viewportFocused && !isPageBody(event.target)) return false;
  event.preventDefault();
  if (!event.repeat || actions.isRepeatable(action)) actions.run(action);
  return true;
}
