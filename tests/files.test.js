import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RAG_FILE_ACCEPT, attachFileDrop, blockFileNavigation, downloadText, pickTextFile, saveTextFile } from '../js/files.js';

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, fn) {
    this.listeners.set(type, fn);
  }

  removeEventListener(type, fn) {
    if (this.listeners.get(type) === fn) this.listeners.delete(type);
  }

  fire(type, event = {}) {
    const full = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...event,
    };
    this.listeners.get(type)?.(full);
    return full;
  }
}

const fileOf = (text) => ({ text: () => Promise.resolve(text) });
const dragOf = (types, files = []) => ({ dataTransfer: { types, files, dropEffect: 'none' } });

test('RAG_FILE_ACCEPT filters to .rag.json and .json', () => {
  assert.equal(RAG_FILE_ACCEPT, '.rag.json,.json');
});

function fakeInputDocument() {
  const created = [];
  created.appended = [];
  const doc = {
    body: { append: (node) => created.appended.push(node) },
    createElement(tag) {
      const node = new FakeTarget();
      node.tag = tag;
      node.clicks = 0;
      node.click = () => {
        node.clicks += 1;
      };
      node.remove = () => {
        node.removed = true;
      };
      created.push(node);
      return node;
    },
  };
  return { doc, created };
}

test('pickTextFile clicks a file input synchronously and resolves the first file text', async () => {
  const { doc, created } = fakeInputDocument();
  const promise = pickTextFile(doc, RAG_FILE_ACCEPT);
  const [input] = created;
  assert.equal(input.tag, 'input');
  assert.equal(input.type, 'file');
  assert.equal(input.accept, '.rag.json,.json');
  assert.equal(input.multiple, undefined);
  assert.equal(input.clicks, 1);
  assert.equal(input.hidden, true);
  assert.deepEqual(created.appended, [input]);
  assert.equal(input.removed, undefined);
  input.files = [fileOf('first'), fileOf('second')];
  input.fire('change');
  assert.equal(await promise, 'first');
  assert.equal(input.removed, true);
});

test('pickTextFile resolves null on cancel or an empty selection and rejects when reading fails', async () => {
  const cancelled = fakeInputDocument();
  const first = pickTextFile(cancelled.doc, 'x');
  cancelled.created[0].fire('cancel');
  assert.equal(await first, null);
  assert.equal(cancelled.created[0].removed, true);

  const empty = fakeInputDocument();
  const second = pickTextFile(empty.doc, 'x');
  empty.created[0].files = [];
  empty.created[0].fire('change');
  assert.equal(await second, null);

  const failing = fakeInputDocument();
  const third = pickTextFile(failing.doc, 'x');
  failing.created[0].files = [{ text: () => Promise.reject(new Error('unreadable')) }];
  failing.created[0].fire('change');
  await assert.rejects(third, /unreadable/);
});

test('downloadText downloads a JSON blob through a temporary link and revokes the object URL', async () => {
  const link = { clicks: 0, removed: false, click() { this.clicks += 1; }, remove() { this.removed = true; } };
  const appended = [];
  const doc = { createElement: () => link, body: { append: (node) => appended.push(node) } };
  const urls = { created: [], revoked: [] };
  mock.timers.enable({ apis: ['setTimeout'] });
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = (blob) => {
    urls.created.push(blob);
    return 'blob:fake';
  };
  URL.revokeObjectURL = (url) => urls.revoked.push(url);
  try {
    downloadText(doc, 'a.rag.json', '{"x":1}\n');
    assert.equal(link.href, 'blob:fake');
    assert.equal(link.download, 'a.rag.json');
    assert.equal(link.clicks, 1);
    assert.equal(link.removed, true);
    assert.deepEqual(appended, [link]);
    assert.equal(urls.created[0].type, 'application/json');
    assert.equal(await urls.created[0].text(), '{"x":1}\n');
    assert.deepEqual(urls.revoked, []);
    mock.timers.tick(999);
    assert.deepEqual(urls.revoked, []);
    mock.timers.tick(1);
    assert.deepEqual(urls.revoked, ['blob:fake']);
  } finally {
    mock.timers.reset();
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  }
});

test('attachFileDrop accepts file drags, reads only the first dropped file and never stops propagation', async () => {
  const element = new FakeTarget();
  const reads = [];
  attachFileDrop(element, (read) => reads.push(read));
  const over = element.fire('dragover', dragOf(['Files']));
  assert.equal(over.defaultPrevented, true);
  assert.equal(over.dataTransfer.dropEffect, 'copy');
  const drop = element.fire('drop', { ...dragOf(['Files'], [fileOf('one'), fileOf('two')]), stopPropagation: () => assert.fail('stopped') });
  assert.equal(drop.defaultPrevented, true);
  assert.equal(reads.length, 1);
  assert.equal(await reads[0](), 'one');
});

test('attachFileDrop shows the none cursor and swallows drops while disabled', () => {
  const element = new FakeTarget();
  const reads = [];
  let allowed = false;
  attachFileDrop(element, (read) => reads.push(read), () => allowed);
  const over = element.fire('dragover', dragOf(['Files']));
  assert.equal(over.defaultPrevented, true);
  assert.equal(over.dataTransfer.dropEffect, 'none');
  const drop = element.fire('drop', dragOf(['Files'], [fileOf('x')]));
  assert.equal(drop.defaultPrevented, true);
  assert.deepEqual(reads, []);
  allowed = true;
  assert.equal(element.fire('dragover', dragOf(['Files'])).dataTransfer.dropEffect, 'copy');
  element.fire('drop', dragOf(['Files'], [fileOf('x')]));
  assert.equal(reads.length, 1);
});

test('attachFileDrop ignores drags without files and drops without a file, and detaches', () => {
  const element = new FakeTarget();
  const reads = [];
  const detach = attachFileDrop(element, (read) => reads.push(read));
  const text = element.fire('dragover', dragOf(['text/plain']));
  assert.equal(text.defaultPrevented, false);
  assert.equal(element.fire('drop', dragOf(['text/plain'])).defaultPrevented, false);
  assert.equal(element.fire('drop', { dataTransfer: undefined }).defaultPrevented, false);
  element.fire('drop', dragOf(['Files'], []));
  assert.deepEqual(reads, []);
  detach();
  assert.equal(element.listeners.size, 0);
});

test('blockFileNavigation refuses unhandled file drags and drops, and leaves handled ones alone', () => {
  const doc = new FakeTarget();
  const detach = blockFileNavigation(doc);
  for (const type of ['dragover', 'drop']) {
    const event = doc.fire(type, dragOf(['Files']));
    assert.equal(event.defaultPrevented, true, type);
    assert.equal(event.dataTransfer.dropEffect, 'none', type);
  }
  const handledCopy = { ...dragOf(['Files']), defaultPrevented: true, dataTransfer: { types: ['Files'], dropEffect: 'copy' } };
  doc.fire('dragover', handledCopy);
  assert.equal(handledCopy.dataTransfer.dropEffect, 'copy');
  const text = doc.fire('drop', dragOf(['text/plain']));
  assert.equal(text.defaultPrevented, false);
  detach();
  assert.equal(doc.listeners.size, 0);
});

function fakeSaveDocument(picker) {
  const downloads = [];
  const link = { click() { downloads.push(this); }, remove() {} };
  const doc = { createElement: () => link, body: { append() {} }, defaultView: picker === undefined ? {} : { showSaveFilePicker: picker } };
  return { doc, downloads, link };
}

test('saveTextFile asks the picker with the suggested name and writes the text', async () => {
  const written = { chunks: [], closed: false };
  const options = [];
  const { doc } = fakeSaveDocument(async (opts) => {
    options.push(opts);
    return {
      createWritable: async () => ({
        write: async (text) => written.chunks.push(text),
        close: async () => {
          written.closed = true;
        },
      }),
    };
  });
  assert.equal(await saveTextFile(doc, 'a.rag.json', 'body'), true);
  assert.equal(options[0].suggestedName, 'a.rag.json');
  assert.deepEqual(options[0].types, [{ description: 'Ragdoll', accept: { 'application/json': ['.rag.json'] } }]);
  assert.deepEqual(written, { chunks: ['body'], closed: true });
});

test('saveTextFile resolves false when the user cancels the picker and rejects on other failures', async () => {
  const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  const cancelled = fakeSaveDocument(async () => {
    throw abort;
  });
  assert.equal(await saveTextFile(cancelled.doc, 'a', 'x'), false);
  const denied = fakeSaveDocument(async () => {
    throw Object.assign(new Error('denied'), { name: 'SecurityError' });
  });
  await assert.rejects(saveTextFile(denied.doc, 'a', 'x'), /denied/);
  const failing = fakeSaveDocument(async () => ({
    createWritable: async () => ({
      write: async () => {
        throw new Error('full');
      },
      abort: async () => {},
      close: async () => assert.fail('closed'),
    }),
  }));
  await assert.rejects(saveTextFile(failing.doc, 'a', 'x'), /full/);
});

test('saveTextFile downloads under the suggested name when the picker is unavailable', async () => {
  const { doc, downloads, link } = fakeSaveDocument(undefined);
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  mock.timers.enable({ apis: ['setTimeout'] });
  URL.createObjectURL = () => 'blob:fake';
  URL.revokeObjectURL = () => {};
  try {
    assert.equal(await saveTextFile(doc, 'a.rag.json', 'x'), true);
    assert.equal(link.download, 'a.rag.json');
    assert.equal(downloads.length, 1);
  } finally {
    mock.timers.reset();
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  }
});