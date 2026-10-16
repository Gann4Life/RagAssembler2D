import { toJson } from '../model/io.js';
import { COLORS, GIZMO_SIZE, LINE_WIDTH } from '../viewport/style.js';
import { defineTool } from './tool.js';

const PRIMARY = 0;

function rootTransform(json) {
  const position = Array.isArray(json.ragdoll?.position) ? json.ragdoll.position : [0, 0];
  return { x: position[0], y: position[1], angle: json.ragdoll?.angle ?? 0 };
}

/**
 * Builds the Pose tool: in Edit mode a left press on a shape starts a physics test through `ctx.physics`, pulling
 * the shape's body toward the pointer while the button is held; the simulated pose is shown with `ctx.setPose`
 * and discarded on release or cancel. A press the physics service refuses shows `not-allowed` until the release.
 * Never executes a command and never changes the selection.
 * @returns {Readonly<import('./tool.js').Tool>} The tool.
 */
export function poseTool() {
  let ctx = null;
  let session = null;
  let refused = false;
  let hoverCursor = null;

  function canStart() {
    return ctx.physics !== null && ctx.physics !== undefined && ctx.modes.can('edit.rest');
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

  function end() {
    const active = session !== null || refused;
    const running = session;
    session = null;
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

  return defineTool({
    id: 'pose',
    activate(context) {
      ctx = context;
      session = null;
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
      try {
        const json = toJson(ctx.model, ctx.editorVersion());
        session = ctx.physics.startPose(json, {
          root: rootTransform(json),
          bodyId: body.props.id,
          point: { x: e.world.x, y: e.world.y },
        });
      } catch {
        session = null;
        refused = true;
        hoverCursor = 'not-allowed';
        ctx.setCursor('not-allowed');
        return;
      }
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
      end();
    },
    cancel() {
      return end();
    },
    tick(seconds) {
      if (session === null) return;
      session.advance(seconds);
      const pose = new Map();
      for (const [id, transform] of session.pose()) {
        const uid = ctx.model.uidOf(id);
        if (uid !== null) pose.set(uid, transform);
      }
      ctx.setPose(pose);
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
