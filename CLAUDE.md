# CLAUDE.md

Guidelines for working in this repository. They apply to people and agents alike.

## Project

RagAssembler is a browser-based ragdoll editor. RagImporter is its runtime library, for LiquidFun + PIXI.js.

## Sources of truth

| File | Role |
|---|---|
| `DESIGN.md` | **Spec.** What the product does and why. Changes to behavior, file format or public API start here. |
| `docs/` | **How the code is built.** Architecture, modules, development setup, decisions. Must match the actual codebase. |
| `TODO.md` | Work queue, ordered by roadmap phase (`DESIGN.md` §11). |
| `CHANGELOG.md` | User-visible changes, [Keep a Changelog](https://keepachangelog.com/) format. |

If code and `DESIGN.md` disagree, stop and resolve it: either fix the code, or update the spec through the architect.

## Rules

1. **No AI attribution.** Never add Claude/AI credit anywhere: commit messages, `Co-Authored-By` trailers, "Generated with" lines, file headers, docs or changelog.
2. **No code comments.** Code must explain itself through naming and structure. No `//` or `/* */` notes, no commented-out code, no TODO comments (TODOs go in `TODO.md`).
3. **Docstrings only.** Exported functions, classes, methods and typedefs get valid **JSDoc** (`/** … */` with `@param`, `@returns`, `@throws`, `@typedef`, `@property` as applicable). Keep them short: contract, units and side effects. Anything longer belongs in `docs/`.
4. **English** for code, docs, commits and file content.
5. **Confidentiality.** No client names, credentials, tokens or private data in the repo. Use generic terms and placeholders.

## Code conventions

- Vanilla JavaScript ES modules, no build step, no npm runtime dependencies.
- The only third-party code is `vendor/liquidfun.js` and `vendor/pixi.min.js`, pinned versions.
- Dependency direction (enforced):
  - `js/` (editor) may import `lib/`;
  - `lib/` never imports from `js/` or `demo/`;
  - `demo/` imports only `lib/`.
- Units follow `DESIGN.md` §1: meters, radians and Y up in data and physics; pixels and degrees only in the UI.
- Node 24 is used only for tests (`node --test`) and the local server.

## Workflow

One task at a time, one task per commit:

1. **Pick** the top unchecked item in `TODO.md`.
2. **Spec check:** if the task changes behavior, the file format or the public API, run `architect` first. It updates `DESIGN.md` and `docs/decisions.md`.
3. **Implement** with the matching agent:
   - `javascript-dev` for the editor (`js/`), the runtime (`lib/`) and tests;
   - `game-dev` for `demo/` and real-game integration;
   - `ui-ux-analyst` reviews editor UI work, before (proposal) and after (review).
4. **Verify:** `node --test tests/` and run the app in the browser (`/run`). Use `/code-review` for non-trivial changes.
5. **Sync docs:** `doc-writer` updates `docs/`, `TODO.md` and `CHANGELOG.md` from the actual diff.
6. **Commit:** imperative summary line (e.g. `Add box tool with SHIFT/ALT/CTRL modifiers`), no attribution.

## Commands

```powershell
npx http-server -c-1 .     # serve editor at http://localhost:8080 and demo at /demo/
node --test tests/          # run tests
```
