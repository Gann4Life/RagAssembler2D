# Development

## Requirements
- A Chromium-based browser for the editor. It needs the File System Access API to read and write sprite folders; other browsers fall back to multi-file pickers.
- Node 24, only for the local server and tests.

## Run

```powershell
npx http-server -c-1 .     # editor: http://localhost:8080, demo: http://localhost:8080/demo/
```

ES modules require HTTP. Opening `index.html` from disk does not work.

## Tests

```powershell
node --test tests/
```

- Uses only the built-in `node:test` runner and `node:assert`. No third-party packages and no `package.json`.
- Test files are named `*.test.js` and live anywhere under `tests/`.
- On Node 24, `node --test tests/` does not walk the directory; it loads `tests/` as a module, which resolves to `tests/index.js`. That file is an aggregator that recursively imports every `*.test.js` under `tests/`, so new test files are picked up without registration.
- Bare `node --test` also works: its default glob matches `*.test.js` and does not match `index.js`, so no test runs twice.
- Any failing test makes the command exit with a non-zero code.

Current coverage: `tests/smoke.test.js` checks that `lib/ragimporter.js` loads as an ES module and declares format version 1 as supported. Tests for validation, canonical serialization (round-trip), the animation evaluator and event timing are **(planned)**.

## Vendored libraries

| Library | File | Version |
|---|---|---|
| liquidfun.js | `vendor/liquidfun.js` | TBD (pin in Phase 0) |
| PIXI.js | `vendor/pixi.min.js` | v8, exact release TBD (pin in Phase 0) |

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
