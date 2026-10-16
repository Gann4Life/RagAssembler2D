import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { loadJson, saveJson } from '../js/model/io.js';
import { createShapeBody } from '../js/commands/create.js';
import { setProps } from '../js/commands/props.js';
import { serialize } from '../lib/serialize.js';
import { ragFile } from './helpers/rag-file.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const bodyCount = (editor) => editor.model.children(ROOT_UID, 'bodies').length;
const validText = () => serialize({ ...ragFile(), meta: { name: 'sample', editorVersion: 'dev' } });

function setup({ text = validText(), confirmAnswer = true, dirty = false, files = true } = {}) {
  const log = { confirms: [], notices: [], saved: [], reads: 0 };
  const service = {
    openText: () => {
      log.reads += 1;
      return typeof text === 'function' ? text() : Promise.resolve(text);
    },
    saveText: (fileName, content) => log.saved.push({ fileName, content }),
  };
  const editor = createEditor({
    confirm: (request) => {
      log.confirms.push(request);
      return Promise.resolve(confirmAnswer);
    },
    notify: (notice) => {
      log.notices.push(notice);
      return Promise.resolve();
    },
    files: files ? service : null,
  });
  if (dirty) {
    editor.history.execute(
      createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'box', width: 1, height: 1 } }),
    );
  }
  return { editor, log, service };
}

test('load and save are registered only with files; loadFrom exists either way', async () => {
  const { editor } = setup({ files: false });
  for (const id of ['load', 'save']) {
    assert.equal(editor.actions.has(id), false);
    assert.equal(editor.actions.reason(id), 'not available yet');
  }
  assert.equal(await editor.loadFrom(() => Promise.resolve(validText())), true);
  assert.equal(bodyCount(editor), 4);
  const withFiles = setup().editor;
  assert.equal(withFiles.actions.has('load'), true);
  assert.equal(withFiles.actions.has('save'), true);
});

test('bad notify and files options throw TypeError', () => {
  assert.throws(() => createEditor({ notify: 1 }), TypeError);
  assert.throws(() => createEditor({ files: {} }), TypeError);
  assert.throws(() => createEditor({ files: { openText() {} } }), TypeError);
  assert.throws(() => createEditor({ files: 'x' }), TypeError);
});

test('load reads synchronously within the action, and not at all when disabled', () => {
  const { editor, log } = setup();
  editor.actions.run('load');
  assert.equal(log.reads, 1);
  editor.modes.startSimulate();
  editor.actions.run('load');
  assert.equal(log.reads, 1);
  assert.equal(editor.actions.isEnabled('load'), false);
});

test('load on a clean document replaces it without asking, and the result is clean with empty history', async () => {
  const source = setup({ dirty: true });
  const { editor, log } = setup({ text: saveJson(source.editor.model, 'dev').text });
  editor.actions.run('load');
  await settle();
  assert.deepEqual(log.confirms, []);
  assert.deepEqual(log.notices, []);
  assert.equal(bodyCount(editor), 1);
  assert.equal(editor.history.dirty, false);
  assert.equal(editor.history.canUndo, false);
});

test('load on a dirty document asks with a load request and loads when confirmed', async () => {
  const { editor, log } = setup({ dirty: true });
  assert.equal(await editor.loadFrom(() => Promise.resolve(validText())), true);
  assert.equal(log.confirms.length, 1);
  assert.equal(log.confirms[0].kind, 'load');
  assert.equal(log.confirms[0].title, 'Discard unsaved changes?');
  assert.equal(log.confirms[0].confirmLabel, 'Discard');
  assert.equal(bodyCount(editor), 4);
  assert.equal(editor.history.dirty, false);
});

test('load on a dirty document keeps it when the confirmation is refused', async () => {
  const { editor, log } = setup({ dirty: true, confirmAnswer: false });
  assert.equal(await editor.loadFrom(() => Promise.resolve(validText())), false);
  assert.equal(bodyCount(editor), 1);
  assert.equal(editor.history.dirty, true);
  assert.deepEqual(log.notices, []);
});

test('load is disabled while its confirmation is open', async () => {
  let answer;
  const editor = createEditor({ confirm: () => new Promise((resolve) => (answer = resolve)), files: { openText() {}, saveText() {} } });
  editor.history.execute(
    createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'box', width: 1, height: 1 } }),
  );
  const loading = editor.loadFrom(() => Promise.resolve(validText()));
  await settle();
  assert.equal(editor.actions.isEnabled('load'), false);
  assert.equal(editor.actions.isEnabled('save'), false);
  assert.equal(editor.actions.isEnabled('new'), false);
  answer(true);
  assert.equal(await loading, true);
  assert.equal(editor.actions.isEnabled('load'), true);
});

test('a cancelled picker does nothing', async () => {
  const { editor, log } = setup({ text: null, dirty: true });
  assert.equal(await editor.loadFrom(() => Promise.resolve(null)), false);
  assert.deepEqual(log.confirms, []);
  assert.deepEqual(log.notices, []);
  assert.equal(bodyCount(editor), 1);
});

test('a read failure, rejected or thrown, notifies the read error and keeps the document', async () => {
  for (const read of [() => Promise.reject(new Error('io')), () => { throw new Error('io'); }]) {
    const { editor, log } = setup({ dirty: true });
    assert.equal(await editor.loadFrom(read), false);
    assert.equal(log.notices.length, 1);
    assert.equal(log.notices[0].kind, 'load-error');
    assert.equal(log.notices[0].message, 'The file could not be read. The current ragdoll is unchanged.');
    assert.deepEqual([...log.notices[0].items], []);
    assert.equal(bodyCount(editor), 1);
    assert.deepEqual(log.confirms, []);
  }
});

test('invalid text leaves the document unchanged and lists the errors in one load-error', async () => {
  const { editor, log } = setup({ dirty: true });
  assert.equal(await editor.loadFrom(() => Promise.resolve('not json')), false);
  assert.equal(log.notices.length, 1);
  const [notice] = log.notices;
  assert.equal(notice.kind, 'load-error');
  assert.equal(notice.title, 'Cannot load file');
  assert.equal(notice.message, 'The file has 1 error and was not loaded. The current ragdoll is unchanged.');
  assert.deepEqual([...notice.items], ['File is not valid JSON']);
  assert.equal(notice.closeLabel, 'OK');
  assert.equal(bodyCount(editor), 1);
  assert.equal(editor.history.dirty, true);
});

test('a problem line is path: message when the path is not empty', async () => {
  const broken = ragFile();
  broken.units.pixelsPerMeter = -1;
  const { editor, log } = setup();
  assert.equal(await editor.loadFrom(() => Promise.resolve(JSON.stringify(broken))), false);
  assert.ok(log.notices[0].items.some((line) => line.startsWith('/units/pixelsPerMeter: ')));
});

test('warnings and migration notes go in one load-notes and never block the load', async () => {
  const withExtra = { ...ragFile(), extra: 1 };
  const { editor, log } = setup();
  assert.equal(await editor.loadFrom(() => Promise.resolve(JSON.stringify(withExtra))), true);
  assert.equal(log.notices.length, 1);
  assert.equal(log.notices[0].kind, 'load-notes');
  assert.equal(log.notices[0].title, 'File loaded with notes');
  assert.ok(log.notices[0].items.length > 0);
  assert.equal(bodyCount(editor), 4);
  assert.equal(editor.history.dirty, false);
});

test('notice items are capped at 50 lines plus "and N more"', async () => {
  const broken = ragFile();
  broken.bodies = Array.from({ length: 60 }, (_, index) => ({ ...broken.bodies[0], id: `b_${index}`, fixtures: [] , position: 'x' }));
  const { editor, log } = setup();
  await editor.loadFrom(() => Promise.resolve(JSON.stringify(broken)));
  const [notice] = log.notices;
  assert.equal(notice.kind, 'load-error');
  assert.equal(notice.items.length, 51);
  assert.match(notice.items[50], /^and \d+ more$/);
});

test('a notify that throws or rejects does not break the load', async () => {
  for (const notify of [() => { throw new Error('x'); }, () => Promise.reject(new Error('x'))]) {
    const editor = createEditor({ notify });
    assert.equal(await editor.loadFrom(() => Promise.resolve('nope')), false);
    await settle();
  }
});

test('save writes the canonical file under its name and marks the document saved', () => {
  const { editor, log } = setup({ dirty: true });
  editor.history.execute(setProps([ROOT_UID], { name: 'a/b: c' }));
  assert.equal(editor.history.dirty, true);
  editor.actions.run('save');
  assert.equal(log.saved.length, 1);
  assert.equal(log.saved[0].fileName, 'a_b_ c.rag.json');
  assert.ok(log.saved[0].content.endsWith('\n'));
  assert.equal(editor.history.dirty, false);
  assert.equal(editor.history.canUndo, true);
  editor.history.undo();
  assert.equal(editor.history.dirty, true);
});

test('save is enabled on a clean document and writes a document with warnings only, reporting none', async () => {
  const { editor, log } = setup();
  await editor.loadFrom(() => Promise.resolve(validText()));
  const notices = log.notices.length;
  assert.equal(editor.history.dirty, false);
  assert.equal(editor.actions.isEnabled('save'), true);
  editor.actions.run('save');
  assert.equal(log.saved.length, 1);
  assert.equal(log.notices.length, notices);
});

test('save with validation errors writes nothing, stays dirty and notifies save-error', () => {
  const { editor, log } = setup({ dirty: true });
  const body = editor.model.children(ROOT_UID, 'bodies')[0];
  editor.history.execute(setProps([body], { position: 'x' }));
  editor.actions.run('save');
  assert.deepEqual(log.saved, []);
  assert.equal(editor.history.dirty, true);
  assert.equal(log.notices.length, 1);
  assert.equal(log.notices[0].kind, 'save-error');
  assert.equal(log.notices[0].title, 'Cannot save');
  assert.match(log.notices[0].message, /^The ragdoll has \d+ errors?\. Fix them and save again\.$/);
  assert.ok(log.notices[0].items.length > 0);
});

test('a throwing saveText leaves the document dirty and propagates', () => {
  const editor = createEditor({
    files: { openText() {}, saveText: () => { throw new Error('disk'); } },
  });
  editor.history.execute(
    createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'box', width: 1, height: 1 } }),
  );
  assert.throws(() => editor.actions.run('save'), /disk/);
  assert.equal(editor.history.dirty, true);
});

test('load then save is byte-identical for a canonical file of the same editor version', async () => {
  const text = validText();
  const { editor, log } = setup({ text });
  await editor.loadFrom(() => Promise.resolve(text));
  editor.actions.run('save');
  assert.equal(log.saved[0].content, text);
  assert.equal(log.saved[0].fileName, 'sample.rag.json');
});

test('new, load and save are enabled in Animate, disabled in Simulate and during a gesture', () => {
  const { editor } = setup();
  loadJson(editor.model, validText());
  const clip = editor.model.children(ROOT_UID, 'clips')[0];
  editor.modes.openClip(clip);
  for (const id of ['new', 'load', 'save']) {
    assert.equal(editor.actions.isEnabled(id), true, `${id} in Animate`);
    assert.equal(editor.actions.reason(id), null);
  }
  editor.modes.startSimulate();
  for (const id of ['new', 'load', 'save']) {
    assert.equal(editor.actions.isEnabled(id), false, `${id} in Simulate`);
    assert.equal(editor.actions.reason(id), 'not available in Simulate mode');
  }
  editor.modes.stopSimulate();
  editor.modes.openClip(null);
  editor.history.beginGesture();
  for (const id of ['new', 'load', 'save']) {
    assert.equal(editor.actions.isEnabled(id), false, `${id} in a gesture`);
    assert.equal(editor.actions.reason(id), null);
  }
  editor.history.cancelGesture();
});
