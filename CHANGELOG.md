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

### Changed
- `TODO.md` is now a generated index of GitHub issues instead of a hand-edited list.
