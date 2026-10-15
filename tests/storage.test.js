import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadLayout, saveLayout, clearLayout, loadSettings, saveSettings } from '../js/storage.js';

const KEY = 'ragassembler.layout';
const SETTINGS_KEY = 'ragassembler.settings';

let original;

beforeEach(() => {
  original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
});

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete globalThis.localStorage;
});

function install(storage) {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}

function memoryStorage(entries = {}) {
  const data = new Map(Object.entries(entries));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function failing() {
  const fail = () => {
    throw new Error('SecurityError');
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

test('loadLayout reports a missing key', () => {
  install(memoryStorage());
  assert.deepEqual(loadLayout(), { error: 'missing' });
});

test('loadLayout returns the parsed value', () => {
  install(memoryStorage({ [KEY]: '{"version":2}' }));
  assert.deepEqual(loadLayout(), { value: { version: 2 } });
});

test('loadLayout reports invalid JSON as parse', () => {
  install(memoryStorage({ [KEY]: '{not json' }));
  assert.deepEqual(loadLayout(), { error: 'parse' });
});

test('loadLayout reports unavailable storage when getItem throws or localStorage is undefined', () => {
  install(failing());
  assert.deepEqual(loadLayout(), { error: 'unavailable' });
  install(undefined);
  assert.deepEqual(loadLayout(), { error: 'unavailable' });
});

test('saveLayout writes JSON under ragassembler.layout', () => {
  const storage = memoryStorage();
  install(storage);
  assert.equal(saveLayout({ version: 2, closed: {} }), true);
  assert.equal(storage.data.get(KEY), '{"version":2,"closed":{}}');
});

test('saveLayout returns false when setItem throws or storage is undefined', () => {
  install(failing());
  assert.equal(saveLayout({ version: 2 }), false);
  install(undefined);
  assert.equal(saveLayout({ version: 2 }), false);
});

test('loadSettings reads ragassembler.settings with the same failure results', () => {
  install(memoryStorage({ [SETTINGS_KEY]: '{"version":1}', [KEY]: '{"version":2}' }));
  assert.deepEqual(loadSettings(), { value: { version: 1 } });
  install(memoryStorage());
  assert.deepEqual(loadSettings(), { error: 'missing' });
  install(memoryStorage({ [SETTINGS_KEY]: '{' }));
  assert.deepEqual(loadSettings(), { error: 'parse' });
  install(failing());
  assert.deepEqual(loadSettings(), { error: 'unavailable' });
  install(undefined);
  assert.deepEqual(loadSettings(), { error: 'unavailable' });
});

test('saveSettings writes JSON under ragassembler.settings and reports failures', () => {
  const storage = memoryStorage();
  install(storage);
  assert.equal(saveSettings({ version: 1, snap: { grid: true } }), true);
  assert.equal(storage.data.get(SETTINGS_KEY), '{"version":1,"snap":{"grid":true}}');
  assert.equal(storage.data.has(KEY), false);
  install(failing());
  assert.equal(saveSettings({ version: 1 }), false);
  install(undefined);
  assert.equal(saveSettings({ version: 1 }), false);
});

test('clearLayout removes the key and swallows errors', () => {
  const storage = memoryStorage({ [KEY]: '{}' });
  install(storage);
  clearLayout();
  assert.equal(storage.data.has(KEY), false);
  install(failing());
  assert.doesNotThrow(() => clearLayout());
  install(undefined);
  assert.doesNotThrow(() => clearLayout());
});
