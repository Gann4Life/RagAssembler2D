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

Tests cover the pure modules: validation, canonical serialization (round-trip), the animation evaluator and event timing.

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
- Commits use an imperative summary and carry no AI attribution.
