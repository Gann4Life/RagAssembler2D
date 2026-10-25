# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) once it is released.

## [Unreleased]

## [0.17.0] - 2026-10-25

### Added
- Inspector panel with Ragdoll and Body pages (the Body page shows physics only): name, damping, fixed rotation, bullet, computed mass, shape list, root body dropdown, preview gravity, drive multipliers and balance.
- Select several bodies to edit them together; values that differ are shown as —.
- Inspector values are shown in px, ° and %.
- The Ragdoll page shows when nothing is selected.
- The Inspector is read-only in Animate (showing values at the playhead) and in Simulate.

## [0.16.0] - 2026-10-25

### Added
- Validation warns when a clip has joint angle keys outside the joint's limits.
- Rig > Clamp keys to limits moves out-of-limit joint angle keys to the nearest limit in one undo step.

## [0.15.0] - 2026-10-25

### Added
- Timeline panel: create, rename and delete clips, set length and loop, scrub the ruler, and Play/Pause with Next frame.
- Timeline keys: select, drag (snapped to 1/30 s) and delete with Del or the new Delete keys button; every edit is undoable.
- Animate mode shows the clip's pose at the playhead (FK preview); The Pose tool keys joint angles and the root body angle.
- Animate runs the clip through physics in the background: scrubbing shows the simulated pose, and onion skins (ghosts) show it at the nearest keys; toggle them from the timeline or View menu.
- Simulate mode plays the ragdoll with gravity and a ground through RagImporter, so the preview matches a game.
- Set as root body (Shift+R) makes any body the root; existing animations keep their look.
- Motor torque is suggested from the load each joint carries and applied automatically when the rig changes; the editor warns about underpowered motors.
- Mode switch, Rig and View menus and a status line in the editor header.
- RagImporter: clip evaluator, joint motors, root body balance controller (`setBalance`), `play`/`stop`/`isPlaying`/loop, groupIndex self-collision fallback, debug drawing, and spawning in a clip pose.
- RagImporter: `stepWorld` and `STEP_SETTINGS` (8 substeps per 1/60 s step); hosts must step the world with them to match the editor.
- Demo page with a sample ragdoll, scene controls, and loading of a `.rag.json` by picker or drop when present in `demo/`.

### Changed
- **BREAKING:** file format v2 adds the root channel `bodyAngle` and `ragdoll.balance`; v1 files migrate automatically on load, and files saved by this version do not open in older versions.
- **BREAKING:** RagImporter hosts must step the world with `stepWorld`/`STEP_SETTINGS`; stepping with a single `world.Step` call gains energy with the new motor torques.
- Looping clips interpolate from the last key back to the first, so they no longer snap at the wrap.
- Pose drags in Edit and Animate use one soft-falloff drag that moves only nearby joints; released parts are keyed at the angle they were left, within limits.
- Timeline tracks scroll under a fixed clip bar.

### Fixed
- Shortening a clip drops keys and events beyond its new length.
- Loading a file while Animate has a clip open no longer breaks the session.
- Motors are sized for the worst case, so humanoid ragdolls hold themselves up and stay stable.
- Pose drags no longer move or key joints you did not touch.
- The demo no longer blows up on heavy rigs and spawns the ragdoll resting on the ground.

### Removed
- The autokey option; Pose always keys.

## [0.14.0] - 2026-10-23

### Added
- Moving or rotating a joint now carries the body it connects and that body's whole limb; hold Alt to move only the joint anchor. Joints that close a loop always move their anchor only.
- The rotation ring appears for a single joint with a child body, and for a joint with limits only when its range can rotate.

## [0.13.0] - 2026-10-17

### Added
- Ctrl+D duplicates the selected bodies, shapes or joints together with every limb hanging from them, as one undoable step; the copies are placed over their sources and selected.

## [0.12.0] - 2026-10-17

### Added
- F2 renames the single selected object: inline in the Hierarchy, or in a popup in the viewport.

### Changed
- The root can no longer be moved or rotated in the editor; its position and angle are read-only. Existing files keep their stored root transform, and the file format is unchanged.
- New documents name the root "root" instead of "ragdoll".

## [0.11.0] - 2026-10-17

### Changed
- Panel tabs show the default cursor at rest and the grabbing cursor only while a tab is being dragged.

## [0.10.0] - 2026-10-17

### Added
- Ctrl+G groups the bodies of the selected shapes and bodies into one body; shapes keep their place in the world.
- Ctrl+Shift+G ungroups the selected bodies into one body per shape.
- Alt+G splits the selected shapes of a body into a new body.
- Grouping bodies that have joints between them asks for confirmation and deletes those joints, with their animation tracks; Undo restores them.
- Group, Ungroup and Split are Edit mode only, are disabled with a reason when they cannot apply, and are each one undo step.

## [0.9.0] - 2026-10-16

### Added
- With one hinge joint selected in Select (Edit mode), lower and upper limit handles on the gizmo ring edit its limits; SHIFT snaps to 15°, ALT mirrors the other limit, dragging enables the limits, and each drag is one undo step.
- Dragging the ring of a selected hinge joint rotates its whole limit range.
- A fixed rest reference line marks the zero direction; disabled limits are drawn at half opacity.

### Changed
- The Hinge tool creates one-sided limits from the drag direction (counter-clockwise 0 to φ, clockwise φ to 0, ALT symmetric); a click without a drag creates a pin.

## [0.8.0] - 2026-10-16

### Added
- Load button, Ctrl+O and drag and drop onto the viewport open a ragdoll file; files with errors are rejected and reported, and warnings are shown after loading.
- Save button and Ctrl+S write the ragdoll file; the browser's save dialog lets you pick the name when available, otherwise the file downloads.
- Loading with unsaved changes asks for confirmation first.
- A notice dialog lists file errors and warnings.

### Changed
- New, Load and Save are also available in Animate mode.
- Loading a file keeps the current camera.
- Dropping a file outside the viewport no longer makes the browser open it and lose your work.

## [0.7.0] - 2026-10-16

### Changed
- The Pose tool shortcut is now D (was P).

## [0.6.0] - 2026-10-16

### Added
- New action: starts an empty ragdoll, asking for confirmation first when there are unsaved changes.
- Files saved by the editor use a fixed canonical layout (stable key order, inline number arrays), so saving the same ragdoll twice gives identical files.

## [0.5.0] - 2026-10-16

### Added
- Confirmation dialog for Delete: when removing objects also deletes animation tracks, a modal lists the affected clips, tracks and keys and asks to confirm (Enter confirms, Escape or clicking outside cancels).

## [0.4.1] - 2026-10-16

### Changed
- Documented how Save fills in the file's name (from the ragdoll name) and editor version.

## [0.4.0] - 2026-10-16

### Added
- Pose tool (P) in Edit mode: hold a body and drag it to test the rig with physics, without gravity; the rest of the ragdoll is damped and does not collide with itself, and releasing restores the rest pose without changing the document.

## [0.3.0] - 2026-10-16

### Added
- `RagImporter.configure` to inject the liquidfun.js and PIXI.js namespaces instead of using globals.
- `RagImporter.parse` returns an immutable `RagDef` and throws `RagFormatError` with the validation errors and warnings.
- `RagDef.spawn` creates a ragdoll in a LiquidFun world in rest pose, optionally mirrored with `flipX`.
- `RagInstance.destroy` removes the ragdoll's joints, bodies and view from the world.

## [0.2.0] - 2026-10-16

### Added
- Validation of `.rag.json` files with stable error and warning codes, including duplicate-name warnings.
- `RagImporter.validate` and `RagImporter.supportedVersions`.


## [0.1.0] - 2026-10-16

### Added
- Rotating with the gizmo ring shows the swept angle as a filled circle slice, signed and full past 360°.
- `DESIGN.md`: complete spec for the editor, the animation model, the `.rag.json` format (v1), the RagImporter API and the demo.
- Repository scaffolding: `README.md`, `CLAUDE.md` (contribution guidelines), `TODO.md`, `docs/` and project agents in `.claude/agents/`.
- Contribution workflow: Conventional Branch, Conventional Commits, Keep a Changelog, and squash merge into `main` as the point where a task closes.
- GitHub backlog workflow:
  - issue templates (task, bug) and a pull request template;
  - a `planner` agent that manages issues, labels and milestones;
  - a `/next` skill that picks the most relevant open issue.
- Test harness: `node --test tests/` runs every `*.test.js` under `tests/` with no dependencies, starting with a RagImporter smoke test.
- Pinned third-party builds in `vendor/`: PIXI.js 8.21.0 and liquidfun.js v1.1.0, with their license files, checksums and provenance in `docs/development.md`.
- Editor shell at `index.html`: a header toolbar with New, Load, Save, Undo, Redo, Play, Pause, Next frame, Stop, Window and Settings. The buttons are disabled for now but stay reachable from the keyboard (one Tab stop, arrow keys between buttons) and show their shortcuts in tooltips.
- Editor viewport: an empty PIXI canvas below the header that fills the window and resizes with it, sharp on high-DPI screens.
- Dockable panels: Hierarchy, Assets, Problems, Inspector and Timeline open as tabbed panels around the viewport (placeholders until their features land).
- Drag a tab to reorder it, move it to another panel, split a panel or dock it at a window edge, with a live drop preview.
- Resize panels with the gutters, by mouse or with the arrow keys.
- Window menu to open or close each panel and to reset the layout, reachable from the keyboard.
- The panel layout is saved in the browser and restored on the next visit; Reset layout returns to the default.
- The Timeline starts folded to its tab bar, with a button (or a double click on the bar) to fold and expand it.
- Editor keyboard shortcuts of the hotkey table (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, Ctrl+S, Ctrl+O, Ctrl+G, Ctrl+D, Space, Del and others) are captured by the editor and no longer trigger the browser's own shortcuts; they are ignored while typing in a text field.
- Undo and Redo buttons enable once there is history to step through (a 200-step command stack with Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y). No editing tool records commands yet, so they stay disabled for now.
- Editor modes (Edit, Animate, Simulate) with a per-mode policy; a disabled header button's tooltip now says why, e.g. "Undo (Ctrl+Z) (not available in Simulate mode)".
- Viewport navigation: pan with the middle mouse button or Space + left drag, zoom with the wheel about the pointer or with `+`/`-`. Pressing and releasing Space without dragging still toggles play.
- Framing: `F` frames the selection and `Home` frames the whole ragdoll in the viewport.
- Viewport grid with axes: adaptive minor and major lines that stay readable at any zoom, and the shapes of the rest pose drawn in the viewport.
- Settings popover (Settings button): grid visibility, grid size and subdivisions, snap to grid, display mode (Shapes, Sprites, Both) and the document's pixels per meter, which is one undo step and read-only outside Edit mode. Editor settings are saved in the browser and restored on the next visit.
- Viewport feedback: the shape under the pointer gets a hover outline, selected bodies, shapes and joints get a thicker selection outline, and invalid targets are outlined in red, all following the displayed pose.
- Viewport gizmos: a cross and ring at the root position, and a circle at each joint anchor with its limit arc, angle needle and `aimAxis` arrow.
- Settings popover: an Overlays group with Names (body, shape and joint labels) and Centers of mass toggles, saved with the other editor settings. A Contacts toggle is also listed but draws nothing yet.
- Tool hotkeys: every tool in the hotkey table has its key bound, and viewport pointer and key input is routed to the active tool. Only the Circle and Box tools are available so far.
- Circle tool (C): click for a default-size circle, or drag from the center to set the radius. The center snaps to the grid and the radius rounds to the grid spacing when snapping is on.
- Box tool (R): click for a default-size box, or drag from a corner. SHIFT makes it square, and CTRL or ALT center it on the press point. Corners snap to the grid when snapping is on.
- Both tools preview the shape while dragging, create one body with one shape per operation (one undo step) and select the new shape. The first body created becomes the root body.
- Tools toolbar: a floating strip of icon buttons at the top-left of the viewport, one per tool and in groups, with tooltips that show the name, hotkey and why a button is disabled. Arrow keys, Home and End move between buttons, and the pressed button shows the active tool.
- The toolbar switches to two columns when the viewport is too short for one, and framing (`F`, `Home`) keeps the content clear of it.
- Select tool (V), active when the editor loads: click selects the shape, joint or root under the pointer; SHIFT + click toggles it, CTRL + click removes it, ALT + click cycles through overlapping objects, and clicking empty space clears the selection. Any drag draws a selection box that picks the shapes entirely inside it and the joints whose anchor is inside, at the release: SHIFT adds, CTRL removes, none replaces. Works in every mode and leaves no undo step.
- Select Box tool (B): drag a selection box with the same rules; a click without a drag clears the selection.
- Hinge Joint tool (H): click where two shapes overlap to create a pin joint at the snapped point, or drag from it to set symmetric ±θ limits (SHIFT snaps to 15° steps). The parent body is chosen automatically, a pair of bodies that already has a joint is refused, and each joint is one undo step.
- Manipulate tool (M): drag the root, or a body with everything hanging from it (ALT moves only that body), and drag joint anchors. A rotation knob turns the selected body around its parent joint anchor (CTRL: its center) or the root around its position, with SHIFT snapping to 15°. Moves snap to the grid when snapping is on, and each drag is one undo step. Available in Edit mode; in Animate mode it only selects.
- Hierarchy panel: a tree of the root, bodies, shapes and joints that stays in sync with the viewport selection, with search by name or id, an Add menu (shape, joint) and a Delete button; unlinked bodies and unassigned joints are grouped and marked.
- Del deletes the selected bodies, shapes and joints, together with the joints and animation tracks that depend on them, as one undo step.
- Select resizes shapes with handles: box corners and sides, and a radius handle on circles. SHIFT keeps the aspect ratio, ALT or CTRL resizes from the center, the handles follow the shape's rotation, sizes snap to the grid, and each drag is one undo step.

### Changed
- The transform gizmo's rotation ring is now a dashed blue ring, and shape outlines in the viewport are orange, so the ring is no longer confused with circle shapes.
- Tools is now a floating toolbar over the viewport instead of a dock panel; it no longer appears in the Window menu, and a saved layout that still lists it resets to the default layout.
- The Viewport panel minimum height is now 168 px (was 160 px).
- Documentation: `docs/architecture.md` now defines the editor core architecture and module conformance rules, and the new `docs/schema.md` lists the property schema of every `.rag.json` object.
- RagImporter is now specified to reach liquidfun.js through its `Box2D` namespace global (`Box2D.b2World`, …) instead of global `b2*` names, and to accept both libraries through `RagImporter.configure({ Box2D, PIXI })`.
- `DESIGN.md` now specifies the header layout (four button groups, Window and Settings at the right end), its keyboard behavior and disabled state, and the accessibility role of the viewport.
- `TODO.md` is now a generated index of GitHub issues instead of a hand-edited list.
- Select now moves and rotates with a transform gizmo (X and Y arrows, a free-move square, a rotation ring and a live readout); Z toggles the pivot between the selection center and the last selected object.

### Removed
- The Manipulate tool and its M hotkey; Select does its moves and rotations.

### Fixed
- Shapes in Both display mode are filled at 20 % opacity again, so they read as solid while sprites stay visible beneath.
