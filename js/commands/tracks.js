import { channelsOf, findTrack } from '../model/clip-channels.js';

/**
 * Builds a command that adds an empty track for a target and channel to a clip, at the end of its tracks. `run`
 * returns the track uid.
 * @param {number} clip Uid of the clip.
 * @param {number} target Uid of the root, a joint or a shape.
 * @param {string} channel Channel valid for the target.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds `clip` not a clip, a channel not valid for the target, or a track of that target
 *   and channel already in the clip; nothing is mutated then.
 */
export function addTrack(clip, target, channel, label = 'Add track') {
  return Object.freeze({
    label,
    run(tx) {
      const { model } = tx;
      if (model.get(clip)?.type !== 'clip') throw new Error(`Node ${clip} is not a clip`);
      if (!channelsOf(model, target).includes(channel)) throw new Error(`Channel "${channel}" is not valid for node ${target}`);
      if (findTrack(model, clip, target, channel) !== null) throw new Error(`The clip already has a ${channel} track for node ${target}`);
      return tx.add(clip, 'tracks', undefined, {
        type: 'track',
        props: { target: model.prop(target, 'id'), channel },
        children: { keys: [] },
      });
    },
  });
}

/**
 * Builds a command that removes a track and its keys (each key removed first, so the selection drops them). `run`
 * returns the number of keys removed.
 * @param {number} track Uid of the track.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds `track` not a track; nothing is mutated then.
 */
export function deleteTrack(track, label = 'Delete track') {
  return Object.freeze({
    label,
    run(tx) {
      if (tx.model.get(track)?.type !== 'track') throw new Error(`Node ${track} is not a track`);
      const keys = [...tx.model.children(track, 'keys')];
      for (const key of keys.toReversed()) tx.remove(key);
      tx.remove(track);
      return keys.length;
    },
  });
}
