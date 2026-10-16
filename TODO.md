# TODO

> Generated from [GitHub issues](https://github.com/Gann4Life/RagAssembler2D/issues) by `doc-writer`. Do not edit by hand; file new work as issues through `planner`.

## Phase 0 – Foundations
- [x] #2 Pin PIXI.js v8 and liquidfun.js builds in vendor/
- [x] #3 Add node --test harness with a first smoke test
- [x] #4 Spike: check custom contact filter support in liquidfun.js
- [x] #5 Spike: verify the liquidfun.js API surface used by RagImporter
- [x] #65 Spike: define editor core architecture and module map
- [x] #66 Architecture conformance tests for imports, pure modules and comments
- [x] #75 Add read-only permission allowlist for routine commands
- [x] #104 Enforce vendor and demo import limits for tests
- [x] #105 Enforce that only js/main.js reads the PIXI and Box2D globals
- [x] #106 Load core and pure modules in Node without a DOM
- [x] #107 Anchor Pure and Runtime parsing to the component diagram

## Phase 1 – Editor: rigging
- [ ] #6 Spike: verify sprite folder access across browsers
- [x] #7 Editor shell with index.html, PIXI app and header
- [x] #8 Dockable panel system with tabs, resize handles and saved layout
- [x] #9 Editor data model for ragdolls, clips and sprite assets
- [x] #10 Command stack with undo/redo and editor modes
- [x] #11 Viewport navigation, grid, snapping and display modes
- [x] #12 Viewport selection, hover, gizmos and overlays
- [x] #13 Select and Select Box tools
- [x] #14 Circle and Box tools with SHIFT/ALT/CTRL modifiers
- [ ] #15 Spike: assess feasibility of the Convex Polygon tool
- [x] #16 Hinge Joint tool with pin and drag-limits
- [x] #17 Manipulate tool: move and rotate root and body subtrees
- [ ] #18 Group and Ungroup bodies
- [x] #19 Hierarchy panel with tree, search, delete and add
- [ ] #20 Inspector framework with root and body properties
- [ ] #21 Assets panel with import, drag-assign, usage and delete guard
- [ ] #22 Inspector: shape and sprite properties
- [ ] #23 Inspector: joint properties
- [ ] #24 Select tool: aimAxis handle and sprite edit mode
- [ ] #25 Implement RagImporter.validate with all errors and warnings
- [ ] #26 Problems panel with live validation
- [ ] #27 Canonical .rag.json serializer and loader with migration
- [ ] #28 Header Save/Load with sprite folder resolution
- [ ] #29 Autosave draft and recovery on startup
- [ ] #63 Duplicate selection with Ctrl+D
- [x] #70 Deploy the editor to GitHub Pages on every merge to main
- [ ] #71 Keep header controls reachable on narrow windows
- [ ] #72 Show a visible error when vendored libraries are missing
- [x] #73 Clarify header alignment and viewport ARIA role in the spec
- [ ] #77 Decide how Save writes meta.name and meta.editorVersion
- [ ] #78 Warn about duplicate body, joint and shape names
- [ ] #83 Drag a whole panel stack by its tab bar
- [ ] #84 Maximize a panel by double-clicking its tab
- [ ] #85 Cycle focus between panels with F6 and Shift+F6
- [x] #87 Tools overlay toolbar on top of the viewport
- [ ] #88 Guard panel minimum widths against clipped tab titles
- [ ] #89 Use the default cursor on tabs at rest and grabbing only while dragging
- [ ] #90 Dim the drag ghost over invalid drop targets
- [ ] #91 Place workspace edge drop strips on the visible area
- [ ] #92 Make panel bodies a Tab stop only when they have no focusable content
- [ ] #94 Show a sprite edit indicator on the Select tool button
- [ ] #112 Add shortcuts to toggle grid snap and cycle display mode
- [ ] #113 Review Settings popover focus handling and grid colors
- [ ] #124 Shared confirmation dialog for destructive actions
- [ ] #126 Highlight the viewport object of the hovered Hierarchy row
- [x] #127 Keep the Manipulate rotate knob clear of nearby joint gizmos
- [x] #128 Select tool with transform gizmo (merge Manipulate into Select)
- [ ] #129 Resize shapes with handles in the Select tool
- [ ] #130 Polygon vertex handles in the Select tool
- [x] #132 Split DESIGN.md and the large docs into per-section files
- [x] #134 Dashed blue rotation ring and orange shape outlines
- [x] #138 Shapes render without their translucent fill

## Phase 2 – Editor: animation
- [ ] #30 Evaluator: track sampling, interpolation and channel defaults
- [ ] #31 Evaluator: layers, additive blending and crossfades
- [ ] #32 Timeline core: clip selector, ruler, scrub and zoom
- [ ] #33 Root, joint and sprite tracks in the timeline
- [ ] #34 Events track and event inspector
- [ ] #35 Timeline key editing: select, move, copy/paste, delete and snap
- [ ] #36 FK preview in Animate mode with strength fill on joint gizmos
- [ ] #37 Preview stack for evaluating several clips together
- [ ] #38 Pose tool with mouse-joint posing
- [ ] #39 Autokey, Key selected (K) and inspector key buttons
- [ ] #93 Show the mode and clip summary in the folded Timeline bar
- [ ] #125 Select: rotation in Animate mode sets the parent joint angle at the playhead

## Phase 3 – Round-trip verification
- [ ] #40 Valid round-trip fixture set
- [ ] #41 Byte-identical load/save test for every fixture
- [ ] #42 Invalid fixtures rejected with the expected errors
- [ ] #43 Evaluator test reproducing the hand-computed values of §4.6

## Phase 4 – RagImporter runtime
- [ ] #44 RagImporter parse, spawn with rest pose and flipX, and destroy
- [ ] #45 Motor controller and runtime multipliers
- [ ] #46 Playback: play, queue, stop, fades, hold, weight and speed
- [ ] #47 Clip events without misses or duplicates
- [ ] #48 Procedural overrides: lookAt, setJointAngle, clear and fades
- [ ] #49 Self-collision setup with contact filter or fallback
- [ ] #50 PIXI sprite creation, sync(), z order and texture resolver
- [ ] #51 Sprite channel texture swaps and debug draw
- [ ] #52 Spike: verify motor stability and tune default motor values
- [ ] #53 Spike: measure performance with 20 humanoids at 60 Hz
- [ ] #54 Editor Simulate mode running on RagImporter
- [ ] #55 Procedural preview and preview stack playback in Simulate
- [ ] #56 Spike: verify determinism between editor and host page
- [ ] #100 Native-memory regression test for ragdoll spawn, update and destroy
- [ ] #120 Fixed ground setting for physics preview

## Phase 5 – Demo
- [ ] #57 Author the demo humanoid with sprites and clips in the editor
- [ ] #58 Demo scene with ground, walls and two instances
- [ ] #59 Demo controls: walk, hit, kill, revive, strength, debug and respawn
- [ ] #60 Demo controls: look at cursor, aim arm, impulse and drag
- [ ] #61 Demo event log

## No milestone
- [x] #80 Assign models to project agents by role
- [x] #95 Keep commit messages and descriptions concise
- [ ] #97 Document version tags and release branches in CLAUDE.md
- [x] #98 Extend read-only PowerShell permission allowlist
