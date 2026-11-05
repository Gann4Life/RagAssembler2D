import { CHANNELS } from '../../lib/schema.js';
import { channelDefault, resolveChannels, sampleTrack } from '../../lib/evaluate.js';
import { ROOT_UID } from './model.js';
import { toJson } from './io.js';

/**
 * Channel order of a target's tracks in the timeline and the inspector.
 * @type {ReadonlyArray<string>}
 */
export const CHANNEL_ORDER = Object.freeze(['angle', 'bodyAngle', 'strength', 'gain', 'damping', 'sprite']);

/**
 * Two key times closer than this, in seconds, are the same time.
 * @type {number}
 */
export const SAME_TIME = 1e-6;

const PREVIEW_VERSION = 'inspector';
const TARGET_TYPES = Object.freeze({ root: 'root', joint: 'joint', shape: 'shape' });

/**
 * Channel target type of a node.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} uid Node uid.
 * @returns {'root'|'joint'|'shape'|null} `null` for a node that cannot be animated or an unknown uid.
 */
export function targetTypeOf(model, uid) {
  return TARGET_TYPES[model.get(uid)?.type] ?? null;
}

/**
 * Channels valid for a target, in {@link CHANNEL_ORDER}.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} uid Target uid (the root, a joint or a shape).
 * @returns {string[]} Channel names; empty for a node that cannot be animated.
 */
export function channelsOf(model, uid) {
  const type = targetTypeOf(model, uid);
  return type === null ? [] : CHANNEL_ORDER.filter((channel) => Object.hasOwn(CHANNELS[type], channel));
}

/**
 * Target node of a track: the root when `target` is the root id, else the joint or shape with that id; `null` when
 * it names nothing animatable or the channel is not valid for it.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} track Track uid.
 * @returns {number|null} Target uid.
 */
export function targetOfTrack(model, track) {
  const { target, channel } = model.get(track).props;
  if (typeof target !== 'string') return null;
  const uid = target === model.prop(ROOT_UID, 'id') ? ROOT_UID : model.uidOf(target);
  if (uid === null || uid === undefined) return null;
  return channelsOf(model, uid).includes(channel) ? uid : null;
}

/**
 * First track of a clip for a target and channel.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} clip Clip uid.
 * @param {number} target Target uid.
 * @param {string} channel Channel name.
 * @returns {number|null} Track uid, or `null` when the clip has none.
 */
export function findTrack(model, clip, target, channel) {
  const id = model.prop(target, 'id');
  return model.children(clip, 'tracks').find((uid) => model.prop(uid, 'target') === id && model.prop(uid, 'channel') === channel) ?? null;
}

/**
 * Key of a track at a time, within {@link SAME_TIME}.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} track Track uid.
 * @param {number} time Time (s).
 * @returns {number|null} Key uid, or `null`.
 */
export function keyAt(model, track, time) {
  return model.children(track, 'keys').find((uid) => Math.abs(model.prop(uid, 't') - time) < SAME_TIME) ?? null;
}

/**
 * Value of a channel in a clip whose track has no keys (`DESIGN.md` §5.8): the §4.2 default in an `override` clip (a
 * root multiplier's is its `ragdoll.channels` base, a shape's `sprite` its asset), `0` for angles and `1` for
 * multipliers in an `additive` clip.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} clip Clip uid.
 * @param {number} target Target uid.
 * @param {string} channel Channel name valid for the target.
 * @returns {number|string|null} Value in the channel unit (radians, multiplier 0-1, asset id).
 * @throws {Error} When the channel is not valid for the target.
 */
export function neutralValue(model, clip, target, channel) {
  const type = targetTypeOf(model, target);
  const spec = CHANNELS[type ?? '']?.[channel];
  if (!spec) throw new Error(`Channel "${channel}" is not valid for node ${target}`);
  if (model.prop(clip, 'blend') === 'additive') {
    if (spec.kind === 'angle') return 0;
    if (spec.kind === 'multiplier') return 1;
  }
  const value = channelDefault(type, channel, type === 'joint' ? undefined : model.get(target).props);
  return value ?? (spec.kind === 'multiplier' ? 1 : null);
}

/**
 * Value of a track at a time, sampled as the runtime does (`interp`, holds, looping clips wrap); a keyless track
 * gives the channel's {@link neutralValue}.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} track Track uid.
 * @param {number} time Clip time (s), clamped to the clip.
 * @returns {number|string|null|undefined} Value in the channel unit; `undefined` for a keyless track whose target is
 *   unknown.
 */
export function trackValueAt(model, track, time) {
  const clip = model.get(track).parent;
  const length = model.prop(clip, 'length');
  const channel = model.prop(track, 'channel');
  const keys = model.children(track, 'keys').map((uid) => model.get(uid).props);
  const t = Math.min(Math.max(time, 0), Number.isFinite(length) ? length : 0);
  const value = sampleTrack(keys, t, channel === 'sprite', model.prop(clip, 'loop') === true ? length : null);
  if (value !== undefined) return value;
  const target = targetOfTrack(model, track);
  return target === null ? undefined : neutralValue(model, clip, target, channel);
}

/**
 * The clip's own value of a channel at a time, before blending: its track's value, or the neutral value without a
 * track.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} clip Clip uid.
 * @param {number} target Target uid.
 * @param {string} channel Channel name valid for the target.
 * @param {number} time Clip time (s).
 * @returns {number|string|null|undefined} Value in the channel unit.
 */
export function channelValueAt(model, clip, target, channel, time) {
  const track = findTrack(model, clip, target, channel);
  return track === null ? neutralValue(model, clip, target, channel) : trackValueAt(model, track, time);
}

const resolvedCaches = new WeakMap();

/**
 * Every channel of the document resolved for a clip at a time (`resolveChannels` on `toJson(model)`), cached per model
 * by `model.revision`, clip and time.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} clip Clip uid.
 * @param {number} time Clip time (s).
 * @returns {import('../../lib/evaluate.js').ResolvedPose|null} The resolved pose; `null` when the document cannot be
 *   evaluated.
 */
export function resolvedChannelsAt(model, clip, time) {
  let cache = resolvedCaches.get(model);
  if (!cache) {
    cache = { revision: null, clip: null, time: null, resolved: null };
    resolvedCaches.set(model, cache);
  }
  if (cache.revision !== model.revision || cache.clip !== clip || cache.time !== time) {
    cache.revision = model.revision;
    cache.clip = clip;
    cache.time = time;
    try {
      const def = toJson(model, PREVIEW_VERSION);
      const clipDef = def.clips[model.children(ROOT_UID, 'clips').indexOf(clip)];
      cache.resolved = resolveChannels(def, clipDef ? [{ clip: clipDef, time }] : []);
    } catch {
      cache.resolved = null;
    }
  }
  return cache.resolved;
}
