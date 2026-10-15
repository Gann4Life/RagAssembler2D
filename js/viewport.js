import { framingBounds } from './viewport/bounds.js';
import { createGrid } from './viewport/grid.js';
import { attachInput } from './viewport/input.js';
import { createScene } from './viewport/scene.js';

/**
 * @typedef {object} Viewport
 * @property {object} app The PIXI application rendering the viewport.
 * @property {import('./viewport/scene.js').Scene} scene The scene synced from the model.
 * @property {(uids: Iterable<number>|null) => void} frame Fits the given objects into the view, or everything for
 *   `null` or when they have nothing to frame.
 * @property {() => void} destroy Stops resizing and input, and destroys the application and its canvas.
 */

/**
 * @typedef {object} ViewportOptions
 * @property {import('./model/model.js').Model} model Document model.
 * @property {import('./viewport/camera.js').Camera} camera Camera driven by navigation and framing.
 * @property {import('./settings.js').Settings} settings Editor settings (grid, display mode).
 * @property {() => import('./viewport/camera.js').Insets} [insets] Framing margins, CSS px; zero by default.
 * @property {() => void} [onSpaceTap] Called when Space is pressed and released on the host without a pan.
 */

const BACKGROUND = 0x1b1d21;
const NO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const KEY_SUMMARY_ID = 'viewport-keys';
const KEY_SUMMARY =
  'Space and drag, or middle drag, pans. Wheel, plus and minus zoom. F frames the selection, Home frames everything.';

/**
 * Creates the PIXI viewport inside a host element: grid, scene and navigation over the camera. The renderer
 * follows the host size (CSS px, reported to the camera) and `devicePixelRatio`, also when only the ratio changes.
 * Frames everything on start and after every model `reset`. Makes the host `role="application"` with
 * `aria-roledescription="viewport"` and a visually hidden key summary.
 * @param {object} PIXI The PIXI.js v8 namespace.
 * @param {HTMLElement} host Element that receives the canvas.
 * @param {ViewportOptions} options
 * @returns {Promise<Viewport>}
 */
export async function createViewport(PIXI, host, { model, camera, settings, insets = () => NO_INSETS, onSpaceTap } = {}) {
  const app = new PIXI.Application();
  await app.init({
    width: hostWidth(host),
    height: hostHeight(host),
    background: BACKGROUND,
    antialias: true,
    resolution: currentResolution(),
    autoDensity: true,
    sharedTicker: true,
  });
  app.canvas.classList.add('viewport-canvas');
  host.append(app.canvas);
  camera.setSize(hostWidth(host), hostHeight(host));

  const grid = createGrid(PIXI, { camera, settings });
  const scene = createScene(PIXI, { model, camera, settings });
  app.stage.addChild(grid.view, scene.view);

  const frame = (uids) => {
    const pose = scene.pose();
    const box = (uids === null ? null : framingBounds(model, uids, pose)) ?? framingBounds(model, null, pose);
    camera.frame(box, insets());
  };

  const resize = () => {
    camera.setSize(hostWidth(host), hostHeight(host));
    app.renderer.resize(hostWidth(host), hostHeight(host), currentResolution());
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const stopResolutionWatch = watchResolution(resize);

  const onReset = () => frame(null);
  const offReset = model.on('reset', onReset);
  const detachInput = attachInput(host, { camera, onSpaceTap });
  const restoreHost = describeHost(host);

  frame(null);

  return {
    app,
    scene,
    frame,
    destroy() {
      detachInput();
      offReset();
      stopResolutionWatch();
      observer.disconnect();
      restoreHost();
      scene.destroy();
      grid.destroy();
      app.destroy({ removeView: true }, { children: true });
    },
  };
}

function describeHost(host) {
  const doc = host.ownerDocument;
  const summary = doc.createElement('p');
  summary.id = KEY_SUMMARY_ID;
  summary.className = 'visually-hidden';
  summary.textContent = KEY_SUMMARY;
  host.after(summary);
  const previousRole = host.getAttribute('role');
  host.setAttribute('role', 'application');
  host.setAttribute('aria-roledescription', 'viewport');
  host.setAttribute('aria-describedby', KEY_SUMMARY_ID);
  return () => {
    summary.remove();
    if (previousRole === null) host.removeAttribute('role');
    else host.setAttribute('role', previousRole);
    host.removeAttribute('aria-roledescription');
    host.removeAttribute('aria-describedby');
  };
}

function watchResolution(onChange) {
  let query = null;
  const listen = () => {
    query = globalThis.matchMedia(`(resolution: ${currentResolution()}dppx)`);
    query.addEventListener('change', onQueryChange, { once: true });
  };
  const onQueryChange = () => {
    onChange();
    listen();
  };
  listen();
  return () => query.removeEventListener('change', onQueryChange);
}

function hostWidth(host) {
  return Math.max(1, Math.floor(host.clientWidth));
}

function hostHeight(host) {
  return Math.max(1, Math.floor(host.clientHeight));
}

function currentResolution() {
  return globalThis.devicePixelRatio || 1;
}
