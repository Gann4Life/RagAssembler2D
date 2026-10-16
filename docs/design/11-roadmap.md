# 11. Roadmap and acceptance criteria

| Phase | Scope | Done when |
|---|---|---|
| 1. Editor – rigging | Panels, header, PIXI viewport, tools, hierarchy, assets, sprites and sprite edit, inspector, undo/redo, validation + Problems, save/load with sprites | The demo humanoid can be built from scratch with sprites and saved/loaded. |
| 2. Editor – animation | Timeline, clips, tracks (including `sprite`), keys, events, FK preview, autokey, preview stack. The evaluator is written in `lib/` (`lib/evaluate.js`, pure, no physics) | The canonical clips can be authored and scrubbed, with face swaps. |
| 3. Round-trip verification | Tests over a fixture set (humanoid, groups, polygons, sprites, all channels, additive clips, events) | Load → save is byte-identical for every valid fixture (canonical, saved with the fixture's `meta.editorVersion` passed as the editor version, §6.5). Each invalid fixture is rejected with the expected error. The evaluator gives the hand-computed values from §4.6. |
| 4. RagImporter runtime | Spawn, motor controller, layers/fades/queues, events, procedural overrides, flipX, PIXI sprite sync, self-collision. Editor Simulate mode and procedural preview run on it | Editor Simulate and a host page show the same behavior. The event tests pass (no missed or duplicated events with large `dt` and loop wraps). `lookAt` respects limits and `dead`. |
| 5. Demo | §10 | Every control works with the exported asset, and no editor code is imported. |
