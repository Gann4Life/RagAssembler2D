# Development

## Requirements
- A Chromium-based browser for the editor. It needs the File System Access API to read and write sprite folders; other browsers fall back to multi-file pickers.
- Node 24, only for the local server and tests.

## Run

```powershell
npx http-server -c-1 .     # editor: http://localhost:8080, demo: http://localhost:8080/demo/
```

ES modules require HTTP. Opening `index.html` from disk does not work. The demo page is **(planned)**.

What the editor shows now (see [Editor boot](architecture.md#editor-boot)):
- A header toolbar across the top: New, Load, Save | Undo, Redo | Play, Pause, Next frame, Stop, and Window, Settings at the right end. Every button is disabled (muted text, tooltip ends with "(not available yet)"), but stays focusable. Tab reaches the toolbar once; Left/Right/Home/End move between buttons. On narrow windows the header scrolls horizontally.
- Below it, an empty dark PIXI viewport that fills the rest of the window and resizes with it. When focused with Tab it shows a blue focus ring.
- If `vendor/pixi.min.js` or `vendor/liquidfun.js` fails to load, the page stays blank and the console shows an error naming the missing library.
- The console also shows `pre-main prep time: 0 ms` from liquidfun.js (see [liquidfun.js](#liquidfunjs)).

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
- `tests/emitter.test.js` checks `lib/emitter.js` (ordering, unsubscribe, error handling, listener validation).
- `tests/schema.test.js` checks `lib/schema.js` (field table against `docs/schema.md`, defaults, channels, clip keys).
- `tests/model.test.js` checks `js/model/model.js` (uids, schema defaults, `applyOps` and `batch` change events and rollback, reset, id allocation, collection rejection in props).

Tests for validation, canonical serialization (round-trip), the animation evaluator and event timing are **(planned)**.

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
