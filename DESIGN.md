# RagAssembler's Design

RagAssembler is a ragdoll editor for LiquidFun + PIXI.js; RagImporter is its runtime library. This is the spec, split per section: read only the file you need (find it with this table).

| Section | File | Summary |
|---|---|---|
| Overview | [00-overview.md](docs/design/00-overview.md) | Purpose, export and import flow, animation through joint motors and procedural control. |
| §1 | [01-conventions.md](docs/design/01-conventions.md) | Units, axes, naming and editor-wide conventions. |
| §2 | [02-object-model.md](docs/design/02-object-model.md) | Root, bodies, shapes, sprites, joints and collision rules. |
| §3 | [03-physics-drive-model.md](docs/design/03-physics-drive-model.md) | How animation drives the ragdoll through joint motors. |
| §4 | [04-animation-model.md](docs/design/04-animation-model.md) | Clips, channels, keys, channel resolution, playback, events and procedural joint control. |
| §5 | [05-editor.md](docs/design/05-editor.md) | Editor overview and index of its subsections. |
| §5.1 | [05-1-modes.md](docs/design/05-1-modes.md) | Edit, Animate and Simulate modes and the mode policy table. |
| §5.2 | [05-2-panels.md](docs/design/05-2-panels.md) | Dock panels, default layout and the Window menu. |
| §5.3 | [05-3-header.md](docs/design/05-3-header.md) | Header actions, menus and settings. |
| §5.4 | [05-4-viewport.md](docs/design/05-4-viewport.md) | Viewport camera, grid, display modes, overlays and gizmos. |
| §5.5 | [05-5-tools.md](docs/design/05-5-tools.md) | Viewport tools: select, select box, pose, circle, box, hinge and the transform gizmo. |
| §5.6 | [05-6-hierarchy-assets-problems.md](docs/design/05-6-hierarchy-assets-problems.md) | Hierarchy tree, Assets and Problems panels. |
| §5.7 | [05-7-inspector.md](docs/design/05-7-inspector.md) | Inspector panel fields per object type. |
| §5.8 | [05-8-animation-timeline.md](docs/design/05-8-animation-timeline.md) | Animation timeline, keys and playback controls. |
| §5.9 | [05-9-hotkeys.md](docs/design/05-9-hotkeys.md) | Default hotkeys. |
| §5.10 | [05-10-inverse-kinematics.md](docs/design/05-10-inverse-kinematics.md) | Inverse kinematics. |
| §6 | [06-file-format.md](docs/design/06-file-format.md) | The `.rag.json` format: example, field reference, versioning, validation and round trip. |
| §7 | [07-ragimporter.md](docs/design/07-ragimporter.md) | RagImporter API, spawn and flipX, sprites, native memory and contact filter. |
| §8 | [08-integration-workflow.md](docs/design/08-integration-workflow.md) | Using the editor output from a separate JS project. |
| §9 | [09-project-layout.md](docs/design/09-project-layout.md) | Repository layout. |
| §10 | [10-demo.md](docs/design/10-demo.md) | Demo scene. |
| §11 | [11-roadmap.md](docs/design/11-roadmap.md) | Roadmap phases and acceptance criteria. |
| §12 | [12-open-items.md](docs/design/12-open-items.md) | Open items to verify. |
| §13 | [13-out-of-scope.md](docs/design/13-out-of-scope.md) | Backlog outside v1. |

References such as "DESIGN.md §5.5" mean the file listed for that section above.
