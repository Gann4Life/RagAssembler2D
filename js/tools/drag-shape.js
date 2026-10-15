import { createShapeBody } from '../commands/create.js';
import { ROOT_UID } from '../model/model.js';
import { COLORS, LINE_WIDTH } from '../viewport/style.js';
import { DRAG_THRESHOLD, defineTool } from './tool.js';

const PRIMARY = 0;
const PREVIEW_FILL_ALPHA = 0.2;

/**
 * What a shape tool would create: the shape center in world meters (Y up) and a world-axis-aligned shape.
 * @typedef {object} ShapeDraft
 * @property {import('../../lib/geometry.js').Vec2} center Shape center, world meters.
 * @property {{ type: 'circle', radius: number } | { type: 'box', width: number, height: number }} shape Shape sizes, meters.
 */

function travelled(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * Builds a Circle or Box style tool: press sets the anchor, a move of at least `DRAG_THRESHOLD` px makes the
 * press a drag for good, release creates one shape body through `history.execute` and selects its shape.
 * Nothing is created when the press is cancelled or the drag draft is `null`. The tool is cursor `crosshair`
 * with no hover feedback and previews its draft in `drawOverlay`.
 * @param {object} spec Tool definition.
 * @param {'circle'|'box'} spec.id Tool id.
 * @param {(anchor: import('../../lib/geometry.js').Vec2) => ShapeDraft} spec.click Default-size draft at the grid-snapped anchor.
 * @param {(anchor: import('../../lib/geometry.js').Vec2, e: import('./tool.js').ToolPointerEvent, ctx: import('./tool.js').ToolContext) => ShapeDraft|null} spec.drag
 *   Draft of a drag, or `null` when refused.
 * @returns {Readonly<import('./tool.js').Tool>} The tool.
 */
export function dragShapeTool({ id, click, drag }) {
  let ctx = null;
  let press = null;

  function latch(event) {
    if (!press.dragging && travelled(press.screen, event.screen) >= DRAG_THRESHOLD) press.dragging = true;
    press.last = event;
  }

  function draftOf(event) {
    return press.dragging ? drag(press.anchor, event, ctx) : click(press.anchor);
  }

  function create(draft) {
    const rootAngle = ctx.model.prop(ROOT_UID, 'angle') ?? 0;
    const uid = ctx.history.execute(
      createShapeBody({ position: ctx.toLocal(draft.center), angle: -rootAngle + 0, shape: draft.shape }),
    );
    ctx.selection.set([uid]);
  }

  return defineTool({
    id,
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
      press = { screen: e.screen, anchor: ctx.snapPoint(e.world), dragging: false, last: e };
      ctx.invalidateOverlay();
    },
    pointerMove(e) {
      if (!press) return;
      latch(e);
      ctx.invalidateOverlay();
    },
    pointerUp(e) {
      if (e.button !== PRIMARY || !press) return;
      latch(e);
      const draft = draftOf(e);
      press = null;
      ctx.invalidateOverlay();
      if (draft) create(draft);
    },
    cancel() {
      if (!press) return false;
      press = null;
      ctx.invalidateOverlay();
      return true;
    },
    drawOverlay(g) {
      if (!press) return;
      const draft = draftOf(press.last);
      if (!draft) return;
      const center = ctx.camera.worldToScreen(draft.center);
      const scale = ctx.camera.scale;
      if (draft.shape.type === 'circle') {
        g.circle(center.x, center.y, draft.shape.radius * scale);
      } else {
        const width = draft.shape.width * scale;
        const height = draft.shape.height * scale;
        g.rect(center.x - width / 2, center.y - height / 2, width, height);
      }
      g.fill({ color: COLORS.highlight, alpha: PREVIEW_FILL_ALPHA });
      g.stroke({ width: LINE_WIDTH.outline, color: COLORS.highlight });
    },
  });
}
