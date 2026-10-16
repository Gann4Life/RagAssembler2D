import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmDialog, confirmKey } from '../js/confirm-dialog.js';

const press = (key, extra = {}) => ({ key, ...extra });

test('confirmKey: Enter confirms, except on a focused Cancel; Esc cancels; Tab traps', () => {
  assert.equal(confirmKey(press('Enter'), 'confirm'), 'confirm');
  assert.equal(confirmKey(press('Enter'), 'other'), 'confirm');
  assert.equal(confirmKey(press('Enter'), 'cancel'), 'cancel');
  assert.equal(confirmKey(press('Escape'), 'confirm'), 'cancel');
  assert.equal(confirmKey(press('Tab'), 'confirm'), 'trap');
  assert.equal(confirmKey(press('Tab', { shiftKey: true }), 'cancel'), 'trap');
  assert.equal(confirmKey(press('a'), 'confirm'), null);
});

test('confirmKey: composing text or a modifier held is not handled', () => {
  for (const extra of [{ isComposing: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    assert.equal(confirmKey(press('Enter', extra), 'confirm'), null);
    assert.equal(confirmKey(press('Escape', extra), 'confirm'), null);
  }
});

class FakeNode {
  constructor(doc, tag) {
    this.doc = doc;
    this.tag = tag;
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
    this.isConnected = false;
    this.focusCalls = 0;
  }

  append(...nodes) {
    this.children.push(...nodes);
    for (const node of nodes) if (node instanceof FakeNode) node.setConnected(this.isConnected);
  }

  setConnected(value) {
    this.isConnected = value;
    for (const child of this.children) if (child instanceof FakeNode) child.setConnected(value);
  }

  remove() {
    this.doc.body.children = this.doc.body.children.filter((child) => child !== this);
    this.setConnected(false);
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, fn) {
    this.listeners.set(type, fn);
  }

  fire(type, event = {}) {
    const full = { target: this, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...event };
    this.listeners.get(type)?.(full);
    return full;
  }

  focus() {
    this.focusCalls += 1;
    this.doc.activeElement = this;
  }

  showModal() {
    this.modal = true;
  }

  find(predicate, found = []) {
    if (predicate(this)) found.push(this);
    for (const child of this.children) if (child instanceof FakeNode) child.find(predicate, found);
    return found;
  }
}

function fakeDocument() {
  const doc = {
    createElement: (tag) => new FakeNode(doc, tag),
  };
  doc.body = new FakeNode(doc, 'body');
  doc.body.isConnected = true;
  const opener = new FakeNode(doc, 'button');
  opener.isConnected = true;
  doc.activeElement = opener;
  return { doc, opener };
}

const OPTIONS = { title: 'Delete?', message: 'Sure?', items: ['one', 'two'], confirmLabel: 'Delete', cancelLabel: 'Cancel' };

function open(options = OPTIONS) {
  const { doc, opener } = fakeDocument();
  const promise = confirmDialog(doc, options);
  const dialog = doc.body.children[0];
  const [cancel, confirm] = dialog.find((node) => node.tag === 'button');
  return { doc, opener, promise, dialog, cancel, confirm };
}

test('confirmDialog renders title, message and items, opens modal and focuses the confirm button', async () => {
  const { doc, dialog, confirm, cancel, promise } = open();
  assert.equal(dialog.attributes.role, 'alertdialog');
  assert.equal(dialog.modal, true);
  assert.equal(doc.activeElement, confirm);
  assert.equal(cancel.textContent, 'Cancel');
  assert.equal(confirm.textContent, 'Delete');
  assert.deepEqual(
    dialog.find((node) => node.tag === 'li').map((node) => node.textContent),
    ['one', 'two'],
  );
  cancel.fire('click');
  assert.equal(await promise, false);
});

test('confirmDialog omits the list when there are no items', async () => {
  const { dialog, cancel, promise } = open({ ...OPTIONS, items: [] });
  assert.equal(dialog.find((node) => node.tag === 'ul').length, 0);
  cancel.fire('click');
  await promise;
});

test('confirmDialog: Enter and the confirm button resolve true and restore focus', async () => {
  for (const choose of [(parts) => parts.dialog.fire('keydown', { key: 'Enter' }), (parts) => parts.confirm.fire('click')]) {
    const parts = open();
    choose(parts);
    assert.equal(await parts.promise, true);
    assert.equal(parts.doc.body.children.length, 0);
    assert.equal(parts.doc.activeElement, parts.opener);
  }
});

test('confirmDialog: Esc, Cancel, the native cancel event and a backdrop press resolve false and restore focus', async () => {
  const ways = [
    (parts) => parts.dialog.fire('keydown', { key: 'Escape' }),
    (parts) => parts.cancel.fire('click'),
    (parts) => parts.dialog.fire('cancel'),
    (parts) => parts.dialog.fire('pointerdown', { target: parts.dialog }),
  ];
  for (const way of ways) {
    const parts = open();
    way(parts);
    assert.equal(await parts.promise, false);
    assert.equal(parts.doc.body.children.length, 0);
    assert.equal(parts.doc.activeElement, parts.opener);
  }
});

test('confirmDialog: a press inside the content does not cancel, Enter on Cancel cancels, Tab swaps the two buttons', async () => {
  const parts = open();
  parts.dialog.fire('pointerdown', { target: parts.confirm });
  assert.equal(parts.doc.body.children.length, 1);
  const tab = parts.dialog.fire('keydown', { key: 'Tab' });
  assert.equal(tab.prevented, true);
  assert.equal(parts.doc.activeElement, parts.cancel);
  parts.dialog.fire('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(parts.doc.activeElement, parts.confirm);
  parts.dialog.fire('keydown', { key: 'Tab' });
  const enter = parts.dialog.fire('keydown', { key: 'Enter' });
  assert.equal(enter.stopped, true);
  assert.equal(await parts.promise, false);
});

test('confirmDialog: a second call while one is open resolves false at once', async () => {
  const parts = open();
  assert.equal(await confirmDialog(parts.doc, OPTIONS), false);
  assert.equal(parts.doc.body.children.length, 1);
  parts.confirm.fire('click');
  assert.equal(await parts.promise, true);
  const again = open();
  again.confirm.fire('click');
  assert.equal(await again.promise, true);
});

test('confirmDialog: focus is not restored to an element that left the document', async () => {
  const parts = open();
  parts.opener.isConnected = false;
  const calls = parts.opener.focusCalls;
  parts.confirm.fire('click');
  await parts.promise;
  assert.equal(parts.opener.focusCalls, calls);
});
