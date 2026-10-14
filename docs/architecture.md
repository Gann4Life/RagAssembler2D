# Architecture

> Status: **(planned)**. Only a stub of `lib/ragimporter.js`, the test harness and the pinned `vendor/` libraries exist (see [Module map](#module-map)). The rest of this document describes the intended structure and is updated as code lands.

## Components

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

`demo/` is a separate host page. It imports only `lib/ragimporter.js` and the vendored libraries.

## Dependency rules

| From | May import |
|---|---|
| `js/` | `lib/`, vendor globals |
| `lib/` | vendor globals only |
| `demo/` | `lib/`, vendor globals |
| `tests/` | `lib/`, pure editor modules (serializer, model) |

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
| `lib/ragimporter.js` | RagImporter entry point. Currently a stub that only declares the supported format versions. | `RagImporter` (frozen object with `supportedVersions: [1]`) |
| `tests/index.js` | Test aggregator for `node --test tests/`: recursively imports every `*.test.js` under `tests/`. | none |
| `tests/smoke.test.js` | Smoke test: `lib/ragimporter.js` loads as an ES module and supports format version 1. | none |
