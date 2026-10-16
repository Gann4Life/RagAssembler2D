import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize } from '../lib/serialize.js';
import { fieldsOf } from '../lib/schema.js';
import { ragFile } from './helpers/rag-file.js';

function shuffled(value, keepOrder = false) {
  if (Array.isArray(value)) return value.map((item) => shuffled(item, keepOrder));
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => [key, shuffled(item, keepOrder || key === 'data')]);
    return Object.fromEntries(keepOrder ? entries : entries.reverse());
  }
  return value;
}

test('serialize writes keys in schema order whatever the input order', () => {
  const json = ragFile();
  assert.equal(serialize(shuffled(json)), serialize(json));
  const parsed = JSON.parse(serialize(json));
  assert.deepEqual(Object.keys(parsed), fieldsOf('document').map((spec) => spec.path.split('.')[0]).filter((key, i, all) => all.indexOf(key) === i));
  assert.deepEqual(Object.keys(parsed.bodies[0]), fieldsOf('body').map((spec) => spec.path));
  for (const body of parsed.bodies) {
    for (const shape of body.fixtures) {
      const variant = shape.shape.type;
      const top = fieldsOf('shape', variant).map((spec) => spec.path.split('.')[0]).filter((key, i, all) => all.indexOf(key) === i);
      assert.deepEqual(Object.keys(shape), top);
    }
  }
  assert.deepEqual(Object.keys(parsed.joints[0]), fieldsOf('joint').map((spec) => spec.path.split('.')[0]).filter((key, i, all) => all.indexOf(key) === i));
});

test('serialize leaves unknown keys out and does not mutate its input', () => {
  const json = ragFile();
  json.extra = 1;
  json.bodies[0].mystery = true;
  json.bodies[0].fixtures[0].shape.other = 2;
  const before = structuredClone(json);
  const text = serialize(json);
  assert.deepEqual(json, before);
  assert.equal(text.includes('extra'), false);
  assert.equal(text.includes('mystery'), false);
  assert.equal(text.includes('other'), false);
});

test('serialize rounds numbers to 1e-5 without trailing zeros and writes -0 as 0', () => {
  const json = ragFile();
  json.bodies[0].position = [0.1 + 0.2, 1e-6];
  json.bodies[0].angle = -1e-6;
  json.bodies[1].position = [-0, 3];
  json.bodies[0].linearDamping = 0.123456789;
  json.clips[0].events[0].data = { n: 0.1 + 0.2, list: [1.000004, -0], z: 'x', nothing: null };
  const parsed = JSON.parse(serialize(json));
  assert.deepEqual(parsed.bodies[0].position, [0.3, 0]);
  assert.equal(parsed.bodies[0].angle, 0);
  assert.equal(parsed.bodies[0].linearDamping, 0.12346);
  assert.deepEqual(parsed.clips[0].events[0].data, { n: 0.3, list: [1, 0], z: 'x', nothing: null });
  const text = serialize(json);
  assert.equal(/-0(?![.\d])/.test(text), false);
  assert.equal(text.includes('0.30000000000000004'), false);
  assert.match(text, /"position": \[\n\s+0\.3,\n\s+0\n\s+\]/);
});

test('serialize uses 2-space indentation, \\n and one final newline, and writes an absent sprite as null', () => {
  const json = ragFile();
  delete json.bodies[3].fixtures[0].sprite;
  const text = serialize(json);
  assert.equal(text.endsWith('}\n'), true);
  assert.equal(text.endsWith('\n\n'), false);
  assert.equal(text.includes('\r'), false);
  assert.match(text, /^\{\n {2}"format": "ragassembler",\n {2}"version": 1,\n/);
  assert.equal(JSON.parse(text).bodies[3].fixtures[0].sprite, null);
});
