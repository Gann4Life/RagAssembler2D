import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../js/viewport/camera.js';
import { gridLevels, gridLines } from '../js/viewport/grid-lines.js';

const EPSILON = 1e-9;

function near(actual, expected, message = '') {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message} expected ${expected}, got ${actual}`);
}

function cameraAt(scale, width = 400, height = 300) {
  const camera = new Camera();
  camera.setSize(width, height);
  camera.zoomAt({ x: width / 2, y: height / 2 }, scale / camera.scale);
  return camera;
}

test('the minor level is fine when its lines are at least 8 px apart', () => {
  const levels = gridLevels(320, 1, 10);
  near(levels.fine.spacing, 0.1);
  assert.equal(levels.fine.alpha, 1);
  assert.equal(levels.coarse.spacing, 1);
});

test('fine opacity ramps from 0 at 8 px to 1 at 32 px', () => {
  near(gridLevels(80, 1, 10).fine.alpha, 0);
  near(gridLevels(200, 1, 10).fine.alpha, 0.5);
  near(gridLevels(320, 1, 10).fine.alpha, 1);
});

test('zooming out turns 1 m lines into the fine level under 10 m lines', () => {
  const levels = gridLevels(20, 1, 10);
  assert.equal(levels.fine.spacing, 1);
  near(levels.fine.alpha, 0.5);
  assert.equal(levels.coarse.spacing, 10);
  const far = gridLevels(2, 1, 10);
  assert.equal(far.fine.spacing, 10);
  assert.equal(far.coarse.spacing, 100);
});

test('equal spacings are counted once', () => {
  const levels = gridLevels(100, 2, 1);
  assert.equal(levels.fine.spacing, 2);
  assert.equal(levels.coarse.spacing, 20);
});

test('gridLevels rejects invalid arguments', () => {
  assert.throws(() => gridLevels(0, 1, 10), RangeError);
  assert.throws(() => gridLevels(10, 0, 10), RangeError);
  assert.throws(() => gridLevels(10, 1, 0), RangeError);
  assert.throws(() => gridLevels(10, 1, 1.5), RangeError);
});

test('gridLines lists visible lines in screen px without duplicating coarse lines', () => {
  const camera = cameraAt(100, 400, 300);
  const { lines, axes } = gridLines(camera, { size: 1, subdivisions: 10 });
  const vertical = lines.filter((line) => line.orientation === 'vertical');
  const coarse = vertical.filter((line) => line.level === 'coarse');
  const fine = vertical.filter((line) => line.level === 'fine');
  assert.deepEqual(coarse.map((line) => line.world), [-2, -1, 0, 1, 2]);
  assert.equal(fine.length, 41 - 5);
  assert.ok(fine.every((line) => Math.abs(line.world - Math.round(line.world)) > EPSILON));
  near(fine[0].alpha, (10 - 8) / 24);
  assert.ok(coarse.every((line) => line.alpha === 1));
  for (const line of lines) {
    const expected =
      line.orientation === 'vertical'
        ? camera.worldToScreen({ x: line.world, y: 0 }).x
        : camera.worldToScreen({ x: 0, y: line.world }).y;
    near(line.screen, expected);
  }
  near(axes.vertical, 200);
  near(axes.horizontal, 150);
});

test('gridLines reports axes outside the view as null and never yields -0', () => {
  const camera = cameraAt(100, 400, 300);
  camera.panBy(-1000, 1000);
  const { lines, axes } = gridLines(camera, { size: 1, subdivisions: 10 });
  assert.equal(axes.vertical, null);
  assert.equal(axes.horizontal, null);
  assert.ok(lines.every((line) => !Object.is(line.world, -0)));
});

test('fine lines with zero opacity are left out', () => {
  const camera = cameraAt(80, 400, 300);
  const { lines } = gridLines(camera, { size: 1, subdivisions: 10 });
  assert.ok(lines.every((line) => line.level === 'coarse'));
});
