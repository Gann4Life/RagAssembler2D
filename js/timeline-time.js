/** Playhead snap step (s). */
export const SNAP_STEP = 1 / 30;

/**
 * Snaps a time to {@link SNAP_STEP} and clamps it to the clip.
 * @param {number} time Time (s).
 * @param {number} length Clip length (s).
 * @returns {number} Snapped time in `[0, length]` (s).
 */
export function snapTime(time, length) {
  const snapped = Math.round(time / SNAP_STEP) * SNAP_STEP;
  return Math.min(Math.max(snapped, 0), length) + 0;
}

/**
 * Converts a horizontal position on the ruler to a snapped time.
 * @param {number} offset Distance from the ruler's left edge (px).
 * @param {number} width Ruler width (px).
 * @param {number} length Clip length (s); the ruler always spans `[0, length]`.
 * @returns {number} Snapped time (s).
 */
export function timeAtOffset(offset, width, length) {
  if (!(width > 0)) return 0;
  return snapTime((offset / width) * length, length);
}

/**
 * Converts a time to a fraction of the ruler width.
 * @param {number} time Time (s).
 * @param {number} length Clip length (s).
 * @returns {number} Fraction in `[0, 1]`.
 */
export function fractionOfTime(time, length) {
  if (!(length > 0)) return 0;
  return Math.min(Math.max(time / length, 0), 1);
}

/**
 * Ruler tick times for a clip: whole seconds, or finer steps while the clip is short.
 * @param {number} length Clip length (s).
 * @returns {number[]} Tick times (s), from 0 up to `length`.
 */
export function rulerTicks(length) {
  if (!(length > 0)) return [0];
  const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60].find((candidate) => length / candidate <= 12) ?? 60;
  const ticks = [];
  for (let index = 0; index * step <= length + 1e-9; index++) ticks.push(Math.round(index * step * 1000) / 1000);
  return ticks;
}