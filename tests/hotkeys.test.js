import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOTKEYS, matchHotkey, dispatchKey } from '../js/hotkeys.js';
import { ActionRegistry } from '../js/actions.js';
import { HEADER_GROUPS } from '../js/header.js';
import { Model } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { Selection } from '../js/model/selection.js';
import { Modes } from '../js/modes.js';
import { Settings } from '../js/settings.js';
import { Camera } from '../js/viewport/camera.js';
import { TOOL_SPECS, defineTool } from '../js/tools/tool.js';
import { ToolRegistry } from '../js/tools/registry.js';

const DESIGN = readFileSync(new URL('../docs/design/05-9-hotkeys.md', import.meta.url), 'utf8');

function designHotkeyKeys() {
  const lines = DESIGN.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('# 5.9'));
  const rows = [];
  for (let index = start + 1; index < lines.length && !lines[index].startsWith('#'); index++) {
    if (!lines[index].startsWith('|') || /^\|\s*(Key|---)/.test(lines[index])) continue;
    const cells = lines[index].split('|').slice(1, -1).map((cell) => cell.trim());
    rows.push(cells[0], cells[2]);
  }
  return rows
    .filter((cell) => cell !== '')
    .flatMap((cell) => cell.split(' / '))
    .flatMap((cell) => cell.split(', '));
}

function keyEvent(key, init = {}) {
  let prevented = false;
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    defaultPrevented: false,
    target: { tagName: 'BODY' },
    ...init,
    preventDefault() {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  };
}

function registry(ids, options = {}) {
  const actions = new ActionRegistry();
  const runs = [];
  for (const id of ids) {
    actions.register(id, {
      run: () => runs.push(id),
      isEnabled: () => !options.disabled?.includes(id),
      repeatable: options.repeatable?.includes(id) ?? false,
    });
  }
  return { actions, runs };
}

test('HOTKEYS lists the DESIGN.md §5.9 keys in table order, tool rows first', () => {
  assert.deepEqual(
    HOTKEYS.map((row) => row.keys),
    designHotkeyKeys(),
  );
  assert.deepEqual(
    HOTKEYS.map((row) => row.action),
    [
      'tool:select',
      'tool:select-box',
      'tool:pose',
      'tool:circle',
      'tool:box',
      'tool:polygon',
      'tool:hinge',
      'sprite-edit',
      'delete',
      'undo',
      'redo',
      'redo',
      'save',
      'load',
      'group',
      'ungroup',
      'split',
      'duplicate',
      'toggle-play',
      'next-frame',
      'key-selected',
      'frame-selection',
      'frame-all',
      'escape',
      'pivot-mode',
    ],
  );
  assert.ok(Object.isFrozen(HOTKEYS));
  assert.ok(HOTKEYS.every((row) => Object.isFrozen(row)));
  for (const { keys } of HOTKEYS) {
    assert.match(keys, /^(Ctrl\+)?(Shift\+)?(Alt\+)?([A-Z0-9.]|Space|Del|Esc|Home)$/);
  }
});

test('tool rows are built from TOOL_SPECS', () => {
  assert.deepEqual(
    HOTKEYS.slice(0, TOOL_SPECS.length),
    TOOL_SPECS.map((tool) => ({ keys: tool.hotkey, action: `tool:${tool.id}` })),
  );
});

test('tool hotkeys match single letters without modifiers', () => {
  assert.equal(matchHotkey(keyEvent('v')), 'tool:select');
  assert.equal(matchHotkey(keyEvent('R')), 'tool:box');
  assert.equal(matchHotkey(keyEvent('h')), 'tool:hinge');
  assert.equal(matchHotkey(keyEvent('v', { shiftKey: true })), null);
  assert.equal(matchHotkey(keyEvent('n', { ctrlKey: true })), null);
});

test('with the tool registry, the focused viewport offers keys to the tool but never Escape', () => {
  const model = new Model();
  const history = new History(model);
  const modes = new Modes(model);
  const seen = [];
  const tools = new ToolRegistry(
    { model, history, selection: new Selection(model), modes, settings: new Settings(), camera: new Camera() },
    [
      defineTool({
        id: 'select',
        keyDown(e) {
          seen.push(e.key);
          return e.key === 'Enter';
        },
      }),
    ],
  );
  const { actions, runs } = registry(['escape', 'tool:select', 'tool:box']);
  const enter = keyEvent('Enter', { target: { tagName: 'DIV' } });
  assert.equal(dispatchKey(enter, { actions, tools, viewportFocused: true }), true);
  assert.equal(enter.prevented, false);
  const escape = keyEvent('Escape', { target: { tagName: 'DIV' } });
  assert.equal(dispatchKey(escape, { actions, tools, viewportFocused: true }), true);
  assert.equal(escape.prevented, true);
  assert.equal(dispatchKey(keyEvent('r', { target: { tagName: 'DIV' } }), { actions, tools, viewportFocused: true }), true);
  assert.equal(dispatchKey(keyEvent('v'), { actions, tools, viewportFocused: false }), true);
  assert.deepEqual(seen, ['Enter', 'r']);
  assert.deepEqual(runs, ['escape', 'tool:box', 'tool:select']);
});

test('tool hotkeys of unregistered tools still suppress the default', () => {
  const { actions, runs } = registry([]);
  const event = keyEvent('c');
  assert.equal(dispatchKey(event, { actions, tools: null, viewportFocused: false }), true);
  assert.equal(event.prevented, true);
  assert.deepEqual(runs, []);
});

test('the header shortcut hints equal the HOTKEYS rows', () => {
  for (const action of HEADER_GROUPS.flat()) {
    const id = action.id === 'play' || action.id === 'pause' ? 'toggle-play' : action.id;
    const rows = HOTKEYS.filter((row) => row.action === id).map((row) => row.keys);
    assert.equal(action.shortcut ?? null, rows.length > 0 ? rows.join(' / ') : null, action.id);
  }
});

test('matchHotkey matches letters case-insensitively with exact modifiers', () => {
  assert.equal(matchHotkey(keyEvent('z', { ctrlKey: true })), 'undo');
  assert.equal(matchHotkey(keyEvent('Z', { ctrlKey: true, shiftKey: true })), 'redo');
  assert.equal(matchHotkey(keyEvent('y', { ctrlKey: true })), 'redo');
  assert.equal(matchHotkey(keyEvent('z', { ctrlKey: true, altKey: true })), null);
  assert.equal(matchHotkey(keyEvent('z')), 'pivot-mode');
  assert.equal(matchHotkey(keyEvent('Z')), 'pivot-mode');
  assert.equal(matchHotkey(keyEvent('z', { shiftKey: true })), null);
  assert.equal(matchHotkey(keyEvent('m')), null);
  assert.equal(matchHotkey(keyEvent('s')), 'sprite-edit');
  assert.equal(matchHotkey(keyEvent('S', { shiftKey: true })), null);
  assert.equal(matchHotkey(keyEvent('s', { ctrlKey: true })), 'save');
  assert.equal(matchHotkey(keyEvent('g', { ctrlKey: true, shiftKey: true })), 'ungroup');
});

test('Alt+G matches split by character, or by physical key when Alt changes the character', () => {
  assert.equal(matchHotkey(keyEvent('g', { altKey: true })), 'split');
  assert.equal(matchHotkey(keyEvent('G', { altKey: true, code: 'KeyG' })), 'split');
  assert.equal(matchHotkey(keyEvent('©', { altKey: true, code: 'KeyG' })), 'split');
  assert.equal(matchHotkey(keyEvent('©', { altKey: true, code: 'KeyH' })), null);
  assert.equal(matchHotkey(keyEvent('h', { altKey: true, code: 'KeyG' })), null);
  assert.equal(matchHotkey(keyEvent('g', { ctrlKey: true, altKey: true })), null);
  assert.equal(matchHotkey(keyEvent('©', { ctrlKey: true, altKey: true, code: 'KeyG' })), null);
  assert.equal(matchHotkey(keyEvent('G', { altKey: true, shiftKey: true, code: 'KeyG' })), null);
  assert.equal(matchHotkey(keyEvent('g', { ctrlKey: true, code: 'KeyG' })), 'group');
});

test('rows without Alt ignore code', () => {
  assert.equal(matchHotkey(keyEvent('©', { code: 'KeyV' })), null);
  assert.equal(matchHotkey(keyEvent('ü', { code: 'KeyB' })), null);
  assert.equal(matchHotkey(keyEvent('ж', { ctrlKey: true, code: 'KeyZ' })), null);
  assert.equal(matchHotkey(keyEvent('q', { code: 'KeyV' })), null);
});

test('matchHotkey treats Meta as Ctrl and maps named keys', () => {
  assert.equal(matchHotkey(keyEvent('z', { metaKey: true })), 'undo');
  assert.equal(matchHotkey(keyEvent('Z', { metaKey: true, shiftKey: true })), 'redo');
  assert.equal(matchHotkey(keyEvent('Delete')), 'delete');
  assert.equal(matchHotkey(keyEvent('Escape')), 'escape');
  assert.equal(matchHotkey(keyEvent(' ')), 'toggle-play');
  assert.equal(matchHotkey(keyEvent('Home')), 'frame-all');
  assert.equal(matchHotkey(keyEvent('.')), 'next-frame');
  assert.equal(matchHotkey(keyEvent('Enter')), null);
  assert.equal(matchHotkey(keyEvent('Del')), null);
});

test('dispatchKey runs a matched action and prevents the default', () => {
  const { actions, runs } = registry(['undo']);
  const event = keyEvent('z', { ctrlKey: true });
  assert.equal(dispatchKey(event, { actions, tools: null, viewportFocused: false }), true);
  assert.equal(event.prevented, true);
  assert.deepEqual(runs, ['undo']);
});

test('dispatchKey prevents the default even when the action is disabled or not registered', () => {
  const { actions, runs } = registry(['undo'], { disabled: ['undo'] });
  const disabled = keyEvent('z', { ctrlKey: true });
  assert.equal(dispatchKey(disabled, { actions, tools: null, viewportFocused: false }), true);
  assert.equal(disabled.prevented, true);
  const unregistered = keyEvent('s', { ctrlKey: true });
  assert.equal(dispatchKey(unregistered, { actions, tools: null, viewportFocused: false }), true);
  assert.equal(unregistered.prevented, true);
  assert.deepEqual(runs, []);
});

test('dispatchKey ignores unmatched keys without preventing the default', () => {
  const { actions } = registry([]);
  const event = keyEvent('q');
  assert.equal(dispatchKey(event, { actions, tools: null, viewportFocused: false }), false);
  assert.equal(event.prevented, false);
});

test('key repeat runs only repeatable actions but still prevents the default', () => {
  const { actions, runs } = registry(['undo', 'escape', 'delete'], { repeatable: ['undo'] });
  for (const event of [
    keyEvent('z', { ctrlKey: true, repeat: true }),
    keyEvent('Escape', { repeat: true }),
    keyEvent('Delete', { repeat: true }),
  ]) {
    assert.equal(dispatchKey(event, { actions, tools: null, viewportFocused: false }), true);
    assert.equal(event.prevented, true);
  }
  assert.deepEqual(runs, ['undo']);
});

test('dispatchKey ignores handled events and text fields', () => {
  const { actions, runs } = registry(['undo', 'delete']);
  const targets = [
    { tagName: 'INPUT', type: 'text' },
    { tagName: 'INPUT', type: 'number' },
    { tagName: 'INPUT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
  ];
  for (const target of targets) {
    const event = keyEvent('z', { ctrlKey: true, target });
    assert.equal(dispatchKey(event, { actions, tools: null, viewportFocused: false }), false);
    assert.equal(event.prevented, false);
  }
  const handled = keyEvent('Delete', { defaultPrevented: true });
  assert.equal(dispatchKey(handled, { actions, tools: null, viewportFocused: false }), false);
  for (const type of ['checkbox', 'radio', 'range', 'button', 'submit', 'reset']) {
    assert.equal(dispatchKey(keyEvent('Delete', { target: { tagName: 'INPUT', type } }), { actions, tools: null, viewportFocused: false }), true);
  }
  assert.deepEqual(runs, ['delete', 'delete', 'delete', 'delete', 'delete', 'delete']);
});

test('Space matches only on the page body or with the viewport focused', () => {
  const { actions, runs } = registry(['toggle-play']);
  const onButton = keyEvent(' ', { target: { tagName: 'BUTTON' } });
  assert.equal(dispatchKey(onButton, { actions, tools: null, viewportFocused: false }), false);
  assert.equal(onButton.prevented, false);
  const onBody = keyEvent(' ');
  assert.equal(dispatchKey(onBody, { actions, tools: null, viewportFocused: false }), true);
  assert.equal(onBody.prevented, true);
  const onViewport = keyEvent(' ', { target: { tagName: 'DIV' } });
  assert.equal(dispatchKey(onViewport, { actions, tools: null, viewportFocused: true }), true);
  assert.deepEqual(runs, ['toggle-play', 'toggle-play']);
});

test('tools get the key first while the viewport has focus', () => {
  const { actions, runs } = registry(['escape', 'delete']);
  const seen = [];
  const tools = {
    key(event) {
      seen.push(event.key);
      return event.key === 'Escape';
    },
  };
  const consumed = keyEvent('Escape', { target: { tagName: 'DIV' } });
  assert.equal(dispatchKey(consumed, { actions, tools, viewportFocused: true }), true);
  assert.equal(consumed.prevented, false);
  assert.equal(dispatchKey(keyEvent('Delete'), { actions, tools, viewportFocused: true }), true);
  assert.equal(dispatchKey(keyEvent('Delete'), { actions, tools, viewportFocused: false }), true);
  assert.deepEqual(seen, ['Escape', 'Delete']);
  assert.deepEqual(runs, ['delete', 'delete']);
});
