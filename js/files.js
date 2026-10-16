/** File picker filter for `.rag.json` files. */
export const RAG_FILE_ACCEPT = '.rag.json,.json';

const REVOKE_DELAY_MS = 1000;

function carriesFiles(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Shows the browser file picker for one file. The input is attached hidden to the body while the picker is open and removed when it settles. Call it directly from a click or key handler: the picker needs the
 * user activation.
 * @param {Document} doc The document that creates the input.
 * @param {string} accept Value of the input's `accept` attribute.
 * @returns {Promise<string|null>} The chosen file's text, `null` when the user cancels or chooses nothing; rejects
 *   when the file cannot be read.
 */
export function pickTextFile(doc, accept) {
  return new Promise((resolve, reject) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    const dispose = () => input.remove();
    input.addEventListener('change', () => {
      dispose();
      const file = input.files?.[0];
      if (file === undefined) {
        resolve(null);
        return;
      }
      file.text().then(resolve, reject);
    });
    input.addEventListener('cancel', () => {
      dispose();
      resolve(null);
    });
    doc.body.append(input);
    input.click();
  });
}

/**
 * Starts the download of a text file through a temporary link and an object URL revoked after one second.
 * @param {Document} doc The document that creates the link.
 * @param {string} fileName Name offered to the browser.
 * @param {string} text File content.
 * @returns {void}
 */
export function downloadText(doc, fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Saves a `.rag.json` text. Where the window has `showSaveFilePicker` it asks the user for the file, suggesting
 * `fileName`, and writes it; otherwise it downloads the file under `fileName` with {@link downloadText}. Call it
 * directly from a click or key handler: the picker needs the user activation.
 * @param {Document} doc The document whose window may offer the save picker.
 * @param {string} fileName Suggested name.
 * @param {string} text File content.
 * @returns {Promise<boolean>} `true` when saved or downloaded, `false` when the user cancelled the picker; rejects
 *   when the file cannot be written.
 */
export async function saveTextFile(doc, fileName, text) {
  const view = doc.defaultView;
  if (typeof view?.showSaveFilePicker !== 'function') {
    downloadText(doc, fileName, text);
    return true;
  }
  let handle;
  try {
    handle = await view.showSaveFilePicker({
      suggestedName: fileName,
      types: [{ description: 'Ragdoll', accept: { 'application/json': ['.rag.json'] } }],
    });
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    throw error;
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
  } catch (error) {
    await writable.abort?.().catch(() => {});
    throw error;
  }
  await writable.close();
  return true;
}

/**
 * Makes `element` accept file drops: a drop carrying files calls `onRead` with a reader of the first file only.
 * Never stops propagation. While `enabled()` is false, file drags show the `none` cursor and drops are swallowed.
 * @param {EventTarget} element Drop target.
 * @param {(read: () => Promise<string>) => *} onRead Receives the reader of the dropped file's text.
 * @param {() => boolean} [enabled] Whether loading is allowed now; always when omitted.
 * @returns {() => void} Detaches the listeners.
 */
export function attachFileDrop(element, onRead, enabled = () => true) {
  const onDragOver = (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = enabled() ? 'copy' : 'none';
  };
  const onDrop = (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file !== undefined && enabled()) onRead(() => file.text());
  };
  element.addEventListener('dragover', onDragOver);
  element.addEventListener('drop', onDrop);
  return () => {
    element.removeEventListener('dragover', onDragOver);
    element.removeEventListener('drop', onDrop);
  };
}

/**
 * Refuses file drops that nothing handled, so the browser never opens a dropped file and loses the work. Reads
 * nothing.
 * @param {Document} doc The document to guard.
 * @returns {() => void} Detaches the listeners.
 */
export function blockFileNavigation(doc) {
  const refuse = (event) => {
    if (!carriesFiles(event) || event.defaultPrevented) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'none';
  };
  doc.addEventListener('dragover', refuse);
  doc.addEventListener('drop', refuse);
  return () => {
    doc.removeEventListener('dragover', refuse);
    doc.removeEventListener('drop', refuse);
  };
}
