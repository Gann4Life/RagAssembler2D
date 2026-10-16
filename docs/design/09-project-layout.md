# 9. Project layout

```
index.html                 editor entry point
js/main.js                 editor bootstrap
js/editor.js               editor composition root (model, commands, modes, tools)
js/…                       model, commands, tools, viewport, panels
lib/ragimporter.js         runtime public entry: validate, parse, spawn, drive, render sync
lib/…                      runtime and shared pure modules (schema, emitter, validation, serializer, evaluator)
docs/                      how the code is built; the module map is docs/architecture.md
vendor/liquidfun.js        physics engine build (editor and demo)
vendor/pixi.min.js         PIXI.js build, pinned version (editor and demo)
tests/                     round-trip and evaluator tests (Node, ES modules)
demo/                      production preview (§10)
```
