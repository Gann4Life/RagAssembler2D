# Tools

`js/tools/tool.js` and `js/tools/registry.js`, built by `createEditor` ([Editor composition](editor-composition.md#editor-composition)) and bound to the view by `js/viewport.js`; behavior in [`DESIGN.md` §5.5](../design/05-5-tools.md#55-tools) (Common rules). Every viewport tool implements one contract. Points are `Vec2` (`{ x, y }`, `lib/geometry.js`).

```
TOOL_SPECS (frozen, DESIGN §5.5 order; the only place tool ids, labels, hotkeys and capabilities are written)
  id            label          hotkey  capability         group
  'select'      'Select'       'V'     'select'           'selection'
  'select-box'  'Select Box'   'B'     'select'           'selection'
  'pose'        'Pose'         'P'     'tool.pose'        'manipulation'
  'circle'      'Circle'       'C'     'tool.circle'      'creation'
  'box'         'Box'          'R'     'tool.box'         'creation'
  'polygon'     'Polygon'      'N'     'tool.polygon'     'creation'
  'hinge'       'Hinge Joint'  'H'     'tool.hinge'       'joints'

Tool {
  id, label, hotkey, capability       copied from TOOL_SPECS by defineTool; a spec cannot override them
  cursor: string                      CSS cursor while idle; default 'default', creation tools 'crosshair'
  hover: boolean                      hover feedback while active; default true, creation tools false
  activate(ctx: ToolContext): void
  deactivate(): void                  called after cancel(); drops in-progress state
  pointerDown(e: ToolPointerEvent): void
  pointerMove(e: ToolPointerEvent): void
  pointerUp(e: ToolPointerEvent): void
  keyDown(e: ToolKeyEvent): boolean   true when consumed; never receives Escape
  cancel(): boolean                   aborts the local operation in progress; true when there was one
  drawOverlay(g: PIXI.Graphics): void screen space (CSS px); g is cleared before the call
  handleAt(screen): string | null     id of the tool handle under a screen point; default () => null (#128)
  readout(): { text, screen } | null  drag readout text and its screen position, CSS px; default () => null (#128)
  tick(seconds): void                 once per frame from the viewport ticker; default no-op (#145)
}
ToolPointerInput { type: 'down' | 'move' | 'up', screen: Vec2 (CSS px from the host's top-left, Y down),
                   button: 0 | 2 (down/up; -1 for move), buttons (DOM bitmask), shift, ctrl (Ctrl or Cmd), alt,
                   clicks: 1 | 2 (down/up; 1 for move) }
ToolPointerEvent ToolPointerInput + { world: Vec2 (m, Y up), local: Vec2 (m, root-local) }
ToolKeyEvent     { key, code, shift, ctrl (Ctrl or Cmd), alt, repeat }
ToolView         { hitTest(screen) → number[], boxTest(box: Aabb) → number[], setCursor(css), invalidateOverlay(),
                   setPose(pose: Pose | null) }                         scene.setPose + gizmos.invalidate (#145)
ToolContext      { model, history, selection, modes, settings, camera,
                   toLocal(world) → Vec2, toWorld(local) → Vec2          through the root transform
                   snapPoint(world) → Vec2, snapLength(m) → m, snapAngle(rad, shift) → rad   snap.js bound to settings
                   hitTest(screen) → number[]                            uids, topmost first (js/viewport/hit.js)
                   boxTest(box: Aabb) → number[]                         uids inside a world box (js/viewport/hit.js, #13)
                   setCursor(css | null)                                 null restores the tool's cursor
                   invalidateOverlay()
                   setPose(pose | null)                                  no-op while no view is bound (#145)
                   physics: PhysicsService | null                        { startPose(json, options) → PoseSession } (#145) }
```

- **`defineTool(definition)`** takes `{ id, ...members }`, throws `Error` for an id not in `TOOL_SPECS`, copies `label`, `hotkey`, `capability` from it (those keys in the definition are ignored, as is any member not in the contract), fills missing members with defaults (`cursor` `'default'`, `hover` `true`, no-op handlers, `keyDown`/`cancel` returning `false`, `handleAt`/`readout` returning `null`), throws `TypeError` when a given handler is not a function, `cursor` is not a string or `hover` is not a boolean, and freezes the result. Tool modules export a **factory** (`circleTool() → Tool`) whose in-progress state lives in its closure; `createEditor` calls each factory, so every editor, and every test, has its own tool state.
- **Tools** are core: no DOM, no PIXI import; they draw only on the `Graphics` they are handed, with `js/viewport/style.js` colors and sizes. They read the model, mutate it only with `ctx.history.execute(command)` (never `beginGesture`, `endGesture` or `cancelGesture`), and keep in-progress state (polygon vertices, a drag rectangle) local until it becomes data. `ctx.modes.can(capability)` decides what an operation may do (e.g. Select moves only where `edit.rest` is allowed, and rotates into keys in Animate, #125). Grid snapping is applied to world points before `toLocal`, so snapped points sit on the world grid ([`DESIGN.md` §5.4](../design/05-4-viewport.md#54-viewport)).
- **Creation tools** preview in `drawOverlay` and execute one create command when the operation completes (inside the release's gesture, so it is one undo step), then call `ctx.selection.set([uid])` with the uid the command returns (`history.execute` returns `run`'s value) and stay active. Aborted or refused operations execute nothing and leave the selection alone.

Details by tool:

- [Tools: Circle and Box](tools-circle-box.md)
- [Tools: Select and Select Box](tools-select.md)
- [Tools: Hinge Joint](tools-hinge.md)
- [Tools: Select transform](tools-select-transform.md)
- [Tools: registry and input routing](tools-registry.md)
- [Tools: Pose](tools-pose.md)
