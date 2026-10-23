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
  let second = 0;
  for (let index = 1; index < points.length - 1; index++) {
    const e1x = points[index].x - origin.x;
    const e1y = points[index].y - origin.y;
    const e2x = points[index + 1].x - origin.x;
    const e2y = points[index + 1].y - origin.y;
    const cross = e1x * e2y - e1y * e2x;
    const triangle = cross / 2;
    area += triangle;
    cx += (triangle * (e1x + e2x)) / 3;
    cy += (triangle * (e1y + e2y)) / 3;
    const intX2 = e1x * e1x + e2x * e1x + e2x * e2x;
    const intY2 = e1y * e1y + e2y * e1y + e2y * e2y;
    second += (cross / 12) * (intX2 + intY2);
  }
  if (area === 0) return null;
  const offsetX = cx / area;
  const offsetY = cy / area;
  const polar = Math.abs(second - area * (offsetX * offsetX + offsetY * offsetY));
  return { area: Math.abs(area), center: { x: origin.x + offsetX, y: origin.y + offsetY }, polar };
}

function areaOf(shape) {
  switch (shape?.type) {
    case 'circle': {
      if (!validCircle(shape)) return null;
      const area = Math.PI * shape.radius * shape.radius;
      return { area, center: vec(shape.center), polar: (area * shape.radius * shape.radius) / 2 };
    }
    case 'box': {
      if (!validBox(shape)) return null;
      const area = shape.width * shape.height;
      return { area, center: vec(shape.center), polar: (area * (shape.width ** 2 + shape.height ** 2)) / 12 };
    }
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

/**
 * Mass, center of mass and rotational inertia of a body from its fixtures, as Box2D computes them (sensors
 * included): `bodyMass` plus each shape's inertia about its own center, moved to the body's center by the
 * parallel-axis rule. Never throws.
 * @param {Iterable<{ shape: object, density: number }>} fixtures Fixture records, body-local.
 * @returns {{ mass: number, center: Vec2|null, inertia: number }} Mass in kg; center body-local, meters, `null`
 *   when the mass is 0; inertia about the center in kg·m², 0 when the mass is 0.
 */
export function bodyMassData(fixtures) {
  const parts = [];
  try {
    for (const fixture of fixtures) {
      const data = areaOf(fixture?.shape);
      const density = fixture?.density;
      if (!data || !isFiniteNumber(density) || density <= 0) continue;
      parts.push({ mass: data.area * density, center: data.center, inertia: data.polar * density });
    }
  } catch {
    return { mass: 0, center: null, inertia: 0 };
  }
  const mass = parts.reduce((total, part) => total + part.mass, 0);
  if (!(mass > 0) || !Number.isFinite(mass)) return { mass: 0, center: null, inertia: 0 };
  const center = {
    x: parts.reduce((total, part) => total + part.mass * part.center.x, 0) / mass,
    y: parts.reduce((total, part) => total + part.mass * part.center.y, 0) / mass,
  };
  const inertia = parts.reduce(
    (total, part) => total + part.inertia + part.mass * ((part.center.x - center.x) ** 2 + (part.center.y - center.y) ** 2),
    0,
  );
  return { mass, center, inertia };
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

/**
 * Area centroid of a polygon as given, by the shoelace formula, for either winding; the average of the
 * vertices when the signed area is 0. Pure; never yields `-0`.
 * @param {ReadonlyArray<ReadonlyArray<number>>} vertices At least one `[x, y]` pair of finite numbers, meters.
 * @returns {Vec2} Centroid, in the vertices' frame, meters.
 */
export function polygonCentroid(vertices) {
  const points = vertices.map(vec);
  const origin = points[0];
  let doubleArea = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < points.length; index++) {
    const ax = points[index].x - origin.x;
    const ay = points[index].y - origin.y;
    const next = points[(index + 1) % points.length];
    const bx = next.x - origin.x;
    const by = next.y - origin.y;
    const cross = ax * by - bx * ay;
    doubleArea += cross;
    cx += (ax + bx) * cross;
    cy += (ay + by) * cross;
  }
  if (doubleArea === 0) {
    const sumX = points.reduce((total, point) => total + point.x, 0);
    const sumY = points.reduce((total, point) => total + point.y, 0);
    return { x: sumX / points.length + 0, y: sumY / points.length + 0 };
  }
  return { x: origin.x + cx / (3 * doubleArea) + 0, y: origin.y + cy / (3 * doubleArea) + 0 };
}

const MIN_VERTEX_DISTANCE = 0.0025;
const COLLINEAR_CROSS = 1e-9;
const FULL_TURN_TOLERANCE = 1e-6;

/**
 * First failing check of a polygon's vertex list, in the order count, degenerate, notCcw, notConvex:
 * 3 to 8 vertices; no two closer than 0.0025 m and no three consecutive collinear (cross product within
 * 1e-9 m²); counter-clockwise; convex and turning once around (a star turns more). Never throws; a
 * non-array or an item that is not a pair of finite numbers gives `'count'`.
 * @param {*} vertices Polygon vertices, body-local meters, as `[x, y]` pairs.
 * @returns {'count'|'degenerate'|'notCcw'|'notConvex'|null} The failing check, or `null` for a valid polygon.
 */
export function polygonProblems(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3 || vertices.length > 8 || !vertices.every(isVec2)) return 'count';
  const points = vertices.map(vec);
  const size = points.length;
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < MIN_VERTEX_DISTANCE) return 'degenerate';
    }
  }
  const turns = points.map((point, i) => {
    const previous = points[(i + size - 1) % size];
    const next = points[(i + 1) % size];
    const inX = point.x - previous.x;
    const inY = point.y - previous.y;
    const outX = next.x - point.x;
    const outY = next.y - point.y;
    return { cross: inX * outY - inY * outX, dot: inX * outX + inY * outY };
  });
  if (turns.some(({ cross }) => Math.abs(cross) <= COLLINEAR_CROSS)) return 'degenerate';
  let area = 0;
  for (let i = 0; i < size; i++) {
    const next = points[(i + 1) % size];
    area += points[i].x * next.y - next.x * points[i].y;
  }
  if (area < 0) return 'notCcw';
  if (turns.some(({ cross }) => cross < 0)) return 'notConvex';
  const totalTurn = turns.reduce((sum, { cross, dot }) => sum + Math.atan2(cross, dot), 0);
  return Math.abs(totalTurn - 2 * Math.PI) > FULL_TURN_TOLERANCE ? 'notConvex' : null;
}
