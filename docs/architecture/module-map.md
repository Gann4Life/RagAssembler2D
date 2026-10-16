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
| `lib/serialize.js` | Canonical writer ([`DESIGN.md` §6.5](../design/06-file-format.md#65-round-trip-guarantee)): keys in the order of `fieldsOf(type, variant)`, only schema fields; arrays in their given order (sorting keys and events is the commands' job, the model already holds them sorted); every number, `json` values (`events[].data`) included, rounded to 1e-5, without trailing zeros, `-0` → `0`; keys inside `json` values in their given order; 2-space indent, arrays of only numbers inline as `[x, y]`, `\n`, final newline. Formats its input only: no validation, no `meta` derivation (done by `toJson`), never mutates it. Expects a document without validation errors (Save validates first); its output for other input is unspecified. Runs in Node. | `serialize(json) → string` | schema | #27 |
| `lib/migrate.js` | Migrates an older format version to the latest through an ordered chain of pure steps ([`DESIGN.md` §6.3](../design/06-file-format.md#63-versioning)). Applies, while one exists, the step whose `from` equals the document's `version`, setting `version` to its `to`; returns the input object itself when no step applies (current version, newer or unknown version, not an object, wrong `format`), so `validate`'s gate reports those. Never mutates its input. Throws `TypeError` only for a malformed chain (a step without `to === from + 1`, or steps not consecutive and ascending), a programming error. `MIGRATIONS` is empty while `FORMAT_VERSION` is 1; tests inject a chain; a test asserts that the last step of `MIGRATIONS` (when any) has `to === FORMAT_VERSION`. Used by the editor loader only. | `migrate(json, chain = MIGRATIONS) → { json, notes }` (`notes`: one English line per applied step, `Migrated from format version N to N+1`), `MIGRATIONS` (frozen), typedef `MigrationStep` (`from`, `to`: integers; `up(json) → object`: pure, returns a new document, never mutates its argument) | schema | #27 |
| `lib/evaluate.js` | Pure animation evaluator: track sampling, interpolation, channel resolution ([`DESIGN.md` §4.3–4.4](../design/04-animation-model.md#43-keys-and-interpolation)). | `sampleTrack`, `evaluateClip`, `resolveChannels`, typedef `ResolvedPose` | schema | #30, #31 |
| `lib/render.js` | PIXI sprites, texture resolver and cache, z order, debug draw. | internal | geometry | #50, #51 |
| `lib/collision.js` | Per-world collision state ([`DESIGN.md` §2.5, §7.5](../design/07-ragimporter.md#75-contact-filter-and-host-integration)): one `JSContactFilter` per world (default rule, self-collision registry keyed by fixture pointer, host predicate), install on first use, `releaseWorld` teardown, instance ids and the `groupIndex` fallback. | internal | — | #49 |

The runtime split (`def`, `instance`, `render`, `collision`) was confirmed by the architect for #44; `ragimporter`, `def` and `instance` are built (see [Module map: lib and tests](module-map-lib-tests.md)). Hosts copy the whole `lib/` folder ([`DESIGN.md` §8](../design/08-integration-workflow.md#8-integration-workflow-separate-js-project)).

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
| `js/tools/polygon.js` | Polygon tool ([`DESIGN.md` §5.5](../design/05-5-tools.md#55-tools)), built with `defineTool`; added to the list in `js/editor.js`. | `polygonTool() → Tool` | tool, commands/*, model, queries, `js/viewport/style.js`, `js/viewport/placement.js` | #15 |
| `js/model/io.js` (remaining) | Built with `toJson` (#145). #27 makes it the model I/O module and the only caller of `model.reset` ([Model I/O](model-io.md#model-io)): `toJson` gains the `editorVersion` parameter, which derives `meta` ([`DESIGN.md` §6.5](../design/06-file-format.md#65-round-trip-guarantee)); `loadJson` parses, migrates, validates, drops unknown fields and resets, or rejects and leaves the model untouched; `newDocument` resets to the empty document; `uidAtPath` maps a problem `path` to a node. Save (`validate` then `serialize`) and the New action (after #124 adds `createEditor({ confirm })`) are wired by their callers, not here. | `toJson(model, editorVersion) → object`, `loadJson(model, text) → LoadResult`, `newDocument(model) → void`, `uidAtPath(model, pointer) → number \| null`, typedef `LoadResult` (`ok`, `errors`, `warnings`, `notes`) | `lib/schema.js` (`FORMAT`, `FORMAT_VERSION`), `lib/migrate.js` (`migrate`), `lib/validate.js` (`validate`), `js/model/model.js` (`ROOT_UID`, `emptyRootSnapshot`) | #27 |
| `js/model/model.js` (#27) | Exports the empty document the constructor builds, so `newDocument` does not redeclare it. | `emptyRootSnapshot() → NodeSnapshot` (root with schema defaults, no children; a new object per call) | unchanged | #27 |
| `js/version.js` | Core. The running editor's version ([`DESIGN.md` §6.5](../design/06-file-format.md#65-round-trip-guarantee)): fetches `version.json` (`cache: 'no-store'`) through the `fetchFn` it is given, so it reads no global. Never rejects: a failed fetch, a non-OK response, bad JSON or a `version` that is not a non-empty string give `{ editorVersion: DEV_VERSION, label: DEV_VERSION }`. Otherwise `editorVersion` is `version` without one leading `v`, and `label` is `version` as given followed by ` · <commit>` when `commit` is a non-empty string (the viewport label of #148). | `loadVersion(fetchFn) → Promise<VersionInfo>`, `DEV_VERSION` (`'dev'`), typedef `VersionInfo` (`editorVersion`, `label`) | — | #27 |
| `js/editor.js` (#27) | `createEditor` gains `editorVersion: () => string` (default `() => DEV_VERSION`), a getter because `version.json` arrives after boot; exposed as `Editor.editorVersion` and passed to the registry as `ToolCore.editorVersion`. Every `toJson` caller with an editor reads it there (Pose, Problems #26, Save #28). | `createEditor({ settings?, physics?, editorVersion? })`, `Editor.editorVersion` | adds `js/version.js` (`DEV_VERSION`) | #27 |
| `js/tools/tool.js`, `js/tools/registry.js` (#27) | `ToolCore.editorVersion` and `ToolContext.editorVersion: () => string` (the registry passes the getter through; `() => DEV_VERSION` when the core has none, as in registry tests). | typedef changes only | `js/tools/registry.js` adds `js/version.js` (`DEV_VERSION`) | #27 |
| `js/tools/pose.js` (#27) | Starts a session with `toJson(ctx.model, ctx.editorVersion())`. | unchanged | unchanged | #27 |

## js/ UI (planned)

| Module | Responsibility | Public exports | Issue |
|---|---|---|---|
| `js/viewport/scene.js` (later issues) | #21 adds sprite entries once the asset store provides textures. | unchanged names | #21 |
| `js/viewport/gizmos.js` (later issues) | The strength fill (#36), contact dots in Simulate mode (#54, which also feeds the live pose), sprite handles (#24); the Problems wiring (#26) feeds `setInvalid`. | unchanged names | #24, #26, #36, #54 |
| `js/panels/assets.js`, `problems.js`, `inspector.js`, `timeline.js` | One panel each ([`DESIGN.md` §5.6–5.8](../design/05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)). The inspector builds its rows from `fieldsOf` ([schema.md](../schema.md)). | `create<Panel>` | #20–#23, #26, #32–#35 |
| `js/main.js` (#27) | Replaces the inline `version.json` read: holds `editorVersion` (starts `DEV_VERSION`), passes `editorVersion: () => editorVersion` to `createEditor`, and calls `loadVersion(fetch)` once at boot to set it and the version label (starts `dev`). | none | #27 |
| `js/physics/pose-session.js` (#27) | `poseTestJson` no longer fills a missing `meta.editorVersion` (`POSE_TEST_EDITOR_VERSION` removed): `toJson` always writes `meta`, with the real version. | unchanged names | #27 |
| `js/storage.js` (draft functions) | Draft autosave and recovery in the built storage module, same failure rules. | `saveDraft`, `loadDraft`, `clearDraft` | #29 |
| `js/files.js` | File and directory pickers, drag & drop (`dragover`/`drop` listeners on `#panel-viewport`, so drops on the Tools overlay load too, [`DESIGN.md` §5.3](../design/05-3-header.md#53-header)), writing `.rag.json` and images. | `pickRagFile`, `pickAssetFolder`, `saveRagFile` | #28 |
| `js/asset-store.js` | Image bytes and PIXI textures by sprite asset id. Not part of the model; entries are kept while any history step can bring their asset back. | `AssetStore` | #21 |
