# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) once it is released.

## [Unreleased]

### Added
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

### Changed
- Tools is now a floating toolbar over the viewport instead of a dock panel; it no longer appears in the Window menu, and a saved layout that still lists it resets to the default layout.
- The Viewport panel minimum height is now 168 px (was 160 px).
- Documentation: `docs/architecture.md` now defines the editor core architecture and module conformance rules, and the new `docs/schema.md` lists the property schema of every `.rag.json` object.
- RagImporter is now specified to reach liquidfun.js through its `Box2D` namespace global (`Box2D.b2World`, …) instead of global `b2*` names, and to accept both libraries through `RagImporter.configure({ Box2D, PIXI })`.
- `DESIGN.md` now specifies the header layout (four button groups, Window and Settings at the right end), its keyboard behavior and disabled state, and the accessibility role of the viewport.
- `TODO.md` is now a generated index of GitHub issues instead of a hand-edited list.
