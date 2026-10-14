# Documentation

`DESIGN.md` (repo root) is the **spec**: what the product does. The documents here describe **how the code implements it** and must match the current codebase.

| Document | Contents |
|---|---|
| [architecture.md](architecture.md) | Modules, dependency rules, data flow, runtime loop. |
| [schema.md](schema.md) | Property schema of every format object: types, defaults, ranges, units, canonical order. |
| [development.md](development.md) | Setup, local server, tests, vendored libraries, docstring style. |
| [decisions.md](decisions.md) | Dated log of design and technical decisions. |

`doc-writer` keeps these files, `TODO.md` and `CHANGELOG.md` in sync with the code. Sections that describe planned code are marked **(planned)** until it exists.
