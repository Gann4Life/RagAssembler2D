import { jointAngleForBody } from '../../lib/evaluate.js';
import { setJointAngleKey, setRootBodyAngleKey } from '../commands/keys.js';
import { animatePose } from '../model/animate-preview.js';
import { toJson } from '../model/io.js';
import { ROOT_UID } from '../model/model.js';
import { jointTree } from '../model/queries.js';
import { COLORS, GIZMO_SIZE, LINE_WIDTH } from '../viewport/style.js';
import { defineTool } from './tool.js';

const PRIMARY = 0;
const PREVIEW_VERSION = 'preview';
const KEY_THRESHOLD = (0.1 * Math.PI) / 180;

function rootTransform(json) {
  const position = Array.isArray(json.ragdoll?.position) ? json.ragdoll.position : [0, 0];
  return { x: position[0], y: position[1], angle: json.ragdoll?.angle ?? 0 };
}

function byId(model, pose) {
  return new Map([...pose].map(([uid, transform]) => [model.prop(uid, 'id'), transform]));
}

function changedRootAngle(model, from, to) {
  const id = model.prop(ROOT_UID, 'rootBody');
  const uid = typeof id === 'string' ? model.uidOf(id) : null;
  if (uid === null || uid === undefined || !from.has(uid) || !to.has(uid)) return null;
  const angle = to.get(uid).angle - model.prop(uid, 'angle');
  const turned = to.get(uid).angle - from.get(uid).angle;
  return Number.isFinite(angle) && Math.abs(turned) > KEY_THRESHOLD ? angle : null;
}

function changedJointAngles(model, from, to) {
  const def = toJson(model, PREVIEW_VERSION);
  const fromIds = byId(model, from);
  const toIds = byId(model, to);
  const changes = [];
  for (const [body, joint] of jointTree(model).parent) {
    if (!from.has(body) || !to.has(body)) continue;
    const jointId = model.prop(joint, 'id');
    const base = jointAngleForBody(def, jointId, from.get(body).angle, fromIds);
    const angle = jointAngleForBody(def, jointId, to.get(body).angle, toIds);
    if (base === null || angle === null || !Number.isFinite(angle)) continue;
    if (Math.abs(angle - base) > KEY_THRESHOLD) changes.push([joint, angle]);
  }
  return changes;
}

/**
 * Builds the Pose tool: a left press on a shape starts a physics test through `ctx.physics`, pulling the shape's
 * body toward the pointer while the button is held; the simulated pose is shown with `ctx.setPose`. In Edit mode the
 * result is discarded on release. In Animate mode the test starts from the FK pose at the playhead with `rootBody`
 * held to what FK can show, and on release every joint whose angle changed by more than 0.1° gets an `angle` key at
 * the playhead, and the root `bodyAngle` too when `rootBody` turned by more than 0.1°, in the press's undo step.
 * Cancel always discards. A press the physics service refuses shows `not-allowed` until the release. Never changes
 * the selection.
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
      if (uid !== null) mapped.set(uid, transform);
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

  function keyResult() {
    if (session === null || animate === null) return;
    const { clip, time, from } = animate;
    if (ctx.model.get(clip)?.type !== 'clip') return;
    const result = uidPose(session.pose());
    for (const [joint, angle] of changedJointAngles(ctx.model, from, result)) {
      ctx.history.execute(setJointAngleKey(clip, joint, time, angle, 'Pose'));
    }
    const bodyAngle = changedRootAngle(ctx.model, from, result);
    if (bodyAngle !== null) ctx.history.execute(setRootBodyAngleKey(clip, time, bodyAngle, 'Pose'));
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
      const keying = ctx.modes.can('edit.rest')
        ? null
        : { clip: ctx.modes.clip, time: ctx.modes.playhead, from: null };
      try {
        if (keying !== null) keying.from = animatePose(ctx.model, keying.clip, keying.time);
        const json = toJson(ctx.model, ctx.editorVersion());
        session = ctx.physics.startPose(json, {
          root: rootTransform(json),
          bodyId: body.props.id,
          point: { x: e.world.x, y: e.world.y },
          start: keying === null ? null : byId(ctx.model, keying.from),
          holdRoot: keying !== null,
        });
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
        keyResult();
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
