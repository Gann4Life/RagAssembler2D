# Architecture

> Status: partly built. The editor shell (header toolbar, dock with placeholder panels, Window menu and an empty PIXI viewport), the document model with its emitter and property schema, a stub of `lib/ragimporter.js`, the test harness with the architecture conformance tests and the pinned `vendor/` libraries exist. Everything marked **(planned)** is the agreed design that issues implement; it is updated as code lands. Changes to this design go through the architect ([Conformance](#conformance)).

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

RagImporter reaches liquidfun.js only through the `Box2D` namespace (no global `b2*` names) and PIXI.js through `PIXI`; either can be injected with `RagImporter.configure({ Box2D, PIXI })` **(planned)** ([`DESIGN.md` §7](../DESIGN.md#7-ragimporter)). Both libraries are pinned in `vendor/` ([Vendored libraries](development.md#vendored-libraries)). Every runtime module that creates or destroys LiquidFun objects follows the native memory rules ([`DESIGN.md` §7.4](../DESIGN.md#74-native-memory)): the heap is fixed and cannot grow.

`demo/` is a separate host page **(planned)**. It imports only `lib/ragimporter.js` and the vendored libraries.

## Editor boot

1. `index.html` loads `css/editor.css`, then the vendored libraries as classic scripts: `vendor/pixi.min.js` (defines `PIXI`) and `vendor/liquidfun.js` (defines `Box2D`).
2. It loads `js/main.js` as the only module script. The markup holds a placeholder `<header id="header">` and `<main id="workspace">` with the viewport panel (`#panel-viewport` > `#viewport-host`, `role="group"`, `tabindex="0"`, labelled "Viewport"; [`DESIGN.md` §5.4](../DESIGN.md#54-viewport)).
3. `js/main.js` reads the `PIXI` and `Box2D` globals and throws an `Error` naming the missing library and its `vendor/` file. The error only reaches the console; the page stays blank.
4. It replaces the placeholder with `createHeader(document)`: a toolbar with every action disabled ([`DESIGN.md` §5.3](../DESIGN.md#53-header)).
5. It creates the dock with `createDock(#workspace, { viewportElement: #panel-viewport })`, which restores the stored layout (falling back to the default layout if restoring throws) and renders every stack, with placeholders for the panels ([Dock layout](#dock-layout)).
6. It enables the Window button and opens `openMenu(windowButton, dock.windowItems(), …)` on `header-action` (`window`), Down (first item) or Up (last item). Choosing an item opens or closes the panel, or resets the layout; Left/Right from the menu call `focusAdjacentAction(header, windowButton, key)`.
7. It awaits `createViewport(PIXI, #viewport-host)`: a PIXI `Application` whose canvas fills the host. A `ResizeObserver` resizes the renderer to the host size in CSS pixels, using the current `devicePixelRatio`.

`Box2D` is checked but not used yet. No editor state, command stack or modes exist; `js/editor.js` is an empty file reserved for the composition root. The Window button is the only `header-action` handled.

**(planned)** Boot becomes: `main.js` checks the globals → `createEditor()` (core, no DOM) → mounts the dock, header, panels and viewport, passing them the editor object → registers action handlers that need the DOM (file pickers) → offers draft recovery ([`DESIGN.md` §1](../DESIGN.md#1-conventions)).

## Dependency rules

| From | May import |
|---|---|
| `js/` | `lib/`, other `js/` modules per the layers below. Only `js/main.js` reads the `PIXI` and `Box2D` globals; other modules receive them as parameters. |
| `lib/` | Other `lib/` modules only. Only runtime modules (`def`, `instance`, `render`, `collision`) use `Box2D`/`PIXI`, and only through the namespaces resolved by `lib/ragimporter.js`. |
| `demo/` | `lib/ragimporter.js` only (the public API), vendor globals. |
| `tests/` | `lib/`, `tests/helpers/`, `vendor/liquidfun.js` (loaded with `createRequire`, only by the liquidfun.js verification tests `tests/liquidfun-*.test.js`), and `js/` **core** modules (they load without a DOM). Exception: a `js/` UI module that loads without a DOM may be imported to test its DOM-free exports (`js/header.js`: `HEADER_GROUPS`, `actionTitle`; `js/viewport/toolbar.js` (planned): `TOOL_BUTTONS`), or with a fake browser global installed on `globalThis` for the test and restored after it (`js/storage.js` with a fake `localStorage`). DOM behavior is checked in the browser. |

**Layers inside `js/`:**

| Layer | Modules | Rules |
|---|---|---|
| Core | `js/editor.js`, `js/model/*`, `js/commands/*`, `js/modes.js`, `js/hotkeys.js`, `js/actions.js`, `js/units.js`, `js/roving-focus.js`, `js/tools/*`, `js/viewport/camera.js`, `js/viewport/hit.js`, `js/panels/layout.js` | No DOM, no PIXI import, no globals. Load and run under `node --test`. Import only `lib/` and other core modules. Tools draw only through the `PIXI.Graphics` they are handed. |
| UI | `js/main.js`, `js/header.js`, `js/menu.js`, `js/viewport.js`, `js/viewport/*` (other than camera, hit), `js/panels/*` (other than layout), `js/storage.js`, `js/files.js`, `js/asset-store.js` | May import core and `lib/`. Receive the editor object and `PIXI` as parameters. Panel content modules (`hierarchy`, `assets`, `problems`, `inspector`, `timeline`) never import each other or the dock modules (`js/panels/dock.js`, `js/panels/layout.js`); `js/main.js` mounts them into the element the dock gives for their panel. Never mutate the model directly. |

Pure modules (`lib/` pure set and the `js/` core) must not touch the DOM, PIXI or LiquidFun.

## Module map

Columns: responsibility, public exports, and allowed imports beyond `lib/`. Rows marked **(planned)** do not exist yet; the issue that creates each one is given.

### Built

| Module | Responsibility | Public exports | Imports |
|---|---|---|---|
| `index.html` | Editor page: loads `css/editor.css`, the vendored libraries as classic scripts and `js/main.js` as the only module; holds the header placeholder and the viewport panel markup. | none | — |
| `css/editor.css` | Editor styles: dark theme variables, full-height grid layout, header toolbar (no wrapping, horizontal scroll, Workspace group pushed right), muted disabled buttons, scrolling workspace, dock (absolutely positioned stacks, tab bars, gutters with grips, drop preview, drag ghost, drag and resize cursors), tab bar edge fades (12 px) and insertion caret, Timeline fold button, resize grips shown on hover and drag, popup menu, viewport focus ring drawn above the canvas. | none | — |
| `js/main.js` | Editor bootstrap ([Editor boot](#editor-boot)): checks the `PIXI` and `Box2D` globals, mounts the header, creates the dock, wires the Window button to the Window menu and creates the viewport. | none | any `js/` |
| `js/editor.js` | Empty. Reserved for the composition root **(planned, #10)**. | none | — |
| `js/header.js` | Header toolbar: grouped action list, roving-tabindex keyboard navigation, `aria-disabled` buttons with tooltips, a bubbling `header-action` CustomEvent (`detail.action`) on clicks of enabled buttons, and moving focus to the previous/next button from outside the toolbar (used when Left/Right close a menu). | `HEADER_GROUPS`, `createHeader`, `actionTitle`, `setActionEnabled`, `focusAdjacentAction(header, button, key)`, typedef `HeaderAction` | `js/roving-focus.js` |
| `js/roving-focus.js` | Pure key-to-index mapping for roving-tabindex widgets: next/previous wrap, Home/End. `orientation` is `'horizontal'` (Left/Right, default) or `'vertical'` (Up/Down, menus). | `rovingIndex(current, key, count, orientation?)` | — |
| `js/panels/layout.js` | Core. Pure dock layout model ([Dock layout](#dock-layout)): panel table, default layout, normalize, validate and restore a stored layout, activate/close/open/move/resize, Timeline folding, rectangles and gutters, drop targets. Immutable: every operation returns a new deep-frozen `Layout`. | `LAYOUT_VERSION`, `PANELS`, `VIEWPORT_MIN`, `TAB_BAR_HEIGHT`, `defaultLayout`, `normalize`, `validateLayout`, `restoreLayout`, `activatePanel`, `closePanel`, `openPanel`, `movePanel`, `canDrop`, `resizeSplit`, `timelineFold`, `setTimelineFolded`, `computeRects`, `dropAt`, typedefs `PanelId`, `PanelSpec`, `Layout`, `LayoutNode`, `SplitNode`, `StackNode`, `Drop`, `Rect`, `Gutter`, `LayoutRects` | — |
| `js/panels/dock.js` | UI. DOM for the layout: absolutely positioned stacks, tab bars (tab list, roving tabindex, close button, middle click, wheel scrolling, edge fades), the Timeline fold button, resize gutters (focusable separators named after the area they resize), pointer-event tab dragging with drop preview and ghost, placeholders for unbuilt panels, DOM order following the layout tree, focus preservation and repair, restore on creation and saving through `js/storage.js`. Emits `layout`. | `createDock(workspace, { viewportElement }) → Dock`, typedef `Dock` (`panelElement(id)`, `isOpen(id)`, `open(id)`, `close(id)`, `reset()`, `windowItems()`, `on/off('layout')`, `destroy()`) | `lib/emitter.js`, `js/panels/layout.js`, `js/roving-focus.js`, `js/storage.js` |
| `js/menu.js` | UI. Generic popup menu anchored to a button: `role="menu"` with `menuitem`/`menuitemcheckbox`/separator items, `aria-expanded`/`aria-controls` on the button while open, opens below the button aligned to its right edge, keyboard per [`DESIGN.md` §5.3](../DESIGN.md#53-header), closes on choice, Esc, Tab, Left/Right and outside pointer presses. Disabled items stay focusable and cannot be chosen. | `openMenu(button, items, { onSelect, onNavigate, focus }) → { close }`, typedefs `MenuItem` (`id`, `label`, `kind: 'item' \| 'checkbox' \| 'separator'`, `checked`, `disabled`), `MenuOptions` | `js/roving-focus.js` |
| `js/storage.js` | UI. Browser storage as JSON in `localStorage` under `ragassembler.*` keys; never validates content. Every `localStorage` failure (missing, `SecurityError`, quota) means "unavailable" and is silent. Layout key: `ragassembler.layout`. #29 adds `saveDraft`, `loadDraft`, `clearDraft`; settings follow with their issue. | `loadLayout() → { value } \| { error: 'missing' \| 'unavailable' \| 'parse' }`, `saveLayout(layout) → boolean`, `clearLayout() → void` | — |
| `js/viewport.js` | PIXI viewport: creates an `Application` in a host element and keeps the renderer sized to the host and `devicePixelRatio`. | `createViewport`, typedef `Viewport` (`app`, `destroy`) | `js/viewport/*` (planned) |
| `js/model/model.js` | Document model ([Document model](#document-model)). | `Model`, `ROOT_UID`, typedefs `Node`, `NodeType`, `NodeSnapshot`, `Change`, `Op` | `lib/emitter.js`, `lib/schema.js` |
| `lib/emitter.js` | Synchronous event emitter ([Emitter](#emitter)). | `Emitter` | — |
| `lib/schema.js` | Property schema: types, defaults, ranges, units, canonical order, channels ([schema.md](schema.md)). | `FORMAT`, `FORMAT_VERSION`, `SCHEMA`, `CHANNELS`, `fieldsOf`, `defaultsOf`, `autoClipKey`, typedef `FieldSpec` | — |
| `lib/ragimporter.js` | RagImporter entry point. Currently a stub that only declares the supported format versions. | `RagImporter` (frozen object with `supportedVersions: [1]`) | `lib/*` (planned) |
| `tests/index.js` | Test aggregator for `node --test tests/`: recursively imports every `*.test.js` under `tests/`. | none | — |
| `tests/smoke.test.js` | Smoke test: `lib/ragimporter.js` loads as an ES module and supports format version 1. | none | — |
| `tests/editor-header.test.js` | Header tests: `rovingIndex` navigation in both orientations, header group order and unique ids against `DESIGN.md` §5.3, shortcuts against §5.9, and `actionTitle` text. | none | — |
| `tests/layout.test.js` | Dock layout tests: `PANELS` against the `DESIGN.md` §5.2 table, default layout, rects and gutters, normalize, stored-layout validation (including the depth and size limits) and restore, close/open (reopen rule), move, `canDrop`, resize (shrunk siblings stay on screen), Timeline folding, `dropAt`, immutability and JSON round trip. | none | — |
| `tests/storage.test.js` | Storage tests with a fake `localStorage` installed on `globalThis` and restored after each test: `missing`, `parse` and `unavailable` results (`getItem` throwing or `localStorage` undefined), `saveLayout` success and failure (`setItem` throwing or storage undefined), silent `clearLayout`. | none | — |
| `tests/liquidfun-api.test.js` | Verifies the pinned liquidfun.js API surface used by RagImporter in Node: revolute joint creation and reference angle, motor, limit, angle and speed methods after `castObject`, filter data, contact filter, mouse joint, teardown order, and heap behavior under repeated create/destroy and per-step calls ([`DESIGN.md` §7.4](../DESIGN.md#74-native-memory)). | none | — |
| `tests/liquidfun-contact-filter.test.js` | Verifies contact filter behavior of the pinned build in Node: a JS filter replaces the default rule, the JS reimplementation of the default rule, fixture pointer identity, per-shape self-collision through a pointer registry, no `GetContactFilter`, replacement and uninstall semantics, one filter across worlds, the `groupIndex` fallback, and filter cost ([`DESIGN.md` §7.5](../DESIGN.md#75-contact-filter-and-host-integration)). | none | — |
| `tests/emitter.test.js`, `tests/schema.test.js`, `tests/model.test.js` | Contract tests for the emitter, the schema tables and helpers against [schema.md](schema.md), and the document model. | none | — |
| `tests/helpers/scan.js` | Test helper (`tests/helpers/` holds modules shared by tests; they are not `*.test.js`, so the aggregator does not load them). Reads every `.js` file under `js/`, `lib/`, `demo/` and `tests/` (never `vendor/`), tokenizes JavaScript so strings, templates, regexes and comments are single tokens, and lists import specifiers (static, re-export, dynamic `import()`, `require()`). | `readSources(root)`, `tokenize(source)`, `importsOf(tokens)`, typedefs `Token`, `SourceFile`, `ImportRef` | — |
| `tests/helpers/architecture.js` | Test helper. Parses the layer classification from this document (the modules column of the Core row of the layers table, the `Pure:` line of the [Components](#components) diagram, and the `js/` modules named in the `tests/` row of the dependency table), and implements the [Conformance](#conformance) checks; each returns `path:line: message` entries. Editing those three places changes what the checks enforce. | `parseArchitecture`, `isCore`, `isUi`, `isPure`, `checkImports`, `checkPureGlobals`, `checkModelMutationCalls`, `checkNoComments`, typedef `Architecture` | `tests/helpers/scan.js` |
| `tests/architecture.test.js` | Conformance tests ([Conformance](#conformance)): runs every check on the repository sources against the classification parsed from this document. | none | `tests/helpers/scan.js`, `tests/helpers/architecture.js` |
| `tests/architecture-checks.test.js` | Tests of the conformance checks themselves on inline sources with a fixed classification: tokenizer edge cases, import forms, each dependency and layer rule, global references, model mutation calls and comment detection. | none | `tests/helpers/scan.js`, `tests/helpers/architecture.js` |

### lib/ (planned)

A module whose functions serve several issues is created by the first of them to land, with only the functions it needs; later issues add theirs and update this row.

| Module | Responsibility | Public exports | Imports | Issue |
|---|---|---|---|---|
| `lib/geometry.js` | Pure 2D math in meters/radians: transforms, polygon convexity/CCW/centroid, shape local frame, area/mass, point-in-shape. | `transformPoint`, `composeTransforms`, `polygonProblems`, `polygonCentroid`, `shapeFrame`, `shapeMass`, `bodyMass`, `pointInShape` | — | first of #11, #20, #25 |
| `lib/validate.js` | `validate(json) → { errors, warnings }` ([`DESIGN.md` §6.4](../DESIGN.md#64-validation)). Generic checks from the schema, cross-field checks by hand. | `validate`, typedef `Problem` (`severity`, `code`, `message`, `path`, `target`) | schema, geometry | #25 |
| `lib/serialize.js` | Canonical writer: schema key order, numbers rounded to 1e-5, `-0` → `0`, 2-space indent, `\n`, final newline ([`DESIGN.md` §6.5](../DESIGN.md#65-round-trip-guarantee)). | `serialize(json) → string` | schema | #27 |
| `lib/migrate.js` | Migrates older format versions to `FORMAT_VERSION`; throws on unknown versions. Used by the editor loader only. | `migrate(json) → { json, notes }` | schema | #27 |
| `lib/evaluate.js` | Pure animation evaluator: track sampling, interpolation, channel resolution ([`DESIGN.md` §4.3–4.4](../DESIGN.md#43-keys-and-interpolation)). | `sampleTrack`, `evaluateClip`, `resolveChannels`, typedef `ResolvedPose` | schema | #30, #31 |
| `lib/ragimporter.js` | Public entry: `configure` (including `contactFilter`), `parse`, `validate`, `supportedVersions`, `setContactFilter`, `releaseWorld`; resolves `Box2D`/`PIXI`. | `RagImporter`, `RagFormatError` | all `lib/` | #44, #49 |
| `lib/def.js` | `RagDef`: immutable parsed definition, `spriteUrls`, `spawn` (destroys every def, shape and filter it creates, casts each joint once to `b2RevoluteJoint`; [§7.4](../DESIGN.md#74-native-memory)). | `RagDef` (via `parse`) | validate, schema, geometry, instance | #44 |
| `lib/instance.js` | `RagInstance`: playback, events, overrides, motor controller, `update`, `sync` (both allocate nothing) and `destroy` (joints before bodies); [§7.4](../DESIGN.md#74-native-memory). | `RagInstance` (via `spawn`) | emitter, evaluate, geometry, render, collision | #44–#48 |
| `lib/render.js` | PIXI sprites, texture resolver and cache, z order, debug draw. | internal | geometry | #50, #51 |
| `lib/collision.js` | Per-world collision state ([`DESIGN.md` §2.5, §7.5](../DESIGN.md#75-contact-filter-and-host-integration)): one `JSContactFilter` per world (default rule, self-collision registry keyed by fixture pointer, host predicate), install on first use, `releaseWorld` teardown, instance ids and the `groupIndex` fallback. | internal | — | #49 |

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
| `js/tools/select.js`, `select-box.js`, `manipulate.js`, `pose.js`, `circle.js`, `box.js`, `polygon.js`, `hinge.js` | One tool each ([`DESIGN.md` §5.5](../DESIGN.md#55-tools)). | `selectTool`, `selectBoxTool`, `manipulateTool`, `poseTool`, `circleTool`, `boxTool`, `polygonTool`, `hingeTool` | tool, commands/*, model, queries | #13–#17, #24, #38 |
| `js/viewport/camera.js` | Pure camera: center (m), zoom, world ⇄ screen with `pixelsPerMeter` and the Y flip. | `Camera` | — | #11 |
| `js/viewport/hit.js` | Pure hit testing in root-local meters: root gizmo, joint gizmos, shapes, topmost first. | `hitTest` | model, camera | #12 |

### js/ UI (planned)

| Module | Responsibility | Public exports | Issue |
|---|---|---|---|
| `js/viewport/scene.js` | Display objects keyed by uid, synced from model changes ([View sync](#view-sync)). | `createScene`, typedef `Scene` | #11, #12 |
| `js/viewport/grid.js` | Grid (1 m / 0.1 m) and origin axes. | `createGrid` | #11 |
| `js/viewport/gizmos.js` | Root, joint, selection and hover gizmos; strength fill in Animate. | `createGizmos` | #12, #36 |
| `js/viewport/input.js` | DOM pointer/keyboard/wheel → navigation, then `ToolPointerEvent` → registry; click counting; context menu suppression. | `attachInput` | #11, #12 |
| `js/viewport/toolbar.js` | Tools overlay ([`DESIGN.md` §5.5](../DESIGN.md#55-tools)): a vertical `role="toolbar"` inside the Viewport panel, sibling of the viewport host, with inline SVG icons, `aria-pressed`/`aria-disabled` states, roving tabindex in both orientations, two-column class from a `ResizeObserver` below 315 px of host height, and tooltips through `js/tooltip.js` with text from `actionTitle`, which gains an optional `reason` (default `'not available yet'`) for the "not available in *Mode* mode" suffix. Clicks call `onActivate(id)` and focus the viewport host; it never activates tools itself. Imports `js/roving-focus.js`, `js/header.js` (`actionTitle`), `js/tooltip.js`. Raises `VIEWPORT_MIN` to 240 × 168. | `TOOL_BUTTONS` (groups of `{ id, label, hotkey, icon }`, ids as in [Tools](#tools)), `createToolbar(viewportPanel, { onActivate }) → Toolbar` (`setActive(id \| null)`, `setEnabled(id, enabled, reason?)`, `width()`, `destroy()`) | Tools overlay issue (planner) |
| `js/tooltip.js` | Custom tooltip for icon buttons: shown after 400 ms of hover or at once on `:focus-visible`, hidden on leave, blur, Esc and press; `aria-hidden`; never sets `title`. | `attachTooltip(element, text: () => string) → () => void` | Tools overlay issue (planner) |
| `js/panels/hierarchy.js`, `assets.js`, `problems.js`, `inspector.js`, `timeline.js` | One panel each ([`DESIGN.md` §5.6–5.8](../DESIGN.md#56-hierarchy-assets-and-problems-panels)). The inspector builds its rows from `fieldsOf` ([schema.md](schema.md)). | `create<Panel>` | #19–#23, #26, #32–#35 |
| `js/storage.js` (draft functions) | Draft autosave and recovery in the built storage module, same failure rules. | `saveDraft`, `loadDraft`, `clearDraft` | #29 |
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

`js/panels/layout.js` holds the layout as data and owns every layout rule; `js/panels/dock.js` renders it and turns pointer and keyboard input into layout operations, without re-deriving those rules. Behavior and sizes: [`DESIGN.md` §5.2](../DESIGN.md#52-panels).

```
PanelId     'hierarchy' | 'assets' | 'problems' | 'inspector' | 'timeline'
PanelSpec   { title, group, edge: side, size, min: { width, height } }
LayoutNode  SplitNode | StackNode | { type: 'viewport' }
SplitNode   { type: 'split', dir: 'row' | 'column', children: LayoutNode[], sizes: (number | null)[] }
StackNode   { type: 'stack', id: string, panels: PanelId[], active: PanelId }
Layout      { version: 2, tree: LayoutNode, closed: { [PanelId]: { stackId: string, index: number } },
              timelineFolded: boolean }
TimelineFold { stackId: string, folded: boolean } | null
Drop        { kind: 'tab', stackId, index } | { kind: 'split', stackId, side } | { kind: 'edge', side }
            side = 'left' | 'right' | 'top' | 'bottom'; a split with stackId 'viewport' splits the viewport node
Rect        { x, y, width, height }   CSS px, relative to the workspace content box
Gutter      { path: number[], index, controlled, dir, rect: Rect, value, min, max }
            px; the split at `path` (child indexes from the root), between children index and index + 1;
            `controlled` is the child it resizes, `value` that child's current size, [min, max] its bounds
LayoutRects { stacks: Map<stackId, Rect>, viewport: Rect, gutters: Gutter[], width, height, tabs?: Map<stackId, Rect[]> }
```

- **Viewport** is a node, not a `PanelId`; it appears exactly once and never inside a stack. The Tools overlay is not part of the layout ([`DESIGN.md` §5.5](../DESIGN.md#55-tools)). `PANELS` maps each `PanelId` to `{ title, group, edge, size, min: { width, height } }` from the §5.2 table, in Window menu order; `group` is the default stack (`hap` for Hierarchy, Assets, Problems). `TAB_BAR_HEIGHT` is 28. `defaultLayout(workspace)` is `column[ row[ viewport, column[ hap, inspector ] ], timeline ]` with `timelineFolded: true`; it takes the workspace size because the Hierarchy stack starts at half the right column's height, measured with the Timeline folded.
- **Sizes** are px along the split axis. Exactly one child per split has `null` (fill): the one containing the viewport, otherwise the last. Every operation re-derives it. A gutter controls child `index` when the fill comes after it, else child `index + 1`; `resizeSplit` and the dock both use `Gutter.controlled` for this. `computeRects(layout, workspace)` gives fixed children their size, the fill the rest; if the fill falls below its minimum, the others shrink in proportion to their size above their own minimum, and if the minimums still do not fit, the content size exceeds the workspace (it scrolls). Shrinking only affects the rects, never the stored sizes, with one exception: `resizeSplit` first stores the on-screen size of every shrunk fixed sibling (the folded Timeline and the fill child excepted), so the dragged edge follows the request and siblings do not grow back later. Minimum sizes of splits are derived from their children plus 4 px gutters; a stack's minimum is the largest minimum of its panels. It returns a `LayoutRects` without `tabs`.
- **Timeline fold.** `timelineFold(layout)` returns `null` unless the Timeline is **foldable**: open, the active panel of its stack, and that stack a fixed (non-fill) child of a `column` split. Otherwise it returns its `stackId` and `folded = layout.timelineFolded`. The flag is kept when the Timeline is not foldable and only takes effect while it is. For a folded stack `computeRects` uses `TAB_BAR_HEIGHT` as its height and as its minimum height, with no slack to shrink; its stored size is untouched; the gutter whose `controlled` child it is is left out of `gutters` (its 4 px space stays). `setTimelineFolded(layout, folded)` sets the flag and throws when `timelineFold` is `null`. These operations clear the flag (expand): `activatePanel` of any panel of the Timeline's stack, including its already active tab; `openPanel` of the Timeline, or of a panel that lands in the Timeline's stack; `movePanel` of the Timeline, or a `tab` drop into its stack. `closePanel` and `resizeSplit` keep it; `resizeSplit` on the folded stack's gutter throws, as there is none.
- **Normalize** (after every operation): drop empty stacks; a split with one child becomes that child; a split nested in a split of the same `dir` is flattened (its fill takes the slot it occupied minus the fixed siblings); space freed by a removed child goes to its previous sibling, else the next; fill is re-derived; `active` must be one of `panels`, else the first; `timelineFolded` is kept.
- **Operations** are pure, return a new deep-frozen `Layout` and throw on an id that is unknown or in the wrong state. `activatePanel` changes the active tab; `closePanel` records `{ stackId, index }` in `closed` and activates the neighbour tab; `openPanel` applies the reopen rule and activates the panel; `movePanel` applies a `Drop` that `canDrop` accepts (an existing stack or the viewport; a tab index within `0..panels.length`; not a `tab` drop on the viewport; not the panel's own stack when it is its only tab) and activates the panel; `resizeSplit(layout, path, index, value, workspace)` stores the on-screen sizes of the split's shrunk siblings, then sets the controlled child, clamped to `[min, max]` and rounded to whole px. New stacks get id `s<n>` above every stack id in `tree` **and** in `closed`, so a closed panel never reopens into an unrelated stack that reused its old id. Edge splits give the moved panel half the target, edge docks the panel's default size capped at 1/3 of the workspace, both respecting minimums. Folding follows the rules above.
- **`dropAt(layout, rects, point, panelId, workspace) → { drop, preview: Rect, caret?: Rect } | null`**, `point` in content coordinates, first match wins:
  1. **Tab bars** (the top 28 px of any stack, a folded stack entirely): a `tab` drop at the insertion index from `rects.tabs` (measured by the caller; the end when absent), previewed as a 2 px caret in `preview`. Tab bars win over edge strips.
  2. **Edge strips** of 16 px along the content box, nearest edge wins: an `edge` drop previewed with the size `movePanel` will give (default size capped at 1/3 of `workspace`).
  3. **Stack edge zones** of 25 % of the stack dimension clamped to 24–80 px, nearest edge wins: a `split` drop previewed as the half the panel will take.
  4. **Stack center:** a `tab` drop at the end, with `preview` the stack rect and `caret` the 2 px insertion caret after its last tab.
  5. **Viewport edge zones** (same size rule): a `split` drop with `stackId: 'viewport'`.

  The viewport center, gutters, points outside the content and drops refused by `canDrop` give `null`.
- **Stored layout:** `LAYOUT_VERSION` is 2 (Tools left the dock and `timelineFolded` was added). Version 1 records are not migrated: no release shipped them, and they are ignored with the usual warning. `validateLayout(value) → string | null` returns the first reason it is invalid: not an object, `version !== 2`, `timelineFolded` not a boolean, malformed node or split `dir`, a tree deeper than 32 levels, a split without children, `sizes` not matching `children` in length, not exactly one `null`, a size that is not finite, not > 0 or above 100000 px, a stack id that is empty, `'viewport'` or repeated, `panels` not an array, an empty stack, an unknown or repeated panel id across `tree` and `closed`, `active` not in its stack, viewport not exactly once, `closed` not an object, or a `closed` entry without a string `stackId` and an integer `index ≥ 0`. `restoreLayout(value, workspace) → { layout, warning }` returns the default layout and `warning: 'Stored layout ignored: <reason>'` when invalid, and adds every panel missing from both `tree` and `closed` by the reopen rule.
- **Dock:** reads `loadLayout()` once on creation (`parse` → warning, `missing`/`unavailable` → default without warning; an exception from `restoreLayout` → warning and default), logs a warning with `console.warn`, and calls `saveLayout` after a drop, a resize end, a tab change, a close or a reopen; keyboard resizing saves 500 ms after the last key. `reset()` calls `clearLayout()` and applies `defaultLayout` without saving. It emits `layout` with `{ layout }` after every change, including each pointer move of a resize and its Esc revert. It re-renders stacks on structural changes and only re-places rects on resizes and on workspace size changes (`ResizeObserver`), which never change the layout; every `place()` also keeps each stack's active tab visible.
  - **DOM order** of the content children follows the layout tree depth-first (child, gutter, child, …; the viewport panel in its slot; the drop preview last), and is re-applied on structural changes without detaching the focused element when it stays (move siblings around it), so Tab order follows the layout and focus survives. When a re-render must recreate a focused tab, it refocuses the tab of the same panel, as it does today.
  - **Tab bars:** the tab list scrolls; a vertical wheel over an overflowing tab list scrolls it horizontally (`preventDefault` only while it can still scroll in that direction); a 12 px fade is shown on each clipped edge (classes toggled from `scrollLeft`, `clientWidth`, `scrollWidth` on scroll and on `place()`).
  - **Fold button** (only when `timelineFold(layout)` is not `null`): a 24 × 24 px button after the tab list, outside its scroll area, in the Timeline's stack; ▾ expanded, ▸ folded; `aria-expanded`, `aria-controls="panel-timeline"`, accessible name "Timeline content", tooltip "Fold" / "Expand"; a normal Tab stop. A click, or a double click on the empty part of that tab bar, calls `setTimelineFolded`. A click on a tab of the folded stack calls `activatePanel` even when it is already active. While folded, the panel element is `hidden`; if focus was inside it, focus moves to the fold button. Folding saves the layout immediately.
  - **Gutters:** `aria-label` is "*name* width" for `row` splits and "*name* height" for `column` splits, where *name* is that of `Gutter.controlled`: "Viewport" for an area holding the viewport, else the active tab of its first stack in tree order. `aria-controls` points to that area's element.
  - `windowItems()` returns the §5.3 Window menu items: one checkbox per panel in `PANELS` order preceded by Viewport (checked and disabled), a separator, then `reset-layout`. `close(id)` repairs focus when the closed panel, its tab or its close button had it: the new active tab of its stack, else the viewport host. Its tab lists and separators, like `js/menu.js`, call `preventDefault` on the keys they handle ([Actions and hotkeys](#actions-and-hotkeys)). Layout operations never go through history.

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

- **Automated (#66):** `tests/architecture.test.js` enforces these rules on every `.js` file under `js/`, `lib/`, `demo/` and `tests/`, with the layer classification parsed from this document by `tests/helpers/architecture.js` (the Core row of the layers table, the `Pure` line of the [Components](#components) diagram, the `js/` modules in the `tests/` dependency row):
  - **Imports** follow the [Dependency rules](#dependency-rules) and layers (static scan of imports, re-exports, dynamic `import()` and `require()` with a literal specifier; bare specifiers such as `node:*` are not checked). Panel content modules (any `js/panels/*.js` other than the dock modules) may import nothing from `js/panels/`: not each other, and neither `js/panels/layout.js` nor `js/panels/dock.js`, even though `layout.js` is core.
  - **Pure modules** (the `lib/` pure set and the `js/` core) reference none of the globals `document`, `window`, `PIXI`, `Box2D` or any `b2*` name. Property accesses and object keys do not count. Modules are scanned, not loaded.
  - **Model mutation calls:** `applyOps` and `batch` are called only by `js/commands/history.js`, and `reset` only by `js/model/io.js`. A call is detected only when its receiver is an identifier ending in `model` (`model.reset(…)`, `this.model.batch(…)`, `editor.model?.applyOps(…)`); a call through an alias (`const m = editor.model; m.reset(…)`) or a destructured method is not detected and is left to review. `tests/` is exempt.
  - **Comments:** only `/** … */` JSDoc blocks.

  Not automated, checked in review: the `vendor/liquidfun.js` loading rule for `tests/`, exports matching the module map, and which modules receive `PIXI`/`Box2D` as parameters.
- **Pull requests:** the PR template has a conformance item. A PR that adds, removes, renames or changes the responsibility or imports of a module updates the module map on the same branch, through the architect, and is reviewed by the architect before merge.
- **Disagreement:** if code needs a module or import this document does not allow, stop and ask the architect; do not merge a deviation.
