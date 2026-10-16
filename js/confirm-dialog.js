/**
 * Content of a confirmation dialog.
 * @typedef {object} ConfirmOptions
 * @property {string} title Dialog heading.
 * @property {string} message Plain-text message.
 * @property {ReadonlyArray<string>} [items] Plain-text list under the message; omitted from the dialog when empty.
 * @property {string} confirmLabel Label of the confirm button.
 * @property {string} cancelLabel Label of the cancel button.
 */

/**
 * Key event fields read by {@link confirmKey}.
 * @typedef {object} ConfirmKeyEvent
 * @property {string} key
 * @property {boolean} [shiftKey]
 * @property {boolean} [altKey]
 * @property {boolean} [ctrlKey]
 * @property {boolean} [metaKey]
 * @property {boolean} [isComposing]
 */

let dialogOpen = false;

/**
 * Maps a key press inside the confirmation dialog to what it does. Enter on a focused Cancel cancels. Nothing
 * happens while composing text or with Alt, Ctrl or Meta held.
 * @param {ConfirmKeyEvent} event The key event.
 * @param {'confirm'|'cancel'|'other'} focused Which dialog element holds focus.
 * @returns {'confirm'|'cancel'|'trap'|null} The outcome, or `null` when the key is not handled.
 */
export function confirmKey(event, focused) {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === 'Escape') return 'cancel';
  if (event.key === 'Enter') return focused === 'cancel' ? 'cancel' : 'confirm';
  if (event.key === 'Tab') return 'trap';
  return null;
}

/**
 * Opens the shared modal confirmation dialog: a native `<dialog role="alertdialog">` with a title, a message, an
 * optional list of items, and Cancel and confirm buttons. Focus starts on the confirm button, Tab stays inside, Enter
 * confirms, Esc, Cancel or a click on the backdrop cancel, and focus returns to the previously focused element.
 * Only one dialog is open at a time: a call while one is open resolves `false` at once. Never rejects.
 * @param {Document} doc The document that hosts the dialog.
 * @param {ConfirmOptions} options Dialog content.
 * @returns {Promise<boolean>} `true` when confirmed, `false` when cancelled.
 */
export function confirmDialog(doc, { title, message, items = [], confirmLabel, cancelLabel }) {
  if (dialogOpen) return Promise.resolve(false);
  dialogOpen = true;
  const previous = doc.activeElement;

  const element = (tag, props = {}, children = []) => {
    const node = doc.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  };

  const dialog = element('dialog', { className: 'confirm-dialog' });
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  const heading = element('h2', { className: 'confirm-title', textContent: title, id: 'confirm-dialog-title' });
  const text = element('p', { className: 'confirm-message', textContent: message, id: 'confirm-dialog-message' });
  dialog.setAttribute('aria-labelledby', heading.id);
  dialog.setAttribute('aria-describedby', text.id);
  const list =
    items.length > 0
      ? element(
          'ul',
          { className: 'confirm-items' },
          items.map((item) => element('li', { textContent: item })),
        )
      : null;
  const cancelButton = element('button', { type: 'button', className: 'confirm-button', textContent: cancelLabel });
  const confirmButton = element('button', {
    type: 'button',
    className: 'confirm-button confirm-primary',
    textContent: confirmLabel,
  });
  const actions = element('div', { className: 'confirm-actions' }, [cancelButton, confirmButton]);
  dialog.append(element('div', { className: 'confirm-content' }, [heading, text, ...(list ? [list] : []), actions]));

  return new Promise((resolve) => {
    let settled = false;
    const close = (result) => {
      if (settled) return;
      settled = true;
      dialog.remove();
      dialogOpen = false;
      if (previous?.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
      resolve(result);
    };
    const focusedPart = () => {
      if (doc.activeElement === confirmButton) return 'confirm';
      if (doc.activeElement === cancelButton) return 'cancel';
      return 'other';
    };

    dialog.addEventListener('keydown', (event) => {
      event.stopPropagation();
      const outcome = confirmKey(event, focusedPart());
      if (outcome === null) return;
      event.preventDefault();
      if (outcome === 'confirm') close(true);
      else if (outcome === 'cancel') close(false);
      else (focusedPart() === 'confirm' ? cancelButton : confirmButton).focus();
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(false);
    });
    dialog.addEventListener('pointerdown', (event) => {
      if (event.target === dialog) close(false);
    });
    cancelButton.addEventListener('click', () => close(false));
    confirmButton.addEventListener('click', () => close(true));

    doc.body.append(dialog);
    dialog.showModal();
    confirmButton.focus();
  });
}
