import { defaultsOf } from '../../lib/schema.js';
import { dragShapeTool } from './drag-shape.js';

function isCentered({ ctrl, alt }) {
  return Boolean(ctrl || alt);
}

function sign(value) {
  return value < 0 ? -1 : 1;
}

/**
 * Box draft of a drag. With `d` the vector from the anchor to the pointer, both axes are centered on the
 * anchor when ALT or CTRL is held (size `2·|d|`), else edge-anchored (size `|d|`, the box grows toward `d`,
 * `sign(0) = +1`). SHIFT then gives both sides the longer size.
 * @param {import('../../lib/geometry.js').Vec2} anchor Grid-snapped press point, world meters.
 * @param {import('../../lib/geometry.js').Vec2} pointer Grid-snapped pointer, world meters.
 * @param {{ shift?: boolean, ctrl?: boolean, alt?: boolean }} modifiers Modifier keys held.
 * @returns {import('./drag-shape.js').ShapeDraft|null} The draft, or `null` when a size is 0.
 */
export function boxDraft(anchor, pointer, { shift, ctrl, alt }) {
  const dx = pointer.x - anchor.x;
  const dy = pointer.y - anchor.y;
  const centered = isCentered({ ctrl, alt });
  const factor = centered ? 2 : 1;
  let width = factor * Math.abs(dx);
  let height = factor * Math.abs(dy);
  if (shift) {
    width = Math.max(width, height);
    height = width;
  }
  if (!(width > 0) || !(height > 0)) return null;
  const center = centered
    ? { x: anchor.x, y: anchor.y }
    : { x: anchor.x + (sign(dx) * width) / 2, y: anchor.y + (sign(dy) * height) / 2 };
  return { center: { x: center.x + 0, y: center.y + 0 }, shape: { type: 'box', width, height } };
}

/**
 * Builds the Box tool (`R`).
 * @returns {Readonly<import('./tool.js').Tool>} A tool with its own press state.
 */
export function boxTool() {
  const { width, height } = defaultsOf('shape', 'box').shape;
  return dragShapeTool({
    id: 'box',
    click: (anchor) => ({ center: { x: anchor.x, y: anchor.y }, shape: { type: 'box', width, height } }),
    drag: (anchor, e, ctx) =>
      boxDraft(anchor, ctx.snapPoint(e.world), { shift: e.shift, ctrl: e.ctrl, alt: e.alt }),
  });
}
