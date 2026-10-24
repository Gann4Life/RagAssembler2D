const SAME_TIME = 1e-6;

/**
 * Key times of a clip: every distinct time in `[0, length]` that holds a key in any of its tracks, ascending.
 * Events are not keys. Times closer than 1e-6 s count once.
 * @param {import('./model.js').Model} model Document model.
 * @param {number|null} clip Uid of a clip, or `null`.
 * @returns {number[]} Times in seconds; empty for `null` or a node that is not a clip.
 */
export function keyTimes(model, clip) {
  if (clip === null || model.get(clip)?.type !== 'clip') return [];
  const length = model.prop(clip, 'length');
  const end = Number.isFinite(length) && length > 0 ? length : 0;
  const times = [];
  for (const track of model.children(clip, 'tracks')) {
    for (const key of model.children(track, 'keys')) {
      const t = model.prop(key, 't');
      if (Number.isFinite(t) && t >= 0 && t <= end) times.push(t);
    }
  }
  times.sort((a, b) => a - b);
  const distinct = [];
  for (const t of times) if (distinct.length === 0 || t - distinct[distinct.length - 1] >= SAME_TIME) distinct.push(t);
  return distinct;
}

/**
 * Which key times get a ghost and on which side of the playhead (`DESIGN.md` §5.1, Ghosts): only the nearest key
 * time `behind` the playhead and the nearest one `ahead` of it. A key time that maps to the same simulation step as
 * the playhead gets none.
 * @param {ReadonlyArray<number>} times Key times, seconds.
 * @param {number} playhead Playhead clip time, seconds.
 * @param {(t: number) => number} stepOf Simulation step of a clip time.
 * @returns {Array<{ t: number, side: 'ahead'|'behind' }>} At most two ghost times, `behind` first.
 */
export function ghostTimes(times, playhead, stepOf) {
  const current = stepOf(playhead);
  let behind = null;
  let ahead = null;
  for (const t of times) {
    const step = stepOf(t);
    if (step < current && (behind === null || step > behind.step)) behind = { t, step };
    if (step > current && (ahead === null || step < ahead.step)) ahead = { t, step };
  }
  const ghosts = [];
  if (behind !== null) ghosts.push({ t: behind.t, side: 'behind' });
  if (ahead !== null) ghosts.push({ t: ahead.t, side: 'ahead' });
  return ghosts;
}
