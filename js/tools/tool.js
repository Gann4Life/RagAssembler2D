/**
 * @typedef {'select'|'select-box'|'pose'|'circle'|'box'|'polygon'|'hinge'} ToolId
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
 * @property {(pose: import('../viewport/bounds.js').Pose|null) => void} setPose Shows body transforms (root-local)
 *   instead of the rest pose; `null` returns to the rest pose.
 * @property {() => import('../viewport/bounds.js').Pose|null} [displayedPose] Body transforms the viewport shows
 *   (root-local), `null` for the rest pose.
 */

/**
 * Animate playback as tools see it.
 * @typedef {object} PlaybackService
 * @property {boolean} playing Whether the playhead is advancing.
 * @property {() => void} pause Pauses with the playhead at the time of the displayed simulation step.
 * @property {(pose: import('../viewport/bounds.js').Pose) => void} hold Shows released bodies (root-local, by uid)
 *   as the posed hold until the clip simulation catches up.
 */

/**
 * Where a pose test starts.
 * @typedef {object} PoseSessionOptions
 * @property {import('../../lib/geometry.js').Transform} root Ragdoll position and angle, world, meters and radians.
 * @property {string} bodyId File id of the grabbed body.
 * @property {import('../../lib/geometry.js').Vec2} point Grabbed point, world meters.
 * @property {Map<string, import('../../lib/geometry.js').Transform>|null} [start] Root-local transforms by body id
 *   the test starts from at rest, e.g. the displayed pose in Animate mode; the rest pose when omitted or `null`.
 * @property {boolean} [holdRoot] Keeps `rootBody` where it was at the press: after every step its center of mass returns to
 *   its press position with zero linear velocity and, unless it is the grabbed body, its angle returns to the press
 *   angle with zero angular velocity. Defaults to `false`.
 */

/**
 * One running pose test, owned by the tool that started it until `destroy`.
 * @typedef {object} PoseSession
 * @property {(point: import('../../lib/geometry.js').Vec2) => void} drag Moves the pull target, world meters.
 * @property {(seconds: number) => void} advance Runs the fixed steps due after `seconds` more.
 * @property {() => Map<string, import('../../lib/geometry.js').Transform>} pose Body id → root-local transform.
 * @property {() => { anchor: import('../../lib/geometry.js').Vec2, target: import('../../lib/geometry.js').Vec2 }} grab
 *   Grabbed point on the body and pull target, world meters.
 * @property {() => void} destroy Releases every native object; idempotent. Other calls throw afterwards.
 */

/**
 * Physics service injected into the editor.
 * @typedef {object} PhysicsService
 * @property {(json: object, options: PoseSessionOptions) => PoseSession} startPose Starts a pose test on a
 *   `.rag.json` document; throws when it cannot start.
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
 * @property {(pose: import('../viewport/bounds.js').Pose|null) => void} setPose Shows body transforms (root-local)
 *   instead of the rest pose, `null` for the rest pose; does nothing without a view.
 * @property {() => import('../viewport/bounds.js').Pose|null} displayedPose Body transforms the viewport shows,
 *   root-local by uid; `null` for the rest pose or without a view.
 * @property {PhysicsService|null} physics Physics service, or `null` when the editor has none.
 * @property {() => string} editorVersion Version of the running editor, read when needed; dev until known.
 * @property {PlaybackService} playback Animate playback; never playing without one.
 * @property {() => boolean} autokey Whether autokey is on.
 * @property {(text: string) => void} status Shows a status line message.
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
 * @property {(seconds: number) => void} tick Called once per frame while active, with the frame time in seconds.
 * @property {(g: object) => void} drawOverlay Draws on a cleared `PIXI.Graphics` in screen space, CSS px.
 * @property {(screen: { x: number, y: number }) => string|null} handleAt Id of the tool handle under a screen point,
 *   CSS px, or `null`.
 * @property {() => { text: string, screen: { x: number, y: number } }|null} readout Drag readout text and the
 *   screen point of its top-left corner, CSS px, or `null`.
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
  spec('pose', 'Pose', 'D', 'tool.pose', 'manipulation'),
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
  tick: () => {},
  drawOverlay: () => {},
  handleAt: () => null,
  readout: () => null,
});

/**
 * Builds a frozen tool. `label`, `hotkey` and `capability` always come from `TOOL_SPECS`; missing handlers
 * are no-ops (`keyDown` and `cancel` return `false`, `handleAt` and `readout` return `null`), `cursor` defaults to
 * `'default'` and `hover` to `true`.
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
