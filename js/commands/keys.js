import { LIMIT_TOLERANCE, clampToLimits } from '../../lib/evaluate.js';
import { ROOT_UID } from '../model/model.js';
import { snapTime } from '../timeline-time.js';

const SAME_TIME = 1e-6;

function requireType(model, uid, type) {
  if (model.get(uid)?.type !== type) throw new Error(`Node ${uid} is not a ${type}`);
}

function keysByTrack(model, keys) {
  const groups = new Map();
  for (const key of new Set(keys)) {
    requireType(model, key, 'key');
    const track = model.get(key).parent;
    groups.set(track, [...(groups.get(track) ?? []), key]);
  }
  return groups;
}

function clipLengthOf(model, track) {
  return model.prop(model.get(track).parent, 'length');
}

/**
 * Builds a command that moves keys along time by the same offset: the offset is limited so the whole group stays
 * inside the clip, each time is snapped to 1/30 s, keys stay sorted, and a key that lands on the time of an unselected
 * key of the same track replaces it. Does nothing when no key changes.
 * @param {number[]} keys Key uids.
 * @param {number} delta Time offset in seconds.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds a uid that is not a key; nothing is mutated then.
 * @throws {TypeError} When `run` finds `delta` not finite; nothing is mutated then.
 */
export function moveKeys(keys, delta, label = 'Move keys') {
  return Object.freeze({
    label,
    run(tx) {
      const { model } = tx;
      if (!Number.isFinite(delta)) throw new TypeError('Key offset must be a finite number');
      const groups = keysByTrack(model, keys);
      let limited = delta;
      for (const [track, moving] of groups) {
        const times = moving.map((uid) => model.prop(uid, 't'));
        limited = Math.min(Math.max(limited, -Math.min(...times)), clipLengthOf(model, track) - Math.max(...times));
      }
      for (const [track, moving] of groups) {
        const length = clipLengthOf(model, track);
        const times = moving.map((uid) => model.prop(uid, 't'));
        const target = new Map(moving.map((uid, index) => [uid, snapTime(times[index] + limited, length)]));
        const taken = new Set();
        const dropped = new Set();
        for (const uid of moving) {
          const t = target.get(uid);
          if (taken.has(t)) {
            dropped.add(uid);
            target.delete(uid);
          } else taken.add(t);
        }
        const survivors = [];
        for (const uid of model.children(track, 'keys')) {
          const t = model.prop(uid, 't');
          if (target.has(uid)) survivors.push(uid);
          else if (dropped.has(uid) || [...taken].some((time) => Math.abs(time - t) < SAME_TIME)) tx.remove(uid);
          else survivors.push(uid);
        }
        for (const [uid, t] of target) if (model.prop(uid, 't') !== t) tx.set(uid, 't', t);
        const order = survivors.toSorted((a, b) => model.prop(a, 't') - model.prop(b, 't'));
        order.forEach((uid, index) => {
          if (model.children(track, 'keys')[index] !== uid) tx.move(uid, track, 'keys', index);
        });
      }
    },
  });
}

/**
 * Builds a command that removes keys. A track left without keys stays (it has no effect on its channel).
 * @param {number[]} keys Key uids.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds a uid that is not a key; nothing is mutated then.
 */
export function deleteKeys(keys, label = 'Delete keys') {
  return Object.freeze({
    label,
    run(tx) {
      const groups = keysByTrack(tx.model, keys);
      for (const uids of groups.values()) for (const uid of uids) tx.remove(uid);
    },
  });
}

/**
 * Builds a command that sets a clip's length and removes the keys and events left outside it (key time above the
 * new length; event time above it, or equal to it when the clip loops), all in one undo step.
 * `run` returns the number of removed keys and events.
 * @param {number} clip Uid of the clip.
 * @param {number} length New length in seconds, finite and above 0.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command; `run` returns `{ keys: number, events: number }`.
 * @throws {Error} When `run` finds `clip` of the wrong type; nothing is mutated then.
 * @throws {TypeError} When `run` finds `length` not a finite number above 0; nothing is mutated then.
 */
export function setClipLength(clip, length, label = 'Set clip length') {
  return Object.freeze({
    label,
    run(tx) {
      const { model } = tx;
      requireType(model, clip, 'clip');
      if (!Number.isFinite(length) || length <= 0) throw new TypeError('Clip length must be a finite number above 0');
      const loop = model.prop(clip, 'loop');
      const outsideKeys = [];
      for (const track of model.children(clip, 'tracks')) {
        for (const key of model.children(track, 'keys')) if (model.prop(key, 't') > length) outsideKeys.push(key);
      }
      const outsideEvents = model
        .children(clip, 'events')
        .filter((event) => (loop ? model.prop(event, 't') >= length : model.prop(event, 't') > length));
      tx.set(clip, 'length', length);
      for (const uid of [...outsideKeys, ...outsideEvents]) tx.remove(uid);
      return { keys: outsideKeys.length, events: outsideEvents.length };
    },
  });
}

function outsideLimits(model) {
  const found = [];
  for (const clip of model.children(ROOT_UID, 'clips')) {
    if (model.prop(clip, 'blend') === 'additive') continue;
    for (const track of model.children(clip, 'tracks')) {
      if (model.prop(track, 'channel') !== 'angle') continue;
      const joint = model.uidOf(model.prop(track, 'target'));
      if (joint === null || model.get(joint)?.type !== 'joint') continue;
      const limits = model.prop(joint, 'limits');
      for (const key of model.children(track, 'keys')) {
        const v = model.prop(key, 'v');
        if (!Number.isFinite(v)) continue;
        const clamped = clampToLimits(v, limits);
        if (Math.abs(clamped - v) > LIMIT_TOLERANCE) found.push({ clip, key, clamped });
      }
    }
  }
  return found;
}

/**
 * Lists the joint `angle` keys that lie more than `LIMIT_TOLERANCE` outside the enabled limits of their joint, in
 * every `override` clip (the keys `W_KEY_OUTSIDE_LIMITS` reports).
 * @param {import('../model/model.js').Model} model Document model.
 * @returns {number[]} Key uids in clip, track and key order.
 */
export function keysOutsideLimits(model) {
  return outsideLimits(model).map(({ key }) => key);
}

/**
 * Builds a command that sets every key of `keysOutsideLimits` to the nearer limit of its joint, in one undo step.
 * `t` and `interp` never change and nothing is added or removed. Mutates nothing when no key is outside.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command; `run` returns `{ keys: number, clips: number }`, the number
 *   of keys changed and of clips holding them.
 */
export function clampKeysToLimits(label = 'Clamp keys to limits') {
  return Object.freeze({
    label,
    run(tx) {
      const outside = outsideLimits(tx.model);
      for (const { key, clamped } of outside) tx.set(key, 'v', clamped);
      return { keys: outside.length, clips: new Set(outside.map(({ clip }) => clip)).size };
    },
  });
}

/**
 * Builds a command that sets the `angle` key of a joint in a clip: the time is snapped to 1/30 s and clamped to the
 * clip, the joint's `angle` track is created when missing, and a key already at that time is updated, else a
 * `linear` key is inserted in time order. `run` returns the key uid.
 * @param {number} clip Uid of the clip.
 * @param {number} joint Uid of the joint.
 * @param {number} time Time in seconds.
 * @param {number} angle Joint angle relative to rest, radians.
 * @param {string} [label] Undo step label.
 * @param {{ snap?: boolean }} [options] `snap: false` keeps the time as given (only clamped), e.g. a simulation
 *   step time; snapped by default.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds `clip` or `joint` of the wrong type; nothing is mutated then.
 * @throws {TypeError} When `run` finds `time` or `angle` not finite; nothing is mutated then.
 */
export function setJointAngleKey(clip, joint, time, angle, label = 'Key joint angle', { snap = true } = {}) {
  return angleKeyCommand(clip, joint, 'joint', 'angle', time, angle, label, snap);
}

/**
 * Builds a command that sets the root `bodyAngle` key in a clip, with the same rules as `setJointAngleKey`: the
 * root's `bodyAngle` track is created when missing. `run` returns the key uid.
 * @param {number} clip Uid of the clip.
 * @param {number} time Time in seconds.
 * @param {number} angle Root `bodyAngle`, radians relative to the rest orientation.
 * @param {string} [label] Undo step label.
 * @param {{ snap?: boolean }} [options] As in `setJointAngleKey`.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds `clip` of the wrong type; nothing is mutated then.
 * @throws {TypeError} When `run` finds `time` or `angle` not finite; nothing is mutated then.
 */
export function setRootBodyAngleKey(clip, time, angle, label = 'Key body angle', { snap = true } = {}) {
  return angleKeyCommand(clip, ROOT_UID, 'root', 'bodyAngle', time, angle, label, snap);
}

function clampTime(time, length) {
  return Math.min(Math.max(time, 0), Number.isFinite(length) && length > 0 ? length : 0) + 0;
}

function angleKeyCommand(clip, node, type, channel, time, angle, label, snap) {
  return Object.freeze({
    label,
    run(tx) {
      const { model } = tx;
      requireType(model, clip, 'clip');
      requireType(model, node, type);
      if (!Number.isFinite(time) || !Number.isFinite(angle)) throw new TypeError('Key time and angle must be finite numbers');
      const length = model.prop(clip, 'length');
      const t = snap ? snapTime(time, length) : clampTime(time, length);
      const target = model.prop(node, 'id');
      const v = angle + 0;
      const track = model
        .children(clip, 'tracks')
        .find((uid) => model.prop(uid, 'target') === target && model.prop(uid, 'channel') === channel);
      const key = { type: 'key', props: { t, v, interp: 'linear' } };
      if (track === undefined) {
        const created = tx.add(clip, 'tracks', undefined, {
          type: 'track',
          props: { target, channel },
          children: { keys: [key] },
        });
        return model.children(created, 'keys')[0];
      }
      const keys = model.children(track, 'keys');
      const existing = keys.find((uid) => Math.abs(model.prop(uid, 't') - t) < SAME_TIME);
      if (existing !== undefined) {
        tx.set(existing, 'v', v);
        return existing;
      }
      const next = keys.findIndex((uid) => model.prop(uid, 't') > t);
      return tx.add(track, 'keys', next === -1 ? undefined : next, key);
    },
  });
}
