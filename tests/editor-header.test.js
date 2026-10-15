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

test('rovingIndex defaults to horizontal and accepts it explicitly', () => {
  assert.equal(rovingIndex(0, 'ArrowRight', 3, 'horizontal'), 1);
  assert.equal(rovingIndex(0, 'ArrowDown', 3, 'horizontal'), -1);
});

test('rovingIndex vertical moves with Up and Down, wraps, and keeps Home and End', () => {
  assert.equal(rovingIndex(0, 'ArrowDown', 3, 'vertical'), 1);
  assert.equal(rovingIndex(2, 'ArrowDown', 3, 'vertical'), 0);
  assert.equal(rovingIndex(0, 'ArrowUp', 3, 'vertical'), 2);
  assert.equal(rovingIndex(2, 'ArrowUp', 3, 'vertical'), 1);
  assert.equal(rovingIndex(1, 'Home', 3, 'vertical'), 0);
  assert.equal(rovingIndex(1, 'End', 3, 'vertical'), 2);
  assert.equal(rovingIndex(1, 'ArrowRight', 3, 'vertical'), -1);
  assert.equal(rovingIndex(1, 'ArrowLeft', 3, 'vertical'), -1);
  assert.equal(rovingIndex(0, 'ArrowDown', 0, 'vertical'), -1);
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

test('actionTitle shows the label plus the hotkey and marks unavailable actions', () => {
  const nextFrame = HEADER_GROUPS.flat().find((action) => action.id === 'next-frame');
  assert.equal(actionTitle(nextFrame, true), 'Next frame (.)');
  assert.equal(actionTitle(nextFrame, false), 'Next frame (.) (not available yet)');
  const stop = HEADER_GROUPS.flat().find((action) => action.id === 'stop');
  assert.equal(actionTitle(stop, true), 'Stop');
  assert.equal(actionTitle(stop, false), 'Stop (not available yet)');
});

test('actionTitle appends the given reason while disabled, and nothing for a null reason', () => {
  const undo = HEADER_GROUPS.flat().find((action) => action.id === 'undo');
  assert.equal(actionTitle(undo, false, 'not available in Simulate mode'), 'Undo (Ctrl+Z) (not available in Simulate mode)');
  assert.equal(actionTitle(undo, false, null), 'Undo (Ctrl+Z)');
  assert.equal(actionTitle(undo, true, 'ignored'), 'Undo (Ctrl+Z)');
  assert.equal(actionTitle(undo, false, undefined), 'Undo (Ctrl+Z) (not available yet)');
});
