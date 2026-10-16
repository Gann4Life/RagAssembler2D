/** File picker filter for `.rag.json` files. */
export const RAG_FILE_ACCEPT = '.rag.json,.json';

function carriesFiles(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Shows the browser file picker for one file. Call it directly from a click or key handler: the picker needs the
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
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file === undefined) {
        resolve(null);
        return;
      }
      file.text().then(resolve, reject);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * Starts the download of a text file through a temporary link and an object URL revoked on the next task.
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
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Makes `element` accept file drops: a drop carrying files calls `onRead` with a reader of the first file only.
 * Never stops propagation.
 * @param {EventTarget} element Drop target.
 * @param {(read: () => Promise<string>) => *} onRead Receives the reader of the dropped file's text.
 * @returns {() => void} Detaches the listeners.
 */
export function attachFileDrop(element, onRead) {
  const onDragOver = (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file !== undefined) onRead(() => file.text());
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
