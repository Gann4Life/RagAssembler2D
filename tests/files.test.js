import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAG_FILE_ACCEPT, attachFileDrop, blockFileNavigation, downloadText, pickTextFile } from '../js/files.js';

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
  const doc = {
    createElement(tag) {
      const node = new FakeTarget();
      node.tag = tag;
      node.clicks = 0;
      node.click = () => {
        node.clicks += 1;
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
  input.files = [fileOf('first'), fileOf('second')];
  input.fire('change');
  assert.equal(await promise, 'first');
});

test('pickTextFile resolves null on cancel or an empty selection and rejects when reading fails', async () => {
  const cancelled = fakeInputDocument();
  const first = pickTextFile(cancelled.doc, 'x');
  cancelled.created[0].fire('cancel');
  assert.equal(await first, null);

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
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(urls.revoked, ['blob:fake']);
  } finally {
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
