# Documentation

`DESIGN.md` (repo root) is the index of the **spec** (one file per section in [design/](design/00-overview.md)): what the product does. The documents here describe **how the code implements it** and must match the current codebase.

| Document | Contents |
|---|---|
| [architecture.md](architecture.md) | Overview, dependency rules, data flow and an index of the topic files in `architecture/` (module map, editor core). |
| [schema.md](schema.md) | Property schema of every format object: types, defaults, ranges, units, canonical order. |
| [development.md](development.md) | Setup, local server, tests, vendored libraries, docstring style. |
| [decisions.md](decisions.md) | Index of the dated decision logs in `decisions/`, one file per area. |

`doc-writer` keeps these files, `TODO.md` and `CHANGELOG.md` in sync with the code. Read only the file you need from the indexes. Sections that describe planned code are marked **(planned)** until it exists.
