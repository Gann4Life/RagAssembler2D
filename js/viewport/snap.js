/** Angle snap step while SHIFT is held: 15°, in radians. */
export const ANGLE_SNAP = Math.PI / 12;

function roundToStep(value, settings) {
  const size = settings.get('grid.size');
  const subdivisions = settings.get('grid.subdivisions');
  return (Math.round((value * subdivisions) / size) * size) / subdivisions + 0;
}

/**
 * Rounds a world point to the nearest multiple of the minor grid spacing when `snap.grid` is on.
 * @param {{ x: number, y: number }} p World point, meters.
 * @param {{ get(key: string): * }} settings Editor settings.
 * @returns {{ x: number, y: number }} Snapped point (a copy of `p` when snapping is off), never `-0`.
 */
export function snapPoint(p, settings) {
  if (!settings.get('snap.grid')) return { x: p.x + 0, y: p.y + 0 };
  return { x: roundToStep(p.x, settings), y: roundToStep(p.y, settings) };
}

/**
 * Rounds a length (a circle radius) to the minor grid spacing, never below it, when `snap.grid` is on.
 * @param {number} length Meters.
 * @param {{ get(key: string): * }} settings Editor settings.
 * @returns {number} Snapped length (`length` when snapping is off), never `-0`.
 */
export function snapLength(length, settings) {
  if (!settings.get('snap.grid')) return length + 0;
  const step = settings.get('grid.size') / settings.get('grid.subdivisions');
  return Math.max(step, roundToStep(length, settings));
}

/**
 * Rounds an angle to a multiple of `ANGLE_SNAP` while SHIFT is held.
 * @param {number} angle Radians.
 * @param {boolean} shift Whether SHIFT is held.
 * @returns {number} Snapped angle (`angle` when `shift` is false), radians, never `-0`.
 */
export function snapAngle(angle, shift) {
  if (!shift) return angle + 0;
  return (Math.round((angle * 12) / Math.PI) * Math.PI) / 12 + 0;
}
