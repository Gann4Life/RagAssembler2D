# Modes

`js/modes.js`: `new Modes(model)` holds `mode` (`'edit'` at start), `clip` (open clip uid or `null`), `playhead` (s, `0` at start) and the state before Simulate. Behavior: [`DESIGN.md` §5.1](../design/05-1-modes.md#51-editor-modes).

- **`openClip(uid | null)`**: a clip uid enters Animate with that clip, `null` enters Edit (`clip = null`, `playhead = 0`). Opening a different clip sets `playhead = 0`; opening the open clip again is a no-op. Throws in Simulate (`clip.open` is refused) and for a uid that is not a clip.
- **`setPlayhead(t)`**: clamps to `[0, length]` of the open clip, and to `[0, 0]` without one (Simulate started from Edit), so the playhead stays `0` there. Allowed in Animate and Simulate (the playback driver, #54), throws in Edit and for a non-finite `t`. Snapping is the timeline's job.
- **`startSimulate()`** from Edit or Animate stores `{ mode, clip, playhead }` and enters Simulate, keeping `clip`; **`stopSimulate()`** restores the stored state. Each throws when called in the wrong mode. In #10 nothing calls them yet (Play/Stop come with #54); they are tested directly.
- **Model listeners:** a `remove` change of the open clip closes it: outside Simulate as `openClip(null)`; in Simulate it sets `clip = null`, keeps the playhead, and stores Edit (`clip = null`, `playhead = 0`) as the state to restore, so Stop returns to Edit at 0; a `set` of the open clip's `length` re-clamps the playhead; `reset` returns to Edit with `clip = null`, `playhead = 0` and drops the stored state, from any mode.
- **Events:** `mode` when `mode` or `clip` changes, then `playhead` when the playhead changed in the same call; `playhead` alone for `setPlayhead` and re-clamps. Nothing is emitted when nothing changed.
- **`can(capability) → boolean`** reads `MODE_POLICY`, a frozen `{ [Capability]: { edit, animate, simulate } }` of booleans; an unknown capability throws. Its rows map one-to-one to the policy table in [`DESIGN.md` §5.1](../design/05-1-modes.md#51-editor-modes) (tested against it):

| Capability | DESIGN §5.1 row |
|---|---|
| `select` | Select, Select Box, Hierarchy selection |
| `tool.pose` | Pose |
| `tool.circle`, `tool.box`, `tool.polygon`, `tool.hinge` | Creation tools |
| `edit.rest` | Rest-pose and object edits |
| `edit.animation` | Animation edits |
| `assets.import`, `assets.delete` | Asset import / Asset delete |
| `clip.open` | Clip selector, New clip |
| `timeline.scrub` | Scrub |
| `preview.stack`, `preview.procedural` | Preview stack / Procedural preview |
| `file`, `history` | New/Load/Save, Undo/Redo |
| `play`, `simulate.control` | Play / Pause, Next frame, Stop |
| `settings.editor`, `layout`, `camera` | Editor settings, panels, navigation |
