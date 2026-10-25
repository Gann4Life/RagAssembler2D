/**
 * Time a status message stays visible after it is shown, milliseconds (`DESIGN.md` §5).
 * @type {number}
 */
export const STATUS_DURATION = 4000;

/**
 * @typedef {object} StatusLine
 * @property {(text: string) => void} show Replaces the current message and restarts the 4 s timer; an empty text hides it.
 * @property {() => void} destroy Removes the element and its timer.
 */

/**
 * Creates the status line at the bottom center of the Viewport panel: one `div.status-line[role=status]`, a polite
 * live region that never takes focus or pointer input, hidden 4 s after its last message.
 * @param {HTMLElement} panel The Viewport panel element.
 * @param {{ setTimeout: (fn: () => void, ms: number) => number, clearTimeout: (handle: number) => void }} [timers]
 *   Timer functions; the panel's window by default.
 * @returns {StatusLine}
 */
export function createStatusLine(panel, timers = panel.ownerDocument.defaultView) {
  const element = panel.ownerDocument.createElement('div');
  element.className = 'status-line';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.hidden = true;
  panel.append(element);
  let handle = null;

  const hide = () => {
    handle = null;
    element.hidden = true;
    element.textContent = '';
  };

  return Object.freeze({
    show(text) {
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
      if (typeof text !== 'string' || text === '') {
        hide();
        return;
      }
      element.textContent = text;
      element.title = text;
      element.hidden = false;
      handle = timers.setTimeout(hide, STATUS_DURATION);
    },
    destroy() {
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
      element.remove();
    },
  });
}
