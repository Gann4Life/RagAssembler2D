import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Settings } from '../js/settings.js';
import { ANGLE_SNAP, snapAngle, snapLength, snapPoint } from '../js/viewport/snap.js';

function settingsWith(values) {
  const settings = new Settings();
  for (const [key, value] of Object.entries(values)) settings.set(key, value);
  return settings;
}

test('ANGLE_SNAP is 15°', () => {
  assert.equal(ANGLE_SNAP, Math.PI / 12);
});

test('snapPoint leaves points alone when snapping is off', () => {
  const settings = new Settings();
  assert.deepEqual(snapPoint({ x: 0.123, y: -4.56 }, settings), { x: 0.123, y: -4.56 });
  assert.ok(Object.is(snapPoint({ x: -0, y: -0 }, settings).x, 0));
});

test('snapPoint rounds to the minor spacing in world coordinates', () => {
  const settings = settingsWith({ 'snap.grid': true });
  assert.deepEqual(snapPoint({ x: 0.26, y: -1.04 }, settings), { x: 0.3, y: -1 });
  settings.set('grid.size', 0.5);
  settings.set('grid.subdivisions', 4);
  assert.deepEqual(snapPoint({ x: 0.3, y: 0.06 }, settings), { x: 0.25, y: 0 });
});

test('snapPoint never returns -0', () => {
  const settings = settingsWith({ 'snap.grid': true });
  const p = snapPoint({ x: -0.04, y: -0.0001 }, settings);
  assert.ok(Object.is(p.x, 0));
  assert.ok(Object.is(p.y, 0));
});

test('snapLength rounds to the minor spacing and never below it', () => {
  const settings = settingsWith({ 'snap.grid': true });
  assert.equal(snapLength(0.26, settings), 0.3);
  assert.equal(snapLength(0.01, settings), 0.1);
  assert.equal(snapLength(0, settings), 0.1);
  settings.set('snap.grid', false);
  assert.equal(snapLength(0.01, settings), 0.01);
});

test('snapAngle rounds to 15° only while SHIFT is held', () => {
  assert.equal(snapAngle(0.3, false), 0.3);
  assert.equal(snapAngle(0.3, true), Math.PI / 12);
  assert.equal(snapAngle(Math.PI / 2 + 0.1, true), Math.PI / 2);
  assert.equal(snapAngle(-Math.PI / 4 - 0.05, true), -Math.PI / 4);
  assert.ok(Object.is(snapAngle(-0.01, true), 0));
  assert.ok(Object.is(snapAngle(-0, false), 0));
});
