# Module map

Columns: responsibility, public exports, and allowed imports beyond `lib/`. Rows marked **(planned)** do not exist yet; the issue that creates each one is given.

## Built

- [Module map: editor core](module-map-editor-core.md)
- [Module map: tools and UI](module-map-tools-ui.md)
- [Module map: lib and tests](module-map-lib-tests.md)

## lib/ (planned)

A module whose functions serve several issues is created by the first of them to land, with only the functions it needs; later issues add theirs and update this row.

| Module | Responsibility | Public exports | Imports | Issue |
|---|---|---|---|---|
| `lib/geometry.js` (remaining functions) | Added to the built module: centroid and the shape local frame (#20). | `polygonCentroid`, `shapeFrame` (#20) | — | #20 |
| `lib/serialize.js` | Canonical writer: schema key order, numbers rounded to 1e-5, `-0` → `0`, 2-space indent, `\n`, final newline ([`DESIGN.md` §6.5](../design/06-file-format.md#65-round-trip-guarantee)). | `serialize(json) → string` | schema | #27 |
| `lib/migrate.js` | Migrates older format versions to `FORMAT_VERSION`; throws on unknown versions. Used by the editor loader only. | `migrate(json) → { json, notes }` | schema | #27 |
| `lib/evaluate.js` | Pure animation evaluator: track sampling, interpolation, channel resolution ([`DESIGN.md` §4.3–4.4](../design/04-animation-model.md#43-keys-and-interpolation)). | `sampleTrack`, `evaluateClip`, `resolveChannels`, typedef `ResolvedPose` | schema | #30, #31 |
| `lib/ragimporter.js` | Public entry. #44: `configure({ Box2D, PIXI })` keeps the injected namespaces in module state (`undefined` keeps, `null` clears); `parse(json)` calls `validate`, throws `RagFormatError` on errors, else returns `new RagDef(json, resolveLibraries)`; `resolveLibraries() → { Box2D, PIXI }` (configured value, else `globalThis.Box2D` / `globalThis.PIXI`, else `Error` naming the library) is module-private and passed to every def, so this stays the only module that reads the globals. #49 adds `contactFilter`, `setContactFilter`, `releaseWorld`. | `RagImporter` (frozen: `configure`, `parse`, `validate`, `supportedVersions`), `RagFormatError` | all `lib/` (#44: validate, def) | #25, #44, #49 |
| `lib/def.js` | `RagDef`: copies and deep-freezes the validated JSON it needs (no unknown or editor-only fields except `editor.color`), `name`, `pixelsPerMeter`, `clips`, `spriteUrls`, `spawn(world, opts)` per [§7.2](../design/07-ragimporter.md#72-spawn-and-flipx) (frames, build order, one scratch `b2Vec2`, polygon vertex buffer, every def and shape destroyed after use, each joint cast once to `b2RevoluteJoint`, rollback on failure through `destroyNatives`). The constructor is internal: hosts get a `RagDef` only from `parse`. | `RagDef`, typedefs `SpawnOptions`, `Libraries` | geometry, instance | #44 |
| `lib/instance.js` | `RagInstance`: #44 builds lookups (`body`, `joint`, `shape` by first name in file order; `bodies`, `joints` maps), `position`, `angle`, `destroyed`, `on`/`off` over an `Emitter`, and `destroy` (joints before bodies, view removed and destroyed, listeners cleared). Seams for later issues: #49 removes registry entries at the start of `destroy`; #45–#48 add playback, overrides and the motor controller in `update` (motors enabled there), clearing their state in `destroy`; #50 adds sprites and `sync`. `update` and `sync` allocate nothing; [§7.4](../design/07-ragimporter.md#74-native-memory). | `RagInstance` (constructed by `spawn` only), `destroyNatives(world, joints, bodies)` (internal: destroys joints, then bodies, then clears both maps; used by `destroy` and by spawn rollback) | emitter, evaluate, geometry, render, collision (#44: emitter) | #44–#48 |
| `lib/render.js` | PIXI sprites, texture resolver and cache, z order, debug draw. | internal | geometry | #50, #51 |
| `lib/collision.js` | Per-world collision state ([`DESIGN.md` §2.5, §7.5](../design/07-ragimporter.md#75-contact-filter-and-host-integration)): one `JSContactFilter` per world (default rule, self-collision registry keyed by fixture pointer, host predicate), install on first use, `releaseWorld` teardown, instance ids and the `groupIndex` fallback. | internal | — | #49 |

The runtime split (`def`, `instance`, `render`, `collision`) was confirmed by the architect for #44. Tests: `tests/ragimporter.test.js` (parse, `RagFormatError`, `RagDef` fields, `configure` and missing-library errors with stub namespaces; no liquidfun.js) and `tests/liquidfun-spawn.test.js` (spawn, `flipX`, lookups and `destroy` on the real `vendor/liquidfun.js` with a PIXI stub; the `liquidfun-` prefix is what lets it load the vendored build). Hosts copy the whole `lib/` folder ([`DESIGN.md` §8](../design/08-integration-workflow.md#8-integration-workflow-separate-js-project)).

## js/ core (planned)

| Module | Responsibility | Public exports | Imports (js/) | Issue |
|---|---|---|---|---|
| `js/editor.js` (later issues) | Each remaining tool issue adds its factory to `TOOLS`, which registers its `tool:<id>` action ([Editor composition](editor-composition.md#editor-composition)). | unchanged names | the tool modules | #15, #38 |
| `js/model/queries.js` (later issues) | Adds the sprite users of an asset id to the built module. | `spriteUsers` | model | #21 |
| `js/commands/create.js` (later issues) | Adds polygons to `createShapeBody` (#15), then `createClip` and `importSpriteAssets`. | `createClip`, `importSpriteAssets` | model, queries | #15, #21 |
| `js/commands/group.js` | Group / Ungroup. | `group`, `ungroup` | model, queries | #18 |
| `js/commands/duplicate.js` | Duplicate selection. | `duplicate` | model, queries | #63 |
| `js/commands/transform.js` (later issues) | Built by #17 with the rigid moves and rotations of body subtrees and joint anchors ([Commands and undo](commands-and-undo.md#commands-and-undo)), used unchanged by #128 (a multi-selection rotation is one `rotationAbout` about the shared pivot); #24 adds sprite offset/angle/scale. Root `position`/`angle` and `aimAxis` are plain `setProps` edits. | `manipulationParts`, `transformParts`, `rotationAbout`, `placeParts`, typedef `Parts` (built); `editSprite` (#24) | `lib/geometry.js`, model, queries | #24 |
| `js/commands/animation.js` | Tracks, keys and events; keeps keys and events sorted by `t`. | `addTrack`, `removeTrack`, `setKey`, `removeKeys`, `moveKeys`, `addEvent`, `moveEvents` | model | #33–#35, #39 |
| `js/tools/pose.js`, `polygon.js` | One tool each ([`DESIGN.md` §5.5](../design/05-5-tools.md#55-tools)), built with `defineTool`; each issue adds its tool to the list in `js/editor.js`. | Factories `poseTool()`, `polygonTool()`, each `→ Tool` | tool, commands/*, model, queries, `js/viewport/style.js`, `js/viewport/placement.js` | #15, #38 |

## js/ UI (planned)

| Module | Responsibility | Public exports | Issue |
|---|---|---|---|
| `js/viewport/scene.js` (later issues) | #21 adds sprite entries once the asset store provides textures. | unchanged names | #21 |
| `js/viewport/gizmos.js` (later issues) | The strength fill (#36), contact dots in Simulate mode (#54, which also feeds the live pose), sprite handles (#24); the Problems wiring (#26) feeds `setInvalid`. | unchanged names | #24, #26, #36, #54 |
| `js/panels/assets.js`, `problems.js`, `inspector.js`, `timeline.js` | One panel each ([`DESIGN.md` §5.6–5.8](../design/05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)). The inspector builds its rows from `fieldsOf` ([schema.md](../schema.md)). | `create<Panel>` | #20–#23, #26, #32–#35 |
| `js/storage.js` (draft functions) | Draft autosave and recovery in the built storage module, same failure rules. | `saveDraft`, `loadDraft`, `clearDraft` | #29 |
| `js/files.js` | File and directory pickers, drag & drop (`dragover`/`drop` listeners on `#panel-viewport`, so drops on the Tools overlay load too, [`DESIGN.md` §5.3](../design/05-3-header.md#53-header)), writing `.rag.json` and images. | `pickRagFile`, `pickAssetFolder`, `saveRagFile` | #28 |
| `js/asset-store.js` | Image bytes and PIXI textures by sprite asset id. Not part of the model; entries are kept while any history step can bring their asset back. | `AssetStore` | #21 |
