import { sampleTrack } from '../../lib/evaluate.js';
import { ROOT_UID } from '../model/model.js';
import { jointTree } from '../model/queries.js';

/**
 * What Set as root body changes, computed from the model before mutating it.
 * @typedef {object} RootBodyPlan
 * @property {number} body Uid of the body that becomes `rootBody`.
 * @property {ReadonlyArray<{ joint: number, sign: number }>} path Tree joints from the old `rootBody` to the new one,
 *   in the old spanning tree, each with +1 when the path crosses it from its bodyA to its bodyB, else -1; empty when
 *   the new body is not connected to the old one or the old one names no body.
 * @property {ReadonlyArray<{ clip: number, track: (number|null), keys: ReadonlyArray<import('../../lib/evaluate.js').Key> }>} tracks
 *   Converted root `bodyAngle` keys per changed clip, sorted by `t`; `track` is the track to rewrite, `null` when one
 *   is appended.
 */

const SAME_TIME = 1e-6;
const DEFAULT_INTERP = 'linear';

function keysOf(model, track) {
  return model.children(track, 'keys').map((uid) => model.get(uid).props);
}

function channelTracks(model, clip, target, channel) {
  return model
    .children(clip, 'tracks')
    .filter((uid) => model.prop(uid, 'target') === target && model.prop(uid, 'channel') === channel);
}

function sampledTrack(model, tracks) {
  return tracks.findLast((uid) => model.children(uid, 'keys').length > 0);
}

function pathFrom(model, body) {
  const tree = jointTree(model);
  if (tree.root === null || !tree.depth.has(body)) return [];
  const path = [];
  for (let child = body; child !== tree.root; ) {
    const joint = tree.parent.get(child);
    const { bodyA, bodyB } = model.get(joint).props;
    const a = model.uidOf(bodyA);
    const parent = a === child ? model.uidOf(bodyB) : a;
    path.unshift({ joint, sign: a === parent ? 1 : -1 });
    child = parent;
  }
  return path;
}

function unionTimes(terms) {
  const times = terms.flatMap(({ keys }) => keys.map((key) => key.t)).toSorted((a, b) => a - b);
  return times.filter((t, index) => index === 0 || t - times[index - 1] >= SAME_TIME);
}

function interpAt(keys, t) {
  let interp;
  for (const key of keys) if (key.t <= t + SAME_TIME) interp = key.interp;
  return interp ?? DEFAULT_INTERP;
}

function segmentInterp(terms, from, to, ownKeys, loopLength) {
  const kinds = new Set();
  for (const { keys } of terms) {
    if (sampleTrack(keys, from, false, loopLength) !== sampleTrack(keys, to, false, loopLength)) {
      kinds.add(interpAt(keys, from));
    }
  }
  if (kinds.size === 0) {
    const own = ownKeys.find((key) => Math.abs(key.t - from) < SAME_TIME);
    return own?.interp ?? DEFAULT_INTERP;
  }
  if (kinds.size === 1 && (kinds.has('step') || kinds.has('ease'))) return [...kinds][0];
  return DEFAULT_INTERP;
}

function convertedKeys(terms, ownKeys, loopLength) {
  const times = unionTimes(terms);
  return times.map((t, index) => {
    const v = terms.reduce((sum, { keys, sign }) => sum + sign * (sampleTrack(keys, t, false, loopLength) ?? 0), 0);
    let interp;
    if (index + 1 < times.length) interp = segmentInterp(terms, t, times[index + 1], ownKeys, loopLength);
    else if (loopLength !== null) interp = segmentInterp(terms, t, times[0], ownKeys, loopLength);
    else interp = segmentInterp([], t, t, ownKeys, null);
    return Object.freeze({ t, v, interp });
  });
}

function clipChange(model, clip, path) {
  const rootId = model.prop(ROOT_UID, 'id');
  const own = channelTracks(model, clip, rootId, 'bodyAngle');
  const ownSampled = sampledTrack(model, own);
  const ownKeys = ownSampled === undefined ? [] : keysOf(model, ownSampled);
  const jointTerms = [];
  for (const { joint, sign } of path) {
    const track = sampledTrack(model, channelTracks(model, clip, model.prop(joint, 'id'), 'angle'));
    if (track !== undefined) jointTerms.push({ keys: keysOf(model, track), sign });
  }
  if (jointTerms.length === 0) return null;
  const loopLength = model.prop(clip, 'loop') ? model.prop(clip, 'length') : null;
  const keys = convertedKeys([{ keys: ownKeys, sign: 1 }, ...jointTerms], ownKeys, loopLength);
  const track = ownSampled ?? own.at(-1) ?? null;
  return Object.freeze({ clip, track, keys: Object.freeze(keys) });
}

/**
 * Computes Set as root body for a body ([DESIGN.md §2.1]): the old-tree path from the old `rootBody` and, for every
 * clip with `angle` tracks on it, the converted root `bodyAngle` keys `oldBodyAngle(t) + Σ sign·angle(t)` at the
 * union of the terms' key times. The tracks a clip samples are the last ones with keys, as `evaluateClip` does.
 * Reads the model only.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {number} bodyUid Uid of the body that becomes `rootBody`.
 * @returns {Readonly<RootBodyPlan>} The frozen plan.
 * @throws {Error} When `bodyUid` is not a body.
 */
export function rootBodyPlan(model, bodyUid) {
  if (model.get(bodyUid)?.type !== 'body') throw new Error(`Node ${bodyUid} is not a body`);
  const path = pathFrom(model, bodyUid);
  const tracks = [];
  if (path.length > 0) {
    for (const clip of model.children(ROOT_UID, 'clips')) {
      const change = clipChange(model, clip, path);
      if (change !== null) tracks.push(change);
    }
  }
  return Object.freeze({
    body: bodyUid,
    path: Object.freeze(path.map((step) => Object.freeze(step))),
    tracks: Object.freeze(tracks),
  });
}

function isRootBody(model, bodyUid) {
  const rootBody = model.prop(ROOT_UID, 'rootBody');
  return typeof rootBody === 'string' && model.uidOf(rootBody) === bodyUid;
}

function rewriteKeys(tx, track, keys) {
  const { model } = tx;
  keys.forEach((key, index) => {
    const existing = model.children(track, 'keys').find((uid) => Math.abs(model.prop(uid, 't') - key.t) < SAME_TIME);
    if (existing === undefined) {
      tx.add(track, 'keys', index, { type: 'key', props: { ...key } });
      return;
    }
    if (model.prop(existing, 'v') !== key.v) tx.set(existing, 'v', key.v);
    if (model.prop(existing, 'interp') !== key.interp) tx.set(existing, 'interp', key.interp);
  });
}

/**
 * Builds a command that makes a body `rootBody` as {@link rootBodyPlan} computes when it runs: sets `rootBody` to
 * its id and writes the converted root `bodyAngle` keys of every clip, updating keys in place, inserting new ones
 * and appending a `bodyAngle` track to a clip without one. Joints are never changed.
 * @param {number} bodyUid Uid of the body that becomes `rootBody`.
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds `bodyUid` not a body or already `rootBody`; nothing is mutated then.
 */
export function setRootBody(bodyUid, label = 'Set as root body') {
  return Object.freeze({
    label,
    run(tx) {
      const { model } = tx;
      const plan = rootBodyPlan(model, bodyUid);
      if (isRootBody(model, bodyUid)) throw new Error('The body is already the root body');
      tx.set(ROOT_UID, 'rootBody', model.prop(bodyUid, 'id'));
      for (const { clip, track, keys } of plan.tracks) {
        if (track !== null) {
          rewriteKeys(tx, track, keys);
          continue;
        }
        tx.add(clip, 'tracks', undefined, {
          type: 'track',
          props: { target: model.prop(ROOT_UID, 'id'), channel: 'bodyAngle' },
          children: { keys: keys.map((key) => ({ type: 'key', props: { ...key } })) },
        });
      }
    },
  });
}
