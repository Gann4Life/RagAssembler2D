import { transformPoint } from '../../lib/geometry.js';
import { defaultsOf } from '../../lib/schema.js';
import { ROOT_UID } from '../model/model.js';
import { COLORS } from './style.js';

/**
 * @typedef {object} Scene
 * @property {object} view Root `PIXI.Container` holding the world container (sprites and shapes layers, placed
 *   by the camera).
 * @property {(pose: import('./bounds.js').Pose|null) => void} setPose Overrides body transforms (root-local)
 *   without touching the model; `null` returns to the rest pose.
 * @property {() => import('./bounds.js').Pose|null} pose The current override.
 * @property {() => void} destroy Stops listening and destroys every display object.
 */

const FALLBACK_PIXELS_PER_METER = defaultsOf('document').units.pixelsPerMeter;
const FALLBACK_COLOR = defaultsOf('shape', 'circle').editor.color;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const SHAPE_STYLES = Object.freeze({
  shapes: Object.freeze({ fill: 0.4, stroke: 1 }),
  sprites: Object.freeze({ fill: 0, stroke: 0 }),
  both: Object.freeze({ fill: 0, stroke: 0.6 }),
});

function vec(value) {
  return Array.isArray(value) && value.length === 2 ? { x: value[0], y: value[1] } : { x: 0, y: 0 };
}

function restTransform(props) {
  const { x, y } = vec(props.position);
  return { x, y, angle: Number.isFinite(props.angle) ? props.angle : 0 };
}

function allFinite(...values) {
  return values.every(Number.isFinite);
}

function shapeOutline(shape) {
  switch (shape?.type) {
    case 'circle': {
      const center = vec(shape.center);
      return allFinite(center.x, center.y, shape.radius) && shape.radius > 0 ? { circle: { ...center, radius: shape.radius } } : null;
    }
    case 'box': {
      const center = vec(shape.center);
      const frame = { ...center, angle: Number.isFinite(shape.angle) ? shape.angle : 0 };
      if (!allFinite(frame.x, frame.y, shape.width, shape.height)) return null;
      const halfW = shape.width / 2;
      const halfH = shape.height / 2;
      const corners = [
        { x: -halfW, y: -halfH },
        { x: halfW, y: -halfH },
        { x: halfW, y: halfH },
        { x: -halfW, y: halfH },
      ];
      return { points: corners.map((corner) => transformPoint(frame, corner)) };
    }
    case 'polygon': {
      if (!Array.isArray(shape.vertices) || shape.vertices.length < 2) return null;
      const points = shape.vertices.map(vec);
      return points.every((p) => allFinite(p.x, p.y)) ? { points } : null;
    }
    default:
      return null;
  }
}

/**
 * Creates the viewport scene ([View sync](docs/architecture/view-sync.md)): layers, a world container placed by the
 * camera (`scale = camera.scale / pixelsPerMeter`), and one display object per root, body and shape, keyed by
 * uid. Model `change` events update entries one by one (add, remove, move, dirty `set`), flushed once per frame
 * from the PIXI shared ticker; only `reset` rebuilds. `display.mode` sets the sprite layer's visibility and the
 * shape style. Outlines stay 1 CSS px wide: shapes are redrawn when the scale changes. Sprites are not drawn
 * until the asset store provides textures.
 * @param {object} PIXI The PIXI.js v8 namespace.
 * @param {{ model: import('../model/model.js').Model, camera: import('./camera.js').Camera,
 *   settings: import('../settings.js').Settings }} options
 * @returns {Scene}
 */
export function createScene(PIXI, { model, camera, settings }) {
  const view = new PIXI.Container();
  view.label = 'scene';
  const world = new PIXI.Container();
  world.label = 'world';
  const spritesLayer = new PIXI.Container();
  spritesLayer.label = 'sprites';
  spritesLayer.sortableChildren = true;
  const shapesLayer = new PIXI.Container();
  shapesLayer.label = 'shapes';
  world.addChild(spritesLayer, shapesLayer);
  view.addChild(world);

  const entries = new Map();
  const dirtyTransforms = new Set();
  const dirtyShapes = new Set();
  let currentPose = null;
  let drawnScale = camera.scale;

  const pixelsPerMeter = () => {
    const value = model.prop(ROOT_UID, 'units.pixelsPerMeter');
    return Number.isFinite(value) && value > 0 ? value : FALLBACK_PIXELS_PER_METER;
  };

  const placeWorld = () => {
    world.scale.set(camera.scale / pixelsPerMeter());
    world.position.set(camera.width / 2 - camera.center.x * camera.scale, camera.height / 2 + camera.center.y * camera.scale);
  };

  const markAll = () => {
    for (const [uid, entry] of entries) {
      dirtyTransforms.add(uid);
      if (entry.type === 'shape') dirtyShapes.add(uid);
    }
  };

  const markShapes = (bodyUid) => {
    for (const [uid, entry] of entries) if (entry.type === 'shape' && (bodyUid === undefined || entry.parent === bodyUid)) dirtyShapes.add(uid);
  };

  const parentContainer = (node) => {
    if (node.type === 'body') return entries.get(ROOT_UID)?.display ?? null;
    if (node.type === 'shape') return entries.get(node.parent)?.display ?? null;
    return null;
  };

  const insertAt = (container, display, node) => {
    const siblings = model.children(node.parent, node.collection);
    const position = siblings.indexOf(node.uid);
    let index = 0;
    for (let i = 0; i < position; i += 1) if (entries.has(siblings[i])) index += 1;
    container.addChildAt(display, Math.min(index, container.children.length));
  };

  const createEntry = (uid) => {
    if (entries.has(uid)) return;
    const node = model.get(uid);
    if (!node || !['root', 'body', 'shape'].includes(node.type)) return;
    if (node.type === 'root') {
      const display = new PIXI.Container();
      display.label = 'root';
      shapesLayer.addChild(display);
      entries.set(uid, { type: 'root', parent: null, display });
      dirtyTransforms.add(uid);
      return;
    }
    const container = parentContainer(node);
    if (!container) return;
    const display = node.type === 'body' ? new PIXI.Container() : new PIXI.Graphics();
    display.label = `${node.type}:${uid}`;
    insertAt(container, display, node);
    entries.set(uid, { type: node.type, parent: node.parent, display });
    if (node.type === 'body') dirtyTransforms.add(uid);
    else dirtyShapes.add(uid);
  };

  const destroyEntry = (uid) => {
    const entry = entries.get(uid);
    if (!entry) return;
    for (const [childUid, child] of [...entries]) if (child.parent === uid) destroyEntry(childUid);
    entry.display.removeFromParent();
    entry.display.destroy({ children: true });
    entries.delete(uid);
    dirtyTransforms.delete(uid);
    dirtyShapes.delete(uid);
  };

  const moveEntry = (uid) => {
    const entry = entries.get(uid);
    const node = model.get(uid);
    if (!entry || !node) return;
    const container = parentContainer(node);
    if (!container) {
      destroyEntry(uid);
      return;
    }
    entry.display.removeFromParent();
    entry.parent = node.parent;
    insertAt(container, entry.display, node);
    if (entry.type === 'shape') dirtyShapes.add(uid);
    else dirtyTransforms.add(uid);
  };

  const onSet = (change) => {
    if (!entries.has(change.uid)) return;
    if (change.type === 'root') {
      if (change.path === 'units' || change.path.startsWith('units.')) {
        placeWorld();
        markAll();
      } else {
        dirtyTransforms.add(change.uid);
      }
    } else if (change.type === 'body') {
      dirtyTransforms.add(change.uid);
    } else if (change.type === 'shape') {
      dirtyShapes.add(change.uid);
    }
  };

  const applyChange = (change) => {
    switch (change.kind) {
      case 'add':
        createEntry(change.uid);
        return;
      case 'remove':
        destroyEntry(change.uid);
        return;
      case 'move':
        moveEntry(change.uid);
        return;
      case 'set':
        onSet(change);
    }
  };

  const applyTransform = (uid) => {
    const entry = entries.get(uid);
    const node = model.get(uid);
    if (!entry || !node || entry.type === 'shape') return;
    const ppm = pixelsPerMeter();
    const t = (entry.type === 'body' && currentPose?.get(uid)) || restTransform(node.props);
    entry.display.position.set(t.x * ppm, -t.y * ppm);
    entry.display.rotation = -t.angle;
  };

  const drawShape = (uid) => {
    const entry = entries.get(uid);
    const node = model.get(uid);
    if (!entry || !node) return;
    const graphics = entry.display;
    graphics.clear();
    const outline = shapeOutline(node.props.shape);
    const style = SHAPE_STYLES[settings.get('display.mode')];
    if (!outline || (style.fill === 0 && style.stroke === 0)) return;
    const ppm = pixelsPerMeter();
    const color = COLOR_PATTERN.test(node.props.editor?.color ?? '') ? node.props.editor.color : FALLBACK_COLOR;
    if (outline.circle) graphics.circle(outline.circle.x * ppm, -outline.circle.y * ppm, outline.circle.radius * ppm);
    else graphics.poly(outline.points.flatMap((p) => [p.x * ppm, -p.y * ppm]), true);
    if (style.fill > 0) graphics.fill({ color, alpha: style.fill });
    if (style.stroke > 0) graphics.stroke({ width: pixelsPerMeter() / camera.scale, color: COLORS.shapeOutline, alpha: style.stroke, alignment: 0.5 });
  };

  const flush = () => {
    if (camera.scale !== drawnScale) {
      drawnScale = camera.scale;
      markShapes();
    }
    for (const uid of dirtyTransforms) applyTransform(uid);
    dirtyTransforms.clear();
    for (const uid of dirtyShapes) drawShape(uid);
    dirtyShapes.clear();
  };

  const applyDisplayMode = () => {
    const mode = settings.get('display.mode');
    spritesLayer.visible = mode !== 'shapes';
    shapesLayer.visible = mode !== 'sprites';
    markShapes();
  };

  const build = () => {
    for (const uid of [...entries.keys()]) if (entries.get(uid)?.type === 'root') destroyEntry(uid);
    entries.clear();
    createEntry(ROOT_UID);
    for (const bodyUid of model.children(ROOT_UID, 'bodies')) {
      createEntry(bodyUid);
      for (const shapeUid of model.children(bodyUid, 'fixtures')) createEntry(shapeUid);
    }
    placeWorld();
  };

  const onChange = ({ changes }) => {
    for (const change of changes) applyChange(change);
  };
  const onReset = () => {
    currentPose = null;
    build();
  };
  const onSettings = ({ key }) => {
    if (key === 'display.mode') applyDisplayMode();
  };

  const offChange = model.on('change', onChange);
  const offReset = model.on('reset', onReset);
  const offCamera = camera.on('camera', placeWorld);
  const offSettings = settings.on('settings', onSettings);
  PIXI.Ticker.shared.add(flush);

  build();
  applyDisplayMode();

  return {
    view,
    setPose(pose) {
      currentPose = pose ?? null;
      for (const [uid, entry] of entries) if (entry.type === 'body') dirtyTransforms.add(uid);
    },
    pose() {
      return currentPose;
    },
    destroy() {
      PIXI.Ticker.shared.remove(flush);
      offChange();
      offReset();
      offCamera();
      offSettings();
      entries.clear();
      view.destroy({ children: true });
    },
  };
}
