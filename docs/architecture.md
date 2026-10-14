# Architecture

> Status: partly built. The editor shell (header toolbar and an empty PIXI viewport), a stub of `lib/ragimporter.js`, the test harness and the pinned `vendor/` libraries exist (see [Module map](#module-map)). Everything else in this document is **(planned)** and is updated as code lands.

## Components

Built today: the Header and an empty Viewport. The other panels, the document model, command stack, serializer and modes are **(planned)**.

```
┌──────────────────────── Editor (index.html, js/) ────────────────────────┐
│  Panels: Header · Tools · Viewport · Hierarchy · Assets · Problems ·     │
│          Inspector · Timeline                                            │
│  Document model ──▶ Command stack (undo/redo) ──▶ Serializer (.rag.json) │
│  Modes: Edit · Animate (FK preview) · Simulate                           │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ imports
┌──────────────────────────────▼──── lib/ragimporter.js ───────────────────┐
│  validate · parse → RagDef · evaluator (pure) · spawn → RagInstance      │
│  motor controller · procedural overrides · events · PIXI sprite sync     │
└──────────────┬──────────────────────────────────────┬────────────────────┘
               │ Box2D global / configure()           │ PIXI global / configure()
        vendor/liquidfun.js                    vendor/pixi.min.js
```

RagImporter reaches liquidfun.js only through the `Box2D` namespace (no global `b2*` names) and PIXI.js through `PIXI`; either can be injected with `RagImporter.configure({ Box2D, PIXI })` **(planned)** ([`DESIGN.md` §7](../DESIGN.md)). Both libraries are pinned in `vendor/` ([Vendored libraries](development.md#vendored-libraries)).

`demo/` is a separate host page **(planned)**. It imports only `lib/ragimporter.js` and the vendored libraries.

## Editor boot

1. `index.html` loads `css/editor.css`, then the vendored libraries as classic scripts: `vendor/pixi.min.js` (defines `PIXI`) and `vendor/liquidfun.js` (defines `Box2D`).
2. It loads `js/main.js` as the only module script. The markup holds a placeholder `<header id="header">` and `<main id="workspace">` with the viewport panel (`#panel-viewport` > `#viewport-host`, `role="group"`, `tabindex="0"`, labelled "Viewport"; [`DESIGN.md` §5.4](../DESIGN.md#54-viewport)).
3. `js/main.js` reads the `PIXI` and `Box2D` globals and throws an `Error` naming the missing library and its `vendor/` file. The error only reaches the console; the page stays blank.
4. It replaces the placeholder with `createHeader(document)`: a toolbar with every action disabled ([`DESIGN.md` §5.3](../DESIGN.md#53-header)).
5. It awaits `createViewport(PIXI, #viewport-host)`: a PIXI `Application` whose canvas fills the host. A `ResizeObserver` resizes the renderer to the host size in CSS pixels, using the current `devicePixelRatio`.

`Box2D` is checked but not used yet. No editor state, command stack or modes exist; `js/editor.js` is an empty file reserved for them ([`DESIGN.md` §9](../DESIGN.md#9-project-layout)). Nothing listens to the header's `header-action` event yet.

## Dependency rules

| From | May import |
|---|---|
| `js/` | `lib/`, vendor globals |
| `lib/` | vendor globals only |
| `demo/` | `lib/`, vendor globals |
| `tests/` | `lib/`, editor modules that load without a DOM (today `js/roving-focus.js` and `js/header.js`; serializer and model **(planned)**) |

Pure modules (validation, evaluator, serializer) must not touch the DOM, PIXI or LiquidFun, so they can run under `node --test`.

## Data flow

1. **Authoring:** UI action → command → document model → views re-render (viewport, hierarchy, inspector, timeline).
2. **Save:** document model → canonical serializer → `.rag.json` (+ sprite files). **Load** reverses it: validate → migrate → model.
3. **Animate mode:** model clips → evaluator at the playhead → FK pose and sprite channels → viewport.
4. **Simulate mode / runtime:** RagDef → spawn in a LiquidFun world → each step:

```
rag.update(dt)    advance clips, fire events, resolve channels + overrides, write motors and textures
world.Step(dt)    LiquidFun integrates
rag.sync()        body transforms → PIXI sprites
```

## Module map

One line per module: responsibility and public exports. Modules not listed here do not exist yet.

| Module | Responsibility | Public exports |
|---|---|---|
| `index.html` | Editor page: loads `css/editor.css`, the vendored libraries as classic scripts and `js/main.js` as the only module; holds the header placeholder and the viewport panel markup. | none |
| `css/editor.css` | Editor styles: dark theme variables, full-height grid layout, header toolbar (no wrapping, horizontal scroll, Workspace group pushed right), muted disabled buttons, viewport focus ring drawn above the canvas. | none |
| `js/main.js` | Editor bootstrap: checks the `PIXI` and `Box2D` globals, mounts the header and creates the viewport. | none |
| `js/editor.js` | Empty. Reserved for editor state, command stack and modes **(planned)**. | none |
| `js/header.js` | Header toolbar: grouped action list, roving-tabindex keyboard navigation, `aria-disabled` buttons with tooltips, and a bubbling `header-action` CustomEvent (`detail.action`) on clicks of enabled buttons. | `HEADER_GROUPS`, `createHeader`, `actionTitle`, `setActionEnabled`, typedef `HeaderAction` |
| `js/roving-focus.js` | Pure key-to-index mapping for roving-tabindex toolbars (Left/Right wrap, Home/End). | `rovingIndex` |
| `js/viewport.js` | PIXI viewport: creates an `Application` in a host element and keeps the renderer sized to the host and `devicePixelRatio`. | `createViewport`, typedef `Viewport` (`app`, `destroy`) |
| `lib/ragimporter.js` | RagImporter entry point. Currently a stub that only declares the supported format versions. | `RagImporter` (frozen object with `supportedVersions: [1]`) |
| `tests/index.js` | Test aggregator for `node --test tests/`: recursively imports every `*.test.js` under `tests/`. | none |
| `tests/smoke.test.js` | Smoke test: `lib/ragimporter.js` loads as an ES module and supports format version 1. | none |
| `tests/editor-header.test.js` | Header tests: `rovingIndex` navigation, header group order and unique ids against `DESIGN.md` §5.3, shortcuts against §5.9, and `actionTitle` text. | none |
