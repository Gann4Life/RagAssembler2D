import { COLORS, LINE_WIDTH } from '../viewport/style.js';
import { DRAG_THRESHOLD, defineTool } from './tool.js';

const PRIMARY = 0;
const BOX_FILL_ALPHA = 0.1;

function travelled(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * World box spanned by two world points.
 * @param {import('../../lib/geometry.js').Vec2} a First corner, meters.
 * @param {import('../../lib/geometry.js').Vec2} b Opposite corner, meters.
 * @returns {import('../../lib/geometry.js').Aabb} The box, meters.
 */
export function boxAabb(a, b) {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

/**
 * Applies a selection box: CTRL removes the uids, else SHIFT adds them, else they replace the selection
 * (an empty box clears it).
 * @param {import('../model/selection.js').Selection} selection Selection to change.
 * @param {number[]} uids Uids inside the box.
 * @param {{ shift: boolean, ctrl: boolean }} modifiers Modifiers held at the release.
 * @returns {void}
 */
export function applyBox(selection, uids, { shift, ctrl }) {
  if (ctrl) selection.remove(uids);
  else if (shift) selection.add(uids);
  else if (uids.length > 0) selection.set(uids);
  else selection.clear();
}

/**
 * Builds a selection tool with the shared press, 4 px drag latch, box and release lifecycle. A drag selects
 * through `ctx.boxTest` and `applyBox` at the release; a press that never becomes a drag calls `click`. The
 * selection changes only at the release; cancelling drops the press. Executes no command.
 * @param {object} spec Tool definition.
 * @param {'select'|'select-box'} spec.id Tool id.
 * @param {string} spec.cursor CSS cursor while idle.
 * @param {boolean} spec.hover Whether hover feedback is shown.
 * @param {(press: import('./tool.js').ToolPointerEvent, release: import('./tool.js').ToolPointerEvent, ctx: import('./tool.js').ToolContext) => void} spec.click
 *   Applies a click; modifiers are read from `release`.
 * @returns {Readonly<import('./tool.js').Tool>} The tool.
 */
export function marqueeTool({ id, cursor, hover, click }) {
  let ctx = null;
  let press = null;

  function latch(event) {
    if (!press.dragging && travelled(press.start.screen, event.screen) >= DRAG_THRESHOLD) press.dragging = true;
    press.last = event;
  }

  return defineTool({
    id,
    cursor,
    hover,
    activate(context) {
      ctx = context;
    },
    deactivate() {
      press = null;
    },
    pointerDown(e) {
      if (e.button !== PRIMARY) return;
      press = { start: e, anchor: e.world, dragging: false, last: e };
    },
    pointerMove(e) {
      if (!press) return;
      latch(e);
      if (press.dragging) ctx.invalidateOverlay();
    },
    pointerUp(e) {
      if (e.button !== PRIMARY || !press) return;
      latch(e);
      const { start, anchor, dragging } = press;
      press = null;
      ctx.invalidateOverlay();
      if (dragging) applyBox(ctx.selection, ctx.boxTest(boxAabb(anchor, e.world)), e);
      else click(start, e, ctx);
    },
    cancel() {
      if (!press) return false;
      press = null;
      ctx.invalidateOverlay();
      return true;
    },
    drawOverlay(g) {
      if (!press?.dragging) return;
      const a = ctx.camera.worldToScreen(press.anchor);
      const b = ctx.camera.worldToScreen(press.last.world);
      const minX = Math.min(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      g.rect(minX, minY, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      g.fill({ color: COLORS.highlight, alpha: BOX_FILL_ALPHA });
      g.stroke({ width: LINE_WIDTH.outline, color: COLORS.highlight });
    },
  });
}

/**
 * Select Box tool (`B`): a drag selects with a box; a press that never becomes a drag acts as an empty box.
 * Crosshair cursor, no hover feedback.
 * @returns {Readonly<import('./tool.js').Tool>} The tool.
 */
export function selectBoxTool() {
  return marqueeTool({
    id: 'select-box',
    cursor: 'crosshair',
    hover: false,
    click: (press, release, ctx) => applyBox(ctx.selection, [], release),
  });
}
