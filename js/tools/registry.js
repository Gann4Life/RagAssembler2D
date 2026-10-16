import { Emitter } from '../../lib/emitter.js';
import { invertTransform, transformPoint } from '../../lib/geometry.js';
import { ROOT_UID } from '../model/model.js';
import { snapAngle, snapLength, snapPoint } from '../viewport/snap.js';
import { TOOL_SPECS } from './tool.js';

const PRIMARY = 0;
const SECONDARY = 2;
const PRIMARY_BUTTON_MASK = 1;
const ESCAPE_KEYS = new Set(['Escape', 'Esc']);

/**
 * Editor services the registry and its tools work with.
 * @typedef {object} ToolCore
 * @property {import('../model/model.js').Model} model Document model.
 * @property {import('../commands/history.js').History} history Command stack.
 * @property {import('../model/selection.js').Selection} selection Selection.
 * @property {import('../modes.js').Modes} modes Modes and policy.
 * @property {import('../settings.js').Settings} settings Editor settings.
 * @property {import('../viewport/camera.js').Camera} camera Viewport camera.
 */

/**
 * Viewport tool registry: activation under the mode policy, pointer and key routing, one history gesture
 * per left press, and cancellation on Esc, tool switch, mode change, gestures closed elsewhere and reset.
 * Emits `tool` with `{ id, previous }` (ids, or `null` for no tool) when the active tool changes. Subscribe
 * it to `modes` before any other `mode` listener.
 */
export class ToolRegistry {
  #core;
  #tools = new Map();
  #active = null;
  #emitter = new Emitter();
  #view = null;
  #cursor = null;
  #press = null;
  #ctx;

  /**
   * Registers the tools, subscribes to `mode`, `history` and the model's `reset`, and activates Select
   * when it is registered. Emits nothing.
   * @param {ToolCore} core Editor services.
   * @param {ReadonlyArray<import('./tool.js').Tool>} tools Tools built with `defineTool`.
   * @throws {Error} When a tool id is not in `TOOL_SPECS` or appears twice.
   */
  constructor(core, tools) {
    this.#core = core;
    const given = new Map();
    for (const tool of tools) {
      if (!TOOL_SPECS.some((row) => row.id === tool?.id)) throw new Error(`Unknown tool "${tool?.id}"`);
      if (given.has(tool.id)) throw new Error(`Tool "${tool.id}" is registered twice`);
      given.set(tool.id, tool);
    }
    for (const { id } of TOOL_SPECS) if (given.has(id)) this.#tools.set(id, given.get(id));
    this.#ctx = this.#createContext();
    core.modes.on('mode', () => this.#onMode());
    core.history.on('history', (state) => this.#onHistory(state));
    core.model.on('reset', () => this.cancel());
    const select = this.#tools.get('select');
    if (select) {
      this.#active = select;
      select.activate(this.#ctx);
    }
  }

  /**
   * The active tool, or `null`.
   * @returns {import('./tool.js').Tool|null}
   */
  get active() {
    return this.#active;
  }

  /**
   * Registered tools in `TOOL_SPECS` order.
   * @returns {import('./tool.js').Tool[]}
   */
  list() {
    return [...this.#tools.values()];
  }

  /**
   * A registered tool.
   * @param {import('./tool.js').ToolId} id Tool id.
   * @returns {import('./tool.js').Tool|null}
   */
  get(id) {
    return this.#tools.get(id) ?? null;
  }

  /**
   * Whether a tool is registered.
   * @param {import('./tool.js').ToolId} id Tool id.
   * @returns {boolean}
   */
  has(id) {
    return this.#tools.has(id);
  }

  /**
   * Whether a tool is registered and allowed by the current mode.
   * @param {import('./tool.js').ToolId} id Tool id.
   * @returns {boolean}
   */
  canActivate(id) {
    const tool = this.#tools.get(id);
    return Boolean(tool) && this.#core.modes.can(tool.capability);
  }

  /**
   * Makes a tool active: cancels the operation in progress, deactivates the previous tool, activates the new
   * one, applies its cursor, invalidates the overlay and emits `tool`. Choosing the active tool does nothing.
   * @param {import('./tool.js').ToolId} id Tool id.
   * @returns {boolean} `false` when the tool is not registered or the mode refuses it.
   */
  activate(id) {
    if (!this.canActivate(id)) return false;
    if (this.#active?.id === id) return true;
    this.cancel();
    const previous = this.#active;
    previous?.deactivate();
    this.#switchTo(this.#tools.get(id), previous);
    return true;
  }

  /**
   * Routes viewport pointer input to the active tool, adding world and root-local coordinates. A left press
   * opens one history gesture until its release; right presses and releases pass without a gesture, unless a
   * left press is open. After a cancel, the rest of the press is swallowed. A handler that throws during a
   * press cancels it and the error is rethrown.
   * @param {import('./tool.js').ToolPointerInput} input Pointer input.
   * @returns {void}
   */
  pointer(input) {
    const tool = this.#active;
    if (!tool) return;
    const event = this.#complete(input);
    switch (input.type) {
      case 'down':
        return this.#down(tool, event);
      case 'move':
        return this.#move(tool, event);
      case 'up':
        return this.#up(tool, event);
      default:
        return undefined;
    }
  }

  /**
   * Offers a key press to the active tool. Escape is never offered.
   * @param {{ key: string, code?: string, shiftKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, repeat?: boolean }} event Keyboard event.
   * @returns {boolean} Whether the tool consumed the key.
   */
  key(event) {
    const tool = this.#active;
    if (!tool || ESCAPE_KEYS.has(event.key)) return false;
    const keyEvent = Object.freeze({
      key: event.key,
      code: event.code ?? '',
      shift: Boolean(event.shiftKey),
      ctrl: Boolean(event.ctrlKey || event.metaKey),
      alt: Boolean(event.altKey),
      repeat: Boolean(event.repeat),
    });
    return this.#run(() => tool.keyDown(keyEvent) === true);
  }

  /**
   * Cancels the operation in progress: the rest of an open press is swallowed, the active tool's `cancel`
   * runs, then any open history gesture is cancelled, and the overlay is invalidated.
   * @returns {boolean} Whether the tool or the history aborted something.
   */
  cancel() {
    if (this.#press) this.#press.cancelled = true;
    const toolAborted = this.#active ? this.#active.cancel() === true : false;
    const gestureAborted = this.#core.history.cancelGesture();
    this.#invalidate();
    return toolAborted || gestureAborted;
  }

  /**
   * Connects the viewport: hit testing, the cursor and overlay invalidation reach it until unbound.
   * Applies the current cursor.
   * @param {import('./tool.js').ToolView} view Viewport services.
   * @returns {() => void} Function that unbinds the view.
   */
  bindView(view) {
    this.#view = view;
    this.#applyCursor();
    return () => {
      if (this.#view === view) this.#view = null;
    };
  }

  /**
   * Clears the graphics and lets the active tool draw on it, in screen space.
   * @param {{ clear(): unknown }} g `PIXI.Graphics` of the tool overlay.
   * @returns {void}
   */
  drawOverlay(g) {
    g.clear();
    this.#active?.drawOverlay(g);
  }

  /**
   * The active tool's handle under a screen point; the viewport hides object hover over it.
   * @param {{ x: number, y: number }} screen Screen point, CSS px from the host's top-left.
   * @returns {string|null} Handle id, or `null` with no active tool, no bound view or no handle there.
   */
  handleAt(screen) {
    if (!this.#active || !this.#view) return null;
    return this.#active.handleAt(screen) ?? null;
  }

  /**
   * The active tool's drag readout, drawn by the viewport as text in the tool overlay.
   * @returns {{ text: string, screen: { x: number, y: number } }|null} Text and its top-left corner, CSS px, or
   *   `null` with no active tool, no bound view or no drag readout.
   */
  readout() {
    if (!this.#active || !this.#view) return null;
    return this.#active.readout() ?? null;
  }

  /**
   * Subscribes to `tool`.
   * @param {'tool'} type Event type.
   * @param {(payload: { id: string|null, previous: string|null }) => void} fn Listener.
   * @returns {() => void} Function that unsubscribes the listener.
   */
  on(type, fn) {
    return this.#emitter.on(type, fn);
  }

  /**
   * Unsubscribes a listener.
   * @param {'tool'} type Event type.
   * @param {(payload: { id: string|null, previous: string|null }) => void} fn Listener.
   * @returns {void}
   */
  off(type, fn) {
    this.#emitter.off(type, fn);
  }

  #createContext() {
    const { model, history, selection, modes, settings, camera } = this.#core;
    return Object.freeze({
      model,
      history,
      selection,
      modes,
      settings,
      camera,
      toLocal: (world) => transformPoint(invertTransform(this.#rootTransform()), world),
      toWorld: (local) => transformPoint(this.#rootTransform(), local),
      snapPoint: (world) => snapPoint(world, settings),
      snapLength: (length) => snapLength(length, settings),
      snapAngle: (angle, shift) => snapAngle(angle, shift),
      hitTest: (screen) => (this.#view ? this.#view.hitTest(screen) : []),
      boxTest: (box) => (this.#view ? this.#view.boxTest(box) : []),
      setCursor: (css) => {
        this.#cursor = css ?? null;
        this.#applyCursor();
      },
      invalidateOverlay: () => this.#invalidate(),
    });
  }

  #rootTransform() {
    const props = this.#core.model.get(ROOT_UID).props;
    const position = Array.isArray(props.position) ? props.position : [0, 0];
    return { x: position[0], y: position[1], angle: props.angle ?? 0 };
  }

  #complete(input) {
    const screen = Object.freeze({ x: input.screen.x, y: input.screen.y });
    const world = this.#core.camera.screenToWorld(screen);
    return Object.freeze({ ...input, screen, world: Object.freeze(world), local: Object.freeze(this.#ctx.toLocal(world)) });
  }

  #down(tool, event) {
    if (event.button === PRIMARY) {
      if (this.#press && !this.#press.cancelled) return;
      this.#press = null;
      if (this.#core.history.inGesture) return;
      this.#core.history.beginGesture();
      this.#press = { cancelled: false };
      this.#run(() => tool.pointerDown(event));
    } else if (event.button === SECONDARY && !this.#press) {
      tool.pointerDown(event);
    }
  }

  #move(tool, event) {
    if (this.#press?.cancelled) {
      if (event.buttons & PRIMARY_BUTTON_MASK) return;
      this.#press = null;
    }
    this.#run(() => tool.pointerMove(event));
  }

  #up(tool, event) {
    if (event.button === PRIMARY) {
      const press = this.#press;
      if (!press) return;
      this.#press = null;
      if (press.cancelled) return;
      try {
        tool.pointerUp(event);
      } catch (error) {
        this.cancel();
        throw error;
      }
      this.#core.history.endGesture();
    } else if (event.button === SECONDARY && !this.#press) {
      tool.pointerUp(event);
    }
  }

  #run(handler) {
    if (!this.#press || this.#press.cancelled) return handler();
    try {
      return handler();
    } catch (error) {
      this.cancel();
      throw error;
    }
  }

  #onMode() {
    this.cancel();
    const tool = this.#active;
    if (!tool || this.#core.modes.can(tool.capability)) return;
    if (this.activate('select')) return;
    tool.deactivate();
    this.#switchTo(null, tool);
  }

  #onHistory(state) {
    if (!this.#press || this.#press.cancelled || state.gesture) return;
    this.#press.cancelled = true;
    this.#active?.cancel();
    this.#invalidate();
  }

  #switchTo(tool, previous) {
    this.#active = tool;
    this.#cursor = null;
    tool?.activate(this.#ctx);
    this.#applyCursor();
    this.#invalidate();
    this.#emitter.emit('tool', Object.freeze({ id: tool?.id ?? null, previous: previous?.id ?? null }));
  }

  #applyCursor() {
    this.#view?.setCursor(this.#cursor ?? this.#active?.cursor ?? 'default');
  }

  #invalidate() {
    this.#view?.invalidateOverlay();
  }
}
