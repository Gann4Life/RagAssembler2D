import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickSelection, selectionState, summaryKeys } from '../js/timeline-rows.js';

const rows = [
  { keys: [{ uid: 1, t: 0 }, { uid: 2, t: 0.5 }] },
  { keys: [{ uid: 3, t: 0.5 + 1e-7 }, { uid: 4, t: 0.75 }, { uid: 5, t: 0 }] },
];

test('summaryKeys merges keys within the same-time tolerance and orders by time', () => {
  const groups = summaryKeys(rows, []);
  assert.deepEqual(groups.map((group) => [group.t, group.keys]), [[0, [1, 5]], [0.5, [2, 3]], [0.75, [4]]]);
});

test('summaryKeys keeps keys apart beyond the tolerance and handles no keys', () => {
  assert.equal(summaryKeys([{ keys: [{ uid: 1, t: 0 }, { uid: 2, t: 2e-6 }] }], []).length, 2);
  assert.deepEqual(summaryKeys([], []), []);
});

test('summaryKeys reports none, some and all selected', () => {
  const groups = summaryKeys(rows, [1, 2, 3]);
  assert.deepEqual(groups.map((group) => [group.state, group.selected]), [['some', 1], ['all', 2], ['none', 0]]);
});

test('selectionState of an empty group is none', () => {
  assert.equal(selectionState([], [1]).state, 'none');
});

test('clickSelection without modifiers selects only the targets, or keeps the selection when all are selected', () => {
  assert.deepEqual(clickSelection([1, 2], [3]), [3]);
  assert.deepEqual(clickSelection([1, 2, 3], [2, 3]), [1, 2, 3]);
  assert.deepEqual(clickSelection([2], [2, 3]), [2, 3]);
});

test('clickSelection with SHIFT adds the targets, or removes them when all are selected', () => {
  assert.deepEqual(clickSelection([1], [2, 1], { shift: true }), [1, 2]);
  assert.deepEqual(clickSelection([1, 2, 3], [2, 3], { shift: true }), [1]);
  assert.deepEqual(clickSelection([2], [2, 3], { shift: true }), [2, 3]);
});

test('clickSelection with CTRL removes the targets and wins over SHIFT', () => {
  assert.deepEqual(clickSelection([1, 2, 3], [2], { ctrl: true }), [1, 3]);
  assert.deepEqual(clickSelection([1, 2], [3], { ctrl: true, shift: true }), [1, 2]);
  assert.deepEqual(clickSelection([1, 2], [2], { ctrl: true, shift: true }), [1]);
});

test('clickSelection does not mutate its inputs', () => {
  const current = Object.freeze([1, 2]);
  const targets = Object.freeze([2]);
  assert.doesNotThrow(() => clickSelection(current, targets, { shift: true }));
});
