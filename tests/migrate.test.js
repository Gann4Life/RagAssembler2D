import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS, migrate } from '../lib/migrate.js';
import { FORMAT_VERSION } from '../lib/schema.js';

function chain() {
  return [
    { from: 1, to: 2, up: (json) => ({ ...json, addedInV2: true }) },
    { from: 2, to: 3, up: (json) => ({ ...json, addedInV3: true }) },
  ];
}

const doc = (version) => ({ format: 'ragassembler', version });

test('an empty MIGRATIONS leaves a current document as the same object', () => {
  const json = doc(FORMAT_VERSION);
  const result = migrate(json);
  assert.equal(result.json, json);
  assert.deepEqual(result.notes, []);
  assert.equal(Object.isFrozen(MIGRATIONS), true);
});

test('the last MIGRATIONS step, when any, ends at FORMAT_VERSION', () => {
  if (MIGRATIONS.length > 0) assert.equal(MIGRATIONS[MIGRATIONS.length - 1].to, FORMAT_VERSION);
});

test('an injected chain runs in order from each start version and notes every step', () => {
  const fromOne = migrate(doc(1), chain());
  assert.deepEqual(fromOne.json, { format: 'ragassembler', version: 3, addedInV2: true, addedInV3: true });
  assert.deepEqual(fromOne.notes, ['Migrated from format version 1 to 2', 'Migrated from format version 2 to 3']);
  const fromTwo = migrate(doc(2), chain());
  assert.deepEqual(fromTwo.json, { format: 'ragassembler', version: 3, addedInV3: true });
  assert.equal(fromTwo.notes.length, 1);
  const current = doc(3);
  assert.equal(migrate(current, chain()).json, current);
});

test('migrate never mutates its input', () => {
  const json = doc(1);
  const before = structuredClone(json);
  migrate(json, chain());
  assert.deepEqual(json, before);
});

test('unknown, newer, wrong-format and non-object inputs come back unchanged', () => {
  for (const input of [doc(0), doc(99), doc(undefined), { format: 'other', version: 1 }, null, 5, 'x', [1]]) {
    const result = migrate(input, chain());
    assert.equal(result.json, input);
    assert.deepEqual(result.notes, []);
  }
});

test('a malformed chain throws TypeError', () => {
  const up = (json) => json;
  assert.throws(() => migrate(doc(1), [{ from: 1, to: 3, up }]), TypeError);
  assert.throws(() => migrate(doc(1), [{ from: 1, to: 2, up }, { from: 3, to: 4, up }]), TypeError);
  assert.throws(() => migrate(doc(1), [{ from: 2, to: 3, up }, { from: 1, to: 2, up }]), TypeError);
  assert.throws(() => migrate(doc(1), [{ from: 1, to: 2 }]), TypeError);
  assert.throws(() => migrate(doc(1), null), TypeError);
});
