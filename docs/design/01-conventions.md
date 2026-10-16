# 1. Conventions

| Topic | Rule |
|---|---|
| Units (file and physics) | Meters, kilograms, seconds, radians. Torque in N·m, density in kg/m². |
| Units (editor UI) | Pixels and degrees. Multiplier channels are shown as 0–100 %. |
| Pixels per meter | `units.pixelsPerMeter` converts meters to pixels **in the editor and at runtime**. A sprite at scale 1 is drawn at its texture's native pixel size under this ratio, so at 32 px/m a 32 px image covers 1 m. |
| Axes | Physics: Y up, CCW-positive angles (Box2D). PIXI: Y down, CW-positive rotation. RagImporter converts: `sprite.x = x·ppm`, `sprite.y = −y·ppm`, `sprite.rotation = −angle`. |
| Identity | Every body, shape, joint and sprite asset has a stable `id` (unique across the file, never reused, used for references) and a human `name` (used for lookup by code). `root` is a reserved id. The editor generates ids as a kind prefix plus a counter (`b_3`, `f_3`, `j_3`, `s_3`), above any id of that prefix seen in the session (as an id or as a reference), and never changes an existing id. "Never reused" holds within an editing session: an id that was deleted and is absent from the saved file may be generated again after a reload. |
| Clip identity | Clips are referenced by `key`: lower-case, `[a-z0-9_]+`, unique. **The key is the contract with game code.** Renaming a clip's `name` never breaks code. Changing its `key` does, and the inspector warns about it. |
| Rest pose | The pose built in the editor is the **rest pose**. All joint angles are measured relative to it, so every joint's angle is `0` at rest. |
| Undo / Redo | Every data mutation (including keys, events and sprite edits) goes through a command stack (minimum 200 steps; the oldest are dropped). One user operation is one step: a compound operation (delete with its cascade, group, ungroup, duplicate) and a continuous gesture (a drag from press to release, a slider or field scrub) each undo at once. Esc or Undo during a gesture reverts it without leaving a step and undoes nothing else; Redo during a gesture does nothing. A gesture that ends where it started leaves no step. A new step clears Redo. New and Load clear both. Selection, camera, panel layout, mode, playhead and editor settings (except `pixelsPerMeter`) are not undoable, and Undo/Redo never change them, except that objects that no longer exist leave the selection and a clip that no longer exists is closed ([§5.1](05-1-modes.md#51-editor-modes)). |
| Autosave | The editor stores a draft in browser storage every 30 s and on page unload, and offers to recover it on the next start. |
