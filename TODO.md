# TODO

> Generated from [GitHub issues](https://github.com/Gann4Life/RagAssembler2D/issues) by `doc-writer`. Do not edit by hand; file new work as issues through `planner`.

## Phase 0 – Foundations
- [ ] #2 Pin PIXI.js v8 and liquidfun.js builds in vendor/
- [ ] #3 Add node --test harness with a first smoke test
- [ ] #4 Spike: check custom contact filter support in liquidfun.js
- [ ] #5 Spike: verify the liquidfun.js API surface used by RagImporter

## Phase 1 – Editor: rigging
- [ ] #6 Spike: verify sprite folder access across browsers
- [ ] #7 Editor shell with index.html, PIXI app and header
- [ ] #8 Dockable panel system with tabs, resize handles and saved layout
- [ ] #9 Editor data model for ragdolls, clips and sprite assets
- [ ] #10 Command stack with undo/redo and editor modes
- [ ] #11 Viewport navigation, grid, snapping and display modes
- [ ] #12 Viewport selection, hover, gizmos and overlays
- [ ] #13 Select and Select Box tools
- [ ] #14 Circle and Box tools with SHIFT/ALT/CTRL modifiers
- [ ] #15 Convex Polygon tool with up to 8 vertices
- [ ] #16 Hinge Joint tool with pin and drag-limits
- [ ] #17 Manipulate tool: move and rotate root and body subtrees
- [ ] #18 Group and Ungroup bodies
- [ ] #19 Hierarchy panel with tree, search, delete and add
- [ ] #20 Inspector framework with root and body properties
- [ ] #21 Assets panel with import, drag-assign, usage and delete guard
- [ ] #22 Inspector: shape and sprite properties
- [ ] #23 Inspector: joint properties
- [ ] #24 Manipulate tool: joint anchor, aimAxis and sprite edit mode
- [ ] #25 Implement RagImporter.validate with all errors and warnings
- [ ] #26 Problems panel with live validation
- [ ] #27 Canonical .rag.json serializer and loader with migration
- [ ] #28 Header Save/Load with sprite folder resolution
- [ ] #29 Autosave draft and recovery on startup
- [ ] #63 Duplicate selection with Ctrl+D

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

## Phase 5 – Demo
- [ ] #57 Author the demo humanoid with sprites and clips in the editor
- [ ] #58 Demo scene with ground, walls and two instances
- [ ] #59 Demo controls: walk, hit, kill, revive, strength, debug and respawn
- [ ] #60 Demo controls: look at cursor, aim arm, impulse and drag
- [ ] #61 Demo event log
