import { fkPose, resolveChannels } from '../../lib/evaluate.js';
import { ROOT_UID } from './model.js';
import { toJson } from './io.js';

const PREVIEW_VERSION = 'preview';

/**
 * Length of the handover blend of the main figure, milliseconds (`DESIGN.md` §5.1, Animate view).
 * @type {number}
 */
export const HANDOVER_MS = 150;

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

function smoothstep(u) {
  return u * u * (3 - 2 * u);
}

/**
 * Blend of two poses: each body's position and continuous angle go linearly from `from` to `to`; bodies missing
 * from `from` take their `to` transform.
 * @param {Map<number, import('../../lib/geometry.js').Transform>} from Start pose by uid.
 * @param {Map<number, import('../../lib/geometry.js').Transform>} to Target pose by uid.
 * @param {number} s Blend amount, 0 (`from`) to 1 (`to`).
 * @returns {Map<number, import('../../lib/geometry.js').Transform>} New pose by uid, the keys of `to`.
 */
export function blendPoses(from, to, s) {
  const pose = new Map();
  for (const [uid, target] of to) {
    const start = from.get(uid);
    if (start === undefined) {
      pose.set(uid, target);
      continue;
    }
    pose.set(uid, {
      x: start.x + (target.x - start.x) * s,
      y: start.y + (target.y - start.y) * s,
      angle: start.angle + (target.angle - start.angle) * s,
    });
  }
  return pose;
}

const isRun = (source) => typeof source === 'string' && /^\d+:/.test(source);
const BLEND_FROM = new Set(['hold', 'fk']);

/**
 * Keeps the viewport showing the pose of the current mode (`DESIGN.md` §5.1): the rest pose (`null`) in Edit mode,
 * the live simulation in Simulate mode, and in Animate mode the main figure of the Animate view, the posed hold
 * while the player holds, else the clip simulation at the playhead, else the FK pose when the clip simulation is not
 * available; plus the ghosts. A change of source to a clip simulation step that the user did not cause by moving
 * the playhead (from the hold, another run, the latest step reached or the FK pose) blends over
 * {@link HANDOVER_MS} with a smoothstep in time, the target following the playhead. Display only.
 * @param {object} options
 * @param {import('./model.js').Model} options.model Document model.
 * @param {import('../modes.js').Modes} options.modes Editor modes.
 * @param {import('../timeline-player.js').TimelinePlayer} options.player Playback driver.
 * @param {import('../timeline-player.js').PlayerClock} options.clock Frames and `now()` in milliseconds for the blend.
 * @param {(pose: (Map<number, import('../../lib/geometry.js').Transform>|null)) => void} options.apply Receives the
 *   pose to show; `null` is the rest pose.
 * @param {(ghosts: ReadonlyArray<import('../timeline-player.js').Ghost>) => void} [options.applyGhosts] Receives the
 *   ghosts to draw whenever they change.
 * @param {() => boolean} [options.ghostsOn] Whether ghosts are shown (onion skins on); when it returns `false` the
 *   ghosts are not read and none are applied. Call `refresh` after it changes. On when omitted.
 * @returns {{ refresh: () => void, destroy: () => void }} `refresh` recomputes and applies; `destroy` unsubscribes.
 */
export function bindAnimateView({ model, modes, player, clock, apply, applyGhosts = () => {}, ghostsOn = () => true }) {
  let def = null;
  let shown = null;
  let source = null;
  let blend = null;
  let handle = null;
  let ghostKey = '';
  const now = () => (typeof clock.now === 'function' ? clock.now() : 0);

  const fk = () => {
    def ??= toJson(model, PREVIEW_VERSION);
    return { pose: poseFromDef(model, def, modes.clip, modes.playhead), source: 'fk' };
  };

  const target = () => {
    if (modes.mode === 'simulate') return { pose: player.livePose, source: 'live' };
    if (modes.mode !== 'animate' || modes.clip === null) return { pose: null, source: 'rest' };
    if (player.holding) return { pose: player.heldPose, source: 'hold' };
    return player.figure() ?? fk();
  };

  const schedule = () => {
    if (handle === null) {
      handle = clock.request(() => {
        handle = null;
        refresh(false);
      });
    }
  };

  const updateGhosts = () => {
    const ghosts = ghostsOn() ? player.ghosts() : [];
    const key = ghosts.map((ghost) => `${ghost.t}/${ghost.key}`).join('|');
    if (key === ghostKey) return;
    ghostKey = key;
    applyGhosts(ghosts);
  };

  function refresh(instant = false) {
    const next = target();
    const changed = next.source !== source;
    if (instant) {
      blend = null;
    } else if (changed && shown !== null && next.pose !== null && isRun(next.source) && (isRun(source) || BLEND_FROM.has(source))) {
      blend = { from: shown, start: now() };
    }
    source = next.source;
    let pose = next.pose;
    if (blend !== null && pose !== null) {
      const u = (now() - blend.start) / HANDOVER_MS;
      if (u >= 1) blend = null;
      else {
        pose = blendPoses(blend.from, pose, smoothstep(Math.max(0, u)));
        schedule();
      }
    }
    if (pose !== shown) {
      shown = pose;
      apply(pose);
    }
    updateGhosts();
  }

  const offs = [
    player.on('view', ({ instant }) => refresh(instant)),
    model.on('change', () => {
      def = null;
      refresh(false);
    }),
    model.on('reset', () => {
      def = null;
      refresh(true);
    }),
  ];
  refresh(true);
  return {
    refresh: () => refresh(false),
    destroy() {
      for (const off of offs) off();
      if (handle !== null) clock.cancel(handle);
      handle = null;
    },
  };
}
