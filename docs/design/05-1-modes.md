# 5.1 Editor modes

| Mode | Entered by | Viewport shows | Edits affect |
|---|---|---|---|
| **Edit** | Mode switch *Edit* ([§5.3](05-3-header.md#53-header)), or "(rest pose)" in the Timeline clip selector | Rest pose | Rest pose / object properties |
| **Animate** | Mode switch *Animate*, or choosing a clip in the Timeline clip selector, or New clip | FK pose and sprites of the evaluated clip (plus the preview stack) at the playhead; after a scrub, the physics simulation of the clip at the playhead; after a Pose release, the posed pose (below) | Keys of the open clip |
| **Simulate** | Play (header, Timeline, or mode switch *Simulate*) | Live physics through RagImporter | Nothing (read-only). Stop returns to the previous mode |

The header mode switch always shows the current mode, also while the Timeline is folded or closed; the Timeline clip selector shows the same state ("(rest pose)" in Edit mode, the open clip otherwise). Modes change only through these controls, Play and Stop ([§5](05-editor.md#visible-controls-and-feedback)).

**FK preview:** in Animate mode the viewport places bodies by forward kinematics:
- `rootBody` is rotated by the evaluated root `bodyAngle` ([§4.2](04-animation-model.md#42-channels)) around its **center of mass** in the rest pose (`bodyMassData`, root-local; the body origin when its mass is 0), which stays fixed: a free body turned by a pure torque, as the balance controller does at runtime ([§3.2](03-physics-drive-model.md#32-balance-controller-rootbody-orientation)). At `bodyAngle = 0` it is at its rest transform;
- each child is rotated around its joint anchor by the evaluated `angle`, carried by its parent's FK transform, so the whole ragdoll follows `rootBody`. The angle is bodyB relative to bodyA, so through a reversed joint ([§2.4](02-object-model.md#24-joints)) the child turns by −`angle`.

Multiplier channels don't move anything. They are shown as the fill of the joint gizmo (grey 0 % → saturated 100 %). Sprite channels swap images live.

**Physics scrub preview:** scrubbing the playhead ([§5.8](05-8-animation-timeline.md#58-animation-timeline)) shows the ragdoll as Simulate would have it at that clip time: the same world (gravity, ground, motors following the clip) stepped at the same fixed 60 Hz step from 0. The runtime cannot seek, so a scrub simulation is kept while the preview lasts: scrubbing forward steps it on, scrubbing back rebuilds it from 0. Stepping is capped per frame, and the viewport shows the latest state reached until it catches up. The preview stays after the scrub ends and is dropped on any document change (keys from Pose, undo, …), on opening another clip and on leaving Animate. It never changes the document. A Pose press starts from it, exactly as displayed ([§5.5](05-5-tools.md#55-tools), Pose).

**Posed preview:** after a Pose release in Animate mode the viewport shows the bodies exactly where the release left them, whether or not keys were written, so the release never makes the view jump. It is dropped, returning to the FK pose, when the playhead moves (a scrub then starts the physics scrub preview), on opening another clip, on leaving Animate, and on any document change other than the release's own keys (undo of those keys included). A Pose press starts from it. The FK pose of the written keys matches it in every joint angle and in `rootBody`'s angle; it can differ only in position, since FK keeps `rootBody`'s center of mass at its rest position (no root position channel, [§13](13-out-of-scope.md#13-out-of-scope-for-v1-backlog)).

**Displayed pose.** Tools, gizmos and hit testing in Animate mode use the pose shown: the posed preview, else the physics scrub preview, else the FK pose.

**Mode policy.** What each mode allows (✓) or disables (—). Disabled controls stay visible, use `aria-disabled` and give the mode reason ([§5](05-editor.md#visible-controls-and-feedback)); disabled inspector fields are read-only.

| Capability | Edit | Animate | Simulate |
|---|---|---|---|
| Select, Select Box, Hierarchy selection | ✓ | ✓ (select only) | ✓ (select only) |
| Pose | ✓ | ✓ (into keys, below) | — |
| Creation tools: Circle, Box, Polygon, Hinge | ✓ | — | — |
| Rest-pose and object edits: inspector fields of root, bodies, shapes, sprites, joints and sprite assets (and `pixelsPerMeter` in Settings); Hierarchy add, rename and delete; Group, Ungroup, Split, Duplicate, Fit motor torque, Set as root body; Select move, rotate and resize (objects and transform gizmo), joint anchor, `aimAxis` and sprite edit | ✓ | — | — |
| Animation edits: clip properties, tracks, keys, events, key buttons ◆, autokey, Key selected (K), Pose → keys | — | ✓ | — |
| Asset import | ✓ | ✓ | — |
| Asset delete | ✓ | — | — |
| Clip selector, New clip | ✓ | ✓ | — |
| Mode switch | ✓ | ✓ | ✓ (below) |
| Scrub | — | ✓ | — |
| Preview stack | — | ✓ | ✓ |
| Procedural preview | — | — | ✓ |
| New, Load, Save; Undo, Redo | ✓ | ✓ | — |
| Play | ✓ | ✓ | — |
| Pause, Next frame, Stop | — | — | ✓ |
| Editor settings (grid, snapping, display, pivot), panels, navigation | ✓ | ✓ | ✓ |

- In Animate mode, inspector fields that are not animatable are shown read-only, and animatable ones show the evaluated value with their key button. **Pose is the animation tool.** Select only selects in Animate and Simulate mode: no gizmo, and every drag draws a selection box ([§5.5](05-5-tools.md#55-tools)); it never writes keys.
- **Mode changes and tools.** Changing mode cancels the tool operation in progress (as Esc) and never changes the active tool. When the new mode disables the active tool, it stays active and pressed, shown disabled with the mode reason, and a viewport press with it changes nothing and shows the reason in the status line ([§5](05-editor.md#visible-controls-and-feedback)); the user chooses another tool or another mode.
- **Playhead and open clip.** Opening a different clip puts the playhead at 0; the playhead always stays within `[0, length]` of the open clip, also when `length` changes. The editor remembers the **last opened clip** of the session (forgotten by New and Load) for the mode switch.
  - When the open clip stops existing (deleted, or its creation undone) the editor returns to Edit mode and the status line shows "Clip *name* removed: Edit mode" (the clip's name, or its key when the name is empty).
  - New and Load return to Edit mode with the playhead at 0.
  - Play continues the physics scrub preview when there is one, from the time it reached; otherwise it plays the open clip from 0.
  - Stop restores the mode, clip and playhead that were active before Play.
- **Leaving Simulate through the mode switch** ([§5.3](05-3-header.md#53-header)): *Edit* stops (as Stop) and then enters Edit mode. *Animate* with a clip open in the simulation enters Animate on that clip **at the time the simulation reached**, and the simulation becomes the physics scrub preview, so the view does not change and scrubbing forward continues it; a Pose press then starts from that pose. Without a clip open (Play from Edit mode) it stops and then enters Animate as from Edit mode.
