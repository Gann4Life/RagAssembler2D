# TODO

Work queue ordered by the roadmap in `DESIGN.md` §11. Take the top unchecked item. Keep items small enough for one commit.

## Phase 0 – Foundations
- [x] Design spec (`DESIGN.md`)
- [x] Repository, guidelines, agents, docs skeleton
- [ ] Spike: does the liquidfun.js build expose a custom contact filter (`ShouldCollide`)? Record the result in `docs/decisions.md` (DESIGN §2.5, §12)
- [ ] Spike: check the liquidfun.js API surface: `b2RevoluteJointDef.Initialize`, motor setters, `GetJointAngle`/`GetJointSpeed`, filter data
- [ ] Pin PIXI.js v8 and liquidfun.js builds in `vendor/`, and record versions in `docs/development.md`
- [ ] Test harness: `tests/` with `node --test`, plus a first smoke test

## Phase 1 – Editor: rigging
- [ ] Editor shell: `index.html`, PIXI app, dockable panel system with tabs, resize handles and saved layout
- [ ] Data model and command stack (undo/redo), with editor modes Edit/Animate/Simulate
- [ ] Viewport: pan/zoom, grid, snapping, selection and hover, display modes (shapes/sprites/both)
- [ ] Tools: Select, Select Box
- [ ] Tools: Circle, Box (modifiers), Polygon (convex, ≤ 8 vertices)
- [ ] Tool: Manipulate (root, body subtree, joint anchor, aimAxis, sprite edit)
- [ ] Tool: Hinge Joint (pin and drag-limits)
- [ ] Group/Ungroup
- [ ] Hierarchy panel (tree, search, delete, add)
- [ ] Inspector (root, body, shape, joint, sprite asset)
- [ ] Assets panel (import, assign by drag, usage, delete guard)
- [ ] Validation (`RagImporter.validate`) and Problems panel
- [ ] Save/Load `.rag.json` with canonical serialization, sprite folder resolution, autosave/recovery

## Phase 2 – Editor: animation
- [ ] Evaluator in `lib/ragimporter.js` (pure): tracks, interpolation, layers, crossfade, discrete channels
- [ ] Timeline: clip selector, ruler and scrub, tracks, keys (edit/move/copy/paste), snap, zoom
- [ ] Root, joint and sprite tracks; events track
- [ ] FK preview in Animate mode; strength fill on joint gizmos
- [ ] Pose tool and autokey; Key selected (K); inspector key buttons ◆
- [ ] Preview stack

## Phase 3 – Round-trip verification
- [ ] Fixture set: humanoid, groups, polygons, sprites, all channels, additive clips, events
- [ ] Load → save byte-identical test for every fixture
- [ ] Invalid fixtures rejected with the expected errors
- [ ] Evaluator test reproducing the hand-computed values of DESIGN §4.6

## Phase 4 – RagImporter runtime
- [ ] `parse`, `spawn` (rest pose, root transform, flipX), `destroy`
- [ ] Motor controller (DESIGN §3) and runtime multipliers
- [ ] Playback: play/queue/stop, fades, hold, weight/speed
- [ ] Events (no misses or duplicates with large `dt` and loop wraps)
- [ ] Procedural overrides: `lookAt`, `setJointAngle`, clear, fades
- [ ] Self-collision setup (contact filter or fallback)
- [ ] PIXI sprites: creation, `sync()`, z order, texture swaps, resolver, debug draw
- [ ] Editor Simulate mode and procedural preview running on RagImporter

## Phase 5 – Demo
- [ ] Generic humanoid with sprites and clips, authored and exported with the editor
- [ ] `demo/` scene: ground, walls, two instances (one flipped)
- [ ] Controls: walk, hit, kill, revive, strength, look at cursor, aim arm, debug, respawn, impulse/drag
- [ ] Event log

## Open items to verify
See `DESIGN.md` §12: motor stability, sprite folder access across browsers, performance (20 humanoids at 60 Hz), determinism.
