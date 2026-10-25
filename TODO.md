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
- [x] #18 Group and Ungroup bodies
- [x] #19 Hierarchy panel with tree, search, delete and add
- [x] #20 Inspector framework with root and body properties
- [ ] #21 Assets panel with import, drag-assign, usage and delete guard
- [ ] #22 Inspector: shape and sprite properties
- [ ] #23 Inspector: joint properties
- [ ] #24 Select tool: aimAxis handle and sprite edit mode
- [x] #25 Implement RagImporter.validate with all errors and warnings
- [ ] #26 Problems panel with live validation
- [x] #27 Canonical .rag.json serializer and loader with migration
- [x] #28 Header Save/Load of .rag.json files
- [ ] #29 Autosave draft and recovery on startup
- [x] #63 Duplicate selection with Ctrl+D
- [x] #70 Deploy the editor to GitHub Pages on every merge to main
- [ ] #71 Keep header controls reachable on narrow windows
- [ ] #72 Show a visible error when vendored libraries are missing
- [x] #73 Clarify header alignment and viewport ARIA role in the spec
- [x] #77 Decide how Save writes meta.name and meta.editorVersion
- [x] #78 Warn about duplicate body, joint and shape names
- [ ] #83 Drag a whole panel stack by its tab bar
- [ ] #84 Maximize a panel by double-clicking its tab
- [ ] #85 Cycle focus between panels with F6 and Shift+F6
- [x] #87 Tools overlay toolbar on top of the viewport
- [ ] #88 Guard panel minimum widths against clipped tab titles
- [x] #89 Use the default cursor on tabs at rest and grabbing only while dragging
- [ ] #90 Dim the drag ghost over invalid drop targets
- [ ] #91 Place workspace edge drop strips on the visible area
- [ ] #92 Make panel bodies a Tab stop only when they have no focusable content
- [ ] #94 Show a sprite edit indicator on the Select tool button
- [ ] #112 Add shortcuts to toggle grid snap and cycle display mode
- [ ] #113 Review Settings popover focus handling and grid colors
- [x] #124 Shared confirmation dialog for destructive actions
- [ ] #126 Highlight the viewport object of the hovered Hierarchy row
- [x] #127 Keep the Manipulate rotate knob clear of nearby joint gizmos
- [x] #128 Select tool with transform gizmo (merge Manipulate into Select)
- [x] #129 Resize shapes with handles in the Select tool
- [ ] #130 Polygon vertex handles in the Select tool
- [x] #132 Split DESIGN.md and the large docs into per-section files
- [x] #134 Dashed blue rotation ring and orange shape outlines
- [x] #138 Shapes render without their translucent fill
- [ ] #139 Body focus mode: isolate a body to edit and add its shapes
- [ ] #142 Group resize for multi-shape selections
- [x] #143 Show the swept angle as a circle slice while rotating
- [ ] #144 Move a shape to another body by dragging it in the Hierarchy
- [x] #147 Version every deploy as a release and show the version in the editor
- [x] #152 Edit hinge joint limits with angle handles
- [x] #153 Lock the root transform, name it root and let the user rename it
- [x] #156 Change the Pose tool hotkey from P to D
- [ ] #158 Sprite folder resolution on Load and image export on Save
- [ ] #165 Copy and paste selection with Ctrl+C / Ctrl+V, including across documents
- [x] #168 Move a joint with its hierarchy by default and only the joint with Alt
- [ ] #169 Snap while holding Ctrl instead of the Snap to grid setting
- [ ] #185 Render a body's shapes as one merged silhouette
- [x] #187 Choose the root body (Set as root body)
- [ ] #188 Body-level mass override
- [ ] #189 Specify the Inspector swap of joint bodies
- [ ] #190 Warn when the root body is too light
- [ ] #191 Make Set as root body discoverable in the Hierarchy

## Phase 2 – Editor: animation
- [x] #30 Evaluator: track sampling, interpolation and channel defaults
- [x] #31 Evaluator: resolve a single clip and combine S/G/D multipliers
- [x] #32 Timeline core: clip selector, New/Delete, length, loop and ruler scrub
- [x] #33 Joint angle tracks in the timeline
- [ ] #34 Events track and event inspector
- [x] #35 Timeline key editing: select, move with snap and delete
- [x] #36 FK preview of the evaluated pose in Animate mode
- [ ] #37 Preview stack for evaluating several clips together
- [x] #38 Pose tool in Animate mode (result becomes the FK pose at the playhead)
- [ ] #39 Autokey, Key selected (K) and inspector key buttons
- [ ] #93 Show the mode and clip summary in the folded Timeline bar
- [x] #125 Select: rotation in Animate mode keys the parent joint angle at the playhead
- [ ] #171 Evaluator: layers, additive blending, crossfades and procedural hook
- [ ] #172 Timeline zoom, Duplicate clip and Clip inspector page
- [ ] #173 Root and sprite tracks, + Track, track deletion and asset drop
- [ ] #174 Timeline key multi-select, copy/paste and key inspector
- [ ] #175 Strength fill on joint gizmos and live sprite swaps in FK preview
- [x] #184 Background simulation with onion-skin ghosts at keyframes while animating
- [x] #192 Pose recording is inaccurate: released parts drift from where they were left
- [ ] #193 Moving ghost that previews the next frames from the current state
- [x] #194 Pose drag moves and keys joints the user did not touch
- [x] #195 Warn about and clamp joint keys outside their limits
- [x] #198 Looping clips interpolate across the wrap back to the first key
- [ ] #199 Pinned preview in Animate: no gravity, root position fixed
- [ ] #200 Extract the delete keys enabled rule into a tested helper
- [ ] #203 Timeline summary row: select and edit all keys at a time

## Phase 3 – Round-trip verification
- [ ] #40 Valid round-trip fixture set
- [ ] #41 Byte-identical load/save test for every fixture
- [ ] #42 Invalid fixtures rejected with the expected errors
- [ ] #43 Evaluator test reproducing the hand-computed values of §4.6

## Phase 4 – RagImporter runtime
- [x] #44 RagImporter parse, spawn with rest pose and flipX, and destroy
- [x] #45 Motor controller and runtime multipliers
- [x] #46 Playback: play, stop, loop and isPlaying
- [ ] #47 Clip events without misses or duplicates
- [ ] #48 Procedural overrides: lookAt, setJointAngle, clear and fades
- [x] #49 Self-collision setup with the groupIndex fallback
- [ ] #50 PIXI sprite creation, sync(), z order and texture resolver
- [x] #51 Runtime debug draw
- [ ] #52 Spike: verify motor stability and tune default motor values
- [ ] #53 Spike: measure performance with 20 humanoids at 60 Hz
- [ ] #54 Editor Simulate mode running on RagImporter
- [ ] #55 Procedural preview and preview stack playback in Simulate
- [ ] #56 Spike: verify determinism between editor and host page
- [ ] #100 Native-memory regression test for ragdoll spawn, update and destroy
- [ ] #120 Fixed ground setting for physics preview
- [x] #145 Pose tool in Edit mode (physics test, discarded on release)
- [ ] #176 Playback: queue, fades, hold, weight and speed
- [ ] #177 Contact filter with setContactFilter and releaseWorld
- [ ] #178 Sprite channel texture swaps at runtime
- [ ] #179 Spike: verify motor stability under procedural overrides
- [x] #186 Suggested motor torque too weak to hold a humanoid up
- [ ] #197 Robot slides backwards after landing a jump
- [ ] #201 Spike: verify balance under loose joints and low strength

## Phase 5 – Demo
- [ ] #57 Author the demo humanoid with idle and walk clips in the editor
- [x] #58 Demo scene with ground and one ragdoll instance
- [x] #59 Demo controls: walk, idle and strength
- [ ] #60 Demo controls: look at cursor, aim arm, impulse and drag
- [ ] #61 Demo event log
- [ ] #180 Demo humanoid: sprites, faces, events, aimAxis and alive/pain/dead clips
- [ ] #181 Demo scene: walls, second flipX instance and world reuse
- [ ] #182 Demo controls: hit, kill, revive, debug toggle and respawn
- [x] #183 Load a .rag.json in the demo with a file picker or drag-and-drop
- [x] #196 Demo breaks with the robot rig: step like the editor
- [ ] #205 Add example library browser

## No milestone
- [x] #80 Assign models to project agents by role
- [x] #95 Keep commit messages and descriptions concise
- [x] #97 Document version tags and release branches in CLAUDE.md
- [x] #98 Extend read-only PowerShell permission allowlist
- [ ] #166 Spike: import a rag file into the current document (limbs as prefabs)
