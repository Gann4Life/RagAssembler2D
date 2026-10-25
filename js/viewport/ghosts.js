import { composeTransforms, transformPoint } from '../../lib/geometry.js';
import { defaultsOf } from '../../lib/schema.js';
import { ROOT_UID } from '../model/model.js';
import { shapeOutline } from './scene.js';
import { COLORS } from './style.js';

/**
 * Ghost drawing (`DESIGN.md` §5.4, Ghosts): fill and outline opacity, and the colors of key times ahead of and
 * behind the playhead, the grid axis colors.
 * @type {Readonly<{ fill: number, stroke: number, ahead: number, behind: number }>}
 */
export const GHOST_STYLE = Object.freeze({ fill: 0.12, stroke: 0.5, ahead: COLORS.gizmoY, behind: COLORS.gizmoX });

const FALLBACK_PIXELS_PER_METER = defaultsOf('document').units.pixelsPerMeter;

/**
 * @typedef {object} GhostLayer
 * @property {object} view `PIXI.Container` to add between the grid and the scene.
 * @property {(ghosts: ReadonlyArray<{ side: 'ahead'|'behind', pose: Map<number, import('../../lib/geometry.js').Transform> }>) => void} setGhosts
 *   Replaces the ghosts drawn; root-local poses by body uid, bodies missing from a pose drawn at rest.
 * @property {() => void} destroy Stops listening and destroys every display object.
 */

function vec(value) {
  return Array.isArray(value) && value.length === 2 ? { x: value[0], y: value[1] } : { x: 0, y: 0 };
}

function transformOf(props) {
  const { x, y } = vec(props.position);
  return { x, y, angle: Number.isFinite(props.angle) ? props.angle : 0 };
}

/**
 * Creates the ghost layer: every shape with valid geometry of each ghost, at the ghost's pose, filled and outlined
 * in its side's color (outlines 1 CSS px), never hit or selected. Redrawn once per frame from the PIXI shared ticker
 * when the ghosts, the model or the camera changed.
 * @param {object} PIXI The PIXI.js v8 namespace.
 * @param {{ model: import('../model/model.js').Model, camera: import('./camera.js').Camera }} options
 * @returns {GhostLayer}
 */
export function createGhosts(PIXI, { model, camera }) {
  const view = new PIXI.Container();
  view.label = 'ghosts';
  view.eventMode = 'none';
  const world = new PIXI.Container();
  const graphics = new PIXI.Graphics();
  world.addChild(graphics);
  view.addChild(world);
  let ghosts = [];
  let dirty = true;

  const pixelsPerMeter = () => {
    const value = model.prop(ROOT_UID, 'units.pixelsPerMeter');
    return Number.isFinite(value) && value > 0 ? value : FALLBACK_PIXELS_PER_METER;
  };

  const placeWorld = () => {
    world.scale.set(camera.scale / pixelsPerMeter());
    world.position.set(camera.width / 2 - camera.center.x * camera.scale, camera.height / 2 + camera.center.y * camera.scale);
  };

  const drawGhost = (ghost, root, ppm) => {
    const color = ghost.side === 'ahead' ? GHOST_STYLE.ahead : GHOST_STYLE.behind;
    const toPx = (point) => [point.x * ppm, -point.y * ppm];
    for (const body of model.children(ROOT_UID, 'bodies')) {
      const local = ghost.pose.get(body) ?? transformOf(model.get(body).props);
      const placed = composeTransforms(root, local);
      for (const shape of model.children(body, 'fixtures')) {
        const outline = shapeOutline(model.prop(shape, 'shape'));
        if (outline === null) continue;
        if (outline.circle) {
          const [x, y] = toPx(transformPoint(placed, outline.circle));
          graphics.circle(x, y, outline.circle.radius * ppm);
        } else {
          graphics.poly(outline.points.flatMap((point) => toPx(transformPoint(placed, point))), true);
        }
        graphics.fill({ color, alpha: GHOST_STYLE.fill });
        graphics.stroke({ width: ppm / camera.scale, color, alpha: GHOST_STYLE.stroke, alignment: 0.5 });
      }
    }
  };

  const flush = () => {
    if (!dirty) return;
    dirty = false;
    placeWorld();
    graphics.clear();
    if (ghosts.length === 0) return;
    const root = transformOf(model.get(ROOT_UID).props);
    const ppm = pixelsPerMeter();
    for (const ghost of ghosts) drawGhost(ghost, root, ppm);
  };

  const invalidate = () => {
    dirty = true;
  };
  const offs = [model.on('change', invalidate), model.on('reset', invalidate), camera.on('camera', invalidate)];
  PIXI.Ticker.shared.add(flush);

  return {
    view,
    setGhosts(next) {
      ghosts = [...next];
      dirty = true;
    },
    destroy() {
      PIXI.Ticker.shared.remove(flush);
      for (const off of offs) off();
      view.destroy({ children: true });
    },
  };
}
