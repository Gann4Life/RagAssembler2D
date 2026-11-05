import { ROOT_UID } from './model/model.js';
import { CHANNEL_ORDER, SAME_TIME, channelsOf, targetOfTrack } from './model/clip-channels.js';
import { toDisplay } from './units.js';

const ROOT_LABEL = 'Root';
const CHANNEL_LABELS = Object.freeze({
  angle: 'angle',
  bodyAngle: 'body angle',
  strength: 'strength',
  balance: 'balance',
  gain: 'gain',
  damping: 'damping',
  sprite: 'sprite',
});

/**
 * One sub-track row of a group: a track of the target.
 * @typedef {object} TrackRow
 * @property {number} track Track uid.
 * @property {string} channel Channel name.
 * @property {string} label Channel label: `angle`, `body angle`, `strength`, `balance`, `gain`, `damping` or `sprite`.
 * @property {ReadonlyArray<{ uid: number, t: number, v: (number|string|null) }>} keys Keys in track order: uid, time
 *   (s) and value in the channel unit.
 */

/**
 * One timeline group: a target with at least one track in the clip.
 * @typedef {object} TrackGroup
 * @property {number} target Target uid: the root, a joint or a shape.
 * @property {string} label `Root`, or the joint or shape name, or its id when the name is empty.
 * @property {ReadonlyArray<TrackRow>} tracks Sub-tracks in {@link CHANNEL_ORDER}.
 */

/**
 * Label of a timeline group target.
 * @param {import('./model/model.js').Model} model Document model.
 * @param {number} uid Target uid.
 * @returns {string} `Root` for the root, else the name, or the id when the name is empty.
 */
export function targetLabel(model, uid) {
  if (uid === ROOT_UID) return ROOT_LABEL;
  const { name, id } = model.get(uid).props;
  return typeof name === 'string' && name !== '' ? name : String(id);
}

/**
 * Label of a channel in the timeline.
 * @param {string} channel Channel name.
 * @returns {string} E.g. `body angle` for `bodyAngle`.
 */
export function channelLabel(channel) {
  return CHANNEL_LABELS[channel] ?? channel;
}

function targetOrder(model) {
  const shapes = model.children(ROOT_UID, 'bodies').flatMap((body) => model.children(body, 'fixtures'));
  return [ROOT_UID, ...model.children(ROOT_UID, 'joints'), ...shapes];
}

/**
 * The track groups of a clip (`DESIGN.md` §5.8): the root first, then joints in `joints` order, then shapes in body
 * and fixture order, each with its tracks in {@link CHANNEL_ORDER}, keyless tracks included. A target with several
 * tracks of one channel shows the first; tracks of unknown targets or invalid channels are left out.
 * @param {import('./model/model.js').Model} model Document model.
 * @param {number|null} clip Clip uid, or `null`.
 * @returns {TrackGroup[]} A new list of frozen groups; empty without a clip.
 */
export function trackGroups(model, clip) {
  if (clip === null || model.get(clip)?.type !== 'clip') return [];
  const byTarget = new Map();
  for (const track of model.children(clip, 'tracks')) {
    const target = targetOfTrack(model, track);
    if (target === null) continue;
    const channels = byTarget.get(target) ?? new Map();
    const channel = model.prop(track, 'channel');
    if (!channels.has(channel)) channels.set(channel, track);
    byTarget.set(target, channels);
  }
  return targetOrder(model)
    .filter((target) => byTarget.has(target))
    .map((target) => {
      const channels = byTarget.get(target);
      const tracks = CHANNEL_ORDER.filter((channel) => channels.has(channel)).map((channel) => {
        const track = channels.get(channel);
        return Object.freeze({
          track,
          channel,
          label: channelLabel(channel),
          keys: Object.freeze(
            model.children(track, 'keys').map((uid) => Object.freeze({ uid, t: model.prop(uid, 't'), v: model.prop(uid, 'v') })),
          ),
        });
      });
      return Object.freeze({ target, label: targetLabel(model, target), tracks: Object.freeze(tracks) });
    });
}

/**
 * What "+ Track" offers for the object selection (`DESIGN.md` §5.8): the selected joint or the selected root, with its
 * channels that have no track in the clip. Nothing selected offers nothing.
 * @param {import('./model/model.js').Model} model Document model.
 * @param {number|null} clip Open clip uid, or `null`.
 * @param {ReadonlyArray<number>} objects Selected object uids.
 * @returns {{ target: number|null, label: string, channels: string[], reason: string|null }} The target (`null` when
 *   the selection has none), its label, the missing channels in {@link CHANNEL_ORDER} and why nothing can be added
 *   (`open a clip`, `select one joint or the root`, `every channel of <label> has a track`), else `null`.
 */
export function trackMenu(model, clip, objects) {
  const only = objects.length === 1 ? objects[0] : null;
  const target = only !== null && (only === ROOT_UID || model.get(only)?.type === 'joint') ? only : null;
  if (target === null) return { target: null, label: '', channels: [], reason: 'select one joint or the root' };
  const label = targetLabel(model, target);
  if (clip === null || model.get(clip)?.type !== 'clip') return { target, label, channels: [], reason: 'open a clip' };
  const taken = new Set(
    model.children(clip, 'tracks').filter((track) => targetOfTrack(model, track) === target).map((track) => model.prop(track, 'channel')),
  );
  const channels = channelsOf(model, target).filter((channel) => channel !== 'sprite' && !taken.has(channel));
  return { target, label, channels, reason: channels.length === 0 ? `every channel of ${label} has a track` : null };
}

function trimmed(value) {
  return String(Number(value.toFixed(1)) + 0);
}

/**
 * A key value in display units (`DESIGN.md` §5.8): degrees for `angle` and `bodyAngle`, % for multipliers, the asset
 * name (or id) for `sprite`, `(none)` for a `null` sprite.
 * @param {import('./model/model.js').Model} model Document model.
 * @param {string} channel Channel name.
 * @param {number|string|null} value Value in the channel unit.
 * @returns {string} E.g. `35°`, `50%`, `head_open`.
 */
export function keyValueText(model, channel, value) {
  if (channel === 'sprite') {
    if (typeof value !== 'string') return '(none)';
    const uid = model.uidOf(value);
    const name = uid === null || uid === undefined ? null : model.prop(uid, 'name');
    return typeof name === 'string' && name !== '' ? name : value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  if (channel === 'angle' || channel === 'bodyAngle') return `${trimmed(toDisplay(value, 'rad'))}°`;
  return `${trimmed(toDisplay(value, 'mult'))}%`;
}

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
 * @param {ReadonlyArray<{ keys: ReadonlyArray<{ uid: number, t: number }> }>} rows Timeline sub-track rows.
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
