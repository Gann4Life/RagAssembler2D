import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_BUTTONS, TOOLBAR_MARGIN, toolbarSize, toolbarColumns } from '../js/viewport/toolbar.js';
import { FRAME_MARGIN, framingInsets } from '../js/viewport/bounds.js';
import { VIEWPORT_MIN } from '../js/panels/layout.js';
import { actionTitle } from '../js/header.js';
import { TOOL_SPECS } from '../js/tools/tool.js';

const entries = TOOL_BUTTONS.flat();

test('TOOL_BUTTONS groups the TOOL_SPECS in table order', () => {
  assert.deepEqual(
    TOOL_BUTTONS.map((group) => group.map((entry) => entry.id)),
    [['select', 'select-box'], ['manipulate', 'pose'], ['circle', 'box', 'polygon'], ['hinge']],
  );
  assert.deepEqual(entries.map((entry) => entry.id), TOOL_SPECS.map((spec) => spec.id));
  assert.ok(Object.isFrozen(TOOL_BUTTONS));
  assert.ok(TOOL_BUTTONS.every((group) => Object.isFrozen(group) && group.every(Object.isFrozen)));
});

test('TOOL_BUTTONS take label and shortcut from TOOL_SPECS', () => {
  for (const entry of entries) {
    const spec = TOOL_SPECS.find((candidate) => candidate.id === entry.id);
    assert.equal(entry.label, spec.label);
    assert.equal(entry.shortcut, spec.hotkey);
  }
  assert.deepEqual(entries.map((entry) => entry.shortcut), ['V', 'B', 'M', 'P', 'C', 'R', 'N', 'H']);
});

test('TOOL_BUTTONS icons are bare SVG child markup without scripts or references', () => {
  for (const { id, icon } of entries) {
    assert.equal(typeof icon, 'string', id);
    assert.ok(icon.length > 0, id);
    assert.doesNotMatch(icon, /<svg|<script|href|url\(|<image|<use/i, id);
  }
  assert.equal(new Set(entries.map((entry) => entry.icon)).size, entries.length);
});

test('tool tooltips follow the header tooltip format', () => {
  const byId = (id) => entries.find((entry) => entry.id === id);
  assert.equal(actionTitle(byId('select'), true), 'Select (V)');
  assert.equal(actionTitle(byId('circle'), false), 'Circle (C) (not available yet)');
  assert.equal(actionTitle(byId('box'), false, 'not available in Animate mode'), 'Box (R) (not available in Animate mode)');
});

test('toolbarSize follows the DESIGN.md 5.5 metrics', () => {
  assert.deepEqual(toolbarSize(1), { width: 40, height: 299 });
  assert.deepEqual(toolbarSize(2), { width: 76, height: 149 });
  for (const columns of [0, 3, 1.5, '1', null, undefined, NaN]) {
    assert.throws(() => toolbarSize(columns), RangeError);
  }
});

test('toolbarColumns switches to two columns below the one-column height plus both margins', () => {
  assert.equal(TOOLBAR_MARGIN, 8);
  assert.equal(toolbarSize(1).height + 2 * TOOLBAR_MARGIN, 315);
  assert.equal(toolbarColumns(315), 1);
  assert.equal(toolbarColumns(314), 2);
  assert.equal(toolbarColumns(314.9), 2);
  assert.equal(toolbarColumns(168), 2);
  assert.equal(toolbarColumns(1000), 1);
  for (const height of [0, -10, NaN, Infinity, -Infinity, undefined, null]) {
    assert.equal(toolbarColumns(height), 1, String(height));
  }
});

test('the Viewport minimum height fits the two-column strip with its margins', () => {
  assert.deepEqual({ ...VIEWPORT_MIN }, { width: 240, height: 168 });
  assert.ok(VIEWPORT_MIN.height >= toolbarSize(2).height + 2 * TOOLBAR_MARGIN);
  assert.equal(toolbarColumns(VIEWPORT_MIN.height), 2);
});

test('framingInsets keeps 16 px around and adds the overlay width on the left', () => {
  assert.equal(FRAME_MARGIN, 16);
  assert.deepEqual(framingInsets(0), { top: 16, right: 16, bottom: 16, left: 16 });
  assert.deepEqual(framingInsets(), framingInsets(0));
  assert.equal(framingInsets(toolbarSize(1).width).left, 56);
  assert.equal(framingInsets(toolbarSize(2).width).left, 92);
  assert.equal(framingInsets(toolbarSize(2).width).top, 16);
});

test('framingInsets rejects a width that is not finite or is negative', () => {
  for (const width of [-1, NaN, Infinity, -Infinity, '40']) {
    assert.throws(() => framingInsets(width), RangeError, String(width));
  }
});
