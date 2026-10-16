const HOVER_DELAY = 400;
const GAP = 8;
const WINDOW_PADDING = 4;

const elements = new WeakMap();
let visible = null;

/**
 * @typedef {object} TooltipHandle
 * @property {() => void} update Re-reads the text and repositions the tooltip while it is shown for the element.
 * @property {() => void} detach Hides the tooltip if shown for the element and removes its listeners.
 */

function tooltipElement(doc) {
  let element = elements.get(doc);
  if (!element) {
    element = doc.createElement('div');
    element.className = 'tooltip';
    element.setAttribute('aria-hidden', 'true');
    element.hidden = true;
    doc.body.append(element);
    elements.set(doc, element);
  }
  return element;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function place(element, anchor, placement) {
  const view = anchor.ownerDocument.defaultView;
  const target = anchor.getBoundingClientRect();
  const size = element.getBoundingClientRect();
  const below = placement === 'below';
  const preferredLeft = below ? target.left + target.width / 2 - size.width / 2 : target.right + GAP;
  const preferredTop = below ? target.bottom + GAP : target.top + target.height / 2 - size.height / 2;
  const left = clamp(preferredLeft, WINDOW_PADDING, view.innerWidth - size.width - WINDOW_PADDING);
  const top = clamp(preferredTop, WINDOW_PADDING, view.innerHeight - size.height - WINDOW_PADDING);
  element.style.left = `${Math.max(WINDOW_PADDING, left)}px`;
  element.style.top = `${Math.max(WINDOW_PADDING, top)}px`;
}

/**
 * Attaches the shared custom tooltip to an element. It shows after 400 ms of mouse or pen hover, or at once when
 * the element gets `:focus-visible` focus, 8 px right of the element and vertically centered, or 8 px below it and
 * horizontally centered, kept inside the window, and hides on pointer leave, blur, press and Esc. One tooltip shows
 * at a time. The element's `title` is never set. The tooltip element is created on the first show.
 * @param {HTMLElement} element Element the tooltip describes.
 * @param {() => string} text Tooltip text; read on show and on `update`.
 * @param {{ placement?: 'right' | 'below' }} [options] Side of the element the tooltip sits on; `'right'` by default.
 * @returns {TooltipHandle}
 */
export function attachTooltip(element, text, { placement = 'right' } = {}) {
  let timer = null;
  const owner = {};

  function cancelTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function hide() {
    cancelTimer();
    if (visible !== owner) return;
    visible = null;
    tooltipElement(element.ownerDocument).hidden = true;
  }

  function show() {
    cancelTimer();
    if (visible && visible !== owner) visible.hide();
    const tooltip = tooltipElement(element.ownerDocument);
    visible = owner;
    tooltip.textContent = text();
    tooltip.hidden = false;
    place(tooltip, element, placement);
  }

  function update() {
    if (visible !== owner) return;
    const tooltip = tooltipElement(element.ownerDocument);
    tooltip.textContent = text();
    place(tooltip, element, placement);
  }

  owner.hide = hide;

  const listeners = {
    pointerenter(event) {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      cancelTimer();
      timer = setTimeout(show, HOVER_DELAY);
    },
    pointerleave: hide,
    pointerdown: hide,
    blur: hide,
    focus() {
      if (element.matches(':focus-visible')) show();
    },
    keydown(event) {
      if (event.key === 'Escape') hide();
    },
  };
  for (const [type, listener] of Object.entries(listeners)) element.addEventListener(type, listener);

  function detach() {
    hide();
    for (const [type, listener] of Object.entries(listeners)) element.removeEventListener(type, listener);
  }

  return { update, detach };
}
