import { CHANNELS } from './schema.js';
import { bodyMassData, invertTransform, transformPoint } from './geometry.js';

/**
 * @typedef {object} Key
 * @property {number} t Time in seconds.
 * @property {(number|string|null)} v Value in the channel unit (radians for angles).
 * @property {string} [interp] `linear`, `step` or `ease`; describes the segment to the next key.
 */

/**
 * Distance in radians beyond a joint limit that still counts as inside it (the canonical rounding).
 * @type {number}
 */
export const LIMIT_TOLERANCE = 1e-5;

/**
 * Clamps a joint angle to the joint's limits. Pure.
 * @param {number} angle Joint angle relative to rest, radians.
 * @param {{ enabled?: boolean, lower?: number, upper?: number }} [limits] Joint `limits`.
 * @returns {number} `angle` unchanged unless `limits.enabled` is true with finite `lower` and `upper`; else the angle
 *   clamped to `[lower, upper]`.
 */
export function clampToLimits(angle, limits) {
  if (limits?.enabled !== true || !Number.isFinite(limits.lower) || !Number.isFinite(limits.upper)) return angle;
  return Math.min(Math.max(angle, limits.lower), limits.upper);
}

function segmentValue(from, to, u, interp) {
  if (interp === 'step') return from.v;
  const w = interp === 'ease' ? u * u * (3 - 2 * u) : u;
  return from.v + (to.v - from.v) * w;
}

function sampleLoop(keys, time, discrete, length) {
  const first = keys[0];
  const end = keys[keys.length - 1];
  let t = time;
  if (t < 0 || t > length) {
    t %= length;
    if (t < 0) t += length;
  }
  const span = first.t + length - end.t;
  if (t < first.t || t >= end.t) {
    if (span <= 0) return t < first.t ? first.v : end.v;
    if (discrete) return end.v;
    const u = (t >= end.t ? t - end.t : t + length - end.t) / span;
    return segmentValue(end, first, u, end.interp);
  }
  let i = 0;
  while (keys[i + 1].t <= t) i += 1;
  if (discrete) return keys[i].v;
  return segmentValue(keys[i], keys[i + 1], (t - keys[i].t) / (keys[i + 1].t - keys[i].t), keys[i].interp);
}

/**
 * Samples a track at a time. Keys must be sorted by `t`. Before the first key the first value is held,
 * after the last key the last value is held, and a single key is constant. Numeric segments follow the
 * key's `interp` (`linear` when absent); angles are not wrapped. Discrete channels always step.
 * With `loopLength`, the track wraps seamlessly: times outside `[0, loopLength]` are wrapped into it, and before the
 * first key or from the last key on, the value runs from the last key to the first key repeated at
 * `t_first + loopLength`, using the last key's `interp` (discrete channels hold the last value).
 * @param {ReadonlyArray<Key>} keys Sorted keys of the track.
 * @param {number} t Time in seconds.
 * @param {boolean} [discrete] True for discrete channels such as `sprite`.
 * @param {(number|null)} [loopLength] Clip length in seconds for a looping clip; `null` or absent for a non-loop clip.
 * @returns {(number|string|null|undefined)} The value, or `undefined` when the track has no keys.
 */
export function sampleTrack(keys, t, discrete = false, loopLength = null) {
  const last = keys.length - 1;
  if (last < 0) return undefined;
  if (loopLength !== null && last > 0) return sampleLoop(keys, t, discrete, loopLength);
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[last].t) return keys[last].v;
  let i = 0;
  while (keys[i + 1].t <= t) i += 1;
  const from = keys[i];
  const to = keys[i + 1];
  if (discrete) return from.v;
  return segmentValue(from, to, (t - from.t) / (to.t - from.t), from.interp);
}

function segmentRate(from, to, u, span, interp) {
  if (interp === 'step' || !(span > 0)) return 0;
  const slope = (to.v - from.v) / span;
  return interp === 'ease' ? 6 * u * (1 - u) * slope : slope;
}

function innerRate(keys, t) {
  let i = 0;
  while (keys[i + 1].t <= t) i += 1;
  const span = keys[i + 1].t - keys[i].t;
  return segmentRate(keys[i], keys[i + 1], (t - keys[i].t) / span, span, keys[i].interp);
}

function loopRate(keys, time, length) {
  const first = keys[0];
  const end = keys[keys.length - 1];
  let t = time;
  if (t < 0 || t > length) {
    t %= length;
    if (t < 0) t += length;
  }
  if (t >= first.t && t < end.t) return innerRate(keys, t);
  const span = first.t + length - end.t;
  const u = (t >= end.t ? t - end.t : t + length - end.t) / span;
  return segmentRate(end, first, u, span, end.interp);
}

/**
 * Time derivative of {@link sampleTrack} (DESIGN.md §3, Target rate): on the segment with `t_a ≤ t < t_b`, `linear`
 * gives `(v_b − v_a) / d`, `ease` `6u(1 − u) · (v_b − v_a) / d` and `step` 0. Held values (one key, before the first
 * key or from the last key on in a non-loop clip) and discrete channels give 0. With `loopLength`, times wrap and the
 * wrap segment applies as in `sampleTrack`.
 * @param {ReadonlyArray<Key>} keys Sorted keys of the track.
 * @param {number} t Time in seconds.
 * @param {boolean} [discrete] True for discrete channels such as `sprite`.
 * @param {(number|null)} [loopLength] Clip length in seconds for a looping clip; `null` or absent for a non-loop clip.
 * @returns {number} Rate in channel units per clip second (rad/s for angles); 0 when the track has fewer than two keys.
 */
export function sampleTrackRate(keys, t, discrete = false, loopLength = null) {
  const last = keys.length - 1;
  if (last < 1 || discrete) return 0;
  if (loopLength !== null) return loopRate(keys, t, loopLength);
  if (t < keys[0].t || t >= keys[last].t) return 0;
  return innerRate(keys, t);
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
 * clamp to `[0, length]`. Looping clips interpolate each track across the wrap ({@link sampleTrack}). Tracks without
 * keys are left out.
 * @param {{ length: number, loop?: boolean, tracks?: ReadonlyArray<{ target: string, channel: string,
 *   keys: ReadonlyArray<Key> }>}} clip Clip with sorted keys.
 * @param {number} time Seconds since the clip started, already scaled by clip and runtime speed.
 * @returns {Map<string, Map<string, (number|string|null)>>} Sampled values by target id, then channel.
 */
export function evaluateClip(clip, time) {
  const t = wrapClipTime(clip, time);
  const sampled = new Map();
  for (const track of clip.tracks ?? []) {
    const value = sampleTrack(track.keys, t, track.channel === 'sprite', clip.loop ? clip.length : null);
    if (value === undefined) continue;
    if (!sampled.has(track.target)) sampled.set(track.target, new Map());
    sampled.get(track.target).set(track.channel, value);
  }
  return sampled;
}

function clipAngleRates(clip, time) {
  const t = wrapClipTime(clip, time);
  const rates = new Map();
  for (const track of clip.tracks ?? []) {
    if (track.channel !== 'angle' && track.channel !== 'bodyAngle') continue;
    if (track.keys.length === 0) continue;
    if (!rates.has(track.target)) rates.set(track.target, new Map());
    rates.get(track.target).set(track.channel, sampleTrackRate(track.keys, t, false, clip.loop ? clip.length : null));
  }
  return rates;
}

/**
 * @typedef {object} JointPose
 * @property {number} angle Target angle in radians, relative to rest.
 * @property {number} angleRate Rate of `angle`, rad/s of real time (DESIGN.md §3, Target rate); 0 without a clip.
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
 * @property {{ strength: number, gain: number, damping: number, bodyAngle: number, bodyAngleRate: number }} root Root
 *   multipliers, 0-1, the root `bodyAngle` target, radians relative to rest, and its rate, rad/s; neither mirrored.
 * @property {Map<string, (string|null)>} sprites Sprite asset id (or `null`, hidden) per shape id.
 */

/**
 * @typedef {object} LayerInput
 * @property {object} clip Clip as in `evaluateClip`, plus `blend` (`override` default or `additive`).
 * @property {number} time Clip-local seconds, as in `evaluateClip`.
 * @property {number} [weight] Effective weight 0-1; defaults to 1.
 * @property {number} [speed] Clip seconds per real second (clip speed × play speed), scales the rates; defaults to
 *   `clip.speed`, else 1.
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

function blendRate(blend, below, clipRate, weight) {
  return blend === 'additive' ? below + clipRate * weight : below + (clipRate - below) * weight;
}

/**
 * Resolves every channel of a ragdoll for one clip on one layer, and combines joint, root and runtime
 * multipliers into `S`, `G` and `D` ([DESIGN.md §3, §4.4]). Untracked channels take their defaults. The joint `angle`
 * and root `bodyAngle` also get their target rate ([DESIGN.md §3], Target rate): the track rate × `speed`, blended at
 * a constant weight over a rate of 0 below.
 * Limitation: only a single layer is supported; crossfades, stacked layers and the procedural hook
 * are not implemented, and the `layers` array is accepted so they can be added without a new signature.
 * @param {{ ragdoll: object, bodies?: ReadonlyArray<object>, joints?: ReadonlyArray<object> }} def
 *   Ragdoll document: root channels, joints with `motor`, bodies with `fixtures`.
 * @param {ReadonlyArray<LayerInput>} layers Active layers, lowest first; at most one.
 * @param {RuntimeMultipliers} [runtime] Runtime strength, gain and damping multipliers.
 * @returns {ResolvedPose} Joint targets in radians and rates in rad/s, multipliers clamped to 0-1.
 * @throws {Error} When more than one layer is given.
 */
export function resolveChannels(def, layers, runtime = {}) {
  if (layers.length > 1) throw new Error('resolveChannels supports a single layer');
  const layer = layers[0];
  const sampled = layer ? evaluateClip(layer.clip, layer.time) : new Map();
  const rates = layer ? clipAngleRates(layer.clip, layer.time) : new Map();
  const blend = layer?.clip.blend ?? 'override';
  const weight = layer ? clamp01(layer.weight ?? 1) : 0;
  const speed = layer ? layer.speed ?? layer.clip.speed ?? 1 : 0;

  const resolveRate = (target, channel) => {
    const clipRate = rates.get(target)?.get(channel);
    if (clipRate === undefined) return 0;
    return blendRate(blend, 0, clipRate * speed, weight);
  };

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
  root.bodyAngle = resolve('root', 'root', 'bodyAngle', def.ragdoll);
  root.bodyAngleRate = resolveRate('root', 'bodyAngle');

  const joints = new Map();
  for (const joint of def.joints ?? []) {
    const pose = { angle: resolve('joint', joint.id, 'angle'), angleRate: resolveRate(joint.id, 'angle') };
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

function bodyTable(def) {
  const bodies = new Map();
  for (const body of def.bodies ?? []) {
    bodies.set(body.id, { x: body.position[0], y: body.position[1], angle: body.angle });
  }
  return bodies;
}

function treeLinks(def, bodies) {
  const edges = [];
  for (const joint of def.joints ?? []) {
    if (joint.bodyA !== joint.bodyB && bodies.has(joint.bodyA) && bodies.has(joint.bodyB)) edges.push(joint);
  }
  const links = new Map();
  const queue = [def.ragdoll?.rootBody];
  const reached = new Set(queue);
  if (!bodies.has(queue[0])) return links;
  for (let head = 0; head < queue.length; head++) {
    for (const joint of edges) {
      if (joint.bodyA !== queue[head] && joint.bodyB !== queue[head]) continue;
      const childIsB = joint.bodyA === queue[head];
      const child = childIsB ? joint.bodyB : joint.bodyA;
      if (reached.has(child)) continue;
      reached.add(child);
      links.set(child, { joint, parent: queue[head], sign: childIsB ? 1 : -1 });
      queue.push(child);
    }
  }
  return links;
}

function placeChild(rest, posedParent, link, child, angle) {
  const restParent = rest.get(link.parent);
  const restChild = rest.get(child);
  const [ax, ay] = link.joint.anchor;
  const anchorLocal = transformPoint(invertTransform(restParent), { x: ax, y: ay });
  const anchor = transformPoint(posedParent, anchorLocal);
  const offset = transformPoint(invertTransform({ x: 0, y: 0, angle: restChild.angle }), {
    x: restChild.x - ax,
    y: restChild.y - ay,
  });
  const turned = transformPoint({ x: 0, y: 0, angle }, offset);
  return { x: anchor.x + turned.x, y: anchor.y + turned.y, angle };
}

function turnRootBody(def, rest, bodyAngle) {
  const id = def.ragdoll?.rootBody;
  const restRoot = rest.get(id);
  if (!restRoot || bodyAngle === 0) return null;
  const source = (def.bodies ?? []).find((body) => body.id === id);
  const center = bodyMassData(source?.fixtures ?? []).center;
  const pivot = center === null ? { x: restRoot.x, y: restRoot.y } : transformPoint(restRoot, center);
  const turned = transformPoint({ x: 0, y: 0, angle: bodyAngle }, { x: restRoot.x - pivot.x, y: restRoot.y - pivot.y });
  return { id, transform: { x: pivot.x + turned.x, y: pivot.y + turned.y, angle: restRoot.angle + bodyAngle } };
}

/**
 * Forward-kinematics pose ([DESIGN.md §5.1]). `rootBody` turns by `bodyAngle` around its rest center of mass (its
 * origin when its mass is 0) and keeps its rest transform at 0; each body reached through the
 * spanning tree of joints (breadth first from `rootBody`, undirected, in `joints` order) turns around the joint
 * anchor so that `child.angle = parent.angle + (restChild - restParent) + sign * angle`, where `sign` is +1 when the
 * child is `bodyB` and -1 when it is `bodyA`. Loop joints are ignored; bodies not connected to `rootBody` keep their
 * rest transform. All transforms are in the ragdoll's root-local frame, meters and radians.
 * @param {{ ragdoll: { rootBody: (string|null) }, bodies?: ReadonlyArray<object>, joints?: ReadonlyArray<object> }} def
 *   Ragdoll document: bodies with `position` and `angle`, joints with `bodyA`, `bodyB` and `anchor`.
 * @param {ReadonlyMap<string, { angle: number }>} joints Joint angle relative to rest, radians, by joint id; missing
 *   joints count as 0.
 * @param {number} [bodyAngle] Root `bodyAngle`, radians relative to rest; defaults to 0.
 * @returns {Map<string, import('./geometry.js').Transform>} Posed transform of every body, by body id, in `bodies`
 *   order; the rest pose when `rootBody` names no body.
 */
export function fkPose(def, joints, bodyAngle = 0) {
  const rest = bodyTable(def);
  const posed = new Map(rest);
  const root = turnRootBody(def, rest, bodyAngle);
  if (root !== null) posed.set(root.id, root.transform);
  const links = treeLinks(def, rest);
  const resolveBody = (body) => {
    const link = links.get(body);
    if (!link || posed.get(body) !== rest.get(body)) return;
    resolveBody(link.parent);
    const angle = posed.get(link.parent).angle
      + rest.get(body).angle - rest.get(link.parent).angle
      + link.sign * (joints.get(link.joint.id)?.angle ?? 0);
    posed.set(body, placeChild(rest, posed.get(link.parent), link, body, angle));
  };
  for (const body of links.keys()) resolveBody(body);
  return posed;
}

/**
 * Inverse of `fkPose` for one joint: the joint angle that gives its child body a desired angle, given the posed
 * parent. Used to write the angle key when a body is rotated in Animate mode.
 * @param {{ ragdoll: { rootBody: (string|null) }, bodies?: ReadonlyArray<object>, joints?: ReadonlyArray<object> }} def
 *   Ragdoll document, as in `fkPose`.
 * @param {string} jointId Joint id.
 * @param {number} bodyAngle Desired angle of the joint's tree child body, radians, root-local.
 * @param {ReadonlyMap<string, import('./geometry.js').Transform>} pose Posed transforms by body id, as `fkPose` returns;
 *   only the parent body is read.
 * @returns {(number|null)} Joint angle relative to rest, radians, not wrapped; `null` when the joint is not a tree
 *   joint of the spanning tree from `rootBody`.
 */
export function jointAngleForBody(def, jointId, bodyAngle, pose) {
  const rest = bodyTable(def);
  for (const [child, link] of treeLinks(def, rest)) {
    if (link.joint.id !== jointId) continue;
    const relative = bodyAngle - pose.get(link.parent).angle - (rest.get(child).angle - rest.get(link.parent).angle);
    return link.sign * relative;
  }
  return null;
}
