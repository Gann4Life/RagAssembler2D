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

function vec([x, y]) {
  return { x, y };
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
