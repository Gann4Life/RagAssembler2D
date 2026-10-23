import { ROOT_UID } from './model/model.js';

/**
 * One timeline row: the `angle` track of a joint in a clip.
 * @typedef {object} AngleRow
 * @property {number} joint Joint uid.
 * @property {number} track Track uid.
 * @property {string} label Joint name, or its id when the name is empty.
 * @property {ReadonlyArray<{ uid: number, t: number, v: number }>} keys Keys in track order: uid, time (s), angle (rad).
 */

function jointOfTrack(model, track) {
  const { channel, target } = model.get(track).props;
  if (channel !== 'angle' || typeof target !== 'string') return null;
  const uid = model.uidOf(target);
  return uid !== null && uid !== undefined && model.get(uid)?.type === 'joint' ? uid : null;
}

/**
 * The joint `angle` tracks of a clip as timeline rows, in `joints` order; a joint with several `angle` tracks
 * shows the first, and tracks of other channels or unknown targets are left out.
 * @param {import('./model/model.js').Model} model Document model.
 * @param {number|null} clip Clip uid, or `null`.
 * @returns {AngleRow[]} A new list; empty without a clip.
 */
export function jointAngleRows(model, clip) {
  if (clip === null || model.get(clip)?.type !== 'clip') return [];
  const tracks = new Map();
  for (const track of model.children(clip, 'tracks')) {
    const joint = jointOfTrack(model, track);
    if (joint !== null && !tracks.has(joint)) tracks.set(joint, track);
  }
  return model
    .children(ROOT_UID, 'joints')
    .filter((joint) => tracks.has(joint))
    .map((joint) => {
      const track = tracks.get(joint);
      const { name, id } = model.get(joint).props;
      return Object.freeze({
        joint,
        track,
        label: typeof name === 'string' && name !== '' ? name : String(id),
        keys: Object.freeze(
          model.children(track, 'keys').map((uid) => Object.freeze({ uid, t: model.prop(uid, 't'), v: model.prop(uid, 'v') })),
        ),
      });
    });
}
