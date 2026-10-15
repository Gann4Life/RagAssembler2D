import { createJoint } from '../commands/create.js';
import { jointBetween, orderJointBodies } from '../model/queries.js';
import { jointZeroAngle, placement } from '../viewport/placement.js';
import { snapAngle } from '../viewport/snap.js';
import { COLORS, GIZMO_SIZE, LINE_WIDTH } from '../viewport/style.js';
import { DRAG_THRESHOLD, defineTool } from './tool.js';

const PRIMARY = 0;
const MAX_LIMIT_DEGREES = 180;

function distance(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function along(center, angle, length) {
  return { x: center.x + Math.cos(angle) * length, y: center.y - Math.sin(angle) * length };
}

/**
 * The two bodies a Hinge press would join: the bodies of the first two shapes of different bodies in `hits`.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {number[]} hits Uids under the pointer, topmost first; uids that are not shapes are skipped.
 * @returns {{ bodyA: number, bodyB: number }|null} Body uids ordered by `orderJointBodies`, or `null` when
 *   fewer than two bodies are hit or a joint already connects them.
 */
export function hingePair(model, hits) {
  const found = [];
  for (const uid of hits) {
    const node = model.get(uid);
    if (node?.type !== 'shape' || found.includes(node.parent)) continue;
    found.push(node.parent);
    if (found.length === 2) break;
  }
  if (found.length < 2) return null;
  const [first, second] = found;
  if (jointBetween(model, first, second) !== null) return null;
  return orderJointBodies(model, first, second);
}

/**
 * Symmetric limit θ of a Hinge drag: 1 CSS px = 1°, rounded to a whole degree, clamped to 0–180°, and
 * rounded to 15° with SHIFT.
 * @param {number} distance Screen distance from the anchor to the pointer, CSS px.
 * @param {boolean} shift Whether SHIFT is held.
 * @returns {number} θ, radians, never `-0`.
 */
export function hingeLimit(distance, shift) {
  const degrees = Math.min(MAX_LIMIT_DEGREES, Math.round(distance));
  return snapAngle((degrees * Math.PI) / 180, shift) + 0;
}

/**
 * Builds the Hinge Joint tool: a press where shapes of two bodies overlap anchors a revolute joint at the
 * grid-snapped press point; a click creates a pin, a drag creates limits ±θ. One joint per press through
 * `history.execute`, then the joint is selected. Refused spots show the `not-allowed` cursor while hovering.
 * @returns {Readonly<import('./tool.js').Tool>} The tool.
 */
export function hingeTool() {
  let ctx = null;
  let press = null;

  function latch(event) {
    if (!press.dragging && distance(press.screen, event.screen) >= DRAG_THRESHOLD) press.dragging = true;
    press.last = event;
  }

  function thetaOf(event) {
    if (!press.dragging) return 0;
    return hingeLimit(distance(ctx.camera.worldToScreen(press.anchor), event.screen), event.shift);
  }

  return defineTool({
    id: 'hinge',
    cursor: 'crosshair',
    hover: false,
    activate(context) {
      ctx = context;
    },
    deactivate() {
      press = null;
    },
    pointerDown(e) {
      if (e.button !== PRIMARY) return;
      const pair = hingePair(ctx.model, ctx.hitTest(e.screen));
      if (!pair) return;
      const anchor = ctx.snapPoint(e.world);
      const zero = jointZeroAngle(anchor, placement(ctx.model).bodies.get(pair.bodyB));
      press = { screen: e.screen, anchor, pair, zero, dragging: false, last: e };
      ctx.setCursor(null);
      ctx.invalidateOverlay();
    },
    pointerMove(e) {
      if (!press) {
        ctx.setCursor(hingePair(ctx.model, ctx.hitTest(e.screen)) ? null : 'not-allowed');
        return;
      }
      latch(e);
      ctx.invalidateOverlay();
    },
    pointerUp(e) {
      if (e.button !== PRIMARY || !press) return;
      latch(e);
      const theta = thetaOf(e);
      const { pair, anchor } = press;
      press = null;
      ctx.invalidateOverlay();
      const spec = { ...pair, anchor: ctx.toLocal(anchor) };
      if (theta > 0) spec.limits = { enabled: true, lower: -theta, upper: theta };
      const uid = ctx.history.execute(createJoint(spec));
      ctx.selection.set([uid]);
    },
    cancel() {
      if (!press) return false;
      press = null;
      ctx.invalidateOverlay();
      return true;
    },
    drawOverlay(g) {
      if (!press) return;
      const a = ctx.camera.worldToScreen(press.anchor);
      const { zero } = press;
      const theta = thetaOf(press.last);
      g.circle(a.x, a.y, GIZMO_SIZE.jointCircle);
      const tip = along(a, zero, GIZMO_SIZE.jointNeedle);
      g.moveTo(a.x, a.y);
      g.lineTo(tip.x, tip.y);
      if (theta > 0) {
        const start = along(a, zero - theta, GIZMO_SIZE.jointArc);
        g.moveTo(start.x, start.y);
        g.arc(a.x, a.y, GIZMO_SIZE.jointArc, -(zero - theta), -(zero + theta), true);
      }
      g.stroke({ width: LINE_WIDTH.outline, color: COLORS.highlight });
    },
  });
}
