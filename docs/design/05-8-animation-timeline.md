# 5.8 Animation timeline
Default location ([§5.2](05-2-panels.md#52-panels)): bottom, full width. Modeled after Godot's animation panel.

```
┌ [▶] [clip ▾ walk] [Rename] [+ New] [⧉ Duplicate] [🗑]  length [1.00]s snap [1/30] [⟲ loop] [‹ cycle 2 ›] [Onion skins] [◆ Key selected (K)] ┐
│ Preview stack: [✓ alive] [ pain] [ dead] ...     Procedural: [ Look at cursor] weight ──○──          zoom ──○──   │
├──────────────────────────┬───────────────────────────────────────────────────────────────────────────────────────┤
│                          │ 0.0     0.2     0.4     0.6     0.8     1.0     ▼ playhead                             │
│ Summary                  │ ◇───────◇───────◇───────◇───────◇                                                     │
│ ▾ root                   │                                                                                       │
│     strength             │ ◆───────────────────────────────◆                                                     │
│ ▾ knee_l                 │                                                                                       │
│     angle                │ ◆───────◆───────◆───────◆                                                             │
│     strength             │                                                                                       │
│ ▸ hip_l                  │                                                                                       │
│ ▾ head (shape)           │                                                                                       │
│     sprite               │ ▣face_normal                    ▣face_blink                                           │
│ Events                   │         ▮footstep                       ▮footstep                                     │
└──────────────────────────┴───────────────────────────────────────────────────────────────────────────────────────┘
```

- **Play button (▶ / ❚❚):** first in the Timeline bar, as in Godot, so the animating loop needs no trip to the header. It runs the same Play / Pause toggle as the header (Space, which also works while the ruler or the key lanes have focus instead of scrolling the panel), with the same enabled rule and reason, and shows ❚❚ with the label "Pause" while playing ([§5.1](05-1-modes.md#51-editor-modes), Playback in Animate).
- **Clip selector:** "(rest pose)" = Edit mode, plus every clip; it mirrors the header mode switch ([§5.3](05-3-header.md#53-header)). Rename / New / Duplicate / Delete buttons. **Rename** (also a double-click on the selector) swaps the selector for a text field holding the open clip's `name`: Enter or leaving the field commits it as one undo step "Rename clip", Esc cancels, an empty name is refused with the status line reason "Rename clip: the name cannot be empty". Disabled with the tooltip reason "open a clip" while no clip is open (Edit mode) and in Simulate; the selector shows the new name at once, and the clip `key` follows the name by the key-follows-name rule ([§4](04-animation-model.md)). New clips are named "New Clip", "New Clip 2", "New Clip 3", … (the first name no clip uses). New creates a clip and opens it, entering Animate mode: its tooltip says so ("New clip: creates and opens it in Animate mode"). The selected clip's properties appear in the inspector.
- **Tracks:**
  - The root track group always comes first.
  - Then one group per joint, with sub-tracks for the channels that have keys.
  - Then one group per shape that has a `sprite` track. Its keys are drawn as image thumbnails and always use `step`.
  - "+ Track" adds a channel for the selected joint or shape, or a root channel (`strength`, `gain`, `damping`, `bodyAngle`) when the root is selected.
  - Deleting a track removes its keys.
- **Keys:**
  - Shown as diamonds, styled by interpolation.
  - **Click modifiers**, read at the press, as in the Hierarchy ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)): none selects only the key, unless it is already selected (the selection stays); SHIFT adds it, or removes it when it is already selected; CTRL removes it (CTRL wins when both are held; Cmd acts as CTRL on macOS). Box select multi-selects (not built yet).
  - Dragging a selected key moves all selected keys by the same snapped offset as one undo step "Move keys" (`moveKeys`): the group stays inside the clip, and a key landing on the time of an unselected key of its track replaces it. A press that leaves the key unselected (SHIFT or CTRL removing it) starts no drag.
  - **Summary row:** the first key lane, labeled "Summary", above the root group, shown while a clip is open. It draws one summary key (◇) at every time where any key drawn in the lanes below sits, collapsed groups included; events are not keys and are not summarized. Keys whose times differ by less than 1e-6 s (the commands' same-time tolerance) share one summary key; keys written by the Timeline are snapped to the snap step, so in practice that is exact equality after snapping. It is derived on every render, so it follows key add, move and delete, undo and redo.
    - A summary key stands for its keys: it is outlined when none of them is selected, half filled when some are, filled in the selection color when all are. Its tooltip reads "*t* s: *n* key(s), *s* selected".
    - Click modifiers apply to its keys as a group, with the key rules above: none selects only its keys, unless all are already selected (the selection stays); SHIFT adds them, or removes them when all are already selected; CTRL removes them.
    - Dragging a fully selected summary key moves the whole selection exactly like a key drag (same snapping, clip clamp, replacement rule and single "Move keys" step); a press that leaves it not fully selected starts no drag. Box select, once built, selects the keys of the boxed summary keys.
    - Delete keys (button, Del, Backspace) acts on the selected keys whatever selected them, as one undo step. The summary row adds no hotkey and no control of its own; it takes the key lanes' focus like a key.
    - One summary row for the clip; per-group summary rows are not specified.
  - Copy, Paste (at the playhead) and Delete keys buttons in the Timeline header act on the selected keys; Ctrl+C, Ctrl+V and Del are their hotkeys while the keys hold the selection focus. Built so far: Delete keys, as the Timeline button (tooltip "Delete keys (Del)", disabled with the reason when no keys are selected, no clip is open, or the mode is not Animate) and through Del or Backspace while the key lanes have focus, always as one undo step; the Copy and Paste buttons and the clipboard are not built yet ([§12](12-open-items.md#12-open-items--to-verify)).
  - Double-clicking an empty spot in a track inserts a key with the evaluated value.
  - Dropping an asset from the Assets panel onto a sprite track inserts a key with that image.
- **Events track:**
  - Double click adds an event.
  - Events are drawn as markers with their name, can be dragged, and are edited in the inspector.
- **Playhead / scrub:**
  - Click or drag on the ruler.
  - Scrubbing (pointer or Left / Right / Home / End on the ruler) is always allowed in Animate mode and only moves the playhead within its cycle (pausing playback): the view shows the clip simulation at the new time with every tool, at once (a scrub ends a posed hold without a handover, [§5.1](05-1-modes.md#51-editor-modes)); the sprites follow the playhead live. It never changes the mode or the tool.
  - In Simulate mode the playhead shows the simulation time and the ruler cannot be scrubbed ("only in Animate mode").
  - **Simulation progress:** a 3 px bar along the bottom of the ruler shows the clip time range the clip simulation has computed ([§5.1](05-1-modes.md#51-editor-modes)): solid `#5b9cf5` from 0 to the time the current run reached, and, beyond it, the range the previous run reached, hatched, while a new run catches up. For a looping clip the bar shows the playhead cycle only: full once the run has passed that cycle, empty while it has not reached it. Once the run restarted by an edit begins, the bar shows how far it is from the playhead, which is what a posed hold waits for ([§5.1](05-1-modes.md#51-editor-modes)). Not drawn when the clip simulation is not available. It is decorative (`aria-hidden`); the ruler's accessible description adds "simulated to *t* s" ("simulated to cycle *c*, *t* s" for a looping clip) while a run is in progress.
  - The snap step defaults to 1/30 s.
- **Loop toggle and length field** mirror the clip properties. Shortening the length removes, in the same undo step, the keys after the new length and the events outside it (at the length too, for a looping clip), and, when anything was removed, the status line says how many ("Set clip length: removed *k* key(s) and *e* event(s) beyond the new length").
- **Cycle control** (`‹ cycle c ›`, after the loop toggle): shown only for a looping clip in Animate mode. It shows the playhead cycle ([§5.1](05-1-modes.md#51-editor-modes), Clip simulation) and follows it while playing. ‹ and › move the playhead to the previous or next cycle at the same clip time, as a scrub does (pausing playback, no handover). ‹ is disabled at cycle 1 ("first cycle") and › at the cycle limit ("cycle limit reached"). Its accessible name is "Cycle *c* of 8". Hidden for a non-looping clip and in Edit and Simulate mode.
- **Onion skins toggle** (after the cycle control): a toggle button (`aria-pressed`, tooltip "Onion skins: ghosts of the nearest key times in Animate") that shows or hides the ghosts ([§5.1](05-1-modes.md#51-editor-modes), Ghosts). On by default; an editor setting, saved like the others ([§5.3](05-3-header.md#53-header)), shown in every mode and mirrored by View › Onion skins. Off, no ghost is drawn and the ghost poses are not read.
- **No autokey toggle:** keying is always on. Every Pose release after a drag in Animate mode keys the joints it moved ([§5.5](05-5-tools.md#55-tools)). Select never keys.
- **Key selected (K):** keys the `angle` of all selected joints, or of all joints of the selected bodies, at the playhead, with the evaluated (FK) value at the playhead, whatever the viewport shows; the displayed simulated pose is keyed only by a Pose release ([§5.5](05-5-tools.md#55-tools)).
- **Preview stack:** checkboxes for other clips to evaluate together with the open clip, in both FK preview and Simulate mode (e.g. `alive` + `pain`); the clip simulation and its ghosts play the open clip alone ([§5.1](05-1-modes.md#51-editor-modes)). During Simulate, clicking a clip name calls `play(key)` on the running instance, so the user can rehearse how game code will trigger clips.
- **Procedural preview** (Simulate mode): *Look at cursor* applies `lookAt` to the selected joints toward the mouse, with a weight slider and an optional strength value. It runs the same RagImporter code as production and is used to tune `aimAxis`, limits and motor values.
