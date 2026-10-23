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

function wrapClipTime(clip, time) {
  if (!clip.loop) return Math.min(Math.max(time, 0), clip.length);
  const wrapped = time % clip.length;
  return wrapped < 0 ? wrapped + clip.length : wrapped;
}

/**
 * Samples every track of a clip at a clip-local time. Looping clips wrap at `length`; non-loop clips
 * clamp to `[0, length]`. Tracks without keys are left out.
 * @param {{ length: number, loop?: boolean, tracks?: ReadonlyArray<{ target: string, channel: string,
 *   keys: ReadonlyArray<Key> }>}} clip Clip with sorted keys.
 * @param {number} time Seconds since the clip started, already scaled by clip and runtime speed.
 * @returns {Map<string, Map<string, (number|string|null)>>} Sampled values by target id, then channel.
 */
export function evaluateClip(clip, time) {
  const t = wrapClipTime(clip, time);
  const sampled = new Map();
  for (const track of clip.tracks ?? []) {
    const value = sampleTrack(track.keys, t, track.channel === 'sprite');
    if (value === undefined) continue;
    if (!sampled.has(track.target)) sampled.set(track.target, new Map());
    sampled.get(track.target).set(track.channel, value);
  }
  return sampled;
}

/**
 * @typedef {object} JointPose
 * @property {number} angle Target angle in radians, relative to rest.
 * @property {number} strength Joint strength multiplier, 0-1.
 * @property {number} gain Joint gain multiplier, 0-1.
 * @property {number} damping Joint damping multiplier, 0-1.
 * @property {number} S `strength x root x runtime`, 0-1; the motor torque is `S * motor.maxTorque`.
 * @property {number} G `gain x root x runtime x motor.gain`, in 1/s.
 * @property {number} D `damping x root x runtime x motor.damping`.
 */

/**
 * @typedef {object} ResolvedPose
 * @property {Map<string, JointPose>} joints Pose per joint id.
 * @property {{ strength: number, gain: number, damping: number }} root Root multipliers, 0-1.
 * @property {Map<string, (string|null)>} sprites Sprite asset id (or `null`, hidden) per shape id.
 */

/**
 * @typedef {object} LayerInput
 * @property {object} clip Clip as in `evaluateClip`, plus `blend` (`override` default or `additive`).
 * @property {number} time Clip-local seconds, as in `evaluateClip`.
 * @property {number} [weight] Effective weight 0-1; defaults to 1.
 */

/**
 * @typedef {object} RuntimeMultipliers
 * @property {number} [strength] Defaults to 1.
 * @property {number} [gain] Defaults to 1.
 * @property {number} [damping] Defaults to 1.
 */

const MULTIPLIERS = ['strength', 'gain', 'damping'];

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

function blendValue(channelKind, blend, below, clipValue, weight) {
  if (channelKind === 'discrete') return weight >= 0.5 ? clipValue : below;
  if (blend === 'additive') {
    return channelKind === 'angle'
      ? below + clipValue * weight
      : below * (1 + (clipValue - 1) * weight);
  }
  return below + (clipValue - below) * weight;
}

/**
 * Resolves every channel of a ragdoll for one clip on one layer, and combines joint, root and runtime
 * multipliers into `S`, `G` and `D` ([DESIGN.md §3, §4.4]). Untracked channels take their defaults.
 * Limitation: only a single layer is supported; crossfades, stacked layers and the procedural hook
 * are not implemented, and the `layers` array is accepted so they can be added without a new signature.
 * @param {{ ragdoll: object, bodies?: ReadonlyArray<object>, joints?: ReadonlyArray<object> }} def
 *   Ragdoll document: root channels, joints with `motor`, bodies with `fixtures`.
 * @param {ReadonlyArray<LayerInput>} layers Active layers, lowest first; at most one.
 * @param {RuntimeMultipliers} [runtime] Runtime strength, gain and damping multipliers.
 * @returns {ResolvedPose} Joint targets in radians, multipliers clamped to 0-1.
 * @throws {Error} When more than one layer is given.
 */
export function resolveChannels(def, layers, runtime = {}) {
  if (layers.length > 1) throw new Error('resolveChannels supports a single layer');
  const layer = layers[0];
  const sampled = layer ? evaluateClip(layer.clip, layer.time) : new Map();
  const blend = layer?.clip.blend ?? 'override';
  const weight = layer ? clamp01(layer.weight ?? 1) : 0;

  const resolve = (targetType, target, channel, base) => {
    const kind = CHANNELS[targetType][channel].kind;
    const fallback = kind === 'multiplier' ? 1 : null;
    const below = channelDefault(targetType, channel, base) ?? fallback;
    const clipValue = sampled.get(target)?.get(channel);
    if (clipValue === undefined) return below;
    const value = blendValue(kind, blend, below, clipValue, weight);
    return kind === 'multiplier' ? clamp01(value) : value;
  };

  const root = {};
  const rootRuntime = {};
  for (const channel of MULTIPLIERS) {
    root[channel] = resolve('root', 'root', channel, def.ragdoll);
    rootRuntime[channel] = clamp01(runtime[channel] ?? 1);
  }

  const joints = new Map();
  for (const joint of def.joints ?? []) {
    const pose = { angle: resolve('joint', joint.id, 'angle') };
    for (const channel of MULTIPLIERS) pose[channel] = resolve('joint', joint.id, channel);
    pose.S = pose.strength * root.strength * rootRuntime.strength;
    pose.G = pose.gain * root.gain * rootRuntime.gain * (joint.motor?.gain ?? 1);
    pose.D = pose.damping * root.damping * rootRuntime.damping * (joint.motor?.damping ?? 1);
    joints.set(joint.id, pose);
  }

  const sprites = new Map();
  for (const body of def.bodies ?? []) {
    for (const shape of body.fixtures ?? []) {
      sprites.set(shape.id, resolve('shape', shape.id, 'sprite', shape));
    }
  }
  return { joints, root, sprites };
}
