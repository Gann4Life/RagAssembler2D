import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera, KEY_ZOOM_STEP, MAX_CENTER, MAX_SCALE, MIN_SCALE, wheelZoomFactor } from '../js/viewport/camera.js';

const EPSILON = 1e-9;

function near(actual, expected, message = '') {
  assert.ok(Math.abs(actual - expected) < EPSILON * Math.max(1, Math.abs(expected)), `${message} expected ${expected}, got ${actual}`);
}

function camera(width = 800, height = 600) {
  const result = new Camera();
  result.setSize(width, height);
  return result;
}

function record(target) {
  const events = [];
  target.on('camera', (payload) => events.push(payload));
  return events;
}

test('constants follow DESIGN §5.4', () => {
  assert.equal(MIN_SCALE, 2);
  assert.equal(MAX_SCALE, 10000);
  assert.equal(MAX_CENTER, 10000);
  assert.equal(KEY_ZOOM_STEP, Math.SQRT2);
});

test('worldToScreen follows the §5.4 formula with the Y flip', () => {
  const cam = camera();
  cam.panBy(-64, 32);
  near(cam.center.x, 2);
  near(cam.center.y, 1);
  const s = cam.scale;
  const p = cam.worldToScreen({ x: 3, y: 4 });
  near(p.x, (3 - 2) * s + 400);
  near(p.y, (1 - 4) * s + 300);
});

test('screenToWorld inverts worldToScreen', () => {
  const cam = camera(640, 480);
  cam.zoomAt({ x: 100, y: 50 }, 3.7);
  cam.panBy(13, -41);
  for (const point of [{ x: 0, y: 0 }, { x: -12.5, y: 7.25 }, { x: 1e3, y: -2e3 }]) {
    const back = cam.screenToWorld(cam.worldToScreen(point));
    near(back.x, point.x);
    near(back.y, point.y);
  }
});

test('panBy moves the world with the pointer', () => {
  const cam = camera();
  const before = cam.screenToWorld({ x: 200, y: 200 });
  cam.panBy(30, -20);
  const after = cam.worldToScreen(before);
  near(after.x, 230);
  near(after.y, 180);
});

test('zoomAt keeps the world point under the cursor fixed', () => {
  const cam = camera();
  const cursor = { x: 123, y: 456 };
  const world = cam.screenToWorld(cursor);
  cam.zoomAt(cursor, 2.5);
  const back = cam.worldToScreen(world);
  near(back.x, cursor.x);
  near(back.y, cursor.y);
  cam.zoomAt(cursor, 1 / 7);
  const again = cam.worldToScreen(world);
  near(again.x, cursor.x);
  near(again.y, cursor.y);
});

test('zoomAt clamps the scale and still pivots on the cursor', () => {
  const cam = camera();
  const cursor = { x: 600, y: 100 };
  const world = cam.screenToWorld(cursor);
  cam.zoomAt(cursor, 1e9);
  assert.equal(cam.scale, MAX_SCALE);
  const back = cam.worldToScreen(world);
  near(back.x, cursor.x);
  near(back.y, cursor.y);
  cam.zoomAt(cursor, 1e-12);
  assert.equal(cam.scale, MIN_SCALE);
});

test('zoomAt rejects invalid factors', () => {
  const cam = camera();
  assert.throws(() => cam.zoomAt({ x: 0, y: 0 }, 0), RangeError);
  assert.throws(() => cam.zoomAt({ x: 0, y: 0 }, -2), RangeError);
  assert.throws(() => cam.zoomAt({ x: 0, y: 0 }, Number.NaN), RangeError);
});

test('center is clamped to ±MAX_CENTER after every operation', () => {
  const cam = camera();
  cam.zoomAt({ x: 400, y: 300 }, 1e-9);
  cam.panBy(-1e9, 1e9);
  assert.deepEqual({ ...cam.center }, { x: MAX_CENTER, y: MAX_CENTER });
  cam.panBy(1e12, -1e12);
  assert.deepEqual({ ...cam.center }, { x: -MAX_CENTER, y: -MAX_CENTER });
  cam.frame({ minX: 2e4, minY: -3e4, maxX: 2e4 + 1, maxY: -3e4 + 1 });
  assert.deepEqual({ ...cam.center }, { x: MAX_CENTER, y: -MAX_CENTER });
});

test('setSize keeps center and scale', () => {
  const cam = camera();
  cam.zoomAt({ x: 10, y: 10 }, 2);
  const { center, scale } = cam;
  cam.setSize(1024, 300);
  assert.deepEqual(cam.center, center);
  assert.equal(cam.scale, scale);
  assert.equal(cam.width, 1024);
  assert.equal(cam.height, 300);
  assert.throws(() => cam.setSize(-1, 10), RangeError);
  assert.throws(() => cam.setSize(10, Number.POSITIVE_INFINITY), RangeError);
});

test('frame fits the box into the inset rectangle and centers it there', () => {
  const cam = camera(800, 600);
  const insets = { top: 16, right: 16, bottom: 16, left: 72 };
  cam.frame({ minX: -1, minY: 0, maxX: 3, maxY: 1 }, insets);
  near(cam.scale, Math.min(712 / 4, 568 / 1));
  const topLeft = cam.worldToScreen({ x: -1, y: 1 });
  const bottomRight = cam.worldToScreen({ x: 3, y: 0 });
  near(topLeft.x, 72);
  near(bottomRight.x, 784);
  near((topLeft.y + bottomRight.y) / 2, 16 + 568 / 2);
});

test('frame uses a 1 px rectangle when insets exceed the viewport and clamps the scale', () => {
  const cam = camera(100, 100);
  cam.frame({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { top: 80, right: 80, bottom: 80, left: 80 });
  assert.equal(cam.scale, MIN_SCALE);
  const center = cam.worldToScreen({ x: 0.5, y: 0.5 });
  near(center.x, 80.5);
  near(center.y, 80.5);
  cam.frame({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
  assert.equal(cam.scale, MAX_SCALE);
  near(cam.center.x, 5);
  assert.throws(() => cam.frame({ minX: 1, minY: 0, maxX: 0, maxY: 1 }), RangeError);
});

test('visibleBounds covers the viewport', () => {
  const cam = camera(400, 200);
  cam.frame({ minX: -2, minY: -1, maxX: 2, maxY: 1 });
  const box = cam.visibleBounds();
  near(box.minX, -2);
  near(box.maxX, 2);
  near(box.minY, -1);
  near(box.maxY, 1);
});

test('camera emits one event per change and none for no-ops', () => {
  const cam = new Camera();
  const events = record(cam);
  cam.setSize(800, 600);
  cam.setSize(800, 600);
  cam.panBy(0, 0);
  cam.panBy(10, 0);
  cam.zoomAt({ x: 0, y: 0 }, 1);
  cam.zoomAt({ x: 5, y: 5 }, 2);
  assert.equal(events.length, 3);
  const last = events.at(-1);
  assert.deepEqual(Object.keys(last), ['center', 'scale', 'width', 'height']);
  assert.equal(last.scale, cam.scale);
  assert.deepEqual(last.center, cam.center);
  assert.ok(Object.isFrozen(last) && Object.isFrozen(last.center));
  cam.zoomAt({ x: 5, y: 5 }, 1e9);
  cam.zoomAt({ x: 5, y: 5 }, 2);
  assert.equal(events.length, 4);
});

test('wheelZoomFactor follows §5.4 rates and delta modes', () => {
  near(wheelZoomFactor(-400, 0, false, 600), 2);
  near(wheelZoomFactor(100, 0, true, 600), 0.5);
  near(wheelZoomFactor(25, 1, false, 600), 0.5);
  near(wheelZoomFactor(-1, 2, false, 400), 2);
  assert.equal(wheelZoomFactor(0, 0, false, 600), 1);
});
