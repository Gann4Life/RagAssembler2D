# Tools: Pose

Behavior in [`DESIGN.md` §5.5](../design/05-5-tools.md#55-tools) (Pose). Built by #145 for Edit mode; keying in Animate mode is a later issue. Three modules, one per layer:

| Module | Layer | Role |
|---|---|---|
| `js/model/io.js` | Core | `toJson(model) → object`: the document in the `.rag.json` data shape. Created by #145 with only this function; #27 makes it `toJson(model, editorVersion)` and adds the load and reset paths ([Model I/O](model-io.md#model-io)). |
| `js/tools/pose.js` | Core | `poseTool() → Tool`: press, drag, release and cancel; owns no native object. |
| `js/physics/pose-session.js` | UI | `createPoseSession(Box2D, json, options) → PoseSession`: one LiquidFun world per press. No DOM, no PIXI import; receives `Box2D` as a parameter, so it is not a pure module. Loaded by `tests/liquidfun-pose-session.test.js`. |

`js/main.js` calls `RagImporter.configure({ Box2D, PIXI })` once at boot and passes `createEditor({ settings, physics: { startPose: (json, options) => createPoseSession(Box2D, json, options) } })`. The editor hands `physics` to the registry, which exposes it as `ToolContext.physics` (`null` when not given, as in core tests).

## Contracts

```
toJson(model) → object
  { format: FORMAT, version: FORMAT_VERSION, meta, units, preview,
    ragdoll: root props without meta, units, preview,
    sprites, bodies (each with fixtures), joints, clips (each with tracks (each with keys) and events) }
  Plain copies of the props in collection order; no uids, no canonical key order, no rounding, no validation.

poseTestJson(json) → object                       exported by js/physics/pose-session.js; pure, never mutates json
  copy of json with sprites [], clips [], every shape's sprite null, selfCollide false, filter.maskBits 0
  (until #27 it also fills a missing meta.editorVersion with '0.0.0'; #27 removes that, since toJson then
  always writes meta with the real version)

PoseSessionOptions { root: Transform (ragdoll position and angle, world), bodyId: string, point: Vec2 (world, m) }
createPoseSession(Box2D, json, options) → PoseSession
  RagImporter.parse(poseTestJson(json)) first: a RagFormatError propagates and nothing native exists yet.
  Then: b2World with gravity (0, 0) (vector destroyed after the constructor), def.spawn(world, { x, y, angle } = root,
  flipX false, no parent), SetLinearDamping(POSE.linearDamping) and SetAngularDamping(POSE.angularDamping) on every
  instance body, one static ground body without fixtures, a b2MouseJoint ground → rag.body by bodyId with
  target = point, maxForce = POSE.forcePerKg × GetMass(), frequencyHz, dampingRatio; the grabbed body SetAwake(true).
  An unknown bodyId or a native failure after the world exists destroys what was built and throws.
PoseSession {
  drag(point: Vec2): void          mouse joint SetTarget through one scratch b2Vec2
  advance(seconds): void           accumulates; world.Step(POSE.step, 8, 3) per whole step, at most POSE.maxSteps per call,
                                   the remainder above that dropped
  pose() → Map<bodyId, Transform>  root-local (inverse of options.root composed with each body's world transform)
  grab() → { anchor: Vec2, target: Vec2 }   world; anchor = the grabbed point on the body (mouse joint GetAnchorB)
  destroy(): void                  idempotent; DestroyJoint(mouse joint), rag.destroy(), DestroyBody(ground),
                                   RagImporter.releaseWorld(world) once #49 provides it, Box2D.destroy(scratch),
                                   Box2D.destroy(world); later calls on the session throw Error
}
POSE (frozen) { step: 1/60 s, maxSteps: 4, linearDamping: 10, angularDamping: 10,
                forcePerKg: 1000, frequencyHz: 5, dampingRatio: 0.7 }   s, s⁻¹, N/kg, Hz
```

The session never calls `rag.update()`, so joint motors stay off and joints are free hinges within their limits ([`DESIGN.md` §7.2](../design/07-ragimporter.md#72-spawn-and-flipx)). It allocates nothing per step or drag ([`DESIGN.md` §7.4](../design/07-ragimporter.md#74-native-memory)).

## Tool contract additions

- `Tool.tick(seconds): void`, default no-op. `ToolRegistry.tick(seconds)` forwards to the active tool. `js/viewport.js` adds a `PIXI.Ticker.shared` callback at `PIXI.UPDATE_PRIORITY.HIGH` that calls `tools.tick(ticker.deltaMS / 1000)`, so the pose set in a frame is drawn in that frame.
- `ToolView.setPose(pose | null)` and `ToolContext.setPose(pose | null)` (no-op while no view is bound). `js/viewport.js` binds it to `scene.setPose(pose)` followed by `gizmos.invalidate()`; `pose` is the `Pose` of `js/viewport/bounds.js` (`Map<bodyUid, Transform>`, root-local).
- `ToolCore.physics` and `ToolContext.physics`: `PhysicsService | null`, typedef in `js/tools/tool.js`: `{ startPose(json, PoseSessionOptions) → PoseSession }`. `PoseSession` and `PoseSessionOptions` are typedefs of `js/tools/tool.js` too; `js/physics/pose-session.js` conforms to them.

## `poseTool()`

- `cursor` `'default'`, `hover` `true`.
- **pointerDown** (left, Edit mode, `ctx.physics` not `null`, `ctx.modes.can('edit.rest')`): the first `shape` uid of `ctx.hitTest(e.screen)` gives the body uid (its parent) and file id. None: nothing. Otherwise `ctx.physics.startPose(toJson(ctx.model), { root, bodyId, point: e.world })` (`toJson(ctx.model, ctx.editorVersion())` from #27); on a throw the press is refused (cursor `not-allowed` until the release, no session). In Animate mode a press does nothing until the keying issue.
- **pointerMove** during a session: `session.drag(e.world)`, `invalidateOverlay()`. Idle: cursor `grab` over a shape hit, else `null`.
- **tick(seconds)** during a session: `session.advance(seconds)`, then `ctx.setPose` with `session.pose()` mapped from body ids to uids through `model.uidOf`, then `invalidateOverlay()`.
- **pointerUp**, **cancel()** and **deactivate()**: `session.destroy()`, `ctx.setPose(null)`, cursor back. `cancel()` returns `true` only when a session or a refused press was in progress. The registry's Esc, tool switch, mode change, reset, closed gesture and throwing handler paths all reach `cancel()`.
- **drawOverlay(g)**: during a session, a 1 px line in `COLORS.gizmo` from `grab().anchor` to `grab().target` and a `GIZMO_SIZE.pivot` dot at the target, in screen space.
- Never executes a command and never touches the selection: the press gesture stays empty and records no undo step.

## Tests

- `tests/model-io.test.js`: `toJson` of a model built by commands has the file shape, file ids and references, collection order and no uids; `validate` finds no errors in it; the model is unchanged.
- `tests/liquidfun-pose-session.test.js` (vendored liquidfun.js, PIXI stub as in `tests/liquidfun-spawn.test.js`): `poseTestJson` output and input untouched; `pose()` equals the rest pose right after start with a rotated root; bodies not attached to the grabbed one do not move over 2 s without a drag; a drag moves the grabbed body toward the target and its chain follows; joint angles stay within limits and every motor is disabled; two overlapping unjointed bodies do not push apart; damping is applied; `advance` step counting (remainder carried, `maxSteps` cap); a parse error throws `RagFormatError` with no world created; `destroy` is idempotent and leaves `GetBodyCount` 0 before the world is destroyed; no heap growth over 500 start, drag, advance, destroy cycles.
- `tests/pose-tool.test.js` (fake `physics` and fake session): press on a shape starts with the body id, root and world point; press on empty space, a joint, the root, a right press, `physics` `null` and Animate mode start nothing; move drags; tick advances and sets a uid-keyed pose; release, Esc, mode change, tool switch and a throwing handler destroy the session once and clear the pose; a throwing `startPose` gives `not-allowed`; model, selection and history are unchanged after every case.
- Registry and editor tests: `tick` forwarding, `setPose` no-op while unbound, Pose registered and `tool:pose` enabled in Edit mode with `P`.
