import { jointAngleForBody, resolveChannels } from '../../lib/evaluate.js';
import { setJointAngleKey, setRootBodyAngleKey } from '../commands/keys.js';
import { animatePose } from '../model/animate-preview.js';
import { toJson } from '../model/io.js';
import { ROOT_UID } from '../model/model.js';
import { jointTree } from '../model/queries.js';
import { COLORS, GIZMO_SIZE, LINE_WIDTH } from '../viewport/style.js';
import { DRAG_THRESHOLD, defineTool } from './tool.js';

const PRIMARY = 0;
const PREVIEW_VERSION = 'preview';
const KEY_THRESHOLD = (0.1 * Math.PI) / 180;
const AUTOKEY_OFF = 'Pose: autokey is off, no keys written';

function rootTransform(json) {
  const position = Array.isArray(json.ragdoll?.position) ? json.ragdoll.position : [0, 0];
  return { x: position[0], y: position[1], angle: json.ragdoll?.angle ?? 0 };
}

function byId(model, pose) {
  return new Map([...pose].map(([uid, transform]) => [model.prop(uid, 'id'), transform]));
}

function evaluated(model, def, clip, time) {
  const clipDef = def.clips[model.children(ROOT_UID, 'clips').indexOf(clip)];
  return resolveChannels(def, clipDef ? [{ clip: clipDef, time }] : []);
}

function rootKey(model, resolved, result) {
  const id = model.prop(ROOT_UID, 'rootBody');
  const uid = typeof id === 'string' ? model.uidOf(id) : null;
  if (uid === null || uid === undefined || !result.has(uid)) return null;
  const angle = result.get(uid).angle - model.prop(uid, 'angle');
  const base = Number.isFinite(resolved.root.bodyAngle) ? resolved.root.bodyAngle : 0;
  return Number.isFinite(angle) && Math.abs(angle - base) > KEY_THRESHOLD ? angle : null;
}

function jointKeys(model, def, resolved, result) {
  const resultIds = byId(model, result);
  const keys = [];
  for (const [body, joint] of jointTree(model).parent) {
    if (!result.has(body)) continue;
    const jointId = model.prop(joint, 'id');
    const angle = jointAngleForBody(def, jointId, result.get(body).angle, resultIds);
    if (angle === null || !Number.isFinite(angle)) continue;
    const base = resolved.joints.get(jointId)?.angle ?? 0;
    if (Math.abs(angle - (Number.isFinite(base) ? base : 0)) > KEY_THRESHOLD) keys.push([joint, angle]);
  }
  return keys;
}

/**
 * Builds the Pose tool: a left press on a shape starts a physics test through `ctx.physics`, pulling the shape's
 * body toward the pointer while the button is held; the simulated pose is shown with `ctx.setPose`. In Edit mode the
 * test starts from the rest pose and the result is discarded on release. In Animate mode it starts from exactly the
 * displayed bodies (`ctx.displayedPose`, the FK pose when nothing is shown) with `rootBody` held; a press while
 * playing pauses first (`ctx.playback.pause`, the playhead at the displayed step) and grabs in the same press. On a
 * release after a drag, with autokey on, every joint whose measured angle differs from its evaluated `angle` at the
 * playhead by more than 0.1° gets a key there, and the root `bodyAngle` likewise, in the press's undo step; with
 * autokey off nothing is written and the status line says so. A click writes nothing. Every Animate release hands the
 * released bodies to `ctx.playback.hold`. Cancel always discards. A press the physics service refuses shows
 * `not-allowed` until the release. Never changes the selection.
 * @returns {Readonly<import('./tool.js').Tool>} The tool.
 */
export function poseTool() {
  let ctx = null;
  let session = null;
  let animate = null;
  let refused = false;
  let hoverCursor = null;

  function animating() {
    return ctx.modes.can('edit.animation') && ctx.modes.clip !== null;
  }

  function canStart() {
    return ctx.physics !== null && ctx.physics !== undefined && (ctx.modes.can('edit.rest') || animating());
  }

  function shapeAt(screen) {
    for (const uid of ctx.hitTest(screen)) {
      if (ctx.model.get(uid)?.type === 'shape') return uid;
    }
    return null;
  }

  function setHoverCursor(css) {
    if (hoverCursor === css) return;
    hoverCursor = css;
    ctx.setCursor(css);
  }

  function uidPose(pose) {
    const mapped = new Map();
    for (const [id, transform] of pose) {
      const uid = ctx.model.uidOf(id);
      if (uid !== null && uid !== undefined) mapped.set(uid, transform);
    }
    return mapped;
  }

  function end() {
    const active = session !== null || refused;
    const running = session;
    session = null;
    animate = null;
    refused = false;
    if (!active) return false;
    hoverCursor = null;
    try {
      running?.destroy();
    } finally {
      if (running !== null) ctx.setPose(null);
      ctx.setCursor(null);
      ctx.invalidateOverlay();
    }
    return true;
  }

  function release() {
    if (session === null || animate === null) return;
    const { clip, time, dragged } = animate;
    if (ctx.model.get(clip)?.type !== 'clip') return;
    const result = uidPose(session.pose());
    if (dragged) {
      const def = toJson(ctx.model, PREVIEW_VERSION);
      const resolved = evaluated(ctx.model, def, clip, time);
      const joints = jointKeys(ctx.model, def, resolved, result);
      const bodyAngle = rootKey(ctx.model, resolved, result);
      const keying = joints.length > 0 || bodyAngle !== null;
      if (keying && !ctx.autokey()) {
        ctx.status(AUTOKEY_OFF);
      } else if (keying) {
        for (const [joint, angle] of joints) {
          ctx.history.execute(setJointAngleKey(clip, joint, time, angle, 'Pose', { snap: false }));
        }
        if (bodyAngle !== null) ctx.history.execute(setRootBodyAngleKey(clip, time, bodyAngle, 'Pose', { snap: false }));
      }
    }
    ctx.playback.hold(result);
  }

  function startPose(json, body, e, keying) {
    session = ctx.physics.startPose(json, {
      root: rootTransform(json),
      bodyId: body.props.id,
      point: { x: e.world.x, y: e.world.y },
      start: keying === null ? null : byId(ctx.model, keying.from),
      holdRoot: keying !== null,
    });
  }

  return defineTool({
    id: 'pose',
    activate(context) {
      ctx = context;
      session = null;
      animate = null;
      refused = false;
      hoverCursor = null;
    },
    deactivate() {
      end();
    },
    pointerDown(e) {
      if (e.button !== PRIMARY || e.shift || e.ctrl || e.alt) return;
      if (session !== null || refused || !canStart()) return;
      const shape = shapeAt(e.screen);
      if (shape === null) return;
      const body = ctx.model.get(ctx.model.get(shape).parent);
      let keying = null;
      try {
        if (!ctx.modes.can('edit.rest')) {
          const clip = ctx.modes.clip;
          const displayed = ctx.displayedPose();
          if (ctx.playback.playing) ctx.playback.pause();
          const time = ctx.modes.playhead;
          keying = { clip, time, from: displayed ?? animatePose(ctx.model, clip, time), screen: e.screen, dragged: false };
        }
        startPose(toJson(ctx.model, ctx.editorVersion()), body, e, keying);
      } catch {
        session = null;
        refused = true;
        hoverCursor = 'not-allowed';
        ctx.setCursor('not-allowed');
        return;
      }
      animate = keying;
      hoverCursor = 'grabbing';
      ctx.setCursor('grabbing');
      ctx.invalidateOverlay();
    },
    pointerMove(e) {
      if (session !== null) {
        if (animate !== null && !animate.dragged) {
          animate.dragged = Math.hypot(e.screen.x - animate.screen.x, e.screen.y - animate.screen.y) >= DRAG_THRESHOLD;
        }
        session.drag({ x: e.world.x, y: e.world.y });
        ctx.invalidateOverlay();
        return;
      }
      if (refused) return;
      setHoverCursor(canStart() && shapeAt(e.screen) !== null ? 'grab' : null);
    },
    pointerUp(e) {
      if (e.button !== PRIMARY) return;
      try {
        release();
      } finally {
        end();
      }
    },
    cancel() {
      return end();
    },
    tick(seconds) {
      if (session === null) return;
      session.advance(seconds);
      ctx.setPose(uidPose(session.pose()));
      ctx.invalidateOverlay();
    },
    drawOverlay(g) {
      if (session === null) return;
      const { anchor, target } = session.grab();
      const from = ctx.camera.worldToScreen(anchor);
      const to = ctx.camera.worldToScreen(target);
      g.moveTo(from.x, from.y);
      g.lineTo(to.x, to.y);
      g.stroke({ width: LINE_WIDTH.outline, color: COLORS.gizmo });
      g.circle(to.x, to.y, GIZMO_SIZE.pivot);
      g.fill(COLORS.gizmo);
    },
  });
}
