import { CHANNELS } from './schema.js';

/**
 * @typedef {object} Key
 * @property {number} t Time in seconds.
 * @property {(number|string|null)} v Value in the channel unit (radians for angles).
 * @property {string} [interp] `linear`, `step` or `ease`; describes the segment to the next key.
 */

function segmentValue(from, to, u, interp) {
  if (interp === 'step') return from.v;
  const w = interp === 'ease' ? u * u * (3 - 2 * u) : u;
  return from.v + (to.v - from.v) * w;
}

/**
 * Samples a track at a time. Keys must be sorted by `t`. Before the first key the first value is held,
 * after the last key the last value is held, and a single key is constant. Numeric segments follow the
 * key's `interp` (`linear` when absent); angles are not wrapped. Discrete channels always step.
 * @param {ReadonlyArray<Key>} keys Sorted keys of the track.
 * @param {number} t Time in seconds.
 * @param {boolean} [discrete] True for discrete channels such as `sprite`.
 * @returns {(number|string|null|undefined)} The value, or `undefined` when the track has no keys.
 */
export function sampleTrack(keys, t, discrete = false) {
  const last = keys.length - 1;
  if (last < 0) return undefined;
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[last].t) return keys[last].v;
  let i = 0;
  while (keys[i + 1].t <= t) i += 1;
  const from = keys[i];
  const to = keys[i + 1];
  if (discrete) return from.v;
  return segmentValue(from, to, (t - from.t) / (to.t - from.t), from.interp);
}

function readPath(source, path) {
  let value = source;
  for (const part of path.split('.')) {
    if (value === null || value === undefined) return null;
    value = value[part];
  }
  return value ?? null;
}

/**
 * Value of a channel when no clip animates it ([DESIGN.md §4.2]). Joint channels use constants;
 * root and shape channels read the base prop of the given object.
 * @param {string} targetType `root`, `joint` or `shape`.
 * @param {string} channel Channel name valid for the target type.
 * @param {object} [base] Object holding the base prop: the ragdoll for `root`, the shape for `shape`.
 * @returns {(number|string|null)} The default value.
 * @throws {Error} When the target type or channel is unknown.
 */
export function channelDefault(targetType, channel, base) {
  const spec = CHANNELS[targetType]?.[channel];
  if (!spec) throw new Error(`Unknown channel "${channel}" for target type "${targetType}"`);
  if (spec.basePath === null) return spec.default;
  return readPath(base, spec.basePath) ?? spec.default;
}
