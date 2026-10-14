import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rovingIndex } from '../js/roving-focus.js';
import { HEADER_GROUPS, actionTitle } from '../js/header.js';

test('rovingIndex moves right and left with wrap-around', () => {
  assert.equal(rovingIndex(0, 'ArrowRight', 3), 1);
  assert.equal(rovingIndex(2, 'ArrowRight', 3), 0);
  assert.equal(rovingIndex(1, 'ArrowLeft', 3), 0);
  assert.equal(rovingIndex(0, 'ArrowLeft', 3), 2);
});

test('rovingIndex jumps to the ends with Home and End', () => {
  assert.equal(rovingIndex(2, 'Home', 5), 0);
  assert.equal(rovingIndex(1, 'End', 5), 4);
});

test('rovingIndex ignores other keys and empty toolbars', () => {
  assert.equal(rovingIndex(1, 'Enter', 3), -1);
  assert.equal(rovingIndex(1, 'ArrowDown', 3), -1);
  assert.equal(rovingIndex(0, 'ArrowRight', 0), -1);
});

test('header lists the DESIGN.md §5.3 actions in grouped order', () => {
  assert.deepEqual(
    HEADER_GROUPS.map((group) => group.map((action) => action.label)),
    [
      ['New', 'Load', 'Save'],
      ['Undo', 'Redo'],
      ['Play', 'Pause', 'Next frame', 'Stop'],
      ['Window', 'Settings'],
    ],
  );
});

test('header action ids are unique', () => {
  const ids = HEADER_GROUPS.flat().map((action) => action.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('header shortcuts match the DESIGN.md §5.9 hotkeys', () => {
  const shortcuts = Object.fromEntries(
    HEADER_GROUPS.flat().map((action) => [action.id, action.ariaKeyShortcuts ?? null]),
  );
  assert.deepEqual(shortcuts, {
    new: null,
    load: 'Control+O',
    save: 'Control+S',
    undo: 'Control+Z',
    redo: 'Control+Shift+Z Control+Y',
    play: 'Space',
    pause: 'Space',
    'next-frame': '.',
    stop: null,
    window: null,
    settings: null,
  });
});

test('actionTitle includes hint and shortcut and marks unavailable actions', () => {
  const nextFrame = HEADER_GROUPS.flat().find((action) => action.id === 'next-frame');
  assert.equal(actionTitle(nextFrame, true), 'Next frame (1/60 s, .)');
  assert.equal(actionTitle(nextFrame, false), 'Next frame (1/60 s, .) (not available yet)');
  const stop = HEADER_GROUPS.flat().find((action) => action.id === 'stop');
  assert.equal(actionTitle(stop, true), 'Stop');
  assert.equal(actionTitle(stop, false), 'Stop (not available yet)');
});
