# Change notifications

All emitters are `lib/emitter.js` instances owned privately; owners expose `on` / `off` only.

| Source | Event | Payload | When |
|---|---|---|---|
| `model` | `change` | `{ changes: Change[], cause: 'do' \| 'undo' \| 'redo' \| 'cancel' }` | Once per committed transaction (`batch`), undo, redo, merge step or cancelled gesture, after the model is consistent. Not emitted when nothing changed. |
| `model` | `reset` | `{ cause: 'new' \| 'load' \| 'recover' }` | After the whole document was replaced. Views rebuild. |
| `history` | `history` | `HistoryState` ([Commands and undo](commands-and-undo.md#commands-and-undo)) | After a call that changed it. |
| `selection` | `selection` | `SelectionState` `{ objects: number[], timeline: number[], focus: 'objects' \| 'timeline' }` | After any selection change. |
| `modes` | `mode` | `{ mode: 'edit' \| 'animate' \| 'simulate', previous, clip: number \| null }` (`previous` is the previous mode) | Mode or open clip changed. |
| `modes` | `playhead` | `{ time }` (s) | Playhead moved. |
| `tools` | `tool` | `{ id, previous }` (tool ids, or `null` for no active tool) | Active tool changed. |
| `settings` | `settings` | `{ key, value, previous }` | An editor setting changed. |
| `camera` | `camera` | `{ center, scale, width, height }` | After a pan, zoom, frame or size change that changed any of them. |
| `RagInstance` | `event`, `start`, `loop`, `complete`, `stop` | [`DESIGN.md` §7.1](../design/07-ragimporter.md#71-api) | During `rag.update(dt)`. |

```
Change = { kind: 'add',    uid, type, parent, collection, index }
       | { kind: 'remove', uid, type, parent, collection, index }
       | { kind: 'set',    uid, type, path, value, previous }
       | { kind: 'move',   uid, type, from: Slot, to: Slot }
```

Adding or removing a subtree produces one change per node: parents before children on `add`, children before parents on `remove`. Changes are listed in application order, and one event may add and then remove the same uid; listeners process them in order.
