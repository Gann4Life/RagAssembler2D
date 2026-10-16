import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeKey } from '../js/tree-nav.js';

const ROWS = [
  { expandable: true, expanded: true, parentIndex: -1 },
  { expandable: true, expanded: false, parentIndex: 0 },
  { expandable: false, expanded: false, parentIndex: 0 },
  { expandable: true, expanded: true, parentIndex: 0 },
  { expandable: false, expanded: false, parentIndex: 3 },
];

test('treeKey maps navigation keys to moves', () => {
  const cases = [
    [0, 'ArrowDown', { kind: 'focus', index: 1 }],
    [4, 'ArrowDown', { kind: 'focus', index: 4 }],
    [2, 'ArrowUp', { kind: 'focus', index: 1 }],
    [0, 'ArrowUp', { kind: 'focus', index: 0 }],
    [3, 'Home', { kind: 'focus', index: 0 }],
    [1, 'End', { kind: 'focus', index: 4 }],
    [1, 'ArrowRight', { kind: 'expand', index: 1 }],
    [3, 'ArrowRight', { kind: 'focus', index: 4 }],
    [2, 'ArrowRight', { kind: 'focus', index: 2 }],
    [3, 'ArrowLeft', { kind: 'collapse', index: 3 }],
    [0, 'ArrowLeft', { kind: 'collapse', index: 0 }],
    [1, 'ArrowLeft', { kind: 'focus', index: 0 }],
    [4, 'ArrowLeft', { kind: 'focus', index: 3 }],
    [9, 'ArrowDown', { kind: 'focus', index: 1 }],
    [-1, 'ArrowUp', { kind: 'focus', index: 0 }],
  ];
  for (const [index, key, expected] of cases) assert.deepEqual(treeKey(ROWS, index, key), expected, `${index} ${key}`);
});

test('treeKey: Left on a collapsed root focuses itself', () => {
  const rows = [{ expandable: true, expanded: false, parentIndex: -1 }];
  assert.deepEqual(treeKey(rows, 0, 'ArrowLeft'), { kind: 'focus', index: 0 });
  assert.deepEqual(treeKey([{ expandable: false, expanded: false, parentIndex: -1 }], 0, 'ArrowLeft'), { kind: 'focus', index: 0 });
});

test('treeKey ignores other keys and empty rows', () => {
  for (const key of ['Enter', ' ', 'Delete', 'a', 'Escape', 'PageDown']) assert.equal(treeKey(ROWS, 0, key), null, key);
  assert.equal(treeKey([], 0, 'ArrowDown'), null);
});
