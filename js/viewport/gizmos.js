import { bodyMass, transformPoint } from '../../lib/geometry.js';
import { ROOT_UID } from '../model/model.js';
import { placement } from './placement.js';
import { COLORS, GIZMO_SIZE, LABEL_SIZE, LINE_WIDTH } from './style.js';

/**
 * @typedef {object} Gizmos
 * @property {object} view Screen-space `PIXI.Container` to stack above the scene.
 * @property {(uid: number|null) => void} setHover Sets the hovered root, joint or shape, or none.
 * @property {(uids: Iterable<number>) => void} setInvalid Sets the objects that validation reports with an error.
 * @property {() => void} invalidate Requests a redraw, e.g. after `scene.setPose`.
 * @property {() => void} destroy Stops listening and destroys every display object.
 */

const LABEL_OUTLINE = 0x111214;
const LABEL_OUTLINE_WIDTH = 3;
const LABEL_GAP = 3;
const ARROW_HEAD = 7;
const ARROW_HEAD_ANGLE = (5 * Math.PI) / 6;
const QUARTER = Math.PI / 2;
const REDRAW_SETTINGS = new Set(['overlay.names', 'overlay.centers', 'overlay.contacts', 'display.mode']);

function isFinitePoint(p) {
  return Number.isFinite(p?.x) && Number.isFinite(p?.y);
}

function vec(value) {
  return Array.isArray(value) ? { x: value[0], y: value[1] } : { x: Number.NaN, y: Number.NaN };
}

function direction(angle) {
  return { x: Math.cos(-angle), y: Math.sin(-angle) };
}

function along(origin, angle, length) {
  const d = direction(angle);
  return { x: origin.x + d.x * length, y: origin.y + d.y * length };
}

function shapePoints(shape, transform) {
  switch (shape?.type) {
    case 'box': {
      const frame = { ...vec(shape.center), angle: Number.isFinite(shape.angle) ? shape.angle : 0 };
      if (!isFinitePoint(frame) || !Number.isFinite(shape.width) || !Number.isFinite(shape.height)) return null;
      const halfW = shape.width / 2;
      const halfH = shape.height / 2;
      return [
        { x: -halfW, y: -halfH },
        { x: halfW, y: -halfH },
        { x: halfW, y: halfH },
        { x: -halfW, y: halfH },
      ].map((corner) => transformPoint(transform, transformPoint(frame, corner)));
    }
    case 'polygon': {
      if (!Array.isArray(shape.vertices) || shape.vertices.length < 2) return null;
      const points = shape.vertices.map(vec);
      return points.every(isFinitePoint) ? points.map((p) => transformPoint(transform, p)) : null;
    }
    default:
      return null;
  }
}

function traceShape(g, shape, transform, camera) {
  if (!isFinitePoint(transform) || !Number.isFinite(transform.angle)) return false;
  if (shape?.type === 'circle') {
    const center = vec(shape.center);
    if (!isFinitePoint(center) || !Number.isFinite(shape.radius) || shape.radius <= 0) return false;
    const screen = camera.worldToScreen(transformPoint(transform, center));
    g.circle(screen.x, screen.y, shape.radius * camera.scale);
    return true;
  }
  const points = shapePoints(shape, transform);
  if (!points) return false;
  g.poly(points.flatMap((p) => {
    const screen = camera.worldToScreen(p);
    return [screen.x, screen.y];
  }), true);
  return true;
}

function line(g, from, to) {
  g.moveTo(from.x, from.y);
  g.lineTo(to.x, to.y);
}

/**
 * Creates the gizmo layer ([DESIGN §5.4]): a screen-space layer above the shapes and sprites, in every display
 * mode, with the hover, selection and invalid outlines of shapes, the root and joint gizmos (selected joints add
 * their `aimAxis` arrow), and the names and centers-of-mass overlays. Everything follows the displayed pose
 * (`scene.pose()`) and keeps a constant size in CSS px. The layer is redrawn whole, at most once per frame from
 * the PIXI shared ticker, after a camera, model, selection, mode or overlay setting change, `setHover`,
 * `setInvalid` or `invalidate`.
 * @param {object} PIXI The PIXI.js v8 namespace; its shared ticker schedules redraws.
 * @param {{ model: import('../model/model.js').Model, camera: import('./camera.js').Camera,
 *   selection: import('../model/selection.js').Selection, modes: import('../modes.js').Modes,
 *   settings: import('../settings.js').Settings, scene: import('./scene.js').Scene }} options
 * @returns {Gizmos}
 */
export function createGizmos(PIXI, { model, camera, selection, modes, settings, scene }) {
  const view = new PIXI.Container();
  view.label = 'gizmos';
  const outlines = new PIXI.Graphics();
  outlines.label = 'feedback';
  const handles = new PIXI.Graphics();
  handles.label = 'handles';
  const marks = new PIXI.Graphics();
  marks.label = 'centers';
  const labels = new PIXI.Container();
  labels.label = 'names';
  view.addChild(outlines, handles, marks, labels);

  const labelPool = [];
  let hover = null;
  let invalid = new Set();
  let dirty = true;

  const feedback = (uids, selected) => {
    const isSelected = uids.some((uid) => selected.has(uid));
    const isInvalid = uids.some((uid) => invalid.has(uid));
    const isHovered = hover !== null && uids[0] === hover;
    return {
      shown: isSelected || isInvalid || isHovered,
      color: isInvalid ? COLORS.invalid : isSelected || isHovered ? COLORS.highlight : COLORS.gizmo,
      width: isSelected ? LINE_WIDTH.selected : LINE_WIDTH.outline,
    };
  };

  const drawShapes = (placed, selected) => {
    for (const bodyUid of model.children(ROOT_UID, 'bodies')) {
      const transform = placed.bodies.get(bodyUid);
      for (const shapeUid of model.children(bodyUid, 'fixtures')) {
        const style = feedback([shapeUid, bodyUid], selected);
        if (!style.shown || !traceShape(outlines, model.get(shapeUid).props.shape, transform, camera)) continue;
        outlines.stroke({ width: style.width, color: style.color, alignment: 0.5 });
      }
    }
  };

  const drawRoot = (placed, selected) => {
    const { root } = placed;
    if (!isFinitePoint(root) || !Number.isFinite(root.angle)) return;
    const center = camera.worldToScreen(root);
    const style = feedback([ROOT_UID], selected);
    for (const angle of [root.angle, root.angle + QUARTER]) {
      line(handles, along(center, angle + Math.PI, GIZMO_SIZE.rootCross), along(center, angle, GIZMO_SIZE.rootCross));
    }
    handles.circle(center.x, center.y, GIZMO_SIZE.rootRing);
    handles.stroke({ width: style.width, color: style.color, alignment: 0.5 });
  };

  const bodyUidOf = (id) => {
    if (typeof id !== 'string') return null;
    const uid = model.uidOf(id);
    return uid !== null && uid !== undefined && model.get(uid)?.type === 'body' ? uid : null;
  };

  const drawJoint = (uid, placed, selected) => {
    const anchor = placed.anchors.get(uid);
    if (!isFinitePoint(anchor)) return;
    const props = model.get(uid).props;
    const center = camera.worldToScreen(anchor);
    const style = feedback([uid], selected);
    handles.circle(center.x, center.y, GIZMO_SIZE.jointCircle);
    const zero = placed.zero.get(uid);
    if (zero !== null && zero !== undefined) {
      const { enabled, lower, upper } = props.limits ?? {};
      if (enabled === true && Number.isFinite(lower) && Number.isFinite(upper) && upper > lower) {
        const start = along(center, zero + lower, GIZMO_SIZE.jointArc);
        handles.moveTo(start.x, start.y);
        handles.arc(center.x, center.y, GIZMO_SIZE.jointArc, -(zero + lower), -(zero + upper), true);
      }
      line(handles, center, along(center, zero + placed.angles.get(uid), GIZMO_SIZE.jointNeedle));
      const bodyB = bodyUidOf(props.bodyB);
      const bodyAngle = bodyB === null ? Number.NaN : placed.bodies.get(bodyB)?.angle;
      if (selected.has(uid) && Number.isFinite(bodyAngle) && Number.isFinite(props.aimAxis)) {
        const aim = bodyAngle + props.aimAxis;
        const tip = along(center, aim, GIZMO_SIZE.aimArrow);
        line(handles, center, tip);
        line(handles, tip, along(tip, aim + ARROW_HEAD_ANGLE, ARROW_HEAD));
        line(handles, tip, along(tip, aim - ARROW_HEAD_ANGLE, ARROW_HEAD));
      }
    }
    handles.stroke({ width: style.width, color: style.color, alignment: 0.5, cap: 'round', join: 'round' });
  };

  const drawCenters = (placed) => {
    const radius = GIZMO_SIZE.centerOfMass;
    for (const bodyUid of model.children(ROOT_UID, 'bodies')) {
      const transform = placed.bodies.get(bodyUid);
      const fixtures = model.children(bodyUid, 'fixtures').map((uid) => model.get(uid).props);
      const { center } = bodyMass(fixtures);
      if (!center || !isFinitePoint(transform)) continue;
      const screen = camera.worldToScreen(transformPoint(transform, center));
      if (!isFinitePoint(screen)) continue;
      marks.circle(screen.x, screen.y, radius);
      marks.fill({ color: LABEL_OUTLINE });
      for (const start of [-QUARTER, QUARTER]) {
        marks.moveTo(screen.x, screen.y);
        marks.arc(screen.x, screen.y, radius, start, start + QUARTER);
        marks.closePath();
        marks.fill({ color: COLORS.gizmo });
      }
      marks.circle(screen.x, screen.y, radius);
      marks.stroke({ width: LINE_WIDTH.outline, color: COLORS.gizmo, alignment: 0.5 });
    }
  };

  const placeLabel = (index, text, point, anchorX, anchorY) => {
    let label = labelPool[index];
    if (!label) {
      label = new PIXI.Text({
        text,
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: LABEL_SIZE,
          fill: COLORS.gizmo,
          stroke: { color: LABEL_OUTLINE, width: LABEL_OUTLINE_WIDTH, join: 'round' },
        },
      });
      labelPool.push(label);
      labels.addChild(label);
    } else if (label.text !== text) {
      label.text = text;
    }
    label.anchor.set(anchorX, anchorY);
    label.position.set(Math.round(point.x), Math.round(point.y));
    label.visible = true;
  };

  const drawNames = (placed) => {
    let count = 0;
    const add = (props, world, offset, anchor) => {
      const text = typeof props.name === 'string' && props.name !== '' ? props.name : props.id;
      if (typeof text !== 'string' || text === '' || !isFinitePoint(world)) return;
      const screen = camera.worldToScreen(world);
      placeLabel(count++, text, { x: screen.x + offset.x, y: screen.y + offset.y }, anchor.x, anchor.y);
    };
    const rootGap = GIZMO_SIZE.rootRing + LABEL_GAP;
    const jointGap = GIZMO_SIZE.jointCircle + LABEL_GAP;
    const bodyGap = GIZMO_SIZE.centerOfMass + LABEL_GAP;
    add(model.get(ROOT_UID).props, placed.root, { x: rootGap, y: -rootGap }, { x: 0, y: 1 });
    for (const uid of model.children(ROOT_UID, 'bodies')) {
      add(model.get(uid).props, placed.bodies.get(uid), { x: 0, y: bodyGap }, { x: 0.5, y: 0 });
    }
    for (const uid of model.children(ROOT_UID, 'joints')) {
      add(model.get(uid).props, placed.anchors.get(uid), { x: jointGap, y: -jointGap }, { x: 0, y: 1 });
    }
    return count;
  };

  const draw = () => {
    dirty = false;
    outlines.clear();
    handles.clear();
    marks.clear();
    let labelCount = 0;
    if (camera.width > 0 && camera.height > 0) {
      const placed = placement(model, scene.pose());
      const selected = new Set(selection.objects);
      drawShapes(placed, selected);
      drawRoot(placed, selected);
      for (const uid of model.children(ROOT_UID, 'joints')) drawJoint(uid, placed, selected);
      if (settings.get('overlay.centers')) drawCenters(placed);
      if (settings.get('overlay.names')) labelCount = drawNames(placed);
    }
    for (let index = labelCount; index < labelPool.length; index++) labelPool[index].visible = false;
  };

  const markDirty = () => {
    dirty = true;
  };
  const tick = () => {
    if (dirty) draw();
  };
  const onReset = () => {
    hover = null;
    dirty = true;
  };
  const onSettings = ({ key }) => {
    if (REDRAW_SETTINGS.has(key)) dirty = true;
  };

  const offCamera = camera.on('camera', markDirty);
  const offChange = model.on('change', markDirty);
  const offReset = model.on('reset', onReset);
  const offSelection = selection.on('selection', markDirty);
  const offMode = modes.on('mode', markDirty);
  const offSettings = settings.on('settings', onSettings);
  PIXI.Ticker.shared.add(tick);

  return {
    view,
    setHover(uid) {
      const next = uid ?? null;
      if (next === hover) return;
      hover = next;
      dirty = true;
    },
    setInvalid(uids) {
      invalid = new Set(uids);
      dirty = true;
    },
    invalidate: markDirty,
    destroy() {
      PIXI.Ticker.shared.remove(tick);
      offCamera();
      offChange();
      offReset();
      offSelection();
      offMode();
      offSettings();
      labelPool.length = 0;
      view.destroy({ children: true });
    },
  };
}
