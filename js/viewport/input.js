import { KEY_ZOOM_STEP, MAX_SCALE, MIN_SCALE, wheelZoomFactor } from './camera.js';
import { DOUBLE_CLICK_TIME, DRAG_THRESHOLD } from '../tools/tool.js';

const PRIMARY = 0;
const MIDDLE = 1;
const SECONDARY = 2;
const BUTTON_MASKS = Object.freeze({ [PRIMARY]: 1, [MIDDLE]: 4, [SECONDARY]: 2 });
const SPACE = ' ';
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);
const MAX_WHEEL_FACTOR = MAX_SCALE / MIN_SCALE;
const ZOOM_KEYS = Object.freeze({ '+': KEY_ZOOM_STEP, '=': KEY_ZOOM_STEP, '-': 1 / KEY_ZOOM_STEP });

function localPoint(host, event) {
  const rect = host.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function clampFactor(factor) {
  if (Number.isNaN(factor)) return 1;
  return Math.min(MAX_WHEEL_FACTOR, Math.max(1 / MAX_WHEEL_FACTOR, factor));
}

function modifiersOf(event) {
  return { shift: Boolean(event.shiftKey), ctrl: Boolean(event.ctrlKey || event.metaKey), alt: Boolean(event.altKey) };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Attaches viewport navigation and tool input to the host element ([DESIGN §5.4, §5.5]). A press focuses the
 * host. Middle drag, or Space + left drag while the host has focus, pans with pointer capture (`grab`/`grabbing`
 * cursors); middle presses chorded with a left drag pan too. The wheel zooms about the pointer and never scrolls or
 * zooms the page. `+`/`=` and `-` zoom by √2 about the center. Every Space `keydown` (repeats included) and `keyup`
 * on the host is `preventDefault`ed, so the document hotkey dispatcher skips it; a Space press and release without
 * a pan calls `onSpaceTap`. Navigation never reaches the tools. Other left presses (captured) and right presses
 * go to `tools.pointer`, with moves over the host or captured, click counting through `DRAG_THRESHOLD` and
 * `DOUBLE_CLICK_TIME`, and the last position re-sent as a move after a pan or zoom during a left press and on
 * modifier key changes. Lost capture, `pointercancel` and window blur during a left press call `tools.cancel()`.
 * The host's context menu is always prevented. Idle moves call `onHover(screen)` at most once per frame; leaving
 * the host, any press and navigation call `onHover(null)`.
 * @param {HTMLElement} host Focusable viewport host.
 * @param {{ camera: import('./camera.js').Camera, onSpaceTap?: () => void,
 *   tools?: import('../tools/registry.js').ToolRegistry|null, onHover?: (screen: { x: number, y: number }|null) => void }} options
 *   Camera to drive, the Space tap handler, the tool registry receiving pointer input, and the hover handler.
 * @returns {() => void} Function that removes every listener, ends a pan, cancels a tool press and restores the
 *   cursor.
 */
export function attachInput(host, { camera, onSpaceTap = () => {}, tools = null, onHover = () => {} }) {
  const view = host.ownerDocument.defaultView;
  let spaceHeld = false;
  let spaceUsed = false;
  let pan = null;
  let press = null;
  let rightPress = null;
  let lastClick = null;
  let pointer = null;
  let hoverFrame = 0;
  let pendingHover = null;

  const updateCursor = () => {
    host.style.cursor = pan ? 'grabbing' : spaceHeld ? 'grab' : '';
  };

  const clearHover = () => {
    if (hoverFrame) view.cancelAnimationFrame(hoverFrame);
    hoverFrame = 0;
    pendingHover = null;
    onHover(null);
  };

  const scheduleHover = (screen) => {
    pendingHover = screen;
    if (hoverFrame) return;
    hoverFrame = view.requestAnimationFrame(() => {
      hoverFrame = 0;
      const screenPoint = pendingHover;
      pendingHover = null;
      if (screenPoint) onHover(screenPoint);
    });
  };

  const remember = (event, screen) => {
    pointer = { pointerId: event.pointerId, screen, buttons: event.buttons ?? 0, modifiers: modifiersOf(event), over: pointer?.over ?? true };
  };

  const sendTool = (type, screen, button, buttons, modifiers, clicks = 1) => {
    tools?.pointer({ type, screen: { x: screen.x, y: screen.y }, button, buttons, ...modifiers, clicks });
  };

  const resendMove = (modifiers = pointer?.modifiers) => {
    if (!tools || !pointer) return;
    if (modifiers) pointer.modifiers = modifiers;
    sendTool('move', pointer.screen, -1, pointer.buttons, pointer.modifiers);
  };

  const releaseCapture = (pointerId) => {
    if (host.hasPointerCapture?.(pointerId)) host.releasePointerCapture(pointerId);
  };

  const startPan = (event, button) => {
    pan = { pointerId: event.pointerId, button, x: event.clientX, y: event.clientY };
    if (!host.hasPointerCapture?.(event.pointerId)) host.setPointerCapture(event.pointerId);
    updateCursor();
    clearHover();
  };

  const endPan = () => {
    if (!pan) return;
    const { pointerId } = pan;
    pan = null;
    if (!press || press.pointerId !== pointerId) releaseCapture(pointerId);
    updateCursor();
  };

  const clickCount = (button, screen, time) => {
    const double =
      lastClick !== null &&
      lastClick.button === button &&
      time - lastClick.time <= DOUBLE_CLICK_TIME &&
      distance(lastClick.screen, screen) <= DRAG_THRESHOLD;
    return double ? 2 : 1;
  };

  const recordClick = (record) => {
    const isClick = record.moved < DRAG_THRESHOLD && record.clicks === 1;
    lastClick = isClick ? { button: record.button, screen: record.screen, time: record.time } : null;
  };

  const buttonDown = (event, button) => {
    clearHover();
    if (button === MIDDLE || (button === PRIMARY && spaceHeld)) {
      if (pan) return;
      if (button === PRIMARY) spaceUsed = true;
      event.preventDefault();
      startPan(event, button);
      return;
    }
    if (!tools || pan || (button !== PRIMARY && button !== SECONDARY)) return;
    const screen = localPoint(host, event);
    remember(event, screen);
    const clicks = clickCount(button, screen, event.timeStamp);
    const record = { button, pointerId: event.pointerId, screen, time: event.timeStamp, clicks, moved: 0 };
    if (button === PRIMARY) {
      if (press) return;
      press = record;
      host.setPointerCapture(event.pointerId);
    } else {
      rightPress = record;
    }
    sendTool('down', screen, button, event.buttons ?? 0, modifiersOf(event), clicks);
  };

  const buttonUp = (event, button) => {
    if (pan && pan.button === button) {
      endPan();
      if (press) resendMove();
      return;
    }
    const record = button === PRIMARY ? press : button === SECONDARY ? rightPress : null;
    if (!record) return;
    const screen = localPoint(host, event);
    remember(event, screen);
    record.moved = Math.max(record.moved, distance(record.screen, screen));
    if (button === PRIMARY) {
      press = null;
      if (!pan || pan.pointerId !== event.pointerId) releaseCapture(event.pointerId);
    } else {
      rightPress = null;
    }
    recordClick(record);
    sendTool('up', screen, button, event.buttons ?? 0, modifiersOf(event), record.moved < DRAG_THRESHOLD ? record.clicks : 1);
  };

  const onPointerDown = (event) => {
    if (event.button === MIDDLE) event.preventDefault();
    host.focus({ preventScroll: true });
    buttonDown(event, event.button);
  };

  const onPointerMove = (event) => {
    if (event.button !== undefined && event.button >= 0) {
      const mask = BUTTON_MASKS[event.button];
      if (mask !== undefined) {
        if (event.buttons & mask) buttonDown(event, event.button);
        else buttonUp(event, event.button);
      }
      return;
    }
    if (pan && event.pointerId === pan.pointerId) {
      const dx = event.clientX - pan.x;
      const dy = event.clientY - pan.y;
      pan.x = event.clientX;
      pan.y = event.clientY;
      if (dx !== 0 || dy !== 0) camera.panBy(dx, dy);
      if (press) resendMove(modifiersOf(event));
      return;
    }
    if (pan) return;
    const screen = localPoint(host, event);
    remember(event, screen);
    for (const record of [press, rightPress]) if (record) record.moved = Math.max(record.moved, distance(record.screen, screen));
    sendTool('move', screen, -1, event.buttons ?? 0, modifiersOf(event));
    if ((event.buttons ?? 0) === 0 && !press) scheduleHover(screen);
  };

  const onPointerUp = (event) => {
    buttonUp(event, event.button);
    if (pan && event.pointerId === pan.pointerId && !event.buttons) endPan();
  };

  const abortPress = () => {
    if (!press) return;
    const { pointerId } = press;
    press = null;
    releaseCapture(pointerId);
    tools?.cancel();
  };

  const onPointerCancel = (event) => {
    if (pan && event.pointerId === pan.pointerId) endPan();
    if (press && press.pointerId === event.pointerId) abortPress();
    rightPress = null;
  };

  const onLostCapture = (event) => {
    if (pan && event.pointerId === pan.pointerId) {
      pan = null;
      updateCursor();
    }
    if (press && press.pointerId === event.pointerId) abortPress();
  };

  const onPointerEnter = (event) => {
    if (pointer) pointer.over = true;
    else remember(event, localPoint(host, event));
  };

  const onPointerLeave = () => {
    if (pointer) pointer.over = false;
    clearHover();
  };

  const onWheel = (event) => {
    event.preventDefault();
    const factor = clampFactor(wheelZoomFactor(event.deltaY, event.deltaMode, event.ctrlKey, camera.height));
    if (factor === 1) return;
    camera.zoomAt(localPoint(host, event), factor);
    clearHover();
    if (press) resendMove();
  };

  const onModifierKey = (event) => {
    if (!MODIFIER_KEYS.has(event.key)) return false;
    if (event.type === 'keyup' && event.key === 'Alt') event.preventDefault();
    if (pointer && (press || pointer.over)) resendMove(modifiersOf(event));
    return true;
  };

  const onKeyDown = (event) => {
    if (onModifierKey(event)) return;
    if (event.key === SPACE) {
      event.preventDefault();
      if (!event.repeat && !spaceHeld) {
        spaceHeld = true;
        spaceUsed = false;
        updateCursor();
      }
      return;
    }
    const factor = ZOOM_KEYS[event.key];
    if (factor === undefined || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    camera.zoomAt({ x: camera.width / 2, y: camera.height / 2 }, factor);
    clearHover();
    if (press) resendMove();
  };

  const onKeyUp = (event) => {
    if (onModifierKey(event)) return;
    if (event.key !== SPACE) return;
    event.preventDefault();
    if (!spaceHeld) return;
    const tap = !spaceUsed;
    spaceHeld = false;
    spaceUsed = false;
    updateCursor();
    if (tap) onSpaceTap();
  };

  const onBlur = () => {
    spaceHeld = false;
    spaceUsed = false;
    updateCursor();
  };

  const onWindowBlur = () => {
    abortPress();
    rightPress = null;
    clearHover();
  };

  const onAuxClick = (event) => {
    if (event.button === MIDDLE) event.preventDefault();
  };

  const onContextMenu = (event) => {
    event.preventDefault();
  };

  const listeners = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['pointercancel', onPointerCancel],
    ['lostpointercapture', onLostCapture],
    ['pointerenter', onPointerEnter],
    ['pointerleave', onPointerLeave],
    ['wheel', onWheel, { passive: false }],
    ['keydown', onKeyDown],
    ['keyup', onKeyUp],
    ['blur', onBlur],
    ['auxclick', onAuxClick],
    ['contextmenu', onContextMenu],
  ];
  for (const [type, listener, options] of listeners) host.addEventListener(type, listener, options);
  view.addEventListener('blur', onWindowBlur);

  return () => {
    endPan();
    abortPress();
    rightPress = null;
    clearHover();
    for (const [type, listener, options] of listeners) host.removeEventListener(type, listener, options);
    view.removeEventListener('blur', onWindowBlur);
    spaceHeld = false;
    host.style.cursor = '';
  };
}
