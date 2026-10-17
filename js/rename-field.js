import { renamePopupPosition } from './rename.js';

const STOPPED_EVENTS = Object.freeze(['pointerdown', 'mousedown', 'click', 'dblclick', 'keyup']);

function isFocusable(element, doc) {
  return element !== null && element !== doc.body && element.isConnected && typeof element.focus === 'function';
}

/**
 * Creates the text field of a rename: aria-labelled "Name", holding the open session's name.
 * @param {Document} doc Owner document.
 * @returns {HTMLInputElement} Unattached input.
 */
export function createRenameInput(doc) {
  const input = doc.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Name');
  return input;
}

/**
 * Wires a rename field to the open session of `rename`: fills it with the session's name, all selected, and focuses
 * it. Enter or blur commits, Esc cancels; key and pointer events stop at the field. Enter and Esc, and a cancel from
 * the core while the field has focus, return focus to `returnFocus`. When the session closes, for any reason, the
 * field is detached and `onClose` is called once.
 * @param {HTMLInputElement} input Field already in the document.
 * @param {import('./rename.js').Rename} rename Rename session with an open field.
 * @param {{ returnFocus: Element|null, onClose: () => void }} options Element focused before F2, and the cleanup.
 * @returns {() => void} Cancels the session when it is still open.
 */
export function attachRenameField(input, rename, { returnFocus, onClose }) {
  const doc = input.ownerDocument;
  let open = true;
  let restore = false;
  input.value = rename.session?.name ?? '';

  const stop = (event) => event.stopPropagation();
  const onKeyDown = (event) => {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      restore = true;
      rename.commit(input.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      restore = true;
      rename.cancel();
    }
  };
  const onBlur = () => {
    if (open) rename.commit(input.value);
  };
  const close = () => {
    if (!open) return;
    open = false;
    const focused = doc.activeElement === input;
    offRename();
    input.removeEventListener('keydown', onKeyDown);
    input.removeEventListener('blur', onBlur);
    for (const type of STOPPED_EVENTS) input.removeEventListener(type, stop);
    onClose();
    if ((restore || focused) && isFocusable(returnFocus, doc)) returnFocus.focus({ preventScroll: true });
  };
  const offRename = rename.on('rename', ({ session }) => {
    if (session === null) close();
  });

  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur', onBlur);
  for (const type of STOPPED_EVENTS) input.addEventListener(type, stop);
  input.focus({ preventScroll: true });
  input.select();
  if (rename.session === null) close();
  return () => {
    if (open) rename.cancel();
  };
}

/**
 * Opens the rename popup of the viewport: a floating panel with the muted label "Name" and a 200 px field, its
 * top-left corner 8 px right of and below `anchor`, kept inside `viewport`. Fixed on screen once open.
 * @param {HTMLElement} container Element that receives the popup (the viewport panel).
 * @param {{ anchor: { x: number, y: number }, viewport: DOMRect }} placement Anchor, CSS px from the viewport's
 *   top-left, and the viewport's client rectangle.
 * @returns {{ element: HTMLElement, input: HTMLInputElement }} The popup and its field.
 */
export function openRenamePopup(container, { anchor, viewport }) {
  const doc = container.ownerDocument;
  const element = doc.createElement('div');
  element.className = 'rename-popup';
  const label = doc.createElement('label');
  label.className = 'rename-popup-label';
  const text = doc.createElement('span');
  text.textContent = 'Name';
  const input = createRenameInput(doc);
  input.removeAttribute('aria-label');
  label.append(text, input);
  element.append(label);
  element.style.visibility = 'hidden';
  container.append(element);
  const box = element.getBoundingClientRect();
  const corner = renamePopupPosition(anchor, { width: box.width, height: box.height }, viewport);
  element.style.left = `${Math.floor(viewport.left + corner.x)}px`;
  element.style.top = `${Math.floor(viewport.top + corner.y)}px`;
  element.style.visibility = '';
  return { element, input };
}
