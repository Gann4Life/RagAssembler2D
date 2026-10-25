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
| `lib/geometry.js` (remaining functions) | Added to the built module: the polygon area centroid (#18, [Group, Ungroup and Split](grouping.md)), then the shape local frame when the shape page needs it (#22; `js/tools/resize.js` has a private one to move here). #20 adds nothing: the body page uses the built `bodyMass`. | `polygonCentroid(vertices) → Vec2` (#18), `shapeFrame` (#22) | — | #18, #22 |
| `lib/serialize.js` | Canonical writer ([`DESIGN.md` §6.5](../design/06-file-format.md#65-round-trip-guarantee)): keys in the order of `fieldsOf(type, variant)`, only schema fields; arrays in their given order (sorting keys and events is the commands' job, the model already holds them sorted); every number, `json` values (`events[].data`) included, rounded to 1e-5, without trailing zeros, `-0` → `0`; keys inside `json` values in their given order; 2-space indent, arrays of only numbers inline as `[x, y]`, `\n`, final newline. Formats its input only: no validation, no `meta` derivation (done by `toJson`), never mutates it. Expects a document without validation errors (Save validates first); its output for other input is unspecified. Runs in Node. | `serialize(json) → string` | schema | #27 |
| `lib/render.js` | PIXI sprites, texture resolver and cache, z order, debug draw. | internal | geometry | #50, #51 |
| `lib/collision.js` | Per-world collision state ([`DESIGN.md` §2.5, §7.5](../design/07-ragimporter.md#75-contact-filter-and-host-integration)): one `JSContactFilter` per world (default rule, self-collision registry keyed by fixture pointer, host predicate), install on first use, `releaseWorld` teardown, instance ids and the `groupIndex` fallback. | internal | — | #49 |

The runtime split (`def`, `instance`, `render`, `collision`) was confirmed by the architect for #44; `ragimporter`, `def` and `instance` are built (see [Module map: lib and tests](module-map-lib-tests.md)). Hosts copy the whole `lib/` folder ([`DESIGN.md` §8](../design/08-integration-workflow.md#8-integration-workflow-separate-js-project)).

## js/ core (planned)

| Module | Responsibility | Public exports | Imports (js/) | Issue |
|---|---|---|---|---|
| `js/editor.js` (later issues) | Each remaining tool issue adds its factory to `TOOLS`, which registers its `tool:<id>` action ([Editor composition](editor-composition.md#editor-composition)). | unchanged names | the tool modules | #15, #38 |
| `js/model/queries.js` (later issues) | Adds the sprite users of an asset id to the built module. | `spriteUsers` | model | #21 |
| `js/commands/create.js` (later issues) | Adds polygons to `createShapeBody` (#15), then `createClip` and `importSpriteAssets`. | `createClip`, `importSpriteAssets` | model, queries | #15, #21 |
| `js/commands/group.js` | Group, Ungroup and Split ([Group, Ungroup and Split](grouping.md#group-ungroup-and-split)): the plans of what each operation merges, deletes, redirects or extracts, and their one-step commands, which move shapes between bodies keeping their world placement. | `groupPlan(model, uids) → GroupPlan`, `groupBodies(uids, label = 'Group') → Command`, `ungroupParts(model, uids)`, `ungroupBodies(uids, label = 'Ungroup') → Command`, `splitParts(model, uids)`, `splitShapes(uids, label = 'Split') → Command` (commands' `run` returns the shapes to select), typedefs `GroupPlan`, `SplitPart` | `lib/geometry.js` (`shapeGeometryValid`, `polygonCentroid`), model (`ROOT_UID`), queries (`referencesTo`), `js/commands/delete.js` (`deletionPlan`) | #18 |
| `js/editor.js` (#18) | Registers `group`, `ungroup` and `split` (Edit mode, no gesture, no pending confirmation); `group` asks through `confirm` with a `'group'` request when internal joints would be deleted; each selects the shapes its command returns. `ConfirmRequest.kind` gains `'group'`. | unchanged names | `js/commands/group.js` | #18 |
| `js/hotkeys.js` (#18) | Adds the `Alt+G` → `split` row after `Ctrl+Shift+G`; `matchHotkey` also matches an Alt + letter row by `event.code` when `event.key` is not an ASCII letter. | unchanged names | — | #18 |
| `js/commands/duplicate.js` | Duplicate selection ([Group, Ungroup and Split](grouping.md#jscommandsduplicatejs)): the plan of the whole branches (bodies and their descendants) and joints copied, and the one-step command that appends the copies with new ids and `_copy` names, in place over their sources. | `duplicatePlan(model, uids) → DuplicatePlan`, `duplicateSelection(uids, label = 'Duplicate') → Command` (`run` returns the copies of the selected objects), typedef `DuplicatePlan` | model (`ROOT_UID`), queries (`selectedBodies`, `parentJoints`, `bodySubtree`, `jointChildBody`) | #63 |
| `js/model/queries.js` (#63) | Adds the bodies of a selection and the child body of a joint, shared by `group.js` and `duplicate.js`. | `selectedBodies(model, uids) → number[]`, `jointChildBody(model, jointUid, parents = parentJoints(model)) → number \| null` | model | #63 |
| `js/editor.js` (#63) | Registers `duplicate` (Edit mode, no gesture, no pending confirmation, selection holds a body, a shape or a non-loop joint); copies in place; selects the copies. | unchanged names | `js/commands/duplicate.js` | #63 |
| `js/editor.js`, `js/hotkeys.js` (#187) | Register `set-root-body` (Edit mode, no gesture, no pending confirmation, exactly one body of the selection via `selectedBodies`, not already `rootBody`) and the `Shift+R` row. | unchanged names | `js/commands/root-body.js` | #187 |
| `js/commands/transform.js` (later issues) | Built by #17 with the rigid moves and rotations of body subtrees and joint anchors ([Commands and undo](commands-and-undo.md#commands-and-undo)), used unchanged by #128 (a multi-selection rotation is one `rotationAbout` about the shared pivot); #24 adds sprite offset/angle/scale. Root `position`/`angle` and `aimAxis` are plain `setProps` edits. #20 added the absolute placement of bodies with their subtrees (`placeBodies`, no caller since the Body page became physics-only, kept for the Joint page, #23), and `rotationPivot` moved here unchanged from `js/tools/manipulation.js`, which re-exports it ([Inspector](inspector.md#inspector)). | `manipulationParts`, `transformParts`, `rotationAbout`, `placeParts`, `placeBodies(uids, { x?, y?, angle? }, label = 'Move') → Command`, `rotationPivot(model, bodyUid, center) → Vec2`, typedef `Parts` (built); `editSprite` (#24) | `lib/geometry.js`, model, queries | #24 |
| `js/commands/animation.js` | Tracks, keys and events; keeps keys and events sorted by `t`. | `addTrack`, `removeTrack`, `setKey`, `removeKeys`, `moveKeys`, `addEvent`, `moveEvents` | model | #33–#35, #39 |
| `js/inspector/<type>-page.js` (later pages) | One page module and one `PAGE_BUILDERS` entry per type ([Inspector](inspector.md#inspector)): `shape` (#22), `joint` (#23), `spriteAsset` (#21), `clip` (#172), `key` (#174), `event` (#34); key buttons ◆ (#39) add a row flag, not a page. #22 also adds `InspectorRow.integer` in `js/inspector/rows.js` (schema type `integer`) and the panel rejects decimal text for such rows ([Inspector](inspector.md#open-items-for-later-pages)). | `<type>Page(ctx) → InspectorSection[]` | `js/inspector/rows.js`, model | #21, #22, #23, #34, #172, #174 |
| `js/tools/polygon.js` | Polygon tool ([`DESIGN.md` §5.5](../design/05-5-tools.md#55-tools)), built with `defineTool`; added to the list in `js/editor.js`. | `polygonTool() → Tool` | tool, commands/*, model, queries, `js/viewport/style.js`, `js/viewport/placement.js` | #15 |

## js/ UI (planned)

| Module | Responsibility | Public exports | Issue |
|---|---|---|---|
| `js/viewport/scene.js` (later issues) | #21 adds sprite entries once the asset store provides textures. | unchanged names | #21 |
| `js/viewport/gizmos.js` (later issues) | The strength fill (#36), contact dots in Simulate mode (#54, which also feeds the live pose), sprite handles (#24); the Problems wiring (#26) feeds `setInvalid`. | unchanged names | #24, #26, #36, #54 |
| `js/panels/assets.js`, `problems.js` | One panel each ([`DESIGN.md` §5.6](../design/05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)). | `create<Panel>` | #21, #26 |
| `js/panels/timeline.js` (later issues) | Tracks other than `angle` / `bodyAngle`, events, Duplicate clip, the Copy / Paste / Delete keys buttons and Key selected ([`DESIGN.md` §5.8](../design/05-8-animation-timeline.md#58-animation-timeline)). | unchanged names | #32–#35 |
| `js/storage.js` (draft functions) | Draft autosave and recovery in the built storage module, same failure rules. | `saveDraft`, `loadDraft`, `clearDraft` | #29 |
| `js/asset-store.js` | Image bytes and PIXI textures by sprite asset id. Not part of the model; entries are kept while any history step can bring their asset back. | `AssetStore` | #21 |
