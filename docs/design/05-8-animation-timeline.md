# 5.8 Animation timeline
Default location ([§5.2](05-2-panels.md#52-panels)): bottom, full width. Modeled after Godot's animation panel.

```
┌ [clip ▾ walk] [+ New] [⧉ Duplicate] [🗑]  length [1.00]s  snap [1/30]  [⟲ loop]  [● autokey]  [◆ Key selected (K)] ┐
│ Preview stack: [✓ alive] [ pain] [ dead] ...     Procedural: [ Look at cursor] weight ──○──          zoom ──○──   │
├──────────────────────────┬───────────────────────────────────────────────────────────────────────────────────────┤
│                          │ 0.0     0.2     0.4     0.6     0.8     1.0     ▼ playhead                             │
│ ▾ ragdoll (root)         │                                                                                       │
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

- **Clip selector:** "(rest pose)" = Edit mode, plus every clip. New / Duplicate / Delete buttons. The selected clip's properties appear in the inspector.
- **Tracks:**
  - The root track group always comes first.
  - Then one group per joint, with sub-tracks for the channels that have keys.
  - Then one group per shape that has a `sprite` track. Its keys are drawn as image thumbnails and always use `step`.
  - "+ Track" adds a channel for the selected joint or shape.
  - Deleting a track removes its keys.
- **Keys:**
  - Shown as diamonds, styled by interpolation.
  - Click selects, SHIFT / box select multi-selects, and dragging moves them (snapped).
  - Ctrl+C / Ctrl+V copy and paste at the playhead; Del deletes.
  - Double-clicking an empty spot in a track inserts a key with the evaluated value.
  - Dropping an asset from the Assets panel onto a sprite track inserts a key with that image.
- **Events track:**
  - Double click adds an event.
  - Events are drawn as markers with their name, can be dragged, and are edited in the inspector.
- **Playhead / scrub:**
  - Click or drag on the ruler.
  - Scrubbing updates the FK preview and the sprites live.
  - The snap step defaults to 1/30 s.
- **Loop toggle and length field** mirror the clip properties.
- **Autokey (●):** while it is on, Pose and Select rotation changes in Animate mode create keys automatically.
- **Key selected (K):** keys the `angle` of all selected joints, or of all joints of the selected bodies, at the playhead.
- **Preview stack:** checkboxes for other clips to evaluate together with the open clip, in both FK preview and Simulate mode (e.g. `alive` + `pain`). During Simulate, clicking a clip name calls `play(key)` on the running instance, so the user can rehearse how game code will trigger clips.
- **Procedural preview** (Simulate mode): *Look at cursor* applies `lookAt` to the selected joints toward the mouse, with a weight slider and an optional strength value. It runs the same RagImporter code as production and is used to tune `aimAxis`, limits and motor values.
