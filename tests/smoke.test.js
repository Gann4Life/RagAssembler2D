import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RagImporter } from '../lib/ragimporter.js';

test('ragimporter loads as an ES module and exposes RagImporter', () => {
  assert.equal(typeof RagImporter, 'object');
  assert.ok(Object.isFrozen(RagImporter));
});

test('RagImporter declares format version 2 as supported', () => {
  assert.deepEqual(RagImporter.supportedVersions, [2]);
});
