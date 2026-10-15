import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayUnit, fromDisplay, toDisplay } from '../js/units.js';

test('toDisplay converts meters, radians and multipliers', () => {
  assert.equal(toDisplay(2, 'm', 32), 64);
  assert.equal(toDisplay(Math.PI, 'rad'), 180);
  assert.equal(toDisplay(0.5, 'mult'), 50);
  assert.equal(toDisplay(7, 's'), 7);
  assert.equal(toDisplay(3, 'px/m'), 3);
});

test('fromDisplay inverts toDisplay', () => {
  for (const [value, unit] of [[1.25, 'm'], [0.3, 'rad'], [0.75, 'mult'], [9, 'kg/m²']]) {
    const back = fromDisplay(toDisplay(value, unit, 40), unit, 40);
    assert.ok(Math.abs(back - value) < 1e-12, `${unit}: ${back} !== ${value}`);
  }
});

test('meter conversions require a positive pixelsPerMeter', () => {
  assert.throws(() => toDisplay(1, 'm'), RangeError);
  assert.throws(() => fromDisplay(1, 'm', 0), RangeError);
  assert.equal(toDisplay(1, 'rad', undefined), 180 / Math.PI);
});

test('displayUnit names the UI unit', () => {
  assert.equal(displayUnit('m'), 'px');
  assert.equal(displayUnit('rad'), '°');
  assert.equal(displayUnit('mult'), '%');
  assert.equal(displayUnit('N·m'), 'N·m');
  assert.equal(displayUnit(''), '');
});
