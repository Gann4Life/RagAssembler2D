import { TOOL_SPECS } from './tools/tool.js';

/**
 * Default key binding. `keys` is `[Ctrl+][Shift+][Alt+]<key>`, where `<key>` is an upper-case letter,
 * a digit, `.`, `Space`, `Del`, `Esc`, `Home` or `F2`.
 * @typedef {object} Hotkey
 * @property {string} keys Key combination, e.g. `Ctrl+Shift+Z`.
 * @property {import('./actions.js').ActionId} action Action run by the combination.
 * @property {string} label Label of the action's visible control, used when the action refuses to run.
 */

/**
 * Default bindings of `DESIGN.md` §5.9 in table order: first one `tool:<id>` row per `TOOL_SPECS` entry, for
 * every tool whether registered or not, then the other actions.
 * @type {ReadonlyArray<Readonly<Hotkey>>}
 */
export const HOTKEYS = Object.freeze(
  [
    ...TOOL_SPECS.map((tool) => ({ keys: tool.hotkey, action: `tool:${tool.id}`, label: tool.label })),
    { keys: 'S', action: 'sprite-edit', label: 'Sprite edit' },
    { keys: 'Del', action: 'delete', label: 'Delete' },
    { keys: 'Ctrl+Z', action: 'undo', label: 'Undo' },
    { keys: 'Ctrl+Shift+Z', action: 'redo', label: 'Redo' },
    { keys: 'Ctrl+Y', action: 'redo', label: 'Redo' },
    { keys: 'Ctrl+S', action: 'save', label: 'Save' },
    { keys: 'Ctrl+O', action: 'load', label: 'Load' },
    { keys: 'Ctrl+G', action: 'group', label: 'Group' },
    { keys: 'Ctrl+Shift+G', action: 'ungroup', label: 'Ungroup' },
    { keys: 'Alt+G', action: 'split', label: 'Split' },
    { keys: 'Ctrl+D', action: 'duplicate', label: 'Duplicate' },
    { keys: 'F2', action: 'rename', label: 'Rename' },
    { keys: 'Shift+R', action: 'set-root-body', label: 'Set as root body' },
    { keys: 'Space', action: 'toggle-play', label: 'Play' },
    { keys: '.', action: 'next-frame', label: 'Next frame' },
    { keys: 'K', action: 'key-selected', label: 'Key selected' },
    { keys: 'F', action: 'frame-selection', label: 'Frame selection' },
    { keys: 'Home', action: 'frame-all', label: 'Frame all' },
    { keys: 'Z', action: 'pivot-mode', label: 'Pivot' },
    { keys: 'Esc', action: 'escape', label: 'Esc' },
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

const BINDINGS = HOTKEYS.map((row) => ({ ...parseKeys(row.keys), action: row.action, label: row.label }));

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

const LETTER = /^[A-Z]$/;

function keyMatches(row, key, code) {
  if (row.key === key) return true;
  return row.alt && LETTER.test(row.key) && !LETTER.test(key) && code === `Key${row.key}`;
}

/**
 * Finds the action bound to a keyboard event. `Meta` counts as `Ctrl`, letters match case-insensitively,
 * and Ctrl, Shift and Alt must match exactly. A row with Alt and a letter also matches `code` `Key<letter>` when
 * `key` is not an ASCII letter (Option on macOS changes the character).
 * @param {{ key: string, code?: string, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean, altKey?: boolean }} event
 *   Keyboard event.
 * @returns {import('./actions.js').ActionId|null} Bound action, or `null`.
 */
export function matchHotkey(event) {
  return bindingOf(event)?.action ?? null;
}

function bindingOf(event) {
  const key = eventKey(event);
  const code = String(event.code ?? '');
  const ctrl = Boolean(event.ctrlKey || event.metaKey);
  const shift = Boolean(event.shiftKey);
  const alt = Boolean(event.altKey);
  return BINDINGS.find((row) => keyMatches(row, key, code) && row.ctrl === ctrl && row.shift === shift && row.alt === alt) ?? null;
}

/**
 * Routes a `keydown` event: ignored when already handled or typed into a text field; offered to the active
 * tool while the viewport has focus (the registry never offers Escape, so it reaches the `escape` action);
 * otherwise matched against {@link HOTKEYS}. A match calls `preventDefault` and runs the action with the row's label,
 * so a refused action reports its reason, except on key repeat for actions that are not repeatable. Space matches only
 * when the viewport has focus or the target is the page body. Reads only the event and its target.
 * @param {KeyboardEvent} event Keyboard event.
 * @param {{ actions: import('./actions.js').ActionRegistry,
 *   tools: Pick<import('./tools/registry.js').ToolRegistry, 'key'>|null, viewportFocused: boolean }} context
 *   Action registry, tool registry (or `null`) and viewport focus.
 * @returns {boolean} Whether the key was consumed by a tool or a hotkey.
 */
export function dispatchKey(event, { actions, tools = null, viewportFocused = false }) {
  if (event.defaultPrevented || isTextField(event.target)) return false;
  if (viewportFocused && tools && tools.key(event)) return true;
  const binding = bindingOf(event);
  if (binding === null) return false;
  if (event.key === SPACE && !viewportFocused && !isPageBody(event.target)) return false;
  event.preventDefault();
  if (!event.repeat || actions.isRepeatable(binding.action)) actions.run(binding.action, { label: binding.label });
  return true;
}
