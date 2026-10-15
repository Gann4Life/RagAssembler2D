import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeTransforms, shapeBounds, transformPoint } from '../lib/geometry.js';

const EPSILON = 1e-9;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message ?? ''} expected ${expected}, got ${actual}`);
}

function nearBox(actual, expected) {
  for (const key of ['minX', 'minY', 'maxX', 'maxY']) near(actual[key], expected[key], key);
}

const IDENTITY = { x: 0, y: 0, angle: 0 };

test('transformPoint rotates counter-clockwise then translates', () => {
  const p = transformPoint({ x: 1, y: 2, angle: Math.PI / 2 }, { x: 1, y: 0 });
  near(p.x, 1);
  near(p.y, 3);
});

test('composeTransforms equals applying the child then the parent', () => {
  const parent = { x: 2, y: -1, angle: 0.7 };
  const child = { x: -0.5, y: 1.5, angle: -1.2 };
  const composed = composeTransforms(parent, child);
  near(composed.angle, -0.5);
  const point = { x: 0.3, y: -0.8 };
  const direct = transformPoint(composed, point);
  const stepwise = transformPoint(parent, transformPoint(child, point));
  near(direct.x, stepwise.x);
  near(direct.y, stepwise.y);
});

test('shapeBounds of a circle is its center ± radius under the transform', () => {
  const box = shapeBounds({ type: 'circle', center: [1, 0], radius: 0.25 }, { x: 0, y: 0, angle: Math.PI / 2 });
  nearBox(box, { minX: -0.25, minY: 0.75, maxX: 0.25, maxY: 1.25 });
});

test('shapeBounds of a rotated box covers its corners', () => {
  const box = shapeBounds({ type: 'box', center: [0, 0], width: 2, height: 2, angle: Math.PI / 4 }, IDENTITY);
  nearBox(box, { minX: -Math.SQRT2, minY: -Math.SQRT2, maxX: Math.SQRT2, maxY: Math.SQRT2 });
  const moved = shapeBounds({ type: 'box', center: [1, 0], width: 2, height: 1, angle: 0 }, { x: 0, y: 3, angle: 0 });
  nearBox(moved, { minX: 0, minY: 2.5, maxX: 2, maxY: 3.5 });
});

test('shapeBounds of a polygon covers its vertices', () => {
  const box = shapeBounds({ type: 'polygon', vertices: [[0, 0], [2, 0], [1, 1]] }, { x: 1, y: 1, angle: 0 });
  nearBox(box, { minX: 1, minY: 1, maxX: 3, maxY: 2 });
});

test('shapeBounds throws on unknown types and empty polygons', () => {
  assert.throws(() => shapeBounds({ type: 'capsule' }, IDENTITY), TypeError);
  assert.throws(() => shapeBounds({ type: 'polygon', vertices: [] }, IDENTITY), TypeError);
});
