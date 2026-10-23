import { snapTime } from '../timeline-time.js';

const SAME_TIME = 1e-6;

function requireType(model, uid, type) {
  if (model.get(uid)?.type !== type) throw new Error(`Node ${uid} is not a ${type}`);
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
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds `clip` or `joint` of the wrong type; nothing is mutated then.
 * @throws {TypeError} When `run` finds `time` or `angle` not finite; nothing is mutated then.
 */
export function setJointAngleKey(clip, joint, time, angle, label = 'Key joint angle') {
  return Object.freeze({
    label,
    run(tx) {
      const { model } = tx;
      requireType(model, clip, 'clip');
      requireType(model, joint, 'joint');
      if (!Number.isFinite(time) || !Number.isFinite(angle)) throw new TypeError('Key time and angle must be finite numbers');
      const t = snapTime(time, model.prop(clip, 'length'));
      const target = model.prop(joint, 'id');
      const v = angle + 0;
      const track = model
        .children(clip, 'tracks')
        .find((uid) => model.prop(uid, 'target') === target && model.prop(uid, 'channel') === 'angle');
      const key = { type: 'key', props: { t, v, interp: 'linear' } };
      if (track === undefined) {
        const created = tx.add(clip, 'tracks', undefined, {
          type: 'track',
          props: { target, channel: 'angle' },
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
