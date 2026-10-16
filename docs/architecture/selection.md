# Selection

`js/model/selection.js`: `new Selection(model)`. Getters `objects`, `timeline`, `focus`, `state → SelectionState`.

- **Lists:** `objects` holds uids of types `root`, `spriteAsset`, `body`, `shape`, `joint`, `clip`; `timeline` holds `key` and `event` uids. Both are frozen arrays in selection order without duplicates. `focus` (`'objects'` by default) names the list the inspector shows.
- **Operations:** `set(uids)` replaces, `add(uids)`, `remove(uids)`, `toggle(uid)`, `clear()` (both lists, focus kept), `has(uid)`. Each of `set`/`add`/`toggle` takes uids of one list only (mixing lists, unknown uids or other node types throw) and moves `focus` to that list; `remove` and `clear` never move it. An empty array names no list: `set([])` acts as `clear()` (both lists emptied, focus kept) and `add([])` does nothing. To empty one list only, callers use `remove` with that list's uids. `remove` ignores uids that are not selected.
- **Pruning:** on a model `change` it drops every uid with a `remove` change; on `reset` it clears both lists and sets `focus` to `'objects'`. Undo and redo never add to the selection.
- **Event:** `selection` with `SelectionState` after a call or prune that changed a list or `focus`, once per call.
