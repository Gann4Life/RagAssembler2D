import { KEY_ZOOM_STEP, MAX_SCALE, MIN_SCALE, wheelZoomFactor } from './camera.js';

const PRIMARY = 0;
const MIDDLE = 1;
const SPACE = ' ';
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

/**
 * Attaches viewport navigation to the host element ([DESIGN §5.4]). A press focuses the host. Middle drag, or
 * Space + left drag while the host has focus, pans with pointer capture (`grab`/`grabbing` cursors). The wheel
 * zooms about the pointer and never scrolls or zooms the page. `+`/`=` and `-` zoom by √2 about the center.
 * Every Space `keydown` (repeats included) and `keyup` on the host is `preventDefault`ed, so the document hotkey
 * dispatcher skips it; a Space press and release without a pan calls `onSpaceTap`.
 * @param {HTMLElement} host Focusable viewport host.
 * @param {{ camera: import('./camera.js').Camera, onSpaceTap?: () => void }} options Camera to drive, and the
 *   Space tap handler.
 * @returns {() => void} Function that removes every listener and restores the cursor.
 */
export function attachInput(host, { camera, onSpaceTap = () => {} }) {
  let spaceHeld = false;
  let spaceUsed = false;
  let pan = null;

  const updateCursor = () => {
    host.style.cursor = pan ? 'grabbing' : spaceHeld ? 'grab' : '';
  };

  const endPan = () => {
    if (!pan) return;
    if (host.hasPointerCapture?.(pan.pointerId)) host.releasePointerCapture(pan.pointerId);
    pan = null;
    updateCursor();
  };

  const onPointerDown = (event) => {
    if (event.button === MIDDLE) event.preventDefault();
    host.focus({ preventScroll: true });
    if (pan) return;
    const panning = event.button === MIDDLE || (event.button === PRIMARY && spaceHeld);
    if (!panning) return;
    if (event.button === PRIMARY) spaceUsed = true;
    event.preventDefault();
    pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    host.setPointerCapture(event.pointerId);
    updateCursor();
  };

  const onPointerMove = (event) => {
    if (!pan || event.pointerId !== pan.pointerId) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    pan.x = event.clientX;
    pan.y = event.clientY;
    if (dx !== 0 || dy !== 0) camera.panBy(dx, dy);
  };

  const onPointerUp = (event) => {
    if (pan && event.pointerId === pan.pointerId) endPan();
  };

  const onWheel = (event) => {
    event.preventDefault();
    const factor = clampFactor(wheelZoomFactor(event.deltaY, event.deltaMode, event.ctrlKey, camera.height));
    if (factor !== 1) camera.zoomAt(localPoint(host, event), factor);
  };

  const onKeyDown = (event) => {
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
  };

  const onKeyUp = (event) => {
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

  const onAuxClick = (event) => {
    if (event.button === MIDDLE) event.preventDefault();
  };

  const listeners = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['pointercancel', onPointerUp],
    ['lostpointercapture', onPointerUp],
    ['wheel', onWheel, { passive: false }],
    ['keydown', onKeyDown],
    ['keyup', onKeyUp],
    ['blur', onBlur],
    ['auxclick', onAuxClick],
  ];
  for (const [type, listener, options] of listeners) host.addEventListener(type, listener, options);

  return () => {
    endPan();
    for (const [type, listener, options] of listeners) host.removeEventListener(type, listener, options);
    spaceHeld = false;
    host.style.cursor = '';
  };
}
