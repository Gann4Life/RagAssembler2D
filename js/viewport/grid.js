import { gridLines } from './grid-lines.js';

const LINE_COLOR = 0xffffff;
const FINE_ALPHA = 0.07;
const COARSE_ALPHA = 0.16;
const X_AXIS_COLOR = 0xe0524f;
const Y_AXIS_COLOR = 0x58b85c;
const AXIS_ALPHA = 0.9;
const GRID_KEYS = new Set(['grid.visible', 'grid.size', 'grid.subdivisions']);

function deviceRatio() {
  return globalThis.devicePixelRatio || 1;
}

function lineRect(orientation, screen, camera, ratio) {
  const width = Math.max(1, Math.round(ratio)) / ratio;
  const start = Math.round((screen - width / 2) * ratio) / ratio;
  return orientation === 'vertical'
    ? { x: start, y: 0, width, height: camera.height }
    : { x: 0, y: start, width: camera.width, height: width };
}

function fillRects(graphics, rects, color, alpha) {
  if (rects.length === 0 || alpha <= 0) return;
  for (const rect of rects) graphics.rect(rect.x, rect.y, rect.width, rect.height);
  graphics.fill({ color, alpha });
}

/**
 * Creates the grid and origin axes: one screen-space `PIXI.Graphics` redrawn once per frame after `camera`
 * events, `grid.*` settings changes or a `devicePixelRatio` change. Lines are 1 CSS px wide, aligned to device
 * pixels; the X axis is red and the Y axis green, over the lines. Hidden, axes included, when `grid.visible` is off.
 * @param {object} PIXI The PIXI.js v8 namespace; its shared ticker schedules redraws.
 * @param {{ camera: import('./camera.js').Camera, settings: import('../settings.js').Settings }} options
 * @returns {{ view: object, destroy: () => void }} The graphics to add behind the scene, and its teardown.
 */
export function createGrid(PIXI, { camera, settings }) {
  const view = new PIXI.Graphics();
  view.label = 'grid';
  let dirty = true;
  let drawnRatio = 0;

  const draw = () => {
    view.clear();
    view.visible = settings.get('grid.visible');
    drawnRatio = deviceRatio();
    dirty = false;
    if (!view.visible || camera.width <= 0 || camera.height <= 0) return;
    const { lines, axes } = gridLines(camera, { size: settings.get('grid.size'), subdivisions: settings.get('grid.subdivisions') });
    const fine = lines.filter((line) => line.level === 'fine');
    const coarse = lines.filter((line) => line.level === 'coarse');
    const toRect = (line) => lineRect(line.orientation, line.screen, camera, drawnRatio);
    fillRects(view, fine.map(toRect), LINE_COLOR, FINE_ALPHA * (fine[0]?.alpha ?? 0));
    fillRects(view, coarse.map(toRect), LINE_COLOR, COARSE_ALPHA);
    if (axes.horizontal !== null) fillRects(view, [lineRect('horizontal', axes.horizontal, camera, drawnRatio)], X_AXIS_COLOR, AXIS_ALPHA);
    if (axes.vertical !== null) fillRects(view, [lineRect('vertical', axes.vertical, camera, drawnRatio)], Y_AXIS_COLOR, AXIS_ALPHA);
  };

  const tick = () => {
    if (dirty || drawnRatio !== deviceRatio()) draw();
  };
  const onCamera = () => {
    dirty = true;
  };
  const onSettings = ({ key }) => {
    if (GRID_KEYS.has(key)) dirty = true;
  };

  const offCamera = camera.on('camera', onCamera);
  const offSettings = settings.on('settings', onSettings);
  PIXI.Ticker.shared.add(tick);

  return {
    view,
    destroy() {
      PIXI.Ticker.shared.remove(tick);
      offCamera();
      offSettings();
      view.destroy();
    },
  };
}
