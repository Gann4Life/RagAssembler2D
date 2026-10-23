# Architecture

> Status: partly built. The editor shell (header toolbar, dock with placeholder panels, Window menu, Settings popover), the viewport (camera navigation, framing, adaptive grid, shapes of the rest pose, display modes, the gizmo layer with hover, selection and overlays, the Tools overlay toolbar, the tool overlay and tool input), the Hierarchy panel (tree, search, Add and Delete, with the deletion cascade and the tree model behind it), the editor core (document model, command stack, property edits, selection, modes, actions and hotkeys, editor settings, camera, framing bounds, grid geometry, snapping rules, UI unit conversions, the tool table and registry built into the editor with the Select (with its transform gizmo), Select Box, Circle, Box and Hinge Joint tools registered, the create-shape and create-joint commands, the transform command, the joint graph queries, hit testing, displayed-pose placement, viewport style constants) with its emitter, property schema and the `lib/geometry.js` functions of #11, #12 and #13, a stub of `lib/ragimporter.js`, the test harness with the architecture conformance tests and the pinned `vendor/` libraries exist. Everything marked **(planned)** is the agreed design that issues implement; it is updated as code lands. Changes to this design go through the architect ([Conformance](#conformance)).

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
│           evaluate · motor                                                │
│  Runtime: ragimporter (public entry) · def · instance · render · collision│
└──────────────┬──────────────────────────────────────┬─────────────────────┘
               │ Box2D global / configure()           │ PIXI global / configure()
        vendor/liquidfun.js                    vendor/pixi.min.js
```

RagImporter reaches liquidfun.js only through the `Box2D` namespace (no global `b2*` names) and PIXI.js through `PIXI`; either can be injected with `RagImporter.configure({ Box2D, PIXI })` **(planned)** ([`DESIGN.md` §7](design/07-ragimporter.md#7-ragimporter)). Both libraries are pinned in `vendor/` ([Vendored libraries](development.md#vendored-libraries)). Every runtime module that creates or destroys LiquidFun objects follows the native memory rules ([`DESIGN.md` §7.4](design/07-ragimporter.md#74-native-memory)): the heap is fixed and cannot grow.

`demo/` is a separate host page **(planned)**. It imports only `lib/ragimporter.js` and the vendored libraries.

## Dependency rules

| From | May import |
|---|---|
| `js/` | `lib/`, other `js/` modules per the layers below. Only `js/main.js` reads the `PIXI` and `Box2D` globals; other modules receive them as parameters. |
| `lib/` | Other `lib/` modules only. Only runtime modules (`def`, `instance`, `render`, `collision`) use `Box2D`/`PIXI`, and only through the namespaces resolved by `lib/ragimporter.js`. |
| `demo/` | `lib/ragimporter.js` only (the public API), vendor globals. |
| `tests/` | `lib/`, `tests/helpers/`, `vendor/liquidfun.js` (loaded with `createRequire`, only by the liquidfun.js verification tests `tests/liquidfun-*.test.js`), and `js/` **core** modules (they load without a DOM). Exception: a `js/` UI module that loads without a DOM may be imported to test its DOM-free exports (`js/header.js`: `HEADER_GROUPS`, `actionTitle`; `js/viewport/toolbar.js`: `TOOL_BUTTONS`, `TOOLBAR_MARGIN`, `toolbarSize`, `toolbarColumns`; `js/confirm-dialog.js`: `confirmKey`), or with a fake browser global installed on `globalThis` for the test and restored after it (`js/storage.js` with a fake `localStorage`; `js/files.js` with a fake document, event target and `URL`), or with the vendored liquidfun.js passed as a parameter by a `tests/liquidfun-*.test.js` (`js/physics/pose-session.js`). DOM behavior is checked in the browser. |

**Layers inside `js/`:**

| Layer | Modules | Rules |
|---|---|---|
| Core | `js/editor.js`, `js/model/*`, `js/commands/*`, `js/modes.js`, `js/timeline-player.js`, `js/timeline-time.js`, `js/rename.js`, `js/hotkeys.js`, `js/actions.js`, `js/units.js`, `js/settings.js`, `js/version.js`, `js/roving-focus.js`, `js/tree-nav.js`, `js/tools/*`, `js/viewport/camera.js`, `js/viewport/bounds.js`, `js/viewport/grid-lines.js`, `js/viewport/snap.js`, `js/viewport/hit.js`, `js/viewport/placement.js`, `js/viewport/style.js`, `js/panels/layout.js` | No DOM, no PIXI import, no globals. Load and run under `node --test`. Import only `lib/` and other core modules; `js/model/*` is the bottom of the core and imports only `lib/` and other `js/model/*` modules. Tools draw only through the `PIXI.Graphics` they are handed. |
| UI | `js/main.js`, `js/header.js`, `js/menu.js`, `js/viewport.js`, `js/viewport/*` (other than camera, bounds, grid-lines, snap, hit, placement, style), `js/panels/*` (other than layout), `js/settings-dialog.js`, `js/confirm-dialog.js`, `js/rename-field.js`, `js/tooltip.js`, `js/storage.js`, `js/files.js`, `js/asset-store.js`, `js/physics/*` | May import core and `lib/`. Receive the editor object, `PIXI` and `Box2D` as parameters. `js/physics/*` touch LiquidFun only, never the DOM or PIXI, and reach the core only through the `ToolContext.physics` service that `js/main.js` builds. Panel content modules (`hierarchy`, `assets`, `problems`, `inspector`, `timeline`) never import each other or the dock modules (`js/panels/dock.js`, `js/panels/layout.js`); `js/main.js` mounts them into the element the dock gives for their panel. Never mutate the model directly. |

Pure modules (`lib/` pure set and the `js/` core) must not touch the DOM, PIXI or LiquidFun.

## Editor core

Each topic lives in its own file; read only the one you need.

| Topic | File | Summary |
|---|---|---|
| Editor boot | [editor-boot.md](architecture/editor-boot.md) | How `js/main.js` boots the editor. |
| Module map | [module-map.md](architecture/module-map.md) | Index of the module map files, plus planned modules. |
| Module map: editor core | [module-map-editor-core.md](architecture/module-map-editor-core.md) | Entry point, settings, viewport math, model, commands, actions. |
| Module map: tools and UI | [module-map-tools-ui.md](architecture/module-map-tools-ui.md) | Tools, header, panels, viewport UI, settings dialog. |
| Module map: lib and tests | [module-map-lib-tests.md](architecture/module-map-lib-tests.md) | `lib/` modules and tests. |
| Document model | [document-model.md](architecture/document-model.md) | Node tree and model collections. |
| Commands and undo | [commands-and-undo.md](architecture/commands-and-undo.md) | Command objects, transactions and history. |
| Joint graph | [joint-graph.md](architecture/joint-graph.md) | Joint tree and queries. |
| Hierarchy and deletion | [hierarchy-and-deletion.md](architecture/hierarchy-and-deletion.md) | Hierarchy tree model and deletion plans. |
| Group, Ungroup and Split | [grouping.md](architecture/grouping.md) | Plans, commands, actions, confirmation and hotkeys that move shapes between bodies (#18). |
| Selection | [selection.md](architecture/selection.md) | Selection state. |
| Editor composition | [editor-composition.md](architecture/editor-composition.md) | `createEditor` composition root. |
| Change notifications | [change-notifications.md](architecture/change-notifications.md) | Model, selection and mode events. |
| View sync | [view-sync.md](architecture/view-sync.md) | How the viewport scene follows the model. |
| Viewport camera, grid and snapping | [viewport-camera-grid-snapping.md](architecture/viewport-camera-grid-snapping.md) | Camera, grid and snap logic. |
| Tools | [tools.md](architecture/tools.md) | Tool table, contract and registry; per-tool files linked from it. |
| Actions and hotkeys | [actions-and-hotkeys.md](architecture/actions-and-hotkeys.md) | Action registry and hotkey dispatcher. |
| Modes | [modes.md](architecture/modes.md) | Mode state and capability policy. |
| Dock layout | [dock-layout.md](architecture/dock-layout.md) | Layout tree and dock. |
| Emitter | [emitter.md](architecture/emitter.md) | Shared `Emitter` class. |
| Schema | [schema.md](architecture/schema.md) | Property schema pointer. |
| Validation | [validation.md](architecture/validation.md) | `lib/validate.js`, its geometry helpers and how the editor consumes problems. |
| Model I/O | [model-io.md](architecture/model-io.md) | Load, save, New, migration, canonical serializer and the editor version (#27). |

## Data flow

1. **Authoring:** UI action → command → `history.execute` → model ops → one `change` event → views update their own entries (scene, hierarchy, inspector, timeline, Problems after a debounced `validate(toJson(model))`).
2. **Save:** `saveJson(model, editor.editorVersion())`: `toJson` → `validate` (blocked on errors, listed through `notify`) → `serialize` → `files.saveText` downloads `<name>.rag.json` (+ sprite files, #158) → `history.markSaved()`. **Load:** `editor.loadFrom(read)` (picker or drop) → confirm when dirty → `loadJson(model, text)`: parse JSON → `migrate` → `validate` (rejected on errors, model untouched) → drop unknown fields → `reset` ([Model I/O](architecture/model-io.md#model-io), [Editor composition](architecture/editor-composition.md#editor-composition)).
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
  - **Imports** follow the [Dependency rules](#dependency-rules) and layers (static scan of imports, re-exports, dynamic `import()` and `require()` with a literal specifier; non-relative specifiers such as URLs, bare packages and `node:*` are rejected in `js/`, `lib/` and `demo/`; `tests/` may use `node:*` only). In `tests/`, `vendor/liquidfun.js` may be loaded only by `tests/liquidfun-*.test.js`, and no test may import `demo/` or `vendor/pixi.min.js`. Panel content modules (any `js/panels/*.js` other than the dock modules) may import nothing from `js/panels/`: not each other, and neither `js/panels/layout.js` nor `js/panels/dock.js`, even though `layout.js` is core.
  - **Pure modules** (the `lib/` pure set and the `js/` core) reference none of the globals `document`, `window`, `PIXI`, `Box2D` or any `b2*` name. Property accesses and object keys do not count. The scan is complemented by the load check below.
  - **Main-only globals:** among `js/` modules only `js/main.js` references the `PIXI` and `Box2D` globals; every other module receives them as parameters. Same reference rules as the pure-module check; additionally a name bound by a function parameter (`createViewport(PIXI, host)`) or a `const`/`let`/`var` declaration is not the global within that binding's scope.
  - **Model mutation calls:** `applyOps` and `batch` are called only by `js/commands/history.js`, and `reset` only by `js/model/io.js`. A call is detected only when its receiver is an identifier ending in `model` (`model.reset(…)`, `this.model.batch(…)`, `editor.model?.applyOps(…)`); a call through an alias (`const m = editor.model; m.reset(…)`) or a destructured method is not detected and is left to review. `tests/` is exempt.
  - **Load check (#106):** every pure module present on disk (the `lib/` pure set and the `js/` core; planned modules not on disk are skipped) is imported dynamically under `node --test` with `document`, `window`, `PIXI` and `Box2D` undefined on `globalThis`, before and after loading. A module that touches a global at load time, through an alias the scan cannot see, fails the test with its path and the error. Only load-time access is caught: a global used inside a function that the load does not call is left to the scan and to review.
  - **Comments:** only `/** … */` JSDoc blocks.

  Not automated, checked in review: exports matching the module map, and that modules which need `PIXI`/`Box2D` are actually handed them as parameters.
- **Pull requests:** the PR template has a conformance item. A PR that adds, removes, renames or changes the responsibility or imports of a module updates the module map on the same branch, through the architect, and is reviewed by the architect before merge.
- **Disagreement:** if code needs a module or import this document does not allow, stop and ask the architect; do not merge a deviation.
