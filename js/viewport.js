/**
 * @typedef {object} Viewport
 * @property {object} app The PIXI application rendering the viewport.
 * @property {() => void} destroy Stops resizing and destroys the application and its canvas.
 */

const BACKGROUND = 0x1b1d21;

/**
 * Creates the PIXI viewport inside a host element and keeps the renderer sized to it.
 * The renderer follows the host size (CSS px) and `devicePixelRatio`.
 * @param {object} PIXI The PIXI.js v8 namespace.
 * @param {HTMLElement} host Element that receives the canvas.
 * @returns {Promise<Viewport>}
 */
export async function createViewport(PIXI, host) {
  const app = new PIXI.Application();
  await app.init({
    width: hostWidth(host),
    height: hostHeight(host),
    background: BACKGROUND,
    antialias: true,
    resolution: currentResolution(),
    autoDensity: true,
  });
  app.canvas.classList.add('viewport-canvas');
  host.append(app.canvas);

  const resize = () => {
    app.renderer.resize(hostWidth(host), hostHeight(host), currentResolution());
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  return {
    app,
    destroy() {
      observer.disconnect();
      app.destroy({ removeView: true }, { children: true });
    },
  };
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
