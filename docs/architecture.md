# Architecture

> Status: **(planned)**. No implementation exists yet. This document describes the intended structure and is updated as code lands.

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
               │ globals                              │ globals / configure()
        vendor/liquidfun.js                    vendor/pixi.min.js
```

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

Filled in by `doc-writer` as modules are created: one line per module with its responsibility and public exports.
