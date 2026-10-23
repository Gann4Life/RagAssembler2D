import { placement } from '../viewport/placement.js';
import { COLORS, HIT_RADIUS, LINE_WIDTH } from '../viewport/style.js';
import { drawLimitHandles, drawLimitRange, limitJoint, limitLayout, limitRange, startLimitDrag } from './joint-limits.js';
import { canRotate, gizmoPivot, manipulationTarget, startMove, startRotation } from './manipulation.js';
import { drawResizeHandles, resizeCursor, resizeHandles, resizeShapes, startResize } from './resize.js';
import { applyBox, boxAabb } from './select-box.js';
import { DRAG_THRESHOLD, defineTool } from './tool.js';
import { drawGizmo, gizmoHandleAt, gizmoLayout } from './transform-gizmo.js';

const PRIMARY = 0;
const BOX_FILL_ALPHA = 0.1;
const READOUT_OFFSET = 16;
const MOVE_AXES = Object.freeze({ square: 'xy', x: 'x', y: 'y' });
const HANDLE_CURSORS = Object.freeze({
  square: 'move',
  x: 'ew-resize',
  y: 'ns-resize',
  ring: 'pointer',
  'limit-lower': 'pointer',
  'limit-upper': 'pointer',
});

/**
 * Object a Select click acts on: the topmost hit, or with ALT the hit just below the topmost selected hit,
 * wrapping to the topmost (the topmost when no hit is selected).
 * @param {number[]} hits Uids under the press point, topmost first.
 * @param {(uid: number) => boolean} isSelected Whether a uid is selected.
 * @param {boolean} alt ALT held at the release.
 * @returns {number|null} The target uid, or `null` without hits.
 */
export function clickTarget(hits, isSelected, alt) {
  if (hits.length === 0) return null;
  if (!alt) return hits[0];
  const selected = hits.findIndex(isSelected);
  return hits[(selected + 1) % hits.length];
}

/**
 * Applies a Select click: with a target, CTRL removes it, else SHIFT toggles it, else it becomes the only
 * selected object; without one, no modifier clears the selection and SHIFT or CTRL do nothing.
 * @param {import('../model/selection.js').Selection} selection Selection to change.
 * @param {number|null} target Clicked uid, or `null` for empty space.
 * @param {{ shift: boolean, ctrl: boolean }} modifiers Modifiers held at the release.
 * @returns {void}
 */
export function applyClick(selection, target, { shift, ctrl }) {
  if (target === null) {
    if (!shift && !ctrl) selection.clear();
    return;
  }
  if (ctrl) selection.remove([target]);
  else if (shift) selection.toggle(target);
  else selection.set([target]);
}

function isFinitePair(value) {
  return Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function travelled(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function gizmoPick(id) {
  return id === null ? null : { id, key: id, resize: null, limit: false };
}

function resizeKey(entry) {
  return `${entry.shape}:${entry.id}`;
}

function pointPick(entry) {
  return { id: entry.id, key: entry.key, resize: entry.resize, limit: entry.limit };
}

function limitId(pick) {
  return pick?.limit ? pick.id : null;
}

function nearestPoint(points, screen) {
  let found = -1;
  let best = Infinity;
  points.forEach((entry, index) => {
    const distance = travelled(entry.screen, screen);
    if (distance <= HIT_RADIUS.handle && distance < best) {
      found = index;
      best = distance;
    }
  });
  return found;
}

function pickCursor(pick) {
  return pick.resize ? resizeCursor(-pick.resize.outward) : HANDLE_CURSORS[pick.id];
}

/**
 * Select tool (`V`): a click selects the object under the press point, a drag on empty space selects with a box.
 * In Edit mode a drag on an object moves the selection (selecting the object first when it is not part of it),
 * the transform gizmo on the selection moves it along X, along Y or freely, or rotates it, and resize handles on
 * the selected circles and boxes resize one shape each; with one joint selected, limit handles and the ring edit its
 * limits. In Animate and Simulate mode it only selects: no gizmo, no handles, and every drag draws a selection box.
 * Each move, rotation, resize or limit drag is one undo step.
 * Default cursor, hover feedback shown.
 * @returns {Readonly<import('./tool.js').Tool>} The tool.
 */
export function selectTool() {
  let ctx = null;
  let press = null;
  let hovered = null;
  let ctrl = false;

  const editing = () => ctx.modes.can('edit.rest');
  const pivotMode = () => ctx.settings.get('gizmo.pivot');
  const currentTarget = () => manipulationTarget(ctx.model, ctx.selection.objects);
  const currentPivot = (withCtrl) => gizmoPivot(ctx.model, ctx.selection.objects, { mode: pivotMode(), ctrl: withCtrl });

  function limitEditor() {
    const joint = limitJoint(ctx.model, ctx.selection.objects);
    if (joint === null) return null;
    const place = placement(ctx.model);
    const center = ctx.camera.worldToScreen(place.anchors.get(joint));
    return { joint, layout: limitLayout(center, place.zero.get(joint), ctx.model.get(joint).props.limits) };
  }

  function rangeRotates(editor) {
    if (editor === null) return false;
    const range = limitRange(editor.layout);
    return range.max - range.min > 0;
  }

  function layout() {
    if (!ctx || !editing()) return null;
    if (press?.dragging && press.kind !== 'handle' && !press.manipulation) return null;
    const pivot = press?.manipulation ? press.manipulation.pivot() : currentPivot(ctrl);
    if (pivot === null) return null;
    const ring = canRotate(ctx.model, currentTarget()) || rangeRotates(limitEditor());
    return gizmoLayout(ctx.camera.worldToScreen(pivot), { ring });
  }

  function pointHandles(found) {
    if (found === null || !editing()) return [];
    const editor = limitEditor();
    const limits = editor
      ? editor.layout.handles.map(({ id, screen }) => ({ id, key: id, screen, resize: null, limit: true }))
      : [];
    const resizes = resizeShapes(ctx.model, ctx.selection.objects)
      .flatMap((uid) => resizeHandles(ctx.model, uid))
      .map((entry) => ({
        id: entry.id,
        key: resizeKey(entry),
        screen: ctx.camera.worldToScreen(entry.point),
        resize: entry,
        limit: false,
      }));
    return [...limits, ...resizes];
  }

  function objectAtPivot(found, screen) {
    if (travelled(found.pivot, screen) > HIT_RADIUS.root) return false;
    return ctx.hitTest(screen).some((uid) => ['joint', 'root'].includes(ctx.model.get(uid)?.type));
  }

  function handleAt(screen) {
    const found = layout();
    if (found === null) return null;
    const gizmo = gizmoHandleAt(found, screen);
    if (gizmo === 'square') return gizmoPick(gizmo);
    const points = pointHandles(found);
    const index = nearestPoint(points, screen);
    if (index !== -1 && !objectAtPivot(found, screen)) return pointPick(points[index]);
    return gizmoPick(gizmo);
  }

  function belongs(target, uid) {
    if (ctx.selection.has(uid)) return true;
    const node = ctx.model.get(uid);
    return node?.type === 'shape' && target.bodies.includes(node.parent);
  }

  function movableHits(hits) {
    return hits.filter((uid) => ctx.model.get(uid)?.type !== 'root');
  }

  function pressedPoint(uid) {
    const node = ctx.model.get(uid);
    const value = node.type === 'joint' ? node.props.anchor : ctx.model.prop(node.parent, 'position');
    return ctx.toWorld(isFinitePair(value) ? { x: value[0], y: value[1] } : { x: 0, y: 0 });
  }

  function handlePress(e, pick) {
    if (pick.resize) {
      return startResize(ctx, { shape: pick.resize.shape, handle: pick.id, press: e, pivot: currentPivot(e.ctrl) });
    }
    const joint = limitJoint(ctx.model, ctx.selection.objects);
    if (pick.limit) return startLimitDrag(ctx, { joint, handle: pick.id, press: e });
    if (pick.id === 'ring' && joint !== null && rangeRotates(limitEditor())) return startLimitDrag(ctx, { joint, handle: 'limit-range', press: e });
    const target = currentTarget();
    if (pick.id === 'ring') return startRotation(ctx, { target, press: e, mode: pivotMode() });
    return startMove(ctx, { target, ref: currentPivot(e.ctrl), axis: MOVE_AXES[pick.id], press: e });
  }

  function startObjectDrag() {
    const hit = movableHits(press.hits)[0];
    if (!editing() || hit === undefined) {
      press.kind = 'box';
      return;
    }
    if (!belongs(currentTarget(), hit)) ctx.selection.set([hit]);
    press.manipulation = startMove(ctx, { target: currentTarget(), ref: pressedPoint(hit), axis: 'xy', press: press.start });
  }

  function advance(e) {
    press.last = e;
    if (press.dragging || travelled(press.start.screen, e.screen) < DRAG_THRESHOLD) return;
    press.dragging = true;
    if (press.kind === 'object') startObjectDrag();
  }

  function hoverCursor(screen, pick) {
    if (pick !== null) return pickCursor(pick);
    return editing() && movableHits(ctx.hitTest(screen)).length > 0 ? 'move' : null;
  }

  function finishClick(start, e) {
    const hits = ctx.hitTest(start.screen);
    applyClick(ctx.selection, clickTarget(hits, (uid) => ctx.selection.has(uid), e.alt), e);
  }

  function drawBox(g) {
    const a = ctx.camera.worldToScreen(press.anchor);
    const b = press.last.screen;
    g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    g.fill({ color: COLORS.highlight, alpha: BOX_FILL_ALPHA });
    g.stroke({ width: LINE_WIDTH.outline, color: COLORS.highlight });
  }

  return defineTool({
    id: 'select',
    cursor: 'default',
    hover: true,
    activate(context) {
      ctx = context;
    },
    deactivate() {
      press = null;
      hovered = null;
    },
    pointerDown(e) {
      if (e.button !== PRIMARY) return;
      ctrl = e.ctrl;
      const handle = handleAt(e.screen);
      const hits = handle === null ? ctx.hitTest(e.screen) : [];
      const kind = handle !== null ? 'handle' : hits.length > 0 ? 'object' : 'box';
      press = { kind, handle, start: e, anchor: e.world, hits, dragging: false, last: e, manipulation: null };
      if (handle !== null) {
        press.manipulation = handlePress(e, handle);
        ctx.setCursor(pickCursor(handle));
      } else if (kind === 'object' && editing() && movableHits(hits).length > 0) {
        ctx.setCursor('move');
      }
    },
    pointerMove(e) {
      const ctrlChanged = e.ctrl !== ctrl;
      ctrl = e.ctrl;
      if (press) {
        advance(e);
        if (!press.dragging) return;
        if (press.manipulation) press.manipulation.apply(e);
        ctx.invalidateOverlay();
        return;
      }
      const handle = handleAt(e.screen);
      ctx.setCursor(hoverCursor(e.screen, handle));
      if (handle?.key !== hovered?.key || ctrlChanged) {
        hovered = handle;
        ctx.invalidateOverlay();
      }
    },
    pointerUp(e) {
      if (e.button !== PRIMARY || !press) return;
      ctrl = e.ctrl;
      advance(e);
      const done = press;
      if (done.dragging && done.manipulation) done.manipulation.apply(e);
      press = null;
      hovered = null;
      ctx.setCursor(null);
      ctx.invalidateOverlay();
      if (done.dragging && !done.manipulation) applyBox(ctx.selection, ctx.boxTest(boxAabb(done.anchor, e.world)), e);
      else if (!done.dragging && done.kind !== 'handle') finishClick(done.start, e);
    },
    cancel() {
      if (!press) return false;
      press = null;
      ctx.setCursor(null);
      ctx.invalidateOverlay();
      return true;
    },
    handleAt(screen) {
      return ctx ? (handleAt(screen)?.id ?? null) : null;
    },
    readout() {
      if (!press?.dragging || !press.manipulation) return null;
      const text = press.manipulation.readout();
      return { text, screen: { x: press.last.screen.x + READOUT_OFFSET, y: press.last.screen.y + READOUT_OFFSET } };
    },
    drawOverlay(g) {
      if (!ctx) return;
      if (press?.dragging && !press.manipulation) {
        drawBox(g);
        return;
      }
      const found = layout();
      if (found === null) return;
      const active = press?.dragging && press.kind === 'handle' ? press.handle : null;
      const hover = press?.dragging ? null : hovered;
      const resizes = pointHandles(found).filter((entry) => entry.resize);
      const indexOf = (pick) => (pick?.resize ? resizes.findIndex((entry) => entry.key === pick.key) : -1);
      const gizmoId = (pick) => (pick && !pick.resize && !pick.limit ? pick.id : null);
      const state = { hover: indexOf(hover), active: indexOf(active) };
      const editor = editing() ? limitEditor() : null;
      drawGizmo(g, found, {
        hover: gizmoId(hover),
        active: gizmoId(active),
        mode: pivotMode(),
        sweep: press?.dragging ? (press.manipulation?.sweep?.() ?? null) : null,
        under: editor ? (graphics) => drawLimitRange(graphics, editor.layout) : undefined,
        points: (graphics) => {
          drawResizeHandles(graphics, resizes.map((entry) => entry.screen), state);
          if (editor) drawLimitHandles(graphics, editor.layout, { hover: limitId(hover), active: limitId(active) });
        },
      });
    },
  });
}
