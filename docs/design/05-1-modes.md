# 5.1 Editor modes

| Mode | Entered by | Viewport shows | Edits affect |
|---|---|---|---|
| **Edit** | Timeline clip selector = "(rest pose)" | Rest pose | Rest pose / object properties |
| **Animate** | Selecting a clip in the timeline | FK pose and sprites of the evaluated clip (plus the preview stack) at the playhead; after a scrub, the physics simulation of the clip at the playhead (below) | Keys of the open clip |
| **Simulate** | Play | Live physics through RagImporter | Nothing (read-only). Stop returns to the previous mode |

**FK preview:** in Animate mode the viewport places bodies by forward kinematics:
- `rootBody` is rotated by the evaluated root `bodyAngle` ([§4.2](04-animation-model.md#42-channels)) around its **center of mass** in the rest pose (`bodyMassData`, root-local; the body origin when its mass is 0), which stays fixed: a free body turned by a pure torque, as the balance controller does at runtime ([§3.2](03-physics-drive-model.md#32-balance-controller-rootbody-orientation)). At `bodyAngle = 0` it is at its rest transform;
- each child is rotated around its joint anchor by the evaluated `angle`, carried by its parent's FK transform, so the whole ragdoll follows `rootBody`. The angle is bodyB relative to bodyA, so through a reversed joint ([§2.4](02-object-model.md#24-joints)) the child turns by −`angle`.

Multiplier channels don't move anything. They are shown as the fill of the joint gizmo (grey 0 % → saturated 100 %). Sprite channels swap images live.

**Physics scrub preview:** scrubbing the playhead ([§5.8](05-8-animation-timeline.md#58-animation-timeline)) shows the ragdoll as Simulate would have it at that clip time: the same world (gravity, ground, motors following the clip) stepped at the same fixed 60 Hz step from 0. The runtime cannot seek, so a scrub simulation is kept while the preview lasts: scrubbing forward steps it on, scrubbing back rebuilds it from 0. Stepping is capped per frame, and the viewport shows the latest state reached until it catches up. The preview stays after the scrub ends and is dropped, returning to the FK pose, on any document change (keys from Pose or rotation, undo, …), on opening another clip and on leaving Animate. It never changes the document. Editing tools ignore it: Pose starts from the FK pose at the playhead and the Select rotation ring and its keys use the FK pose too, so pressing either may jump the view to the authored pose.

**Mode policy.** What each mode allows (✓) or disables (—). Disabled controls stay visible and use `aria-disabled`; disabled inspector fields are read-only.

| Capability | Edit | Animate | Simulate |
|---|---|---|---|
| Select, Select Box, Hierarchy selection | ✓ | ✓ | ✓ |
| Pose | ✓ | ✓ (into keys, below) | — |
| Creation tools: Circle, Box, Polygon, Hinge | ✓ | — | — |
| Rest-pose and object edits: inspector fields of root, bodies, shapes, sprites, joints and sprite assets (and `pixelsPerMeter` in Settings); Hierarchy add, rename and delete; Group, Ungroup, Split, Duplicate, Fit motor torque, Set as root body; Select move and rest-pose rotate (objects and transform gizmo), joint anchor, `aimAxis` and sprite edit | ✓ | — | — |
| Animation edits: clip properties, tracks, keys, events, key buttons ◆, autokey, Key selected (K), Select rotation ring → parent joint `angle` (root `bodyAngle` for `rootBody`), Pose → keys | — | ✓ | — |
| Asset import | ✓ | ✓ | — |
| Asset delete | ✓ | — | — |
| Clip selector, New clip | ✓ | ✓ | — |
| Scrub | — | ✓ | ✓ (returns to Animate first, keeping the simulation for the scrub) |
| Preview stack | — | ✓ | ✓ |
| Procedural preview | — | — | ✓ |
| New, Load, Save; Undo, Redo | ✓ | ✓ | — |
| Play | ✓ | ✓ | — |
| Pause, Next frame, Stop | — | — | ✓ |
| Editor settings (grid, snapping, display), panels, navigation | ✓ | ✓ | ✓ |

- In Animate mode, inspector fields that are not animatable are shown read-only, and animatable ones show the evaluated value with their key button. The Select tool only rotates: its transform gizmo shows the rotation ring alone, and dragging objects never moves them ([§5.5](05-5-tools.md#55-tools)).
- Changing mode cancels the tool operation in progress (as Esc). If the active tool is disabled in the new mode, the Select tool becomes active.
- **Playhead and open clip.** Opening a different clip puts the playhead at 0; the playhead always stays within `[0, length]` of the open clip, also when `length` changes. When the open clip stops existing (deleted, or its creation undone) the editor returns to Edit mode. New and Load return to Edit mode with the playhead at 0. Play continues the physics scrub preview when there is one, from the time it reached; otherwise it plays the open clip from 0. Stop restores the mode, clip and playhead that were active before Play.
