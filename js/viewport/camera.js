import { Emitter } from '../../lib/emitter.js';

/**
 * @typedef {object} Insets
 * @property {number} top CSS px.
 * @property {number} right CSS px.
 * @property {number} bottom CSS px.
 * @property {number} left CSS px.
 */

/** Smallest camera scale, CSS px per meter. */
export const MIN_SCALE = 2;

/** Largest camera scale, CSS px per meter. */
export const MAX_SCALE = 10000;

/** Largest absolute value of each `center` coordinate, meters. */
export const MAX_CENTER = 10000;

/** Zoom factor of one `+` or `-` key press. */
export const KEY_ZOOM_STEP = Math.SQRT2;

const DEFAULT_SCALE = 32;
const LINE_HEIGHT = 16;
const WHEEL_RATE = 400;
const PINCH_RATE = 100;
const NO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampCenter(value) {
  return clamp(value, -MAX_CENTER, MAX_CENTER) + 0;
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be a finite number, got ${value}`);
  return value;
}

/**
 * Zoom factor of one wheel event: `2^(−Δy / 400)`, or `2^(−Δy / 100)` with Ctrl (trackpad pinch).
 * @param {number} deltaY `WheelEvent.deltaY`.
 * @param {0|1|2} deltaMode `WheelEvent.deltaMode`: pixels, lines (× 16 px) or pages (× the viewport height).
 * @param {boolean} ctrlKey Whether Ctrl was held.
 * @param {number} viewportHeight Viewport height, CSS px.
 * @returns {number} Factor to pass to `Camera#zoomAt`.
 */
export function wheelZoomFactor(deltaY, deltaMode, ctrlKey, viewportHeight) {
  const unit = deltaMode === 1 ? LINE_HEIGHT : deltaMode === 2 ? viewportHeight : 1;
  return 2 ** (-(deltaY * unit) / (ctrlKey ? PINCH_RATE : WHEEL_RATE));
}

/**
 * Viewport camera: `center` in meters (Y up) and `scale` in CSS px per meter, independent of `pixelsPerMeter`.
 * Screen coordinates are CSS px from the host's top-left corner, Y down. Emits `camera` with
 * `{ center, scale, width, height }` once per operation that changed any of them. Session state, not undoable.
 */
export class Camera {
  #center = { x: 0, y: 0 };
  #scale = DEFAULT_SCALE;
  #width = 0;
  #height = 0;
  #emitter = new Emitter();

  /**
   * World point at the viewport center, meters.
   * @returns {Readonly<{ x: number, y: number }>}
   */
  get center() {
    return Object.freeze({ ...this.#center });
  }

  /**
   * CSS px per meter, within `MIN_SCALE`–`MAX_SCALE`.
   * @returns {number}
   */
  get scale() {
    return this.#scale;
  }

  /**
   * Viewport width, CSS px.
   * @returns {number}
   */
  get width() {
    return this.#width;
  }

  /**
   * Viewport height, CSS px.
   * @returns {number}
   */
  get height() {
    return this.#height;
  }

  /**
   * Sets the viewport size, keeping `center` and `scale`.
   * @param {number} width CSS px, at least 0.
   * @param {number} height CSS px, at least 0.
   * @returns {void}
   * @throws {RangeError} When a size is negative or not finite.
   */
  setSize(width, height) {
    requireFinite(width, 'width');
    requireFinite(height, 'height');
    if (width < 0 || height < 0) throw new RangeError(`Viewport size must not be negative, got ${width} × ${height}`);
    this.#update(() => {
      this.#width = width;
      this.#height = height;
    });
  }

  /**
   * Maps a world point to the screen.
   * @param {{ x: number, y: number }} p World point, meters, Y up.
   * @returns {{ x: number, y: number }} Screen point, CSS px, Y down.
   */
  worldToScreen(p) {
    return {
      x: (p.x - this.#center.x) * this.#scale + this.#width / 2,
      y: (this.#center.y - p.y) * this.#scale + this.#height / 2,
    };
  }

  /**
   * Maps a screen point to the world.
   * @param {{ x: number, y: number }} p Screen point, CSS px, Y down.
   * @returns {{ x: number, y: number }} World point, meters, Y up.
   */
  screenToWorld(p) {
    return {
      x: (p.x - this.#width / 2) / this.#scale + this.#center.x,
      y: this.#center.y - (p.y - this.#height / 2) / this.#scale,
    };
  }

  /**
   * Pans so the world follows a screen drag: the world point under the pointer moves by the delta.
   * @param {number} dx Screen delta, CSS px, right positive.
   * @param {number} dy Screen delta, CSS px, down positive.
   * @returns {void}
   * @throws {RangeError} When a delta is not finite.
   */
  panBy(dx, dy) {
    requireFinite(dx, 'dx');
    requireFinite(dy, 'dy');
    this.#update(() => {
      this.#setCenter(this.#center.x - dx / this.#scale, this.#center.y + dy / this.#scale);
    });
  }

  /**
   * Multiplies the scale by `factor`, clamped, keeping the world point under `screenPoint` in place.
   * @param {{ x: number, y: number }} screenPoint Zoom pivot, CSS px.
   * @param {number} factor Scale multiplier, above 0.
   * @returns {void}
   * @throws {RangeError} When `factor` is not a finite number above 0 or the pivot is not finite.
   */
  zoomAt(screenPoint, factor) {
    if (!Number.isFinite(factor) || factor <= 0) throw new RangeError(`Zoom factor must be a finite number above 0, got ${factor}`);
    requireFinite(screenPoint.x, 'screenPoint.x');
    requireFinite(screenPoint.y, 'screenPoint.y');
    const scale = clamp(this.#scale * factor, MIN_SCALE, MAX_SCALE);
    if (scale === this.#scale) return;
    const pivot = this.screenToWorld(screenPoint);
    this.#update(() => {
      this.#scale = scale;
      this.#placeAt(pivot, screenPoint);
    });
  }

  /**
   * Fits a world box as large as the scale limits allow into the viewport minus `insets`, centered in it.
   * The inset rectangle is at least 1 px each way.
   * @param {import('../../lib/geometry.js').Aabb} aabb World box, meters.
   * @param {Insets} [insets] Margins, CSS px; zero by default.
   * @returns {void}
   * @throws {RangeError} When a box coordinate is not finite or the box is inverted.
   */
  frame(aabb, insets = NO_INSETS) {
    for (const name of ['minX', 'minY', 'maxX', 'maxY']) requireFinite(aabb[name], `aabb.${name}`);
    if (aabb.maxX < aabb.minX || aabb.maxY < aabb.minY) throw new RangeError('Framed box is inverted');
    const rectWidth = Math.max(1, this.#width - insets.left - insets.right);
    const rectHeight = Math.max(1, this.#height - insets.top - insets.bottom);
    const boxWidth = aabb.maxX - aabb.minX;
    const boxHeight = aabb.maxY - aabb.minY;
    const fit = Math.min(boxWidth > 0 ? rectWidth / boxWidth : Infinity, boxHeight > 0 ? rectHeight / boxHeight : Infinity);
    const world = { x: (aabb.minX + aabb.maxX) / 2, y: (aabb.minY + aabb.maxY) / 2 };
    const screen = { x: insets.left + rectWidth / 2, y: insets.top + rectHeight / 2 };
    this.#update(() => {
      this.#scale = clamp(fit, MIN_SCALE, MAX_SCALE);
      this.#placeAt(world, screen);
    });
  }

  /**
   * World box currently visible in the viewport.
   * @returns {import('../../lib/geometry.js').Aabb} Meters.
   */
  visibleBounds() {
    const halfWidth = this.#width / 2 / this.#scale;
    const halfHeight = this.#height / 2 / this.#scale;
    return {
      minX: this.#center.x - halfWidth,
      minY: this.#center.y - halfHeight,
      maxX: this.#center.x + halfWidth,
      maxY: this.#center.y + halfHeight,
    };
  }

  /**
   * Subscribes to `camera`.
   * @param {'camera'} type Event type.
   * @param {(payload: { center: { x: number, y: number }, scale: number, width: number, height: number }) => void} fn Listener.
   * @returns {() => void} Function that unsubscribes the listener.
   */
  on(type, fn) {
    return this.#emitter.on(type, fn);
  }

  /**
   * Unsubscribes a listener.
   * @param {'camera'} type Event type.
   * @param {(payload: object) => void} fn Listener.
   * @returns {void}
   */
  off(type, fn) {
    this.#emitter.off(type, fn);
  }

  #setCenter(x, y) {
    this.#center = { x: clampCenter(x), y: clampCenter(y) };
  }

  #placeAt(world, screen) {
    this.#setCenter(
      world.x - (screen.x - this.#width / 2) / this.#scale,
      world.y + (screen.y - this.#height / 2) / this.#scale,
    );
  }

  #update(mutate) {
    const before = [this.#center.x, this.#center.y, this.#scale, this.#width, this.#height];
    mutate();
    const after = [this.#center.x, this.#center.y, this.#scale, this.#width, this.#height];
    if (before.every((value, index) => Object.is(value, after[index]))) return;
    this.#emitter.emit(
      'camera',
      Object.freeze({ center: this.center, scale: this.#scale, width: this.#width, height: this.#height }),
    );
  }
}
