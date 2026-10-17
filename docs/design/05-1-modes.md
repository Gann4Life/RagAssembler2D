# 5.1 Editor modes

| Mode | Entered by | Viewport shows | Edits affect |
|---|---|---|---|
| **Edit** | Timeline clip selector = "(rest pose)" | Rest pose | Rest pose / object properties |
| **Animate** | Selecting a clip in the timeline | FK pose and sprites of the evaluated clip (plus the preview stack) at the playhead | Keys of the open clip |
| **Simulate** | Play | Live physics through RagImporter | Nothing (read-only). Stop returns to the previous mode |

**FK preview:** in Animate mode the viewport places bodies by forward kinematics:
- `rootBody` stays at its rest transform;
- each child is rotated around its joint anchor by the evaluated `angle`.

Multiplier channels don't move anything. They are shown as the fill of the joint gizmo (grey 0 % → saturated 100 %). Sprite channels swap images live.

**Mode policy.** What each mode allows (✓) or disables (—). Disabled controls stay visible and use `aria-disabled`; disabled inspector fields are read-only.

| Capability | Edit | Animate | Simulate |
|---|---|---|---|
| Select, Select Box, Hierarchy selection | ✓ | ✓ | ✓ |
| Pose | ✓ | ✓ (into keys, below) | — |
| Creation tools: Circle, Box, Polygon, Hinge | ✓ | — | — |
| Rest-pose and object edits: inspector fields of root, bodies, shapes, sprites, joints and sprite assets (and `pixelsPerMeter` in Settings); Hierarchy add/delete; Group, Ungroup, Split, Duplicate; Select move and rest-pose rotate (objects and transform gizmo), joint anchor, `aimAxis` and sprite edit | ✓ | — | — |
| Animation edits: clip properties, tracks, keys, events, key buttons ◆, autokey, Key selected (K), Select rotation ring → parent joint `angle`, Pose → keys | — | ✓ | — |
| Asset import | ✓ | ✓ | — |
| Asset delete | ✓ | — | — |
| Clip selector, New clip | ✓ | ✓ | — |
| Scrub | — | ✓ | — |
| Preview stack | — | ✓ | ✓ |
| Procedural preview | — | — | ✓ |
| New, Load, Save; Undo, Redo | ✓ | ✓ | — |
| Play | ✓ | ✓ | — |
| Pause, Next frame, Stop | — | — | ✓ |
| Editor settings (grid, snapping, display), panels, navigation | ✓ | ✓ | ✓ |

- In Animate mode, inspector fields that are not animatable are shown read-only, and animatable ones show the evaluated value with their key button. The Select tool only rotates: its transform gizmo shows the rotation ring alone, and dragging objects never moves them ([§5.5](05-5-tools.md#55-tools)).
- Changing mode cancels the tool operation in progress (as Esc). If the active tool is disabled in the new mode, the Select tool becomes active.
- **Playhead and open clip.** Opening a different clip puts the playhead at 0; the playhead always stays within `[0, length]` of the open clip, also when `length` changes. When the open clip stops existing (deleted, or its creation undone) the editor returns to Edit mode. New and Load return to Edit mode with the playhead at 0. Stop restores the mode, clip and playhead that were active before Play.
