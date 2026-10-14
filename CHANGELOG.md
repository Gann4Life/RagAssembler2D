# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) once it is released.

## [Unreleased]

### Added
- `DESIGN.md`: complete spec for the editor, the animation model, the `.rag.json` format (v1), the RagImporter API and the demo.
- Repository scaffolding: `README.md`, `CLAUDE.md` (contribution guidelines), `TODO.md`, `docs/` and project agents in `.claude/agents/`.
- Contribution workflow: Conventional Branch, Conventional Commits, Keep a Changelog, and squash merge into `main` as the point where a task closes.
- GitHub backlog workflow:
  - issue templates (task, bug) and a pull request template;
  - a `planner` agent that manages issues, labels and milestones;
  - a `/next` skill that picks the most relevant open issue.
- Test harness: `node --test tests/` runs every `*.test.js` under `tests/` with no dependencies, starting with a RagImporter smoke test.
- Pinned third-party builds in `vendor/`: PIXI.js 8.21.0 and liquidfun.js v1.1.0, with their license files, checksums and provenance in `docs/development.md`.

### Changed
- RagImporter is now specified to reach liquidfun.js through its `Box2D` namespace global (`Box2D.b2World`, …) instead of global `b2*` names, and to accept both libraries through `RagImporter.configure({ Box2D, PIXI })`.
- `TODO.md` is now a generated index of GitHub issues instead of a hand-edited list.
