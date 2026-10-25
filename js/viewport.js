import { framingBounds } from './viewport/bounds.js';
import { createGhosts } from './viewport/ghosts.js';
import { createGizmos } from './viewport/gizmos.js';
import { createGrid } from './viewport/grid.js';
import { boxTest, hitTest } from './viewport/hit.js';
import { attachInput } from './viewport/input.js';
import { createScene } from './viewport/scene.js';
import { COLORS, LABEL_SIZE } from './viewport/style.js';

/**
 * @typedef {object} Viewport
 * @property {object} app The PIXI application rendering the viewport.
 * @property {import('./viewport/scene.js').Scene} scene The scene synced from the model.
 * @property {import('./viewport/gizmos.js').Gizmos} gizmos The gizmo layer; whoever calls `scene.setPose` also calls
 *   `gizmos.invalidate()`.
 * @property {(screen: { x: number, y: number }) => number[]} hitTest Uids under a screen point (CSS px from the host's
 *   top-left), topmost first, in the displayed pose.
 * @property {(uids: Iterable<number>|null) => void} frame Fits the given objects into the view, or everything for
 *   `null` or when they have nothing to frame.
 * @property {(pose: import('./viewport/bounds.js').Pose|null) => void} setBasePose Sets the pose shown when no tool sets one,
 *   e.g. the FK pose in Animate mode; `null` is the rest pose.
 * @property {(ghosts: ReadonlyArray<{ side: 'ahead'|'behind', pose: import('./viewport/bounds.js').Pose }>) => void} setGhosts
 *   Replaces the ghosts drawn between the grid and the scene.
 * @property {() => void} destroy Stops resizing and input, unbinds the tools, and destroys the application and its
 *   canvas.
 */

/**
 * @typedef {object} ViewportOptions
 * @property {import('./model/model.js').Model} model Document model.
 * @property {import('./viewport/camera.js').Camera} camera Camera driven by navigation and framing.
 * @property {import('./settings.js').Settings} settings Editor settings (grid, display mode, overlays).
 * @property {import('./model/selection.js').Selection} selection Selection shown by the gizmo layer.
 * @property {import('./modes.js').Modes} modes Modes; a mode change redraws the gizmos.
 * @property {import('./tools/registry.js').ToolRegistry} tools Tool registry bound to the view.
 * @property {() => import('./viewport/camera.js').Insets} [insets] Framing margins, CSS px; zero by default.
 * @property {() => void} [onSpaceTap] Called when Space is pressed and released on the host without a pan.
 */

const BACKGROUND = 0x1b1d21;
const NO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const KEY_SUMMARY_ID = 'viewport-keys';
const KEY_SUMMARY =
  'Space and drag, or middle drag, pans. Wheel, plus and minus zoom. F frames the selection, Home frames everything. ' +
  'Escape cancels the current tool operation, or clears the selection. ' +
  'Z switches the transform pivot between the selection center and the last selected object.';
const TOOL_CURSOR_PROPERTY = '--tool-cursor';
const READOUT_OUTLINE = 0x111214;
const READOUT_OUTLINE_WIDTH = 3;

/**
 * Creates the PIXI viewport inside a host element: grid, scene, gizmo layer and tool overlay, in that order, with
 * navigation over the camera and tool input. The renderer follows the host size (CSS px, reported to the camera)
 * and `devicePixelRatio`, also when only the ratio changes. Frames everything on start and after every model
 * `reset`. Binds the tool registry (hit testing in the displayed pose, the host cursor, overlay redraws at most once
 * per frame, the active tool's drag readout as text kept inside the host) and shows hover feedback unless the
 * active tool disables it or the pointer is over one of its handles. Ticks the tools once per frame before the
 * scene and gizmo redraws, and shows the pose they set with `ToolContext.setPose`. Makes the host `role="application"` with
 * `aria-roledescription="viewport"` and a visually hidden key summary.
 * @param {object} PIXI The PIXI.js v8 namespace.
 * @param {HTMLElement} host Element that receives the canvas.
 * @param {ViewportOptions} options
 * @returns {Promise<Viewport>}
 */
export async function createViewport(
  PIXI,
  host,
  { model, camera, settings, selection, modes, tools, insets = () => NO_INSETS, onSpaceTap } = {},
) {
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
  const ghosts = createGhosts(PIXI, { model, camera });
  const scene = createScene(PIXI, { model, camera, settings });
  const gizmos = createGizmos(PIXI, { model, camera, selection, modes, settings, scene });
  const toolOverlay = new PIXI.Container();
  toolOverlay.label = 'tool-overlay';
  const toolGraphics = new PIXI.Graphics();
  const readoutText = new PIXI.Text({
    text: '',
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: LABEL_SIZE,
      fill: COLORS.gizmo,
      stroke: { color: READOUT_OUTLINE, width: READOUT_OUTLINE_WIDTH, join: 'round' },
    },
  });
  readoutText.label = 'readout';
  readoutText.visible = false;
  toolOverlay.addChild(toolGraphics, readoutText);
  app.stage.addChild(grid.view, ghosts.view, scene.view, gizmos.view, toolOverlay);

  let basePose = null;
  let toolPose = null;
  const showPose = (pose) => {
    scene.setPose(pose);
    gizmos.invalidate();
  };

  const hitTestAt = (screen) => hitTest(model, camera, screen, { pose: scene.pose() });

  const placeReadout = () => {
    const readout = tools.readout();
    if (readout === null) {
      readoutText.visible = false;
      return;
    }
    if (readoutText.text !== readout.text) readoutText.text = readout.text;
    const x = Math.min(readout.screen.x, camera.width - readoutText.width);
    const y = Math.min(readout.screen.y, camera.height - readoutText.height);
    readoutText.position.set(Math.round(Math.max(0, x)), Math.round(Math.max(0, y)));
    readoutText.visible = true;
  };

  let overlayDirty = true;
  const invalidateOverlay = () => {
    overlayDirty = true;
  };
  const drawOverlay = () => {
    if (!overlayDirty) return;
    overlayDirty = false;
    tools.drawOverlay(toolGraphics);
    placeReadout();
  };
  PIXI.Ticker.shared.add(drawOverlay);
  const offCamera = camera.on('camera', invalidateOverlay);
  const overlayTriggers = [
    selection.on('selection', invalidateOverlay),
    modes.on('mode', invalidateOverlay),
    model.on('change', invalidateOverlay),
    model.on('reset', invalidateOverlay),
    settings.on('settings', invalidateOverlay),
  ];

  const hoverAllowed = () => tools.active === null || (tools.usable && tools.active.hover);
  const onHover = (screen) => {
    const shown = screen && hoverAllowed() && tools.handleAt(screen) === null;
    gizmos.setHover(shown ? (hitTestAt(screen)[0] ?? null) : null);
  };
  const onTool = () => {
    invalidateOverlay();
    if (!hoverAllowed()) gizmos.setHover(null);
  };
  const offTool = tools.on('tool', onTool);
  const offModeHover = modes.on('mode', onTool);

  const unbindTools = tools.bindView({
    hitTest: hitTestAt,
    boxTest: (box) => boxTest(model, box, { pose: scene.pose() }),
    setCursor: (css) => host.style.setProperty(TOOL_CURSOR_PROPERTY, css),
    invalidateOverlay,
    setPose: (pose) => {
      toolPose = pose ?? null;
      showPose(toolPose ?? basePose);
    },
    displayedPose: () => scene.pose(),
  });
  const tickTools = (ticker) => tools.tick(ticker.deltaMS / 1000);
  PIXI.Ticker.shared.add(tickTools, undefined, PIXI.UPDATE_PRIORITY.HIGH);

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

  const onReset = ({ cause }) => {
    if (cause !== 'load') frame(null);
  };
  const offReset = model.on('reset', onReset);
  const detachInput = attachInput(host, { camera, onSpaceTap, tools, onHover });
  const restoreHost = describeHost(host);

  frame(null);

  return {
    app,
    scene,
    gizmos,
    hitTest: hitTestAt,
    frame,
    setBasePose(pose) {
      basePose = pose ?? null;
      showPose(toolPose ?? basePose);
      invalidateOverlay();
    },
    setGhosts: (list) => ghosts.setGhosts(list),
    destroy() {
      detachInput();
      PIXI.Ticker.shared.remove(tickTools);
      unbindTools();
      offTool();
      offModeHover();
      offCamera();
      for (const off of overlayTriggers) off();
      offReset();
      PIXI.Ticker.shared.remove(drawOverlay);
      stopResolutionWatch();
      observer.disconnect();
      restoreHost();
      host.style.removeProperty(TOOL_CURSOR_PROPERTY);
      gizmos.destroy();
      scene.destroy();
      ghosts.destroy();
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
