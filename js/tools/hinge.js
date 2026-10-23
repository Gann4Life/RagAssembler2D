import { motorTorqueSuggestions } from '../../lib/motor.js';
import { createJoint } from '../commands/create.js';
import { toJson } from '../model/io.js';
import { jointBetween, orderJointBodies } from '../model/queries.js';
import { placement } from '../viewport/placement.js';
import { snapAngle } from '../viewport/snap.js';
import { COLORS, GIZMO_SIZE, LINE_WIDTH } from '../viewport/style.js';
import { formatLimits } from './joint-limits.js';
import { DRAG_THRESHOLD, defineTool } from './tool.js';

const PRIMARY = 0;
const PIVOT_DEAD_ZONE = 1;
const READOUT_OFFSET = 16;

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

function withSuggestedTorque(create, editorVersion) {
  return Object.freeze({
    label: create.label,
    run(tx) {
      const uid = create.run(tx);
      const suggestion = motorTorqueSuggestions(toJson(tx.model, editorVersion())).get(tx.model.prop(uid, 'id'));
      if (typeof suggestion === 'number') tx.set(uid, 'motor.maxTorque', suggestion);
      return uid;
    },
  });
}

function wrap(angle) {
  const turned = angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
  return turned === -Math.PI ? Math.PI : turned;
}

/**
 * Limits of a Hinge drag from the limit angle φ: rounded to a whole degree, then to 15° with SHIFT; one-sided
 * (`0 / φ` for φ > 0, `φ / 0` for φ < 0), or `−|φ| / |φ|` with ALT.
 * @param {number} phi Angle from the zero direction to the pointer, radians, in (−π, π], counter-clockwise positive.
 * @param {{ shift: boolean, alt: boolean }} modifiers SHIFT and ALT held.
 * @returns {Readonly<{ lower: number, upper: number }>} Limits, radians, never `-0`.
 */
export function hingeLimits(phi, { shift, alt }) {
  const a = snapAngle((Math.round((phi * 180) / Math.PI) * Math.PI) / 180, shift) + 0;
  if (alt) return Object.freeze({ lower: -Math.abs(a) + 0, upper: Math.abs(a) });
  return Object.freeze({ lower: Math.min(a, 0) + 0, upper: Math.max(a, 0) + 0 });
}

/**
 * Builds the Hinge Joint tool: a press where shapes of two bodies overlap anchors a revolute joint at the
 * grid-snapped press point; a click creates a pin, a drag creates one-sided limits toward the pointer (ALT:
 * symmetric) and shows them in a readout. `motor.maxTorque` is the joint's suggested torque (`DESIGN.md` §3.1), the
 * schema default when there is none. One joint per press through `history.execute`, then the joint is
 * selected. Refused spots show the `not-allowed` cursor while hovering.
 * @returns {Readonly<import('./tool.js').Tool>} The tool.
 */
export function hingeTool() {
  let ctx = null;
  let press = null;

  function latch(event) {
    if (!press.dragging && distance(press.screen, event.screen) >= DRAG_THRESHOLD) press.dragging = true;
    press.last = event;
    if (!press.dragging) return;
    const a = ctx.camera.worldToScreen(press.anchor);
    const d = { x: event.screen.x - a.x, y: event.screen.y - a.y };
    if (Math.hypot(d.x, d.y) >= PIVOT_DEAD_ZONE) press.phi = wrap(Math.atan2(-d.y, d.x) - press.zero);
  }

  function currentLimits() {
    return hingeLimits(press.phi, { shift: press.last.shift, alt: press.last.alt });
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
      const zero = placement(ctx.model).root.angle + 0;
      press = { screen: e.screen, anchor, pair, zero, dragging: false, last: e, phi: 0 };
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
      const { lower, upper } = currentLimits();
      const { pair, anchor } = press;
      press = null;
      ctx.invalidateOverlay();
      const spec = { ...pair, anchor: ctx.toLocal(anchor) };
      if (lower !== 0 || upper !== 0) spec.limits = { enabled: true, lower, upper };
      const uid = ctx.history.execute(withSuggestedTorque(createJoint(spec), ctx.editorVersion));
      ctx.selection.set([uid]);
    },
    cancel() {
      if (!press) return false;
      press = null;
      ctx.invalidateOverlay();
      return true;
    },
    readout() {
      if (!press?.dragging) return null;
      const { lower, upper } = currentLimits();
      const { x, y } = press.last.screen;
      return { text: formatLimits(lower, upper), screen: { x: x + READOUT_OFFSET, y: y + READOUT_OFFSET } };
    },
    drawOverlay(g) {
      if (!press) return;
      const a = ctx.camera.worldToScreen(press.anchor);
      const { zero } = press;
      const { lower, upper } = currentLimits();
      g.circle(a.x, a.y, GIZMO_SIZE.jointCircle);
      const tip = along(a, zero, GIZMO_SIZE.jointNeedle);
      g.moveTo(a.x, a.y);
      g.lineTo(tip.x, tip.y);
      if (lower !== 0 || upper !== 0) {
        const start = along(a, zero + lower, GIZMO_SIZE.jointArc);
        g.moveTo(start.x, start.y);
        g.arc(a.x, a.y, GIZMO_SIZE.jointArc, -(zero + lower), -(zero + upper), true);
      }
      g.stroke({ width: LINE_WIDTH.outline, color: COLORS.highlight });
    },
  });
}
