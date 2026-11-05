import { ROOT_UID } from './model/model.js';

const ROOT_LABEL = 'Root body';

/**
 * One timeline row: the `angle` track of a joint, or the root `bodyAngle` track, in a clip.
 * @typedef {object} AngleRow
 * @property {number} joint Joint uid; the root uid for the root `bodyAngle` row.
 * @property {number} track Track uid.
 * @property {string} label Joint name, or its id when the name is empty; `Root body` for the root row.
 * @property {ReadonlyArray<{ uid: number, t: number, v: number }>} keys Keys in track order: uid, time (s), angle (rad).
 */

function jointOfTrack(model, track) {
  const { channel, target } = model.get(track).props;
  if (channel === 'bodyAngle' && target === model.prop(ROOT_UID, 'id')) return ROOT_UID;
  if (channel !== 'angle' || typeof target !== 'string') return null;
  const uid = model.uidOf(target);
  return uid !== null && uid !== undefined && model.get(uid)?.type === 'joint' ? uid : null;
}

function labelOf(model, uid) {
  if (uid === ROOT_UID) return ROOT_LABEL;
  const { name, id } = model.get(uid).props;
  return typeof name === 'string' && name !== '' ? name : String(id);
}

/**
 * The root `bodyAngle` track first, then the joint `angle` tracks of a clip, as timeline rows in `joints` order; a
 * target with several tracks of its channel shows the first, and tracks of other channels or unknown targets are
 * left out.
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
  return [ROOT_UID, ...model.children(ROOT_UID, 'joints')]
    .filter((joint) => tracks.has(joint))
    .map((joint) => {
      const track = tracks.get(joint);
      return Object.freeze({
        joint,
        track,
        label: labelOf(model, joint),
        keys: Object.freeze(
          model.children(track, 'keys').map((uid) => Object.freeze({ uid, t: model.prop(uid, 't'), v: model.prop(uid, 'v') })),
        ),
      });
    });
}

const SAME_TIME = 1e-6;

/**
 * One summary key: every key of the rows sharing a time.
 * @typedef {object} SummaryKey
 * @property {number} t Time of the earliest key of the group (s).
 * @property {number[]} keys Key uids at that time, in row order.
 * @property {number} selected How many of them are selected.
 * @property {'none'|'some'|'all'} state Selection state of the group.
 */

/**
 * Selection state of a group of keys.
 * @param {ReadonlyArray<number>} keys Key uids of the group.
 * @param {ReadonlyArray<number>} selected Selected uids.
 * @returns {{ selected: number, state: 'none'|'some'|'all' }} Selected count and state; `none` for an empty group.
 */
export function selectionState(keys, selected) {
  const count = keys.filter((uid) => selected.includes(uid)).length;
  return { selected: count, state: count === 0 ? 'none' : count === keys.length ? 'all' : 'some' };
}

/**
 * Groups the keys of the rows by time; times closer than 1e-6 s (the `moveKeys` same-time tolerance) share a group.
 * @param {ReadonlyArray<AngleRow>} rows Timeline rows.
 * @param {ReadonlyArray<number>} selected Selected uids.
 * @returns {SummaryKey[]} Groups in time order; empty without keys.
 */
export function summaryKeys(rows, selected) {
  const all = rows.flatMap((row) => row.keys).sort((a, b) => a.t - b.t);
  const groups = [];
  for (const key of all) {
    const last = groups[groups.length - 1];
    if (last !== undefined && key.t - last.t < SAME_TIME) last.keys.push(key.uid);
    else groups.push({ t: key.t, keys: [key.uid] });
  }
  return groups.map((group) => Object.freeze({ ...group, ...selectionState(group.keys, selected) }));
}

/**
 * Selection after a click on a key or a summary key, with the modifiers read at the press: CTRL removes the
 * targets (and wins over SHIFT), SHIFT adds them or removes them when all are selected, no modifier selects only
 * the targets unless all are already selected, which keeps the selection.
 * @param {ReadonlyArray<number>} current Selected uids.
 * @param {ReadonlyArray<number>} targets Key uids under the click.
 * @param {{ shift?: boolean, ctrl?: boolean }} modifiers Modifier keys; Cmd counts as CTRL.
 * @returns {number[]} The new selection.
 */
export function clickSelection(current, targets, { shift = false, ctrl = false } = {}) {
  const hit = new Set(targets);
  const all = targets.every((uid) => current.includes(uid));
  if (ctrl || (shift && all)) return current.filter((uid) => !hit.has(uid));
  if (shift) return [...current, ...targets.filter((uid) => !current.includes(uid))];
  return all ? [...current] : [...targets];
}
