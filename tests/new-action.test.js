import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { loadJson } from '../js/model/io.js';
import { createShapeBody } from '../js/commands/create.js';
import { serialize } from '../lib/serialize.js';
import { ragFile } from './helpers/rag-file.js';

function dirtyEditor(options) {
  const editor = createEditor(options);
  editor.history.execute(
    createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'box', width: 1, height: 1 } }),
  );
  return editor;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const bodyCount = (editor) => editor.model.children(ROOT_UID, 'bodies').length;

test('editorVersion defaults to dev, is exposed as a getter and must be a function', () => {
  assert.equal(createEditor().editorVersion(), 'dev');
  let version = 'dev';
  const editor = createEditor({ editorVersion: () => version });
  version = '0.4.0';
  assert.equal(editor.editorVersion(), '0.4.0');
  assert.throws(() => createEditor({ editorVersion: '0.4.0' }), TypeError);
});

test('new on a clean document resets without asking', () => {
  const requests = [];
  const editor = createEditor({ confirm: (request) => requests.push(request) });
  loadJson(editor.model, serialize(ragFile()));
  assert.equal(editor.history.dirty, false);
  assert.equal(editor.actions.isEnabled('new'), true);
  editor.actions.run('new');
  assert.deepEqual(requests, []);
  assert.equal(bodyCount(editor), 0);
});

test('new on a dirty document asks with a new request and resets only when confirmed', async () => {
  const requests = [];
  const editor = dirtyEditor({
    confirm: (request) => {
      requests.push(request);
      return Promise.resolve(false);
    },
  });
  editor.selection.set([editor.model.children(ROOT_UID, 'bodies')[0]]);
  editor.actions.run('new');
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, 'new');
  assert.equal(requests[0].confirmLabel, 'Discard');
  assert.equal(bodyCount(editor), 1);
  assert.equal(editor.history.dirty, true);

  const accepting = dirtyEditor({ confirm: () => Promise.resolve(true) });
  accepting.actions.run('new');
  await settle();
  assert.equal(bodyCount(accepting), 0);
  assert.equal(accepting.history.dirty, false);
  assert.equal(accepting.history.canUndo, false);
  assert.deepEqual([...accepting.selection.objects], []);
});

test('new is disabled while its confirmation is open and a failing confirm cancels it', async () => {
  let answer;
  const editor = dirtyEditor({ confirm: () => new Promise((resolve) => (answer = resolve)) });
  editor.actions.run('new');
  assert.equal(editor.actions.isEnabled('new'), false);
  answer(true);
  await settle();
  assert.equal(bodyCount(editor), 0);
  assert.equal(editor.actions.isEnabled('new'), true);

  const failing = dirtyEditor({ confirm: () => Promise.reject(new Error('boom')) });
  failing.actions.run('new');
  await settle();
  assert.equal(bodyCount(failing), 1);
});

test('new is disabled outside edit mode', () => {
  const editor = createEditor();
  editor.modes.startSimulate();
  assert.equal(editor.actions.isEnabled('new'), false);
});
