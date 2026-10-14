import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Emitter } from '../lib/emitter.js';

test('emitter calls listeners synchronously, in subscription order, with one payload', () => {
  const emitter = new Emitter();
  const calls = [];
  emitter.on('change', (...args) => calls.push(['a', ...args]));
  emitter.on('change', (...args) => calls.push(['b', ...args]));
  emitter.on('other', () => calls.push(['other']));
  emitter.emit('change', 42);
  calls.push(['after']);
  assert.deepEqual(calls, [['a', 42], ['b', 42], ['after']]);
});

test('emitter on returns an unsubscribe function and off removes a listener', () => {
  const emitter = new Emitter();
  const calls = [];
  const first = () => calls.push('first');
  const second = () => calls.push('second');
  const unsubscribe = emitter.on('x', first);
  emitter.on('x', second);
  unsubscribe();
  emitter.emit('x');
  emitter.off('x', second);
  emitter.emit('x');
  emitter.off('x', second);
  emitter.off('missing', second);
  assert.deepEqual(calls, ['second']);
});

test('emitter registers a function at most once per type', () => {
  const emitter = new Emitter();
  let count = 0;
  const listener = () => count++;
  emitter.on('x', listener);
  emitter.on('x', listener);
  emitter.emit('x');
  assert.equal(count, 1);
});

test('emitter iterates a copy: changes during an emit apply to the next emit', () => {
  const emitter = new Emitter();
  const calls = [];
  const late = () => calls.push('late');
  const removed = () => calls.push('removed');
  emitter.on('x', () => {
    calls.push('first');
    emitter.on('x', late);
    emitter.off('x', removed);
  });
  emitter.on('x', removed);
  emitter.emit('x');
  assert.deepEqual(calls, ['first', 'removed']);
  calls.length = 0;
  emitter.emit('x');
  assert.deepEqual(calls, ['first', 'late']);
});

test('emitter runs every listener when one throws and rethrows the first error', () => {
  const emitter = new Emitter();
  const calls = [];
  const firstError = new Error('first');
  emitter.on('x', () => {
    calls.push(1);
    throw firstError;
  });
  emitter.on('x', () => {
    calls.push(2);
    throw new Error('second');
  });
  emitter.on('x', () => calls.push(3));
  assert.throws(() => emitter.emit('x'), (error) => error === firstError);
  assert.deepEqual(calls, [1, 2, 3]);
});

test('emitter clear removes every listener', () => {
  const emitter = new Emitter();
  let count = 0;
  emitter.on('a', () => count++);
  emitter.on('b', () => count++);
  emitter.clear();
  emitter.emit('a');
  emitter.emit('b');
  assert.equal(count, 0);
});

test('emitter rejects non-function listeners', () => {
  assert.throws(() => new Emitter().on('x', null), TypeError);
});
