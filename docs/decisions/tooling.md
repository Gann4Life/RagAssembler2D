# Decisions: Tooling and tests

Newest first. See the [index](../decisions.md).

## 2026-10-15
- **The conformance tests read the layer classification from `docs/architecture.md`** (Core row of the layers table, `Pure` line of the components diagram, `js/` modules of the `tests/` dependency row) instead of a copy in code, and pure modules are checked by a static scan for `document`, `window`, `PIXI`, `Box2D` and `b2*` references rather than by loading them. Reason: one source for the layers, so editing the document changes what is enforced; a static scan reports file and line and needs no module to be importable yet. (docs/architecture.md, Conformance, Module map)
- **Model mutation calls are detected only when the receiver identifier ends in `model`;** aliases and destructured methods are not detected and are left to review. Reason: `reset` and `batch` are common method names (`dock.reset()`), and resolving aliases needs data-flow analysis a token scan cannot do; the receiver convention covers every call site the architecture describes with no false positives. (docs/architecture.md, Document model, Conformance)
- **Panel content modules may import nothing from `js/panels/`, `js/panels/layout.js` included,** although `layout.js` is core. Reason: panels are mounted by `js/main.js` into the element the dock gives them and must not depend on the dock or its layout model; the rule already said so for the dock modules, and the check makes it hold for any future panel file. (docs/architecture.md, Dependency rules, Conformance)
- **Every liquidfun.js verification test (`tests/liquidfun-*.test.js`) may load `vendor/liquidfun.js`,** not only `tests/liquidfun-api.test.js`. Reason: the #4 spike added `tests/liquidfun-contact-filter.test.js`, which loads it the same way; the rule had not been updated. (docs/architecture.md, Dependency rules)

## 2026-10-14
- **`js/storage.js` is tested under Node with a fake `localStorage`** installed on `globalThis` and restored after each test, as the dependency rules allow. Reason: the mapping of every storage failure to `missing`, `unavailable` or `parse` is the contract the dock and draft recovery (#29) rely on. (docs/architecture.md, Dependency rules, Module map)
- **Conformance with `docs/architecture.md` is checked:** automated by #66, as an item of the PR template, and by architect review of any PR that adds or changes a module. (docs/architecture.md, Conformance)
