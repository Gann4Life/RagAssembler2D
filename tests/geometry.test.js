import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyMass,
  composeTransforms,
  invertTransform,
  pointInShape,
  shapeBounds,
  shapeGeometryValid,
  shapeMass,
  transformPoint,
} from '../lib/geometry.js';

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

test('invertTransform undoes a transform', () => {
  const t = { x: 2, y: -3, angle: 0.9 };
  const inverse = invertTransform(t);
  near(inverse.angle, -0.9);
  const point = { x: 0.4, y: 1.7 };
  const back = transformPoint(inverse, transformPoint(t, point));
  near(back.x, point.x);
  near(back.y, point.y);
  const identity = composeTransforms(t, inverse);
  near(identity.x, 0);
  near(identity.y, 0);
  near(identity.angle, 0);
  assert.ok(Object.is(invertTransform(IDENTITY).x, 0));
});

test('pointInShape tests circles under the body transform with a tolerance', () => {
  const circle = { type: 'circle', center: [1, 0], radius: 0.5 };
  const body = { x: 0, y: 2, angle: Math.PI / 2 };
  assert.equal(pointInShape(circle, body, { x: 0, y: 3 }), true);
  assert.equal(pointInShape(circle, body, { x: 0, y: 3.6 }), false);
  assert.equal(pointInShape(circle, body, { x: 0, y: 3.6 }, 0.11), true);
  assert.equal(pointInShape(circle, body, { x: 1, y: 2 }), false);
});

test('pointInShape tests rotated boxes, with the tolerance measured from the edges', () => {
  const box = { type: 'box', center: [0, 0], width: 2, height: 1, angle: Math.PI / 2 };
  assert.equal(pointInShape(box, IDENTITY, { x: 0, y: 0.9 }), true);
  assert.equal(pointInShape(box, IDENTITY, { x: 0.9, y: 0 }), false);
  assert.equal(pointInShape(box, IDENTITY, { x: 0.55, y: 0 }, 0.1), true);
  assert.equal(pointInShape(box, IDENTITY, { x: 0.55, y: 1.05 }, 0.06), false);
  assert.equal(pointInShape(box, IDENTITY, { x: 0.53, y: 1.03 }, 0.06), true);
  assert.equal(pointInShape(box, { x: 5, y: 0, angle: 0 }, { x: 5.9, y: 0 }), false);
  assert.equal(pointInShape(box, { x: 5, y: 0, angle: Math.PI / 2 }, { x: 5.9, y: 0 }), true);
});

test('pointInShape tests polygons, concave drafts included', () => {
  const triangle = { type: 'polygon', vertices: [[0, 0], [2, 0], [0, 2]] };
  assert.equal(pointInShape(triangle, IDENTITY, { x: 0.5, y: 0.5 }), true);
  assert.equal(pointInShape(triangle, IDENTITY, { x: 1.2, y: 1.2 }), false);
  assert.equal(pointInShape(triangle, IDENTITY, { x: 1.2, y: 1.2 }, 0.3), true);
  assert.equal(pointInShape(triangle, { x: 10, y: 0, angle: 0 }, { x: 10.5, y: 0.5 }), true);
  const notch = { type: 'polygon', vertices: [[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]] };
  assert.equal(pointInShape(notch, IDENTITY, { x: 2, y: 3 }), false);
  assert.equal(pointInShape(notch, IDENTITY, { x: 1, y: 1.5 }), true);
});

test('pointInShape returns false for invalid geometry and never throws', () => {
  const p = { x: 0, y: 0 };
  for (const shape of [
    null,
    undefined,
    {},
    { type: 'capsule' },
    { type: 'circle', center: [0, 0], radius: 0 },
    { type: 'circle', center: [0, 0], radius: -1 },
    { type: 'circle', center: [0, Number.NaN], radius: 1 },
    { type: 'box', center: [0, 0], width: 0, height: 1, angle: 0 },
    { type: 'box', center: [0, 0], width: 1, height: -1, angle: 0 },
    { type: 'box', center: [0, 0], width: 1, height: 1 },
    { type: 'polygon', vertices: [[-1, -1], [1, -1]] },
    { type: 'polygon', vertices: [[-1, -1], [1, -1], [0, 'x']] },
    { type: 'polygon' },
  ]) {
    assert.equal(pointInShape(shape, IDENTITY, p, 10), false, JSON.stringify(shape));
  }
  const circle = { type: 'circle', center: [0, 0], radius: 1 };
  assert.equal(pointInShape(circle, { x: Number.NaN, y: 0, angle: 0 }, p), false);
  assert.equal(pointInShape(circle, IDENTITY, { x: Number.POSITIVE_INFINITY, y: 0 }), false);
  assert.equal(pointInShape(circle, IDENTITY, p, Number.NaN), true);
});

const INVALID_SHAPES = [
  null,
  undefined,
  {},
  'circle',
  { type: 'capsule' },
  { type: 'circle', center: [0, 0], radius: 0 },
  { type: 'circle', center: [0, 0], radius: -1 },
  { type: 'circle', center: [0, Number.NaN], radius: 1 },
  { type: 'circle', center: [0, 0], radius: Number.POSITIVE_INFINITY },
  { type: 'box', center: [0, 0], width: 0, height: 1, angle: 0 },
  { type: 'box', center: [0, 0], width: 1, height: -1, angle: 0 },
  { type: 'box', center: [0, 0], width: 1, height: 1 },
  { type: 'box', center: [0, 0], width: 1, height: 1, angle: Number.NaN },
  { type: 'polygon', vertices: [[-1, -1], [1, -1]] },
  { type: 'polygon', vertices: [[-1, -1], [1, -1], [0, 'x']] },
  { type: 'polygon', vertices: [] },
  { type: 'polygon' },
];

const VALID_SHAPES = [
  { type: 'circle', center: [0, 0], radius: 1 },
  { type: 'box', center: [1, 0], width: 2, height: 1, angle: 0.3 },
  { type: 'polygon', vertices: [[0, 0], [2, 0], [0, 2]] },
  { type: 'polygon', vertices: [[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]] },
  { type: 'polygon', vertices: [[0, 0], [1, 1], [1, 0], [0, 1]] },
];

test('shapeGeometryValid rejects invalid geometry and accepts convex and concave shapes', () => {
  for (const shape of INVALID_SHAPES) assert.equal(shapeGeometryValid(shape), false, JSON.stringify(shape));
  for (const shape of VALID_SHAPES) assert.equal(shapeGeometryValid(shape), true, JSON.stringify(shape));
});

test('pointInShape rejects exactly the shapes shapeGeometryValid rejects', () => {
  for (const shape of INVALID_SHAPES) assert.equal(pointInShape(shape, IDENTITY, { x: 0, y: 0 }, 100), false, JSON.stringify(shape));
  for (const shape of VALID_SHAPES) assert.equal(pointInShape(shape, IDENTITY, { x: 0, y: 0 }, 100), true, JSON.stringify(shape));
});

test('shapeMass is area × density at the shape center or centroid', () => {
  const circle = shapeMass({ type: 'circle', center: [1, 2], radius: 0.5 }, 2);
  near(circle.mass, Math.PI * 0.5);
  assert.deepEqual(circle.center, { x: 1, y: 2 });
  const box = shapeMass({ type: 'box', center: [-1, 0], width: 2, height: 3, angle: 0.4 }, 0.5);
  near(box.mass, 3);
  assert.deepEqual(box.center, { x: -1, y: 0 });
  const triangle = shapeMass({ type: 'polygon', vertices: [[0, 0], [3, 0], [0, 3]] }, 1);
  near(triangle.mass, 4.5);
  near(triangle.center.x, 1);
  near(triangle.center.y, 1);
  const clockwise = shapeMass({ type: 'polygon', vertices: [[0, 3], [3, 0], [0, 0]] }, 1);
  near(clockwise.mass, 4.5);
  near(clockwise.center.x, 1);
  near(clockwise.center.y, 1);
});

test('shapeMass gives no mass for invalid geometry or density', () => {
  const none = { mass: 0, center: null };
  assert.deepEqual(shapeMass({ type: 'circle', center: [0, 0], radius: 0 }, 1), none);
  assert.deepEqual(shapeMass({ type: 'polygon', vertices: [[0, 0], [1, 1], [2, 2]] }, 1), none);
  assert.deepEqual(shapeMass({ type: 'capsule' }, 1), none);
  assert.deepEqual(shapeMass({ type: 'circle', center: [0, 0], radius: 1 }, -1), none);
  assert.deepEqual(shapeMass({ type: 'circle', center: [0, 0], radius: 1 }, Number.NaN), none);
  assert.equal(shapeMass({ type: 'circle', center: [0, 0], radius: 1 }, 0).mass, 0);
});

test('bodyMass weights the shape centers by mass, sensors included, and has no center without mass', () => {
  const result = bodyMass([
    { shape: { type: 'box', center: [0, 0], width: 1, height: 1, angle: 0 }, density: 1, isSensor: false },
    { shape: { type: 'box', center: [3, 0], width: 1, height: 1, angle: 0 }, density: 2, isSensor: true },
    { shape: { type: 'circle', center: [9, 9], radius: 0 }, density: 5 },
  ]);
  near(result.mass, 3);
  near(result.center.x, 2);
  near(result.center.y, 0);
  assert.deepEqual(bodyMass([]), { mass: 0, center: null });
  assert.deepEqual(
    bodyMass([{ shape: { type: 'circle', center: [1, 1], radius: 1 }, density: 0 }]),
    { mass: 0, center: null },
  );
});
