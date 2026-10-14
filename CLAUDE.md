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

## Git conventions

### Branches: [Conventional Branch](https://conventional-branch.github.io/)
- **One task, one branch**, always created from an up-to-date `main`. Never commit directly to `main`.
- Format: `<type>/<short-description>`. Lowercase, hyphen-separated, no other punctuation (dots allowed only in release versions).

| Type | Use |
|---|---|
| `feature/` | New functionality, e.g. `feature/box-tool` |
| `bugfix/` | Bug fixes, e.g. `bugfix/timeline-scrub-snap` |
| `hotfix/` | Urgent fix for a released version |
| `release/` | Release preparation, e.g. `release/v0.1.0` |
| `chore/` | Docs, tooling, dependencies, refactors without behavior change, e.g. `chore/pin-pixi` |

### Commits: [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/)
- Format: `<type>(<scope>): <description>`, imperative and lower-case, without a trailing period, e.g. `feat(editor): add box tool with shift/alt/ctrl modifiers`.
- **Types:** `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `style`, `revert`.
- **Scopes:**
  - `editor` (`js/`, `index.html`);
  - `runtime` (`lib/`);
  - `format` (`.rag.json` schema, validation, serializer);
  - `demo`;
  - `tests`;
  - `docs`;
  - `deps` (`vendor/`).
- **Breaking changes:** `!` after the type/scope plus a `BREAKING CHANGE:` footer. This is required for any incompatible change to the RagImporter public API or the file format; file format breaks also bump the format `version` (`DESIGN.md` §6.3).
- No AI attribution in subject, body or trailers.

### Changelog: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
- Every branch with user-visible changes adds entries under `## [Unreleased]`, before merging. Sections: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
- Entries are written for users, one line each. They are not commit messages.
- Releases rename `[Unreleased]` to `## [x.y.z] - YYYY-MM-DD` on a `release/` branch. Versions follow [SemVer](https://semver.org/) derived from commits: `feat` → minor, `fix` → patch, breaking → major. Before 1.0.0, breaking changes bump the minor.

## Workflow

A task **closes when its branch is merged into `main`**. Until then it is open, and its `TODO.md` item stays unchecked on `main`.

1. **Pick** the top unchecked item in `TODO.md`, then create its branch from `main`.
2. **Spec check:** if the task changes behavior, the file format or the public API, run `architect` first. It updates `DESIGN.md` and `docs/decisions.md` on the same branch.
3. **Implement** with the matching agent, in conventional commits:
   - `javascript-dev` for the editor (`js/`), the runtime (`lib/`) and tests;
   - `game-dev` for `demo/` and real-game integration;
   - `ui-ux-analyst` reviews editor UI work, before (proposal) and after (review).
4. **Verify:** `node --test tests/` and run the app in the browser (`/run`). Use `/code-review` for non-trivial changes.
5. **Sync docs:** `doc-writer` updates `docs/`, `TODO.md` (checks the item off) and `CHANGELOG.md` from the branch diff, and commits it as `docs: …`.
6. **Merge:** squash-merge into `main` with a single conventional commit message that summarizes the task, then delete the branch. The task is now closed.

```powershell
git switch main
git merge --squash feature/box-tool
git commit -m "feat(editor): add box tool with shift/alt/ctrl modifiers"
git branch -D feature/box-tool
```

`git branch -D` is required after a squash merge, because Git does not recognize the branch as merged.

### Definition of done (checked before merging)
- Behavior matches `DESIGN.md`, or `DESIGN.md` was updated by the architect on this branch.
- Tests pass, and the change was exercised in the browser when it touches the UI or runtime.
- No code comments; exported API has JSDoc.
- `TODO.md`, `CHANGELOG.md` and `docs/` reflect the change.
- Branch name, commits and the squash message follow the conventions above.

## Commands

```powershell
npx http-server -c-1 .     # serve editor at http://localhost:8080 and demo at /demo/
node --test tests/          # run tests
```
