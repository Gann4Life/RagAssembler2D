import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_DURATION, createStatusLine } from '../js/status-line.js';

function fakePanel() {
  const children = [];
  const element = () => {
    const attributes = new Map();
    const node = {
      className: '',
      textContent: '',
      title: '',
      hidden: false,
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name) ?? null,
      remove: () => children.splice(children.indexOf(node), 1),
    };
    return node;
  };
  const panel = {
    ownerDocument: { createElement: element },
    append: (node) => children.push(node),
  };
  return { panel, children };
}

function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    pending,
    setTimeout: (fn, ms) => {
      pending.set(next, { fn, ms });
      return next++;
    },
    clearTimeout: (handle) => pending.delete(handle),
    fire() {
      for (const [handle, { fn }] of [...pending]) {
        pending.delete(handle);
        fn();
      }
    },
  };
}

test('the status line is a hidden polite live region until a message arrives', () => {
  const { panel, children } = fakePanel();
  createStatusLine(panel, fakeTimers());
  const [line] = children;
  assert.equal(line.className, 'status-line');
  assert.equal(line.getAttribute('role'), 'status');
  assert.equal(line.getAttribute('aria-live'), 'polite');
  assert.equal(line.hidden, true);
});

test('a message shows for 4 s and a new one replaces it and restarts the timer', () => {
  const { panel, children } = fakePanel();
  const timers = fakeTimers();
  const status = createStatusLine(panel, timers);
  const [line] = children;
  status.show('Circle: only in Edit mode');
  assert.equal(line.hidden, false);
  assert.equal(line.textContent, 'Circle: only in Edit mode');
  assert.deepEqual([...timers.pending.values()].map(({ ms }) => ms), [STATUS_DURATION]);
  status.show('Root body: pelvis');
  assert.equal(timers.pending.size, 1);
  assert.equal(line.textContent, 'Root body: pelvis');
  timers.fire();
  assert.equal(line.hidden, true);
  assert.equal(line.textContent, '');
  status.show('x');
  status.destroy();
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(children, []);
});
