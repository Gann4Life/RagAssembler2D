import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionRegistry } from '../js/actions.js';

test('unregistered actions are disabled and not available yet', () => {
  const actions = new ActionRegistry();
  assert.equal(actions.has('save'), false);
  assert.equal(actions.isEnabled('save'), false);
  assert.equal(actions.reason('save'), 'not available yet');
  assert.equal(actions.isRepeatable('save'), false);
  assert.equal(actions.run('save'), false);
});

test('a registered action is enabled by default, runs and has no reason', () => {
  const actions = new ActionRegistry();
  let runs = 0;
  actions.register('window', { run: () => runs++ });
  assert.equal(actions.has('window'), true);
  assert.equal(actions.isEnabled('window'), true);
  assert.equal(actions.reason('window'), null);
  assert.equal(actions.run('window'), true);
  assert.equal(runs, 1);
});

test('a disabled action does not run and reports its reason', () => {
  const actions = new ActionRegistry();
  let enabled = false;
  let reason = 'not available in Simulate mode';
  let runs = 0;
  actions.register('undo', { run: () => runs++, isEnabled: () => enabled, reason: () => reason, repeatable: true });
  assert.equal(actions.run('undo'), false);
  assert.equal(actions.reason('undo'), 'not available in Simulate mode');
  reason = null;
  assert.equal(actions.reason('undo'), null);
  enabled = true;
  assert.equal(actions.reason('undo'), null);
  assert.equal(actions.run('undo'), true);
  assert.equal(runs, 1);
  assert.equal(actions.isRepeatable('undo'), true);
});

test('a disabled action without a reason function reports null', () => {
  const actions = new ActionRegistry();
  actions.register('redo', { run() {}, isEnabled: () => false });
  assert.equal(actions.reason('redo'), null);
});

test('register rejects duplicates, empty ids and specs without run', () => {
  const actions = new ActionRegistry();
  actions.register('escape', { run() {} });
  assert.throws(() => actions.register('escape', { run() {} }), /already registered/);
  assert.throws(() => actions.register('', { run() {} }), TypeError);
  assert.throws(() => actions.register('x', {}), TypeError);
  assert.throws(() => actions.register('y'), TypeError);
});
