# 5.8 Animation timeline
Default location ([§5.2](05-2-panels.md#52-panels)): bottom, full width. Modeled after Godot's animation panel.

```
┌ [▶] [clip ▾ walk] [+ New] [⧉ Duplicate] [🗑]  length [1.00]s snap [1/30] [⟲ loop] [● autokey] [◆ Key selected (K)] ┐
│ Preview stack: [✓ alive] [ pain] [ dead] ...     Procedural: [ Look at cursor] weight ──○──          zoom ──○──   │
├──────────────────────────┬───────────────────────────────────────────────────────────────────────────────────────┤
│                          │ 0.0     0.2     0.4     0.6     0.8     1.0     ▼ playhead                             │
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

- **Play button (▶ / ❚❚):** first in the Timeline bar, as in Godot, so the animating loop needs no trip to the header. It runs the same Play / Pause toggle as the header (Space), with the same enabled rule and reason, and shows ❚❚ with the label "Pause" while playing ([§5.1](05-1-modes.md#51-editor-modes), Playback in Animate).
- **Clip selector:** "(rest pose)" = Edit mode, plus every clip; it mirrors the header mode switch ([§5.3](05-3-header.md#53-header)). New / Duplicate / Delete buttons. New creates a clip and opens it, entering Animate mode: its tooltip says so ("New clip: creates and opens it in Animate mode"). The selected clip's properties appear in the inspector.
- **Tracks:**
  - The root track group always comes first.
  - Then one group per joint, with sub-tracks for the channels that have keys.
  - Then one group per shape that has a `sprite` track. Its keys are drawn as image thumbnails and always use `step`.
  - "+ Track" adds a channel for the selected joint or shape, or a root channel (`strength`, `gain`, `damping`, `bodyAngle`) when the root is selected.
  - Deleting a track removes its keys.
- **Keys:**
  - Shown as diamonds, styled by interpolation.
  - Click selects, SHIFT / box select multi-selects, and dragging moves them (snapped).
  - Copy, Paste (at the playhead) and Delete keys buttons in the Timeline header act on the selected keys; Ctrl+C, Ctrl+V and Del are their hotkeys while the keys hold the selection focus.
  - Double-clicking an empty spot in a track inserts a key with the evaluated value.
  - Dropping an asset from the Assets panel onto a sprite track inserts a key with that image.
- **Events track:**
  - Double click adds an event.
  - Events are drawn as markers with their name, can be dragged, and are edited in the inspector.
- **Playhead / scrub:**
  - Click or drag on the ruler.
  - Scrubbing (pointer or Left / Right / Home / End on the ruler) is always allowed in Animate mode and only moves the playhead (pausing playback): the view shows the Animate view at the new time, the clip simulation, or the FK pose while Pose is active ([§5.1](05-1-modes.md#51-editor-modes)); the sprites follow the playhead live. It never changes the mode or the tool.
  - In Simulate mode the playhead shows the simulation time and the ruler cannot be scrubbed ("only in Animate mode").
  - **Simulation progress:** a 3 px bar along the bottom of the ruler shows the clip time range the clip simulation has computed ([§5.1](05-1-modes.md#51-editor-modes)): solid `#5b9cf5` from 0 to the time the current run reached, and, beyond it, the range the previous run reached, hatched, while a new run catches up. Not drawn when the clip simulation is not available. It is decorative (`aria-hidden`); the ruler's accessible description adds "simulated to *t* s" while a run is in progress.
  - The snap step defaults to 1/30 s.
- **Loop toggle and length field** mirror the clip properties.
- **Autokey (●):** while it is on, Pose releases in Animate mode create keys automatically ([§5.5](05-5-tools.md#55-tools)). Select never keys.
- **Key selected (K):** keys the `angle` of all selected joints, or of all joints of the selected bodies, at the playhead, with the evaluated (FK) value at the playhead, whatever the viewport shows (the clip simulation is never keyed).
- **Preview stack:** checkboxes for other clips to evaluate together with the open clip, in both FK preview and Simulate mode (e.g. `alive` + `pain`); the clip simulation and its ghosts play the open clip alone ([§5.1](05-1-modes.md#51-editor-modes)). During Simulate, clicking a clip name calls `play(key)` on the running instance, so the user can rehearse how game code will trigger clips.
- **Procedural preview** (Simulate mode): *Look at cursor* applies `lookAt` to the selected joints toward the mouse, with a weight slider and an optional strength value. It runs the same RagImporter code as production and is used to tune `aimAxis`, limits and motor values.
