import { defaultsOf } from '../../lib/schema.js';
import { dragShapeTool } from './drag-shape.js';

/**
 * Circle draft of a drag: centered on the anchor, with the radius being the distance to the unsnapped pointer,
 * rounded by `snapLength`.
 * @param {import('../../lib/geometry.js').Vec2} anchor Grid-snapped press point, world meters.
 * @param {import('../../lib/geometry.js').Vec2} pointer Pointer, world meters, not snapped.
 * @param {(length: number) => number} snapLength Grid snap of a length, meters.
 * @returns {import('./drag-shape.js').ShapeDraft|null} The draft, or `null` when the radius is 0.
 */
export function circleDraft(anchor, pointer, snapLength) {
  const radius = snapLength(Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y));
  if (!(radius > 0)) return null;
  return { center: { x: anchor.x, y: anchor.y }, shape: { type: 'circle', radius } };
}

/**
 * Builds the Circle tool (`C`).
 * @returns {Readonly<import('./tool.js').Tool>} A tool with its own press state.
 */
export function circleTool() {
  return dragShapeTool({
    id: 'circle',
    click: (anchor) => ({
      center: { x: anchor.x, y: anchor.y },
      shape: { type: 'circle', radius: defaultsOf('shape', 'circle').shape.radius },
    }),
    drag: (anchor, e, ctx) => circleDraft(anchor, e.world, ctx.snapLength),
  });
}
