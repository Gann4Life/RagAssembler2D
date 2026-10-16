import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_VERSION, loadVersion } from '../js/version.js';

const respond = (body, ok = true) => () => Promise.resolve({ ok, json: () => body });

test('loadVersion strips a leading v and builds the label with the commit', async () => {
  const info = await loadVersion(respond(Promise.resolve({ version: 'v0.4.0', commit: 'abc1234' })));
  assert.deepEqual({ ...info }, { editorVersion: '0.4.0', label: 'v0.4.0 · abc1234' });
});

test('loadVersion keeps a version without v and omits a missing commit from the label', async () => {
  const info = await loadVersion(respond(Promise.resolve({ version: '0.4.0' })));
  assert.deepEqual({ ...info }, { editorVersion: '0.4.0', label: '0.4.0' });
});

test('loadVersion asks for version.json without cache', async () => {
  const calls = [];
  await loadVersion((url, init) => {
    calls.push([url, init]);
    return respond(Promise.resolve({ version: 'v1.0.0' }))();
  });
  assert.deepEqual(calls, [['version.json', { cache: 'no-store' }]]);
});

test('loadVersion gives dev on rejection, non-OK, bad JSON or a missing version and never rejects', async () => {
  const dev = { editorVersion: DEV_VERSION, label: DEV_VERSION };
  const cases = [
    () => Promise.reject(new Error('offline')),
    respond(Promise.resolve({}), false),
    respond(Promise.reject(new SyntaxError('bad'))),
    respond(Promise.resolve({ commit: 'abc' })),
    respond(Promise.resolve({ version: 3 })),
    respond(Promise.resolve({ version: '' })),
    respond(Promise.resolve(null)),
    () => {
      throw new Error('sync');
    },
  ];
  for (const fetchFn of cases) assert.deepEqual({ ...(await loadVersion(fetchFn)) }, dev);
});
