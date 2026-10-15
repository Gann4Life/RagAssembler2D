/**
 * @typedef {'select'|'select-box'|'manipulate'|'pose'|'circle'|'box'|'polygon'|'hinge'} ToolId
 */

/**
 * One row of the tool table.
 * @typedef {object} ToolSpec
 * @property {ToolId} id Tool id; its action is `tool:<id>`.
 * @property {string} label Name shown in the toolbar and tooltips.
 * @property {string} hotkey Key in `HOTKEYS` form, e.g. `V`.
 * @property {import('../modes.js').Capability} capability Mode policy row that allows the tool.
 * @property {'selection'|'manipulation'|'creation'|'joints'} group Toolbar group.
 */

/**
 * Pointer input from the viewport. Screen points are CSS px from the host's top-left corner, Y down.
 * @typedef {object} ToolPointerInput
 * @property {'down'|'move'|'up'} type Event type.
 * @property {{ x: number, y: number }} screen Pointer position, CSS px.
 * @property {0|2|-1} button `0` left, `2` right on down and up; `-1` on move.
 * @property {number} buttons DOM bitmask of the buttons held.
 * @property {boolean} shift SHIFT held.
 * @property {boolean} ctrl Ctrl or Cmd held.
 * @property {boolean} alt ALT held.
 * @property {1|2} clicks `2` for the second press or release of a double click; `1` otherwise and on move.
 */

/**
 * Pointer input completed by the registry: `world` in meters, Y up, and `local` in root-local meters.
 * @typedef {ToolPointerInput & { world: import('../../lib/geometry.js').Vec2, local: import('../../lib/geometry.js').Vec2 }} ToolPointerEvent
 */

/**
 * Key press offered to the active tool. Escape is never offered.
 * @typedef {object} ToolKeyEvent
 * @property {string} key `KeyboardEvent.key`.
 * @property {string} code `KeyboardEvent.code`.
 * @property {boolean} shift SHIFT held.
 * @property {boolean} ctrl Ctrl or Cmd held.
 * @property {boolean} alt ALT held.
 * @property {boolean} repeat Auto-repeat.
 */

/**
 * Viewport services bound to the registry with `bindView`.
 * @typedef {object} ToolView
 * @property {(screen: { x: number, y: number }) => number[]} hitTest Uids under a screen point, topmost first.
 * @property {(box: import('../../lib/geometry.js').Aabb) => number[]} boxTest Uids inside a world box, meters.
 * @property {(css: string) => void} setCursor Sets the viewport cursor.
 * @property {() => void} invalidateOverlay Requests a tool overlay redraw.
 */

/**
 * What a tool may use. Tools mutate the model only through `history.execute`.
 * @typedef {object} ToolContext
 * @property {import('../model/model.js').Model} model Document model.
 * @property {import('../commands/history.js').History} history Command stack.
 * @property {import('../model/selection.js').Selection} selection Selection.
 * @property {import('../modes.js').Modes} modes Modes and policy.
 * @property {import('../settings.js').Settings} settings Editor settings.
 * @property {import('../viewport/camera.js').Camera} camera Viewport camera.
 * @property {(world: import('../../lib/geometry.js').Vec2) => import('../../lib/geometry.js').Vec2} toLocal World to root-local, meters.
 * @property {(local: import('../../lib/geometry.js').Vec2) => import('../../lib/geometry.js').Vec2} toWorld Root-local to world, meters.
 * @property {(world: import('../../lib/geometry.js').Vec2) => import('../../lib/geometry.js').Vec2} snapPoint Grid snap of a world point.
 * @property {(length: number) => number} snapLength Grid snap of a length, meters.
 * @property {(angle: number, shift: boolean) => number} snapAngle Angle snap, radians.
 * @property {(screen: { x: number, y: number }) => number[]} hitTest Uids under a screen point, topmost first; `[]` without a view.
 * @property {(box: import('../../lib/geometry.js').Aabb) => number[]} boxTest Uids inside a world box, meters; `[]` without a view.
 * @property {(css: string|null) => void} setCursor Overrides the cursor; `null` restores the tool's cursor.
 * @property {() => void} invalidateOverlay Requests a tool overlay redraw.
 */

/**
 * Viewport tool, built with {@link defineTool}.
 * @typedef {object} Tool
 * @property {ToolId} id Tool id.
 * @property {string} label Label from `TOOL_SPECS`.
 * @property {string} hotkey Hotkey from `TOOL_SPECS`.
 * @property {import('../modes.js').Capability} capability Capability from `TOOL_SPECS`.
 * @property {string} cursor CSS cursor while idle.
 * @property {boolean} hover Whether hover feedback is shown while the tool is active.
 * @property {(ctx: ToolContext) => void} activate Called when the tool becomes active.
 * @property {() => void} deactivate Called after `cancel` when another tool becomes active.
 * @property {(e: ToolPointerEvent) => void} pointerDown Left or right press.
 * @property {(e: ToolPointerEvent) => void} pointerMove Pointer move, hover included.
 * @property {(e: ToolPointerEvent) => void} pointerUp Left or right release.
 * @property {(e: ToolKeyEvent) => boolean} keyDown Key press; `true` when consumed.
 * @property {() => boolean} cancel Aborts the local operation; `true` when there was one.
 * @property {(g: object) => void} drawOverlay Draws on a cleared `PIXI.Graphics` in screen space, CSS px.
 */

function spec(id, label, hotkey, capability, group) {
  return Object.freeze({ id, label, hotkey, capability, group });
}

/**
 * The tool table in `DESIGN.md` §5.5 order: the only place tool ids, labels, hotkeys, capabilities and
 * toolbar groups are written.
 * @type {ReadonlyArray<Readonly<ToolSpec>>}
 */
export const TOOL_SPECS = Object.freeze([
  spec('select', 'Select', 'V', 'select', 'selection'),
  spec('select-box', 'Select Box', 'B', 'select', 'selection'),
  spec('manipulate', 'Manipulate', 'M', 'tool.manipulate', 'manipulation'),
  spec('pose', 'Pose', 'P', 'tool.pose', 'manipulation'),
  spec('circle', 'Circle', 'C', 'tool.circle', 'creation'),
  spec('box', 'Box', 'R', 'tool.box', 'creation'),
  spec('polygon', 'Polygon', 'N', 'tool.polygon', 'creation'),
  spec('hinge', 'Hinge Joint', 'H', 'tool.hinge', 'joints'),
]);

/** Pointer travel below which a press and release is a click, CSS px. */
export const DRAG_THRESHOLD = 4;

/** Longest time between two clicks of a double click, ms. */
export const DOUBLE_CLICK_TIME = 400;

const HANDLERS = Object.freeze({
  activate: () => {},
  deactivate: () => {},
  pointerDown: () => {},
  pointerMove: () => {},
  pointerUp: () => {},
  keyDown: () => false,
  cancel: () => false,
  drawOverlay: () => {},
});

/**
 * Builds a frozen tool. `label`, `hotkey` and `capability` always come from `TOOL_SPECS`; missing handlers
 * are no-ops (`keyDown` and `cancel` return `false`), `cursor` defaults to `'default'` and `hover` to `true`.
 * @param {{ id: ToolId } & Partial<Tool>} definition Tool id and members.
 * @returns {Readonly<Tool>} The tool.
 * @throws {Error} When the id is not in `TOOL_SPECS`.
 * @throws {TypeError} When a handler is not a function, `cursor` is not a string or `hover` is not a boolean.
 */
export function defineTool(definition) {
  const row = TOOL_SPECS.find((entry) => entry.id === definition?.id);
  if (!row) throw new Error(`Unknown tool "${definition?.id}"`);
  const tool = { id: row.id, label: row.label, hotkey: row.hotkey, capability: row.capability };
  tool.cursor = definition.cursor ?? 'default';
  if (typeof tool.cursor !== 'string') throw new TypeError(`Tool "${row.id}" cursor must be a string`);
  tool.hover = definition.hover ?? true;
  if (typeof tool.hover !== 'boolean') throw new TypeError(`Tool "${row.id}" hover must be a boolean`);
  for (const [name, fallback] of Object.entries(HANDLERS)) {
    const handler = definition[name] ?? fallback;
    if (typeof handler !== 'function') throw new TypeError(`Tool "${row.id}" ${name} must be a function`);
    tool[name] = handler;
  }
  return Object.freeze(tool);
}
