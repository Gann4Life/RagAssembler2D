/**
 * @typedef {object} Vec2
 * @property {number} x Meters.
 * @property {number} y Meters, Y up.
 */

/**
 * @typedef {object} Transform
 * @property {number} x Translation, meters.
 * @property {number} y Translation, meters, Y up.
 * @property {number} angle Rotation, radians, counter-clockwise.
 */

/**
 * @typedef {object} Aabb
 * @property {number} minX Meters.
 * @property {number} minY Meters.
 * @property {number} maxX Meters.
 * @property {number} maxY Meters.
 */

/**
 * Maps a point from a transform's local frame to its parent frame: rotates, then translates.
 * @param {Transform} t Local frame in parent coordinates.
 * @param {Vec2} p Point in the local frame, meters.
 * @returns {Vec2} Point in the parent frame, meters.
 */
export function transformPoint(t, p) {
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  return { x: t.x + p.x * cos - p.y * sin, y: t.y + p.x * sin + p.y * cos };
}

/**
 * Composes two transforms: the result maps `child`-local points straight to `parent`'s parent frame.
 * @param {Transform} parent Parent frame.
 * @param {Transform} child Child frame, in `parent` coordinates.
 * @returns {Transform} Child frame in the coordinates of `parent`'s parent.
 */
export function composeTransforms(parent, child) {
  const { x, y } = transformPoint(parent, child);
  return { x, y, angle: parent.angle + child.angle };
}

/**
 * Inverse of a transform: maps points of the parent frame back to the local frame.
 * @param {Transform} t Local frame in parent coordinates.
 * @returns {Transform} Parent frame in local coordinates.
 */
export function invertTransform(t) {
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  return { x: -(t.x * cos + t.y * sin) + 0, y: t.x * sin - t.y * cos + 0, angle: -t.angle + 0 };
}

function vec([x, y]) {
  return { x, y };
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVec2(value) {
  return Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);
}

function isFiniteTransform(t) {
  return Boolean(t) && isFiniteNumber(t.x) && isFiniteNumber(t.y) && isFiniteNumber(t.angle);
}

function validCircle(shape) {
  return isVec2(shape.center) && isFiniteNumber(shape.radius) && shape.radius > 0;
}

function validBox(shape) {
  return (
    isVec2(shape.center) &&
    isFiniteNumber(shape.angle) &&
    isFiniteNumber(shape.width) &&
    isFiniteNumber(shape.height) &&
    shape.width > 0 &&
    shape.height > 0
  );
}

function validPolygon(shape) {
  return Array.isArray(shape.vertices) && shape.vertices.length >= 3 && shape.vertices.every(isVec2);
}

function segmentDistance(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  const along = lengthSquared > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared)) : 0;
  return Math.hypot(p.x - (a.x + abx * along), p.y - (a.y + aby * along));
}

function insidePolygon(p, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Whether a shape record has usable geometry: a known type, finite numbers, a positive radius, width and
 * height, and at least 3 polygon vertices. Concave and self-intersecting polygons are valid. Never throws.
 * @param {object} shape The fixture's `shape` record, body-local meters and radians.
 * @returns {boolean}
 */
export function shapeGeometryValid(shape) {
  if (!shape || typeof shape !== 'object') return false;
  switch (shape.type) {
    case 'circle':
      return validCircle(shape);
    case 'box':
      return validBox(shape);
    case 'polygon':
      return validPolygon(shape);
    default:
      return false;
  }
}

/**
 * Whether a point lies inside a shape or within `tolerance` of it. Shapes failing `shapeGeometryValid`
 * give `false`. Never throws.
 * @param {object} shape The fixture's `shape` record, body-local meters and radians.
 * @param {Transform} t Body frame in the point's coordinates.
 * @param {Vec2} p Point, meters.
 * @param {number} [tolerance] Distance from the shape that still counts, meters, at least 0.
 * @returns {boolean}
 */
export function pointInShape(shape, t, p, tolerance = 0) {
  if (!shapeGeometryValid(shape) || !isFiniteTransform(t) || !p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
    return false;
  }
  const slack = isFiniteNumber(tolerance) && tolerance > 0 ? tolerance : 0;
  const local = transformPoint(invertTransform(t), p);
  switch (shape.type) {
    case 'circle':
      return Math.hypot(local.x - shape.center[0], local.y - shape.center[1]) <= shape.radius + slack;
    case 'box': {
      const inBox = transformPoint(invertTransform({ x: shape.center[0], y: shape.center[1], angle: shape.angle }), local);
      const dx = Math.max(Math.abs(inBox.x) - shape.width / 2, 0);
      const dy = Math.max(Math.abs(inBox.y) - shape.height / 2, 0);
      return Math.hypot(dx, dy) <= slack;
    }
    case 'polygon': {
      const points = shape.vertices.map(vec);
      if (insidePolygon(local, points)) return true;
      return points.some((a, index) => segmentDistance(local, a, points[(index + 1) % points.length]) <= slack);
    }
    default:
      return false;
  }
}

function polygonMassData(points) {
  const origin = points[0];
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 1; index < points.length - 1; index++) {
    const e1x = points[index].x - origin.x;
    const e1y = points[index].y - origin.y;
    const e2x = points[index + 1].x - origin.x;
    const e2y = points[index + 1].y - origin.y;
    const triangle = (e1x * e2y - e1y * e2x) / 2;
    area += triangle;
    cx += (triangle * (e1x + e2x)) / 3;
    cy += (triangle * (e1y + e2y)) / 3;
  }
  if (area === 0) return null;
  return { area: Math.abs(area), center: { x: origin.x + cx / area, y: origin.y + cy / area } };
}

function areaOf(shape) {
  switch (shape?.type) {
    case 'circle':
      return validCircle(shape) ? { area: Math.PI * shape.radius * shape.radius, center: vec(shape.center) } : null;
    case 'box':
      return validBox(shape) ? { area: shape.width * shape.height, center: vec(shape.center) } : null;
    case 'polygon':
      return validPolygon(shape) ? polygonMassData(shape.vertices.map(vec)) : null;
    default:
      return null;
  }
}

/**
 * Mass and center of mass of one shape, as Box2D computes them: area × density, centered on the circle or
 * box center or the polygon centroid. Invalid geometry, or a density that is negative or not finite, gives
 * mass 0 and center `null`.
 * @param {object} shape The fixture's `shape` record, body-local meters.
 * @param {number} density kg/m².
 * @returns {{ mass: number, center: Vec2|null }} Mass in kg; center body-local, meters.
 */
export function shapeMass(shape, density) {
  const data = areaOf(shape);
  if (!data || !isFiniteNumber(density) || density < 0) return { mass: 0, center: null };
  return { mass: data.area * density, center: data.center };
}

/**
 * Mass and center of mass of a body from its fixtures, as Box2D computes them (sensors included).
 * @param {Iterable<{ shape: object, density: number }>} fixtures Fixture records, body-local.
 * @returns {{ mass: number, center: Vec2|null }} Mass in kg; center body-local, meters, `null` when the mass is 0.
 */
export function bodyMass(fixtures) {
  let mass = 0;
  let x = 0;
  let y = 0;
  for (const fixture of fixtures) {
    const part = shapeMass(fixture?.shape, fixture?.density);
    if (part.mass <= 0) continue;
    mass += part.mass;
    x += part.mass * part.center.x;
    y += part.mass * part.center.y;
  }
  return mass > 0 ? { mass, center: { x: x / mass, y: y / mass } } : { mass: 0, center: null };
}

function localPoints(shape) {
  switch (shape?.type) {
    case 'box': {
      const frame = { x: shape.center[0], y: shape.center[1], angle: shape.angle };
      const halfW = shape.width / 2;
      const halfH = shape.height / 2;
      return [
        { x: -halfW, y: -halfH },
        { x: halfW, y: -halfH },
        { x: halfW, y: halfH },
        { x: -halfW, y: halfH },
      ].map((corner) => transformPoint(frame, corner));
    }
    case 'polygon':
      if (!Array.isArray(shape.vertices) || shape.vertices.length === 0) {
        throw new TypeError('A polygon needs at least one vertex to have bounds');
      }
      return shape.vertices.map(vec);
    default:
      throw new TypeError(`Unknown shape type "${shape?.type}"`);
  }
}

/**
 * Axis-aligned bounds of a shape record under a transform.
 * @param {object} shape The fixture's `shape` record (`circle`, `box` or `polygon`), body-local meters and radians.
 * @param {Transform} t Body frame in the target coordinates.
 * @returns {Aabb} Bounds in the target coordinates, meters.
 * @throws {TypeError} When the shape type is unknown or a polygon has no vertices.
 */
export function shapeBounds(shape, t) {
  if (shape?.type === 'circle') {
    const center = transformPoint(t, vec(shape.center));
    const radius = Math.abs(shape.radius);
    return { minX: center.x - radius, minY: center.y - radius, maxX: center.x + radius, maxY: center.y + radius };
  }
  const points = localPoints(shape).map((point) => transformPoint(t, point));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
