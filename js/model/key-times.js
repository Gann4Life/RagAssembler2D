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
 * Which key times get a ghost and on which side of the playhead (`DESIGN.md` §5.1, Ghosts): a key time is skipped
 * while it maps to the same simulation step as the playhead; the others are `ahead` (after the playhead) or `behind`.
 * @param {ReadonlyArray<number>} times Key times, seconds.
 * @param {number} playhead Playhead clip time, seconds.
 * @param {(t: number) => number} stepOf Simulation step of a clip time.
 * @returns {Array<{ t: number, side: 'ahead'|'behind' }>} Ghost times in the order given.
 */
export function ghostTimes(times, playhead, stepOf) {
  const current = stepOf(playhead);
  const ghosts = [];
  for (const t of times) {
    const step = stepOf(t);
    if (step === current) continue;
    ghosts.push({ t, side: step > current ? 'ahead' : 'behind' });
  }
  return ghosts;
}
