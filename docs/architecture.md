# Architecture

> Status: partly built. The editor shell (header toolbar and an empty PIXI viewport), the document model with its emitter and property schema, a stub of `lib/ragimporter.js`, the test harness and the pinned `vendor/` libraries exist. Everything marked **(planned)** is the agreed design that issues implement; it is updated as code lands. Changes to this design go through the architect ([Conformance](#conformance)).

## Components

```
┌──────────────────────── Editor (index.html, js/) ─────────────────────────┐
│  UI:   Header · Tools · Viewport (scene, gizmos, input) · Hierarchy ·     │
│        Assets · Problems · Inspector · Timeline · Dock                    │
│  Core: Model ◀── History (commands) ◀── Tools / Actions / Panels          │
│        Selection · Modes · Hotkeys · Model I/O                            │
└──────────────────────────────┬────────────────────────────────────────────┘
                               │ imports
┌──────────────────────────────▼──── lib/ ──────────────────────────────────┐
│  Pure:    emitter · schema · geometry · validate · serialize · migrate ·  │
│           evaluate                                                        │
│  Runtime: ragimporter (public entry) · def · instance · render · collision│
└──────────────┬──────────────────────────────────────┬─────────────────────┘
               │ Box2D global / configure()           │ PIXI global / configure()
        vendor/liquidfun.js                    vendor/pixi.min.js
```

RagImporter reaches liquidfun.js only through the `Box2D` namespace (no global `b2*` names) and PIXI.js through `PIXI`; either can be injected with `RagImporter.configure({ Box2D, PIXI })` **(planned)** ([`DESIGN.md` §7](../DESIGN.md#7-ragimporter)). Both libraries are pinned in `vendor/` ([Vendored libraries](development.md#vendored-libraries)).

`demo/` is a separate host page **(planned)**. It imports only `lib/ragimporter.js` and the vendored libraries.

## Editor boot

1. `index.html` loads `css/editor.css`, then the vendored libraries as classic scripts: `vendor/pixi.min.js` (defines `PIXI`) and `vendor/liquidfun.js` (defines `Box2D`).
2. It loads `js/main.js` as the only module script. The markup holds a placeholder `<header id="header">` and `<main id="workspace">` with the viewport panel (`#panel-viewport` > `#viewport-host`, `role="group"`, `tabindex="0"`, labelled "Viewport"; [`DESIGN.md` §5.4](../DESIGN.md#54-viewport)).
3. `js/main.js` reads the `PIXI` and `Box2D` globals and throws an `Error` naming the missing library and its `vendor/` file. The error only reaches the console; the page stays blank.
4. It replaces the placeholder with `createHeader(document)`: a toolbar with every action disabled ([`DESIGN.md` §5.3](../DESIGN.md#53-header)).
5. It awaits `createViewport(PIXI, #viewport-host)`: a PIXI `Application` whose canvas fills the host. A `ResizeObserver` resizes the renderer to the host size in CSS pixels, using the current `devicePixelRatio`.

`Box2D` is checked but not used yet. No editor state, command stack or modes exist; `js/editor.js` is an empty file reserved for the composition root. Nothing listens to the header's `header-action` event yet.

**(planned)** Boot becomes: `main.js` checks the globals → `createEditor()` (core, no DOM) → mounts the dock, header, panels and viewport, passing them the editor object → registers action handlers that need the DOM (file pickers) → offers draft recovery ([`DESIGN.md` §1](../DESIGN.md#1-conventions)).

## Dependency rules

| From | May import |
|---|---|
| `js/` | `lib/`, other `js/` modules per the layers below. Only `js/main.js` reads the `PIXI` and `Box2D` globals; other modules receive them as parameters. |
| `lib/` | Other `lib/` modules only. Only runtime modules (`def`, `instance`, `render`, `collision`) use `Box2D`/`PIXI`, and only through the namespaces resolved by `lib/ragimporter.js`. |
| `demo/` | `lib/ragimporter.js` only (the public API), vendor globals. |
| `tests/` | `lib/`, and `js/` **core** modules (they load without a DOM). |

**Layers inside `js/`:**

| Layer | Modules | Rules |
|---|---|---|
| Core | `js/editor.js`, `js/model/*`, `js/commands/*`, `js/modes.js`, `js/hotkeys.js`, `js/actions.js`, `js/units.js`, `js/roving-focus.js`, `js/tools/*`, `js/viewport/camera.js`, `js/viewport/hit.js`, `js/panels/layout.js` | No DOM, no PIXI import, no globals. Load and run under `node --test`. Import only `lib/` and other core modules. Tools draw only through the `PIXI.Graphics` they are handed. |
| UI | `js/main.js`, `js/header.js`, `js/menu.js`, `js/viewport.js`, `js/viewport/*` (other than camera, hit), `js/panels/*` (other than layout), `js/storage.js`, `js/files.js`, `js/asset-store.js` | May import core and `lib/`. Receive the editor object and `PIXI` as parameters. Panel modules never import each other or `js/panels/dock.js`; `js/main.js` mounts them into the element the dock gives for their panel. Never mutate the model directly. |

Pure modules (`lib/` pure set and the `js/` core) must not touch the DOM, PIXI or LiquidFun.

## Module map

Columns: responsibility, public exports, and allowed imports beyond `lib/`. Rows marked **(planned)** do not exist yet; the issue that creates each one is given.

### Built

| Module | Responsibility | Public exports | Imports |
|---|---|---|---|
| `index.html` | Editor page: loads `css/editor.css`, the vendored libraries as classic scripts and `js/main.js` as the only module; holds the header placeholder and the viewport panel markup. | none | — |
| `css/editor.css` | Editor styles: dark theme variables, full-height grid layout, header toolbar (no wrapping, horizontal scroll, Workspace group pushed right), muted disabled buttons, viewport focus ring drawn above the canvas. | none | — |
| `js/main.js` | Editor bootstrap: checks the `PIXI` and `Box2D` globals, mounts the header and creates the viewport. | none | any `js/` |
| `js/editor.js` | Empty. Reserved for the composition root **(planned, #10)**. | none | — |
| `js/header.js` | Header toolbar: grouped action list, roving-tabindex keyboard navigation, `aria-disabled` buttons with tooltips, and a bubbling `header-action` CustomEvent (`detail.action`) on clicks of enabled buttons. | `HEADER_GROUPS`, `createHeader`, `actionTitle`, `setActionEnabled`, typedef `HeaderAction` | `js/roving-focus.js` |
| `js/roving-focus.js` | Pure key-to-index mapping for roving-tabindex toolbars (Left/Right wrap, Home/End). **#8** adds an optional fourth parameter `orientation` (`'horizontal'` default, `'vertical'` uses Up/Down) for menus. | `rovingIndex(current, key, count, orientation?)` | — |
| `js/viewport.js` | PIXI viewport: creates an `Application` in a host element and keeps the renderer sized to the host and `devicePixelRatio`. | `createViewport`, typedef `Viewport` (`app`, `destroy`) | `js/viewport/*` (planned) |
| `js/model/model.js` | Document model ([Document model](#document-model)). | `Model`, `ROOT_UID`, typedefs `Node`, `NodeType`, `NodeSnapshot`, `Change`, `Op` | `lib/emitter.js`, `lib/schema.js` |
| `lib/emitter.js` | Synchronous event emitter ([Emitter](#emitter)). | `Emitter` | — |
| `lib/schema.js` | Property schema: types, defaults, ranges, units, canonical order, channels ([schema.md](schema.md)). | `FORMAT`, `FORMAT_VERSION`, `SCHEMA`, `CHANNELS`, `fieldsOf`, `defaultsOf`, `autoClipKey`, typedef `FieldSpec` | — |
| `lib/ragimporter.js` | RagImporter entry point. Currently a stub that only declares the supported format versions. | `RagImporter` (frozen object with `supportedVersions: [1]`) | `lib/*` (planned) |
| `tests/index.js` | Test aggregator for `node --test tests/`: recursively imports every `*.test.js` under `tests/`. | none | — |
| `tests/smoke.test.js` | Smoke test: `lib/ragimporter.js` loads as an ES module and supports format version 1. | none | — |
| `tests/editor-header.test.js` | Header tests: `rovingIndex` navigation, header group order and unique ids against `DESIGN.md` §5.3, shortcuts against §5.9, and `actionTitle` text. | none | — |
| `tests/emitter.test.js`, `tests/schema.test.js`, `tests/model.test.js` | Contract tests for the emitter, the schema tables and helpers against [schema.md](schema.md), and the document model. | none | — |

### lib/ (planned)

A module whose functions serve several issues is created by the first of them to land, with only the functions it needs; later issues add theirs and update this row.

| Module | Responsibility | Public exports | Imports | Issue |
|---|---|---|---|---|
| `lib/geometry.js` | Pure 2D math in meters/radians: transforms, polygon convexity/CCW/centroid, shape local frame, area/mass, point-in-shape. | `transformPoint`, `composeTransforms`, `polygonProblems`, `polygonCentroid`, `shapeFrame`, `shapeMass`, `bodyMass`, `pointInShape` | — | first of #11, #20, #25 |
| `lib/validate.js` | `validate(json) → { errors, warnings }` ([`DESIGN.md` §6.4](../DESIGN.md#64-validation)). Generic checks from the schema, cross-field checks by hand. | `validate`, typedef `Problem` (`severity`, `code`, `message`, `path`, `target`) | schema, geometry | #25 |
| `lib/serialize.js` | Canonical writer: schema key order, numbers rounded to 1e-5, `-0` → `0`, 2-space indent, `\n`, final newline ([`DESIGN.md` §6.5](../DESIGN.md#65-round-trip-guarantee)). | `serialize(json) → string` | schema | #27 |
| `lib/migrate.js` | Migrates older format versions to `FORMAT_VERSION`; throws on unknown versions. Used by the editor loader only. | `migrate(json) → { json, notes }` | schema | #27 |
| `lib/evaluate.js` | Pure animation evaluator: track sampling, interpolation, channel resolution ([`DESIGN.md` §4.3–4.4](../DESIGN.md#43-keys-and-interpolation)). | `sampleTrack`, `evaluateClip`, `resolveChannels`, typedef `ResolvedPose` | schema | #30, #31 |
| `lib/ragimporter.js` | Public entry: `configure`, `parse`, `validate`, `supportedVersions`; resolves `Box2D`/`PIXI`. | `RagImporter`, `RagFormatError` | all `lib/` | #44 |
| `lib/def.js` | `RagDef`: immutable parsed definition, `spriteUrls`, `spawn`. | `RagDef` (via `parse`) | validate, schema, geometry, instance | #44 |
| `lib/instance.js` | `RagInstance`: playback, events, overrides, motor controller, `update`, `sync`, `destroy`. | `RagInstance` (via `spawn`) | emitter, evaluate, geometry, render, collision | #44–#48 |
| `lib/render.js` | PIXI sprites, texture resolver and cache, z order, debug draw. | internal | geometry | #50, #51 |
| `lib/collision.js` | Contact filter or `groupIndex` fallback ([`DESIGN.md` §2.5](../DESIGN.md#25-collision-rules)). | internal | — | #49 |

The runtime split (`def`, `instance`, `render`, `collision`) is confirmed by the architect when phase 4 starts. Hosts copy the whole `lib/` folder ([`DESIGN.md` §8](../DESIGN.md#8-integration-workflow-separate-js-project)).

### js/ core (planned)

| Module | Responsibility | Public exports | Imports (js/) | Issue |
|---|---|---|---|---|
| `js/editor.js` | Composition root without DOM: builds model, history, selection, modes, tools, actions and settings, and wires mode changes to tool/gesture cancellation. | `createEditor() → Editor`, typedef `Editor` | core | #10 |
| `js/model/io.js` | File JSON ⇄ model: `loadJson` (migrate, validate, reset, drop unknown fields with warnings), `newDocument`, `toJson`, `uidAtPath`. | `loadJson`, `newDocument`, `toJson`, `uidAtPath` | model | #27 |
| `js/model/queries.js` | Derived read-only views: joint tree from `rootBody`, loop joints, unlinked bodies, body subtree, references to an id (joints, tracks, sprite users). Created with the same rule as `lib/geometry.js`. | `jointTree`, `bodySubtree`, `referencesTo`, `spriteUsers` | model | first of #13, #19 |
| `js/model/selection.js` | Selection: `objects` (root, bodies, shapes, joints, assets, clips) and `timeline` (keys, events) uid sets, plus `focus`. Prunes removed uids. Not undoable. | `Selection` | model | #10 |
| `js/commands/history.js` | Command stack, transactions and gestures ([Commands and undo](#commands-and-undo)). | `History`, typedefs `Command`, `Transaction` | model | #10 |
| `js/commands/props.js` | Property edits (single or multi-object). Renaming a clip also applies the key-follows-name rule ([schema.md](schema.md#clip-clips)); the model does not. | `setProps` | model | #10 |
| `js/commands/create.js` | Shape bodies, joints, clips, sprite assets; assigns `rootBody` when it is `null`. | `createShapeBody`, `createJoint`, `createClip`, `importSpriteAssets` | model, queries | #14–#16, #19, #21 |
| `js/commands/delete.js` | Deletion with cascade ([`DESIGN.md` §5.6](../DESIGN.md#56-hierarchy-assets-and-problems-panels)), plus the plan shown in the confirmation. | `deletionPlan`, `deleteObjects` | model, queries | #19 |
| `js/commands/group.js` | Group / Ungroup. | `group`, `ungroup` | model, queries | #18 |
| `js/commands/duplicate.js` | Duplicate selection. | `duplicate` | model, queries | #63 |
| `js/commands/transform.js` | Move/rotate root, body subtrees, joint anchor and `aimAxis`, sprite offset/angle/scale. | `moveRoot`, `moveBodies`, `rotateBody`, `moveAnchor`, `setAimAxis`, `editSprite` | model, queries | #17, #24 |
| `js/commands/animation.js` | Tracks, keys and events; keeps keys and events sorted by `t`. | `addTrack`, `removeTrack`, `setKey`, `removeKeys`, `moveKeys`, `addEvent`, `moveEvents` | model | #33–#35, #39 |
| `js/modes.js` | Mode state and policy ([Modes](#modes)). | `Modes`, `MODE_POLICY` | model | #10 |
| `js/hotkeys.js` | Default bindings ([`DESIGN.md` §5.9](../DESIGN.md#59-hotkeys-defaults)) and key matching. | `HOTKEYS`, `matchHotkey`, `dispatchKey` | — | #10 |
| `js/actions.js` | Action registry shared by the header, hotkeys and menus. | `ActionRegistry`, typedef `ActionId` | — | #10 |
| `js/units.js` | UI conversions: m ⇄ px, rad ⇄ deg, mult ⇄ %. The only place UI units exist. | `toDisplay`, `fromDisplay`, `displayUnit` | — | #20 |
| `js/tools/tool.js` | Tool contract ([Tools](#tools)). | `defineTool`, typedefs `Tool`, `ToolContext`, `ToolPointerEvent`, `ToolKeyEvent` | — | #12 |
| `js/tools/registry.js` | Tool registry, activation under the mode policy, gesture handling, hotkey lookup. | `ToolRegistry` | tool, modes, history | #12 |
| `js/tools/select.js`, `select-box.js`, `manipulate.js`, `pose.js`, `circle.js`, `box.js`, `polygon.js`, `hinge.js` | One tool each ([`DESIGN.md` §5.5](../DESIGN.md#55-tools-panel)). | `selectTool`, `selectBoxTool`, `manipulateTool`, `poseTool`, `circleTool`, `boxTool`, `polygonTool`, `hingeTool` | tool, commands/*, model, queries | #13–#17, #24, #38 |
| `js/viewport/camera.js` | Pure camera: center (m), zoom, world ⇄ screen with `pixelsPerMeter` and the Y flip. | `Camera` | — | #11 |
| `js/viewport/hit.js` | Pure hit testing in root-local meters: root gizmo, joint gizmos, shapes, topmost first. | `hitTest` | model, camera | #12 |
| `js/panels/layout.js` | Pure dock layout model ([Dock layout](#dock-layout)): panel table, default layout, normalize, validate and restore a stored layout, close/open/move/activate/resize, rectangles, drop targets. Immutable: every operation returns a new frozen `Layout`. | `LAYOUT_VERSION`, `PANELS`, `VIEWPORT_MIN`, `defaultLayout`, `normalize`, `validateLayout`, `restoreLayout`, `activatePanel`, `closePanel`, `openPanel`, `movePanel`, `canDrop`, `resizeSplit`, `computeRects`, `dropAt`, typedefs `PanelId`, `Layout`, `LayoutNode`, `Drop`, `Rect`, `Gutter` | — | #8 |

### js/ UI (planned)

| Module | Responsibility | Public exports | Issue |
|---|---|---|---|
| `js/viewport/scene.js` | Display objects keyed by uid, synced from model changes ([View sync](#view-sync)). | `createScene`, typedef `Scene` | #11, #12 |
| `js/viewport/grid.js` | Grid (1 m / 0.1 m) and origin axes. | `createGrid` | #11 |
| `js/viewport/gizmos.js` | Root, joint, selection and hover gizmos; strength fill in Animate. | `createGizmos` | #12, #36 |
| `js/viewport/input.js` | DOM pointer/keyboard/wheel → navigation, then `ToolPointerEvent` → registry; click counting; context menu suppression. | `attachInput` | #11, #12 |
| `js/panels/dock.js` | DOM for the layout of `js/panels/layout.js`: splits, tab bars (tab list, roving tabindex), resize gutters (separators), pointer-event tab dragging with drop preview, placeholders for unbuilt panels, focus repair on close, and saving through `js/storage.js` ([Dock layout](#dock-layout)). Imports `js/panels/layout.js`, `js/roving-focus.js`, `js/storage.js`. | `createDock(workspace, { viewportElement }) → Dock`, typedef `Dock` (`panelElement(id)`, `isOpen(id)`, `open(id)`, `close(id)`, `reset()`, `windowItems()`, `on/off('layout')`, `destroy()`) | #8 |
| `js/menu.js` | Generic popup menu anchored to a button: `role="menu"` with `menuitem`/`menuitemcheckbox`/separator items, `aria-expanded`/`aria-controls` on the button, keyboard per [`DESIGN.md` §5.3](../DESIGN.md#53-header), outside click closes. Imports `js/roving-focus.js`. | `openMenu(button, items, { onSelect, onNavigate }) → { close }`, typedef `MenuItem` (`id`, `label`, `kind`, `checked`, `disabled`) | #8 |
| `js/panels/tools-panel.js`, `hierarchy.js`, `assets.js`, `problems.js`, `inspector.js`, `timeline.js` | One panel each ([`DESIGN.md` §5.5–5.8](../DESIGN.md#55-tools-panel)). The inspector builds its rows from `fieldsOf` ([schema.md](schema.md)). | `create<Panel>` | #19–#23, #26, #32–#35 |
| `js/storage.js` | Browser storage: draft autosave and recovery, layout, settings. JSON in `localStorage` under `ragassembler.*` keys; never validates content. Every `localStorage` failure (missing, `SecurityError`, quota) means "unavailable" and is silent. No `js/` imports. #8 creates it with the layout functions only: `loadLayout() → { value } \| { error: 'missing' \| 'unavailable' \| 'parse' }`, `saveLayout(layout) → boolean`, `clearLayout() → void`, key `ragassembler.layout`. | `loadLayout`, `saveLayout`, `clearLayout` (#8); `saveDraft`, `loadDraft`, `clearDraft` (#29) | #8, #29 |
| `js/files.js` | File and directory pickers, drag & drop, writing `.rag.json` and images. | `pickRagFile`, `pickAssetFolder`, `saveRagFile` | #28 |
| `js/asset-store.js` | Image bytes and PIXI textures by sprite asset id. Not part of the model; entries are kept while any history step can bring their asset back. | `AssetStore` | #21 |

## Editor core

### Document model

`js/model/model.js` holds the document as a tree of nodes, in file units (meters, radians, Y up).

```
Node         { uid: number, type: NodeType, parent: number|null, collection: string|null, props: object }
NodeType     'root' | 'spriteAsset' | 'body' | 'shape' | 'joint' | 'clip' | 'track' | 'key' | 'event'
NodeSnapshot { uid?, type, props, children?: { [collection]: NodeSnapshot[] } }
```

- **Identity:** every node has a session `uid` (positive integer, never serialized, never reused in the session). Display objects, selection, change payloads and history refer to uids. `ROOT_UID` (1) is the root. File ids (`root`, `b_…`, `f_…`, `j_…`, `s_…`) are props, and references between objects (`bodyA`, `rootBody`, `target`, `sprite.asset`, key values) store file ids exactly as in the file.
- **Tree:** the root owns the collections `sprites`, `bodies`, `joints`, `clips`. A body owns `fixtures`, a clip owns `tracks` and `events`, a track owns `keys`. The root's props hold the `ragdoll` record fields plus the document fields `meta`, `units`, `preview` ([schema.md](schema.md#document-file-top-level)); `format` and `version` are not props (the serializer writes them). A shape's `sprite` is a prop (object or `null`), not a node. A new `Model` holds an empty document with schema defaults and emits nothing.
- **Props** are plain JSON values shaped like the file record minus child collections, and are frozen. A props key or a `set` path whose first segment names a child collection of the node type (`fixtures`, `tracks`, `events`, `keys`, and the root's `sprites`, `bodies`, `joints`, `clips`) is rejected. A change replaces the value at a dotted path, creating missing intermediate objects; `value: undefined` removes the key (inverse of a `set` on an absent path).
- **Read API:** `get(uid)`, `prop(uid, path)`, `children(uid, collection) → readonly number[]`, `uidOf(id)` (file id → uid; the first holder when a draft or invalid file duplicates an id), `clipByKey(key)`, `nextId(prefix)`, `on/off`.
- **`nextId(prefix)`** takes `'b'`, `'f'`, `'j'` or `'s'` and returns `<prefix>_<n>`, with `n` above every `<prefix>_<n>` string seen in any prop during the session (ids, references, key values, names), so a dangling reference is never bound to a new object. Counters only grow, and survive `reset` ([`DESIGN.md` §1](../DESIGN.md#1-conventions)). `root` cannot be generated.
- **Not enforced by the model:** unique ids and clip keys, the reserved `root` id on other nodes, names, ranges and references. These are command preconditions and validation rules (#25). The model only refuses to change the root id, to remove or move the root, wrong child types and moves into a node's own subtree.
- **Mutation:** only through `applyOps`, `batch` and `reset`. `applyOps` and `batch` are called by `js/commands/history.js` only, and `reset` by `js/model/io.js` only.
  - **`applyOps(ops, cause = 'do') → ReadonlyArray<Op>`** applies the ops in order, atomically: if one throws, the call is reverted and nothing is emitted. Input ops may leave out derived fields (`previous`, `index`, move `from`, remove `snapshot`/`parent`/`collection`, snapshot uids); the returned ops are complete and are what history records and inverts. Outside a batch it emits one `change` with the effective changes, or nothing when every op was a no-op (a `set` to a JSON-equal value, a `move` to the same slot). A no-op op is still returned.
  - **`batch(fn) → { ops, changes }`** runs `fn` with change emission deferred. Every `applyOps` inside it applies immediately (so later reads see it) and must use cause `do`. If `fn` throws, every op applied in the batch is reverted in reverse order, nothing is emitted and the error is rethrown. Otherwise it emits one `change` (`cause: 'do'`) with all effective changes in application order, if any, and returns the applied ops and those changes, both frozen. Batches do not nest, and `reset` inside a batch throws.
  - **`reset(snapshot, cause = 'new')`** replaces the document from a root snapshot and emits `reset`. Every node but the root gets a fresh uid, whatever uids the snapshot carries. On an invalid snapshot it throws and leaves the model unchanged.

### Commands and undo

Strategy: **command objects recorded as primitive operations**, not model snapshots ([decision](decisions.md)). `js/commands/history.js` **(planned, #10)**.

```
Command     { label: string, run(tx: Transaction): void }
Transaction { model, set(uid, path, value), add(parentUid, collection, index, init) → uid,
              remove(uid), move(uid, parentUid, collection, index) }
Op          { op: 'set',    uid, path, value, previous }
            | { op: 'add',    snapshot, parent, collection, index }
            | { op: 'remove', snapshot, parent, collection, index }
            | { op: 'move',   uid, from: Slot, to: Slot }      Slot = { parent, collection, index }
```

- **Commands are factories** in `js/commands/*.js` that return a `Command` (e.g. `setProps(uids, { 'limits.upper': 1.2 })`). They validate their preconditions and throw before mutating.
- **`history.execute(command)`** runs `model.batch(() => command.run(tx))`. Each `tx` call is one `model.applyOps([op])`, applied immediately so `run` reads its own writes; `tx.add` returns the uid from the completed op. The batch returns the complete ops, which carry their inverse data (`previous`, the removed subtree snapshot with its uids), and the model emits one `change` for the whole command. If `run` throws, the batch reverts the applied ops, nothing is recorded and no event fires. An entry whose batch returned no changes is discarded.
- **Undo, redo and cancel** are one `model.applyOps(ops, cause)` call each, with cause `undo`, `redo` or `cancel`.
- **Entries** (`do` / `undo` / `merge`): `undo` applies the inverse ops in reverse order; `redo` re-applies the recorded ops (it never calls `run` again, so ids and uids are identical); `merge` appends the ops of the next command and coalesces `set` ops on the same `uid + path` (first `previous`, last `value`).
- **Compound operations are one command:** delete with cascade (joints, tracks, `rootBody` reassignment), group/ungroup, duplicate, create + assign `rootBody`, set key + create track. Whatever `run` does is one undo step.
- **Continuous edits merge through gestures:** `beginGesture()`, `endGesture()`, `cancelGesture()`. Every command executed while a gesture is open merges into the gesture's single entry. The tool registry opens a gesture on a primary pointer press and closes it on release; inspector drag-scrubbing and sliders do the same. `cancelGesture()` (Esc, tool switch, mode change, or Undo during a gesture) reverts the gesture's ops and records nothing.
- **Stack:** limit 200 entries (oldest dropped); a new entry clears redo. `markSaved()` and `dirty` track unsaved changes. `clear()` on New and Load.
- **Not undoable:** selection, camera, layout, settings other than `pixelsPerMeter`, mode, playhead, tool. Load and New reset the model and clear history.

### Change notifications

All emitters are `lib/emitter.js` instances owned privately; owners expose `on` / `off` only.

| Source | Event | Payload | When |
|---|---|---|---|
| `model` | `change` | `{ changes: Change[], cause: 'do' \| 'undo' \| 'redo' \| 'cancel' }` | Once per committed transaction (`batch`), undo, redo, merge step or cancelled gesture, after the model is consistent. Not emitted when nothing changed. |
| `model` | `reset` | `{ cause: 'new' \| 'load' \| 'recover' }` | After the whole document was replaced. Views rebuild. |
| `history` | `history` | `{ canUndo, canRedo, undoLabel, redoLabel, dirty }` | After any stack change. |
| `selection` | `selection` | `{ objects: number[], timeline: number[], focus: 'objects' \| 'timeline' }` | After any selection change. |
| `modes` | `mode` | `{ mode: 'edit' \| 'animate' \| 'simulate', previous, clip: number \| null }` | Mode or open clip changed. |
| `modes` | `playhead` | `{ time }` (s) | Playhead moved. |
| `tools` | `tool` | `{ id, previous }` | Active tool changed. |
| `settings` | `settings` | `{ key, value, previous }` | An editor setting changed. |
| `RagInstance` | `event`, `start`, `loop`, `complete`, `stop` | [`DESIGN.md` §7.1](../DESIGN.md#71-api) | During `rag.update(dt)`. |

```
Change = { kind: 'add',    uid, type, parent, collection, index }
       | { kind: 'remove', uid, type, parent, collection, index }
       | { kind: 'set',    uid, type, path, value, previous }
       | { kind: 'move',   uid, type, from: Slot, to: Slot }
```

Adding or removing a subtree produces one change per node: parents before children on `add`, children before parents on `remove`. Changes are listed in application order, and one event may add and then remove the same uid; listeners process them in order.

### View sync

`js/viewport/scene.js` **(planned, #11/#12)** never rebuilds the scene on a change.

- It keeps `Map<uid, Entry>` for root, bodies, shapes, sprites and joints. Layers, bottom to top: grid, sprites (flat container, `sortableChildren`, `zIndex = z`, because z is ordered across the whole ragdoll), shapes (root container → body containers → shape graphics), gizmos, overlay (screen space).
- On `change`: `add` creates the entry, `remove` destroys it, `move` reparents it, `set` marks it dirty with the smallest effect: root or body transform → container transform plus that body's sprites; shape geometry or `editor.color` → redraw that shape; `sprite.*` → that sprite; joint props → that joint gizmo; `units.pixelsPerMeter` → every entry dirty (still no rebuild). Clip, track, key and event changes only re-evaluate the FK pose when they belong to the open clip in Animate mode.
- Dirty entries are flushed once per frame from the PIXI ticker. `reset` is the only full rebuild.
- Conversion follows [`DESIGN.md` §1](../DESIGN.md#1-conventions): `x·ppm`, `−y·ppm`, `rotation = −angle`.
- `setPose(pose | null)` overrides body transforms for FK preview without touching the model. Simulate mode shows the `RagInstance` view instead (#54).
- Selection, hover, mode and settings changes redraw gizmos and highlights only.

### Tools

`js/tools/tool.js` **(planned, #12)**. Every viewport tool implements one contract:

```
Tool {
  id: 'select' | 'select-box' | 'manipulate' | 'pose' | 'circle' | 'box' | 'polygon' | 'hinge',
  label: string,
  hotkey: string,                 single key from DESIGN §5.9, e.g. 'V'
  cursor: string,                 CSS cursor while idle
  activate(ctx: ToolContext): void,
  deactivate(): void,             cancels any operation in progress first
  pointerDown(e: ToolPointerEvent): void,
  pointerMove(e: ToolPointerEvent): void,
  pointerUp(e: ToolPointerEvent): void,
  keyDown(e: ToolKeyEvent): boolean,   true when consumed
  cancel(): boolean,              Esc; true when an operation was aborted
  drawOverlay(g: PIXI.Graphics): void  screen space, called after invalidateOverlay() or a camera change
}
ToolPointerEvent { world: {x, y} (m, Y up), local: {x, y} (m, root-local), screen: {x, y} (CSS px, Y down),
                   button: 0|1|2, buttons, shift, ctrl, alt, clicks: 1|2 }
ToolKeyEvent     { key, code, shift, ctrl, alt, repeat }
ToolContext      { model, history, selection, modes, settings, camera,
                   hitTest(screen) → number[] (topmost first), snapPoint(world), snapAngle(angle, shift),
                   setCursor(css | null), invalidateOverlay() }
```

- `defineTool(spec)` fills missing members with no-ops and freezes the tool.
- Tools read the model, mutate it only with `ctx.history.execute(command)`, and keep in-progress state (polygon vertices, selection box) local until it becomes data. `ctx.modes.can(capability)` decides what an operation may do (e.g. Manipulate rotates into keys in Animate).
- **`ToolRegistry(ctx, tools)`:** `list()`, `get(id)`, `active`, `activate(id) → boolean` (refused when the mode policy disallows the tool), `toolForHotkey(key)`, `pointer(type, e)`, `key(e) → boolean`, `cancel() → boolean`, `drawOverlay(g)`, `on/off('tool')`.
  - It opens a history gesture on a primary `pointerDown` and closes it on `pointerUp`, so one press–drag–release is one undo step. On `cancel()` it calls `tool.cancel()` and then `history.cancelGesture()`.
  - On a mode change it cancels, and switches to `select` if the active tool is no longer allowed.
- Navigation (pan, zoom, `F`, `Home`) is handled by `js/viewport/input.js` before tools and never reaches them. `clicks` is counted by the input layer (second press within 400 ms and 4 px).

### Actions and hotkeys

- **`ActionRegistry`** `js/actions.js` **(planned, #10)**: `register(id, { run, isEnabled })`, `run(id)`, `isEnabled(id)`. Ids reuse the header ids (`new`, `load`, `save`, `undo`, `redo`, `play`, `pause`, `next-frame`, `stop`, `window`, `settings`) and add `toggle-play`, `delete`, `group`, `ungroup`, `duplicate`, `key-selected`, `frame-selection`, `frame-all`, `sprite-edit`, `escape`, `tool:<id>`, `panel:<id>` (toggle a panel) and `reset-layout`. Until #10 lands, `js/main.js` connects the Window button, `js/menu.js` and the dock directly; #10 moves that wiring to these actions. The header and hotkeys both call `run`; the header refreshes `aria-disabled` from `isEnabled` on `history`, `mode` and `selection` events.
- **`HOTKEYS`** `js/hotkeys.js`: `{ keys: 'Ctrl+Shift+Z', action: 'redo' }` rows for §5.9, plus `tool:<id>` rows built from each tool's `hotkey`. `Meta` counts as `Ctrl`. The header's shortcut hints must equal this table (tested).
- **`dispatchKey(event, { tools, actions, viewportFocused })`** order:
  1. ignore if `event.defaultPrevented` (the header already handled its arrow keys) or the target is a text field, `select` or `contenteditable`;
  2. if the viewport has focus, `tools.key(e)`; stop if consumed;
  3. `matchHotkey(e)`; run the action if enabled and `preventDefault`. Space only matches when focus is the viewport or the page body, and the viewport turns Space into pan-or-toggle ([`DESIGN.md` §5.9](../DESIGN.md#59-hotkeys-defaults)).
- `escape` runs `tools.cancel()`, and clears the selection when nothing was cancelled.

### Modes

`js/modes.js` **(planned, #10)** holds `mode`, the open clip uid, `playhead` and the mode before Simulate. `openClip(uid | null)` enters Animate or Edit; `startSimulate()` / `stopSimulate()` enter Simulate and restore the previous mode. `can(capability)` reads `MODE_POLICY`, whose rows map one-to-one to the policy table in [`DESIGN.md` §5.1](../DESIGN.md#51-editor-modes):

| Capability | DESIGN §5.1 row |
|---|---|
| `select` | Select, Select Box, Hierarchy selection |
| `tool.manipulate`, `tool.pose` | Manipulate, Pose |
| `tool.circle`, `tool.box`, `tool.polygon`, `tool.hinge` | Creation tools |
| `edit.rest` | Rest-pose and object edits |
| `edit.animation` | Animation edits |
| `assets.import`, `assets.delete` | Asset import / Asset delete |
| `clip.open` | Clip selector, New clip |
| `timeline.scrub` | Scrub |
| `preview.stack`, `preview.procedural` | Preview stack / Procedural preview |
| `file`, `history` | New/Load/Save, Undo/Redo |
| `play`, `simulate.control` | Play / Pause, Next frame, Stop |
| `settings.editor`, `layout`, `camera` | Editor settings, panels, navigation |

### Dock layout

`js/panels/layout.js` **(planned, #8)** holds the layout as data; `js/panels/dock.js` renders it and turns pointer and keyboard input into layout operations. Behavior and sizes: [`DESIGN.md` §5.2](../DESIGN.md#52-panels).

```
PanelId    'tools' | 'hierarchy' | 'assets' | 'problems' | 'inspector' | 'timeline'
LayoutNode Split | Stack | { type: 'viewport' }
Split      { type: 'split', dir: 'row' | 'column', children: LayoutNode[], sizes: (number | null)[] }
Stack      { type: 'stack', id: string, panels: PanelId[], active: PanelId }
Layout     { version: 1, tree: LayoutNode, closed: { [PanelId]: { stackId: string, index: number } } }
Drop       { kind: 'tab', stackId, index } | { kind: 'split', stackId, side } | { kind: 'edge', side }
           side = 'left' | 'right' | 'top' | 'bottom'
Rect       { x, y, width, height }   CSS px, relative to the workspace content box
Gutter     { path: number[], index, dir, rect: Rect, value, min, max }   px, the split at `path` (child indexes from the root), between children index and index + 1
```

- **Viewport** is a node, not a `PanelId`; it appears exactly once and never inside a stack. `PANELS` maps each `PanelId` to `{ title, group, edge, size, min: { width, height } }` from the §5.2 table; `group` is the default stack (`hap` for Hierarchy, Assets, Problems). `defaultLayout(workspace)` takes the workspace size because the Hierarchy stack starts at half the right column's height.
- **Sizes** are px along the split axis. Exactly one child per split has `null` (fill): the one containing the viewport, otherwise the last. Every operation re-derives it. `computeRects(layout, workspace)` gives fixed children their size, the fill the rest; if the fill falls below its minimum, the others shrink in proportion to their size above their own minimum, and if the minimums still do not fit, the content size exceeds the workspace (it scrolls). Minimum sizes of splits are derived from their children plus 4 px gutters. It returns `{ stacks: Map<string, Rect>, viewport: Rect, gutters: Gutter[], width, height }`.
- **Normalize** (after every operation): drop empty stacks; a split with one child becomes that child; a split nested in a split of the same `dir` is flattened; space freed by a removed child goes to its previous sibling, else the next; fill is re-derived; `active` must be one of `panels`.
- **Operations** are pure, return a new frozen `Layout` and throw on an id that is unknown or in the wrong state. `closePanel` records `{ stackId, index }` in `closed`; `openPanel` applies the reopen rule and activates the panel; `movePanel` applies a `Drop` that `canDrop` accepts (not the viewport center, not the panel's own stack when it is its only tab); `resizeSplit(layout, path, index, value, workspace)` clamps to `[min, max]`. New stacks get id `s<n>` above every existing stack id. Edge splits give the moved panel half the target, edge docks the panel's default size capped at 1/3 of the workspace, both respecting minimums.
- **`dropAt(layout, rects, point, panelId) → { drop, preview: Rect } | null`**: 16 px workspace edge strips first; then over a tab bar a `tab` drop at the insertion index; then stack edge zones of 25 % of the stack dimension clamped to 24–80 px; then the stack center.
- **Stored layout:** `validateLayout(value) → string | null` returns the first reason it is invalid: not an object, `version !== 1`, malformed node, unknown or repeated panel id across `tree` and `closed`, viewport not exactly once, empty stack, `active` not in its stack, `sizes` not matching `children` in length, not exactly one `null`, or a size that is not finite and > 0. `restoreLayout(value, workspace) → { layout, warning }` returns the default layout and `warning: 'Stored layout ignored: <reason>'` when invalid, and adds every panel missing from both `tree` and `closed` by the reopen rule.
- **Dock:** reads `loadLayout()` once on creation (`parse` → warning, `missing`/`unavailable` → default without warning), logs a warning with `console.warn`, and calls `saveLayout` after a drop, a resize end, a tab change, a close or a reopen; keyboard resizing saves 500 ms after the last key. `reset()` calls `clearLayout()` and applies `defaultLayout`. It emits `layout` with `{ layout }` after every change. Its tab lists and separators, like `js/menu.js`, call `preventDefault` on the keys they handle ([Actions and hotkeys](#actions-and-hotkeys)). Layout operations never go through history.

### Emitter

`lib/emitter.js`, used by the editor core and by `RagInstance` (#47).

```
class Emitter {
  on(type: string, fn: (payload) => void): () => void   returns an unsubscribe function
  off(type: string, fn): void
  emit(type: string, payload?): void
  clear(): void                                          removes every listener
}
```

- Listeners run synchronously, in subscription order, with one payload argument. A function is registered at most once per type.
- `emit` iterates a copy of the listener list: listeners added or removed during an emit take effect on the next one.
- Every listener runs even if one throws; the first error is rethrown after the last listener.
- No wildcard types, no `once`, no async.

### Schema

`lib/schema.js` is the single code source of field types, defaults, ranges, enums, units, editor-only flags and canonical order; [schema.md](schema.md) documents it. It lives in `lib/` because `lib/validate.js` and `lib/serialize.js` need it and `lib/` cannot import `js/`. Model defaults, validation, the serializer and the inspector never redeclare a default, range or key order.

## Data flow

1. **Authoring:** UI action → command → `history.execute` → model ops → one `change` event → views update their own entries (scene, hierarchy, inspector, timeline, Problems after a debounced `validate(toJson(model))`).
2. **Save:** `toJson(model)` → `validate` (blocked on errors) → `serialize` → `.rag.json` (+ sprite files). **Load:** parse JSON → `migrate` → `validate` → `loadJson` → `reset`.
3. **Animate mode:** model clips → `lib/evaluate.js` at the playhead → FK pose (`scene.setPose`) and sprite channels.
4. **Simulate mode / runtime:** `toJson(model)` → `RagImporter.parse` → spawn in a LiquidFun world → each step:

```
rag.update(dt)    advance clips, fire events, resolve channels + overrides, write motors and textures
world.Step(dt)    LiquidFun integrates
rag.sync()        body transforms → PIXI sprites
```

## Conformance

A change conforms when its modules, exports and imports match this document.

- **Automated (#66):** conformance tests check the dependency rules and layers above (static import scan), that core and pure modules load under Node without a DOM, that `applyOps`, `batch` and `reset` are only called from their owners, and that source files have no code comments.
- **Pull requests:** the PR template has a conformance item. A PR that adds, removes, renames or changes the responsibility or imports of a module updates the module map on the same branch, through the architect, and is reviewed by the architect before merge.
- **Disagreement:** if code needs a module or import this document does not allow, stop and ask the architect; do not merge a deviation.
