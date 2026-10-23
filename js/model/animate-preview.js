import { fkPose, resolveChannels } from '../../lib/evaluate.js';
import { ROOT_UID } from './model.js';
import { toJson } from './io.js';

const PREVIEW_VERSION = 'preview';

/**
 * Pose of every body at a clip time, by body uid in the root-local frame, from the joint angles and the root
 * `bodyAngle` the clip resolves.
 * Never changes the model.
 * @param {import('./model.js').Model} model Document model.
 * @param {number} clip Uid of a clip.
 * @param {number} time Clip time in seconds, wrapped or clamped per the clip's `loop`.
 * @returns {Map<number, import('../../lib/geometry.js').Transform>} FK pose by body uid.
 */
export function animatePose(model, clip, time) {
  return poseFromDef(model, toJson(model, PREVIEW_VERSION), clip, time);
}

function poseFromDef(model, def, clip, time) {
  const clipDef = def.clips[model.children(ROOT_UID, 'clips').indexOf(clip)];
  const layers = clipDef ? [{ clip: clipDef, time }] : [];
  const { joints, root } = resolveChannels(def, layers);
  const pose = new Map();
  for (const [id, transform] of fkPose(def, joints, root.bodyAngle)) pose.set(model.uidOf(id), transform);
  return pose;
}

/**
 * Keeps a view showing the FK pose of the open clip at the playhead while in Animate mode, and `null` (the rest
 * pose) otherwise. Recomputes on playhead, mode and model changes; the document is read from a cache that model
 * changes invalidate.
 * @param {import('./model.js').Model} model Document model.
 * @param {import('../modes.js').Modes} modes Editor modes holding the open clip and the playhead.
 * @param {(pose: (Map<number, import('../../lib/geometry.js').Transform>|null)) => void} apply Receives the pose to show.
 * @returns {{ refresh: () => void, destroy: () => void }} `refresh` recomputes and applies; `destroy` unsubscribes.
 */
export function bindAnimatePreview(model, modes, apply) {
  let def = null;
  let showing = false;
  const refresh = () => {
    if (modes.mode === 'animate' && modes.clip !== null) {
      def ??= toJson(model, PREVIEW_VERSION);
      apply(poseFromDef(model, def, modes.clip, modes.playhead));
      showing = true;
    } else if (showing) {
      apply(null);
      showing = false;
    }
  };
  const offs = [
    model.on('change', () => {
      def = null;
      refresh();
    }),
    model.on('reset', () => {
      def = null;
      refresh();
    }),
    modes.on('mode', refresh),
    modes.on('playhead', refresh),
  ];
  refresh();
  return {
    refresh,
    destroy() {
      for (const off of offs) off();
    },
  };
}
