# Development

## Requirements
- A Chromium-based browser for the editor. It needs the File System Access API to read and write sprite folders; other browsers fall back to multi-file pickers.
- Node 24, only for the local server and tests.

## Run

```powershell
npx http-server -c-1 .     # editor: http://localhost:8080, demo: http://localhost:8080/demo/
```

ES modules require HTTP. Opening `index.html` from disk does not work. The demo page is **(planned)**.

What the editor shows now (see [Editor boot](architecture/editor-boot.md#editor-boot)):
- A header toolbar across the top: New, Load, Save | Undo, Redo | Play, Pause, Next frame, Stop, and Window, Settings at the right end. Every button is disabled (muted text, tooltip ends with "(not available yet)"), but stays focusable. Tab reaches the toolbar once; Left/Right/Home/End move between buttons. On narrow windows the header scrolls horizontally.
- Below it, an empty dark PIXI viewport that fills the rest of the window and resizes with it. When focused with Tab it shows a blue focus ring.
- A Tools toolbar floats at the top-left of the viewport: one icon button per tool, in groups, with a tooltip (name and hotkey) on hover or keyboard focus. Tools that are not built yet stay disabled. Up/Down/Left/Right/Home/End move between buttons. On a viewport shorter than 315 px it switches to two columns.
- If `vendor/pixi.min.js` or `vendor/liquidfun.js` fails to load, the page stays blank and the console shows an error naming the missing library.
- The console also shows `pre-main prep time: 0 ms` from liquidfun.js (see [liquidfun.js](#liquidfunjs)).

## Deploy

Every push to `main` runs `.github/workflows/pages.yml`: it runs `node --test tests/` and, only if the tests pass, publishes `index.html`, `css/`, `js/`, `lib/`, `vendor/` and `demo/` (when present) to GitHub Pages at `https://gann4life.github.io/RagAssembler2D/`. There is no build step; the files are served as they are in the repository. The workflow uses the built-in `GITHUB_TOKEN` with Pages permissions, so no secrets are stored. It can also be started by hand from the Actions tab (`workflow_dispatch`). Pages must be set to the "GitHub Actions" source in the repository settings.

Every deploy is also a release. After the tests pass, the uild job (the only one with contents: write) reads the top ## [x.y.z] heading of CHANGELOG.md, fails if tag X.Y.Z already exists on another commit, tags the merge commit, creates a GitHub Release whose notes are that changelog section, and writes ersion.json ({"version":"vX.Y.Z","commit":"<short sha>"}) into the published site. A manual run on a commit whose tag already points at it skips tagging. The editor fetches ersion.json and shows X.Y.Z · <short sha> at the bottom-left of the viewport, or dev when the file is missing (local server). Versions are chosen per PR by doc-writer (see CLAUDE.md, Changelog).

## Tests

```powershell
node --test tests/
```

- Uses only the built-in `node:test` runner and `node:assert`. No third-party packages and no `package.json`.
- Test files are named `*.test.js` and live anywhere under `tests/`.
- On Node 24, `node --test tests/` does not walk the directory; it loads `tests/` as a module, which resolves to `tests/index.js`. That file is an aggregator that recursively imports every `*.test.js` under `tests/`, so new test files are picked up without registration.
- Bare `node --test` also works: its default glob matches `*.test.js` and does not match `index.js`, so no test runs twice.
- Any failing test makes the command exit with a non-zero code.

Current coverage:
- `tests/smoke.test.js` checks that `lib/ragimporter.js` loads as an ES module and declares format version 1 as supported.
- `tests/editor-header.test.js` checks the header's roving-focus key handling, group order, unique action ids, shortcuts and tooltip text. It imports `js/roving-focus.js` and `js/header.js`, which load in Node without a DOM; DOM behavior (`createHeader`, the viewport) is checked in the browser.
- `tests/toolbar.test.js` checks the DOM-free part of the Tools overlay (`js/viewport/toolbar.js`): button groups against `TOOL_SPECS`, icon markup rules, tooltip texts, strip size and column rule, the `VIEWPORT_MIN` height, and `framingInsets` from `js/viewport/bounds.js`. `tests/layout.test.js` also checks that stored layouts naming the removed `tools` panel fall back to the default layout.
- `tests/emitter.test.js` checks `lib/emitter.js` (ordering, unsubscribe, error handling, listener validation).
- `tests/schema.test.js` checks `lib/schema.js` (field table against `docs/schema.md`, defaults, channels, clip keys).
- `tests/model.test.js` checks `js/model/model.js` (uids, schema defaults, `applyOps` and `batch` change events and rollback, reset, id allocation, collection rejection in props).
- `tests/history.test.js`, `tests/props.test.js`, `tests/selection.test.js`, `tests/modes.test.js`, `tests/actions.test.js`, `tests/hotkeys.test.js` and `tests/editor.test.js` check the editor core without a DOM: command stack (transactions, gestures, coalescing, saved point, limit), `setProps`, selection, mode policy, action registry, hotkey matching and dispatch, and the `createEditor` wiring.
- `tests/geometry.test.js`, `tests/units.test.js`, `tests/settings.test.js`, `tests/camera.test.js`, `tests/bounds.test.js`, `tests/grid-lines.test.js` and `tests/snap.test.js` check the pure viewport modules: transforms and shape bounds, UI unit conversions, settings validation and restore, camera pan/zoom/framing, framing bounds, grid line selection and snapping. `tests/storage.test.js` also covers the settings record with a fake `localStorage`. The DOM parts (`js/viewport/input.js`, `js/viewport/scene.js`, `js/settings-dialog.js`) are checked in the browser.
- `tests/placement.test.js`, `tests/hit.test.js` and `tests/tools.test.js` check the displayed-pose placement of bodies and joints, viewport hit testing with the style constants, and the tool contract and registry (activation by mode policy, pointer routing, drag revert on Esc). The gizmo drawing (`js/viewport/gizmos.js`) is checked in the browser.
- `tests/create.test.js` checks `createShapeBody` (snapshot, ids and names, `rootBody`, one undo step, preconditions). `tests/shape-tools.test.js` checks the Circle and Box tools on `createEditor()` with a fake view: draft tables, click and drag creation, grid snap, the drag latch, modifiers, cancellation, a moved and rotated root and the overlay calls on a recording fake. The pointer feel and the overlay drawing are checked in the browser.
- `tests/select-tools.test.js` checks the Select and Select Box tools on `createEditor()` with a bound view built from the real `hitTest` and `boxTest`: click targets (ALT cycling) and modifier tables on a real `Selection`, box selection, the 4 px drag latch, cancellation by Esc, tool switch and mode change, and that nothing is recorded in history. `tests/hit.test.js` and `tests/geometry.test.js` also cover `boxTest` and `shapeGeometryValid`.
- `tests/transform.test.js` checks the transform command of `js/commands/transform.js` (`manipulationParts`, `transformParts`, `rotationAbout`, `placeParts`). `tests/manipulation.test.js` checks the transform target, pivots and the move and rotation drags, and `tests/resize.test.js` the resize handles (`resizeShapes`, `resizeHandles`, `resizedBox`, `resizeCursor`, `startResize`, `drawResizeHandles`, `formatSize`), and `tests/transform-gizmo.test.js` the pure gizmo layout, hit test, drawing and readout formats; the Select transform itself (object drags, handle presses, pivot mode, modes) is covered in `tests/select-tools.test.js`. The pointer feel and the overlay drawing are checked in the browser.
- `tests/queries.test.js` checks the joint graph queries (`jointTree`, `jointBetween`, `orderJointBodies`, `parentJoints`, `bodySubtree`) on small models. `tests/hinge-tool.test.js` checks `hingePair`, `hingeLimit` and the Hinge Joint tool on `createEditor()` with a fake view: click and drag creation, grid snap, limits, refusals, undo, cancellation, cursor and overlay calls. `createJoint` is checked in `tests/create.test.js`. The pointer feel and the overlay drawing are checked in the browser.
- `tests/delete.test.js` checks `deletionPlan` and `deleteObjects` (cascade, tracks, `rootBody` reassignment, one undo step with an exact restore). `tests/hierarchy.test.js` checks the Hierarchy tree model (`hierarchyTree`, `hierarchyRows`, `fuzzyMatch`, `ancestorKeys`) and `tests/tree-nav.test.js` checks `treeKey`. `tests/queries.test.js` also covers `jointEdges` and `referencesTo`, `tests/create.test.js` unassigned joints, and `tests/editor.test.js` the `delete`, `add-shape` and `add-joint` actions. The panel DOM (`js/panels/hierarchy.js`) is checked in the browser.
- `tests/liquidfun-api.test.js` loads `vendor/liquidfun.js` in Node and checks the API surface RagImporter uses and the heap rules of `DESIGN.md` §7.4 (20,000 create/destroy cycles, 10⁶ vector-setter calls). `vendor/liquidfun.js` in Node and checks the API surface RagImporter uses and the heap rules of `DESIGN.md` §7.4 (20,000 create/destroy cycles, 10⁶ vector-setter calls).
- `tests/liquidfun-contact-filter.test.js` loads `vendor/liquidfun.js` in Node and checks the contact filter behavior RagImporter relies on ([`DESIGN.md` §7.5](design/07-ragimporter.md#75-contact-filter-and-host-integration)): the JS filter replaces the default rule, the reimplementation of that rule, per-shape self-collision, replacement and uninstall, one filter across worlds, the `groupIndex` fallback and filter cost.
- `tests/ragimporter.test.js` checks `parse`, `RagFormatError`, `RagDef` and `configure` with stub namespaces (no liquidfun.js). `tests/liquidfun-spawn.test.js` loads `vendor/liquidfun.js` with a PIXI stub and checks spawn, `flipX`, lookups, `destroy`, heap stability and rollback. `tests/helpers/rag-file.js` builds the small `.rag.json` documents they use.
- **Shared state across test files:** `node --test tests/` loads every file through `tests/index.js` in one process, so `RagImporter.configure` state and the liquidfun.js heap are shared. Tests that call `configure` must reset it with `configure({ Box2D: null, PIXI: null })` when they end, and every world must be destroyed (see Native worlds in tests below).
- **Locked world in tests:** `world.IsLocked()` is true only inside `world.Step`. To test it, install a `Box2D.JSContactListener` whose `BeginContact` calls `spawn` or `destroy` while stepping two overlapping bodies, catch the error there and rethrow it after the step; remove the listener with `world.SetContactListener(null)` before destroying the world.
- `tests/architecture.test.js` runs the conformance checks below on the real sources; `tests/architecture-checks.test.js` proves each check fails on an in-memory violation. Helpers live in `tests/helpers/` (`scan.js`: tokenizer and import scanner; `architecture.js`: checks).
- **Native worlds in tests:** the heap is a fixed 16 MiB and is not reclaimed by garbage collection. Every test that creates a `b2World` must destroy it (and any filter it installed) before it ends. About 15 live worlds exhaust the heap and abort `Step` ([`DESIGN.md` §7.4](design/07-ragimporter.md#74-native-memory)).

### Architecture conformance checks

The checks scan `js/`, `lib/`, `demo/` and `tests/` (never `vendor/`) with a small tokenizer that skips strings, templates, regex literals and comments. A violation is reported as `path:line: message`. Checks on modules that do not exist yet pass trivially and start applying when the files appear.

- **Layers are read from `docs/architecture.md`:** the Core row of the layers table (a `/*` entry matches a folder), the `Pure:` and `Runtime:` lines inside the first code block after the `Components` heading, ignoring any other occurrence in the document (`lib/<name>.js`), and the `js/` modules named in the `tests/` row of the dependency table (UI modules tests may import). Every other `js/` file is UI. Editing those parts of the document changes the checks; the test fails if they cannot be parsed. Only the panel-module rule (`js/panels/*.js` other than `layout.js` and `dock.js`) is fixed in code.
- **Imports:** `lib/` imports only `lib/`; `demo/` imports only `demo/`, `vendor/` and `lib/ragimporter.js`; `js/` imports only `lib/` and `js/`; a core module imports only `lib/` and core modules; a panel module imports no other `js/panels/` module (the dock modules included); `tests/` import no `js/` UI module except the listed ones, no `demo/` and no `vendor/pixi.min.js`, and only `tests/liquidfun-*.test.js` load `vendor/liquidfun.js`. Static, re-export, dynamic `import('…')` and `require('…')` with a string argument are scanned. In `js/`, `lib/` and `demo/` any import that is not relative or root-absolute (URL, bare package, `node:*`) is a violation; `tests/` may import only relative paths and `node:*` built-ins.
- **Globals:** a pure module (the `lib/` pure set and the `js/` core) may not name `document`, `window`, `PIXI`, `Box2D` or a `b2*` identifier. Property accesses (`x.document`) and object keys are not references.
- **Main-only globals:** a `js/` module other than `js/main.js` may not name `PIXI` or `Box2D`, except as a function parameter or a `const`/`let`/`var` binding (`createViewport(PIXI, host)`), which is allowed within its scope. Property accesses and object keys are not references.
- **Model mutation:** outside `tests/`, `.applyOps(` and `.batch(` may be called only in `js/commands/history.js`, and `.reset(` only in `js/model/io.js`. A call counts when its receiver is an identifier ending in `model` (`model.reset(…)`, `this.model.batch(…)`); other receivers such as `dock.reset()` are not model calls.
- **Load check:** `tests/architecture.test.js` also imports every pure module on disk (the `lib/` pure set and the `js/` core) with `document`, `window`, `PIXI` and `Box2D` undefined, so a module that touches one at load time fails the suite, naming the module and the error. Modules not on disk yet are skipped. It cannot see globals used only inside functions the load does not call.
- **Comments:** only `/** … */` blocks are allowed; any `//` or `/* */` comment fails.

- `tests/validate.test.js` covers `lib/validate.js` and `RagImporter.validate` against [`DESIGN.md` §6.4](design/06-file-format.md#64-validation); `tests/geometry.test.js` covers `polygonProblems`.

Tests for canonical serialization (round-trip), the animation evaluator and event timing are **(planned)**.

## Vendored libraries

Both files are loaded with plain `<script>` tags, as served, with no build step. Neither is fetched from a CDN at runtime.

| Library | File | Version | Source | SHA-256 | Size | License |
|---|---|---|---|---|---|---|
| liquidfun.js | `vendor/liquidfun.js` | v1.1.0 (doebi/liquidfun.js release tag `v1.1.0`, commit `25dc77a88e3a99491af3e67f3d50569eb9adfa1b`) | Release asset `liquidfun_v1.1.0.min.js`, renamed: https://github.com/doebi/liquidfun.js/releases/download/v1.1.0/liquidfun_v1.1.0.min.js | `5D6BC9A3BA5D66409CDE01BC3DFEACE01F68EBE0F77746E6C5971322033C9289` | 1,519,142 bytes | Zlib (Box2D / LiquidFun). Notice kept in `vendor/LICENSE-liquidfun.txt`. |
| PIXI.js | `vendor/pixi.min.js` | 8.21.0 (npm, published 2026-09-17) | `package/dist/pixi.min.js` from https://registry.npmjs.org/pixi.js/-/pixi.js-8.21.0.tgz | `C6D9D4C897B15576CCE0055D0BA4382021181C99CDF08A446BE9D61E16833DB0` | 828,321 bytes | MIT. The license header in the file must stay; full text in `vendor/LICENSE-pixi.txt`. |

### liquidfun.js

- The build is the Emscripten (asm.js) port by doebi. The same file, byte for byte, is used by the reference demo at https://github.com/doebi/liquidfun.js-demo (`js/lib/liquidfun_v1.1.0.min.js`, commit `22d921c6925de8cb2cfea646078a026a0ff4a32f`).
- It compiles google/liquidfun at submodule commit `0708ce1464b0db3cf34353258ce939a82f28a173`. The notice file is `liquidfun/Box2D/License.txt` from that commit.
- The doebi/liquidfun.js repository declares no license of its own. It ships only the Box2D notice (`NOTICE`).
- **API exposure:** loading the script defines a single global, `Box2D`. The classes live on it (`Box2D.b2World`, `Box2D.b2Vec2`, `Box2D.b2RevoluteJointDef`, …). There are **no** global `b2World` / `b2Vec2`. Fields use WebIDL accessors (`bd.set_type(Box2D.b2_dynamicBody)`, `body.GetPosition().get_y()`).
- The file is self-contained: no `.mem` or `.wasm` side file is requested.
- **Heap:** fixed 16 MiB that cannot grow; objects created with `new Box2D.*` stay until `Box2D.destroy`. Rules: [`DESIGN.md` §7.4](design/07-ragimporter.md#74-native-memory).
- Under Node it installs a `process.on('uncaughtException')` handler as a side effect of loading.
- On load it writes `pre-main prep time: 0 ms` with `console.log`. This is informational, not an error.

### PIXI.js

- The file is the browser IIFE build: it defines `globalThis.PIXI` (`var PIXI=(function(d){…})({})`) and has no ES module exports.
- It contains default jsDelivr URLs for the Basis and KTX2 transcoders. They are fetched only when loading `.basis` / `.ktx2` compressed textures. Hosts that use those formats must point the transcoder paths at local copies.
- API check against `DESIGN.md` §7 (headless Edge, 2026-10-14):

| API | Result |
|---|---|
| `PIXI.VERSION` | `8.21.0` |
| `PIXI.Application` + `await app.init()` | function; init succeeds with the WebGL renderer |
| `PIXI.Assets` (`load`, `get`) | object with both functions |
| `Container.sortableChildren` / `zIndex` | children reorder by `zIndex` after `sortChildren()` |
| `eventMode` + `pointermove` | `eventMode = 'static'` is kept, and a `pointermove` listener fires |
| `PIXI.Texture.from`, `PIXI.Graphics`, `PIXI.EventSystem` | present |

### Updating a vendored library

1. Download into an empty scratch folder outside the repository and verify the source checksum (npm `dist.integrity` for PIXI.js).
2. Compute the SHA-256 (`Get-FileHash <file> -Algorithm SHA256`), copy only the distributable file into `vendor/`, and update the table above.
3. Load both files from a static page served by `npx http-server -c-1 .` and check that the console shows no errors.

## Documentation style
- No code comments. Exported API gets valid JSDoc only:

```js
/**
 * Resolves every channel of a ragdoll at the current clip times.
 * @param {RagDef} def Parsed ragdoll definition.
 * @param {ActiveClip[]} active Active clips ordered by layer, lowest first.
 * @returns {ResolvedPose} Joint targets in radians and multipliers in 0–1.
 */
export function evaluate(def, active) { … }
```

- Explanations longer than a docstring go in `docs/`.
- Branches, commits and changelog follow the conventions in `CLAUDE.md` (Conventional Branch, Conventional Commits, Keep a Changelog). No AI attribution.
