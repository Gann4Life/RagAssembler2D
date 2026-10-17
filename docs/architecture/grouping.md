# Group, Ungroup and Split

Behavior: [`DESIGN.md` §2.2](../design/02-object-model.md#22-bodies-and-shapes) (rules and examples), [§5.1](../design/05-1-modes.md#51-editor-modes) (Edit mode only), [§5.9](../design/05-9-hotkeys.md#59-hotkeys-defaults) (Ctrl+G, Ctrl+Shift+G, Alt+G). Everything is core and tested under Node; no UI module changes, since the operations have no button yet and their confirmation reuses the shared dialog.

| Concern | Core (Node-tested) |
|---|---|
| Plans, commands and their undo steps | `js/commands/group.js` |
| Polygon centroid | `lib/geometry.js` (`polygonCentroid`) |
| `group`, `ungroup`, `split` actions and the group confirmation | `js/editor.js` |
| `Alt+G` row and the Alt letter fallback | `js/hotkeys.js` |

## `js/commands/group.js`

Core. Imports `lib/geometry.js` (`shapeGeometryValid`, `polygonCentroid`), `js/model/model.js` (`ROOT_UID`), `js/model/queries.js` (`referencesTo`, `selectedBodies`) and `js/commands/delete.js` (`deletionPlan`).

**Bodies of the selection** (`readSelection`, shared by the three plans): `selectedBodies(model, uids)` from `js/model/queries.js`, also used by `duplicatePlan`. Every uid must exist (`Error` for an unknown uid); the result is the given bodies plus the parent body of every given shape, deduplicated, in `bodies` order. Other node types are ignored. `readSelection` also records which of the uids are bodies and which are shapes.

**Frames.** A body's transform reads as in `manipulationParts` ([Commands and undo](commands-and-undo.md#commands-and-undo)): a missing `position` is (0, 0), a missing `angle` 0. A shape's **center** is its `shape.center` for circles and boxes and `polygonCentroid(shape.vertices)` for polygons, body-local. Computed angles are wrapped to (−π, π]; no result holds `-0`. A `set` whose value is JSON-equal to the current prop is skipped (as `placeParts` does), so a merge between bodies with the same transform issues no geometry ops. A plan is **`invalid`** when a shape it re-expresses fails `shapeGeometryValid`, or a body whose transform it reads has a `position` that is present and not a finite pair or an `angle` that is present and not finite.

```
GroupPlan {
  bodies:     number[]       merged bodies, `bodies` order, survivor included
  survivor:   number | null  `rootBody` when among `bodies`, else bodies[0]; null when empty
  joints:     number[]       internal joints (both bodyA and bodyB resolve to merged bodies), `joints` order
  redirected: number[]       other joints that reference a merged body other than the survivor, `joints` order
  deletion:   DeletionPlan   deletionPlan(model, joints): the tracks and clips removed with them
  invalid:    boolean        a moved shape (any fixture of a non-survivor body) or a merged body is invalid
  confirm:    boolean        joints.length > 0
  empty:      boolean        bodies.length < 2
}
SplitPart { body: number, shapes: number[] }   source body; shapes moved to one new body, fixture order
```

- **`groupPlan(model, uids) → GroupPlan`** (frozen; reads only).
- **`groupBodies(uids, label = 'Group') → Command`.** `run(tx)` computes `groupPlan(tx.model, uids)` and throws `Error` when it is `empty` or `invalid`, before mutating. Ops, in order:
  1. `tx.remove` each `deletion.tracks`, then each internal joint;
  2. for each non-survivor body in `bodies` order, for each of its fixtures in order: `tx.move(fixture, survivor, 'fixtures')` (append), then `tx.set` of the re-expressed geometry (`shape.center`, box `shape.angle`, polygon `shape.vertices`) and, for a circle or polygon whose `sprite` is not `null`, `sprite.offset` (absent reads `[0, 0]`) and `sprite.angle` (absent reads 0), by the formulas of §2.2;
  3. for each redirected joint: `tx.set` of `bodyA` and/or `bodyB` to the survivor's id, and when `bodyB` changed, `aimAxis` (absent reads 0) plus `Δ` of its old body;
  4. `tx.remove` each non-survivor body (now without fixtures).

  `rootBody` is never set. `run` returns the survivor's fixture uids, in order. Shapes are moved, not re-created, so their uids stay selected and their sprite tracks stay valid.
- **`splitParts(model, uids) → { parts: SplitPart[], invalid: boolean }`** (frozen): for each body of the selection, in `bodies` order, with some but not all fixtures among the given shape uids, one part with those shapes. Given bodies add no part of their own. `invalid` per the frames rule, for the parts' shapes and source bodies.
- **`ungroupParts(model, uids) → { bodies: number[], parts: SplitPart[], invalid: boolean }`** (frozen): `bodies` are the bodies of the selection with two or more fixtures, in `bodies` order; `parts` holds one single-shape part per fixture after the first of each, body order then fixture order.
- **`splitShapes(uids, label = 'Split') → Command`** and **`ungroupBodies(uids, label = 'Ungroup') → Command`** compute their parts in `run` and throw `Error` when there are none or the result is `invalid`, before mutating. Both apply one private **extract** per part, in order:
  1. `c` = the average of the part's shape centers (source-local); `id = model.nextId('b')`;
  2. `tx.add(ROOT_UID, 'bodies', index, { type: 'body', props, children: { fixtures: [] } })`, where `index` is right after the source and the new bodies already added for it, and `props` are the source's props with `id`, `name` `body_<n>`, `position` = source position + `R(θ)·c`, `angle` = the source's;
  3. per shape, in fixture order: `tx.move(shape, newBody, 'fixtures')`, then `tx.set` of its geometry shifted by `−c` (`shape.center`, or every polygon vertex). Box `angle` and sprites are unchanged.

  `splitShapes` returns the moved shapes; `ungroupBodies` returns every fixture of the ungrouped bodies and of their new bodies; both in `bodies` order, then fixture order, read after the ops. Neither touches joints, tracks or `rootBody`.
- **Undo and redo** are exact and need no history feature: every `move` op records both slots, `add` and `remove` carry their snapshots, and redo re-applies the recorded ops with the same ids and uids ([Commands and undo](commands-and-undo.md#commands-and-undo)). A body added with no fixtures is momentarily empty inside the transaction; the model does not enforce `fixtures` ≥ 1 ([Document model](document-model.md#document-model)).
- They read no mode, selection or confirmation: the actions do.

## `js/commands/duplicate.js`

Core. Behavior: [`DESIGN.md` §5.6](../design/05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels) (Duplicate). Imports `js/model/model.js` (`ROOT_UID`) and `js/model/queries.js` (`selectedBodies`).

```
DuplicatePlan {
  bodies: number[]   copied bodies, `selectedBodies` result
  joints: number[]   joints whose bodyA and bodyB both resolve to copied bodies, `joints` order
  empty:  boolean    bodies.length === 0
}
```

- **`duplicatePlan(model, uids) → DuplicatePlan`** (frozen; reads only; `Error` for an unknown uid).
- **`duplicateSelection(uids, offset, label = 'Duplicate') → Command`.** `run(tx)` throws `Error` when the plan is `empty`, before mutating. Per body, appended to `bodies`: a new `b` id, the props of the source with `name` and `position` shifted by `offset` (a missing or non-finite `position` reads (0, 0)), and a copy of each fixture with a new `f` id and the same props and sprite. Then per joint, appended to `joints`: a new `j` id, `bodyA` and `bodyB` mapped to the copies, `anchor` shifted by `offset`. Tracks are not copied and `rootBody` is unchanged.
- **Names.** `<base>_copy`, or `<base>_copy<k>` with the smallest `k ≥ 2` not taken among the names of the same kind (bodies, shapes, joints); a trailing `_copy` or `_copy<k>` (`k ≥ 2`) of the source is stripped first.
- `run` returns the copies of the given bodies, shapes and joints that were copied, in the given order, deduplicated; the action selects them. A copied shape is selected as itself, not as its body.
- One undo step; the offset is computed by the `duplicate` action (`js/editor.js`), not here.

## `lib/geometry.js`: `polygonCentroid(vertices) → Vec2`

Area centroid of the polygon as given (shoelace formula, either winding); the average of the vertices when the signed area is 0. Pure; results never hold `-0`. Created by #18; #20 adds `shapeFrame` and reuses it, and the Polygon tool (#15) uses it to place a new body ([Module map](module-map.md)).

## Actions (`js/editor.js`)

`selection.focus === 'objects'`, `canEditRest()` (`edit.rest`, no gesture) and `!confirming` gate all three; `confirming` is the flag shared with `delete`, `new`, `load` and `save`, so only one confirmation can be pending. None is repeatable. While a gesture or a confirmation is open they are disabled with reason `null` in Edit mode; elsewhere the mode reason wins ([Actions and hotkeys](actions-and-hotkeys.md#actions-and-hotkeys)). The state reasons below are shown wherever an action's reason is shown, like Delete's root reason ([decision](../decisions/editor-core.md)).

| Action | Enabled when | State reason (Edit mode, no gesture, no confirmation) | `run` |
|---|---|---|---|
| `group` | `groupPlan` is neither `empty` nor `invalid` | `'select shapes of two or more bodies'` when `bodies.length === 1`; `'a shape has invalid geometry'` when `invalid`; else `null` | `uids` = a copy of `selection.objects`. Without `plan.confirm`: `history.execute(groupBodies(uids))`, then `selection.set(result)`; returns `undefined`. With it: `ask(groupRequest(model, plan))`, as `delete` does; on `true`, if the enabled rule (without `confirming`) still holds for `uids`, execute and select the same way |
| `ungroup` | `ungroupParts` has parts and is not `invalid` | `'a shape has invalid geometry'` when `invalid`; `'each selected body has a single shape'` when the selection has bodies but no part; else `null` | `history.execute(ungroupBodies(uids))`, then `selection.set(result)` |
| `split` | `splitParts` has parts and is not `invalid` | `'a shape has invalid geometry'` when `invalid`; `'select some, not all, shapes of a body'` when the selection has bodies but no part; else `null` | `history.execute(splitShapes(uids))`, then `selection.set(result)` |

**`groupRequest(model, plan) → ConfirmRequest`** (private, tested through a fake `confirm`), with `countOf` as for `deleteRequest` ([Hierarchy and deletion](hierarchy-and-deletion.md#hierarchy-and-deletion)):
- `kind: 'group'`, `title: 'Delete joints inside the group?'`, `confirmLabel: 'Group'`, `cancelLabel: 'Cancel'`;
- `message`: `"Grouping <countOf(B, 'body')> deletes <countOf(J, 'joint')> between them"`, then, when `T > 0`, `", which also removes <countOf(T, 'track')> and <countOf(K, 'key')> from <countOf(C, 'clip')>"`, then `". Undo restores them."`; `B`, `J` are `plan.bodies.length` and `plan.joints.length`, `T`, `K`, `C` the tracks, keys and clips of `plan.deletion`;
- `items`: one per internal joint, in `joints` order: its label (`name`, or `id` when the name is empty), followed by `": <countOf(t, 'track')>, <countOf(k, 'key')>"` when tracks target it (`t` its tracks, `k` their keys, over every clip).
- Example: grouping three bodies with internal joints `elbow_l` (3 tracks, 12 keys in two clips) and `wrist_l` (none) → `"Grouping 3 bodies deletes 2 joints between them, which also removes 3 tracks and 12 keys from 2 clips. Undo restores them."`, items `["elbow_l: 3 tracks, 12 keys", "wrist_l"]`.

## Hotkeys (`js/hotkeys.js`)

- `HOTKEYS` gains `{ keys: 'Alt+G', action: 'split' }` right after `Ctrl+Shift+G`.
- `matchHotkey`: for a row with Alt and a letter key, when `event.key` is not a single ASCII letter, `event.code === 'Key<letter>'` also matches (Option on macOS turns G into "©"). Rows without Alt, and Alt rows when `event.key` is a letter, match by `event.key` only, so Latin layouts keep matching by character. Ctrl, Shift and Alt still match exactly, so AltGr (Ctrl+Alt on Windows) never matches `Alt+G`.

## Tests (#18)

- `tests/group.test.js`:
  - bodies of the selection: shapes and bodies mixed, duplicates, other types ignored, unknown uid `Error`;
  - `groupPlan`: survivor is `rootBody` when merged, else the first in `bodies` order; internal joints (including one between two non-survivors); redirected joints as `bodyA` and as `bodyB`; unassigned and unrelated joints untouched; `deletion` tracks and clips; `empty` with zero or one body; `invalid` for an invalid moved shape and for a non-finite body angle, not for an invalid shape of the survivor;
  - `groupBodies` on `createEditor()`: the §2.2 example; world placement kept for a circle, a box and a polygon moved between bodies with different angles (each point compared through both frames within 1e-9); circle and polygon sprite offset and angle turned by `Δ`, box sprite unchanged; `aimAxis` of a redirected `bodyB` turned by `Δ`, of a redirected `bodyA` unchanged; fixture order; survivor id, name, fields and index kept, `rootBody` unchanged; two joints to the same outside body both kept (the later one a loop in `jointTree`); one undo step labelled "Group"; undo restores the identical document (snapshots with ids, uids, order, props) and redo the identical result; shape uids preserved; `Error` on an empty or invalid plan with nothing mutated; no geometry `set` ops when transforms are equal;
  - `splitParts` and `ungroupParts`: per-body parts, all-shapes bodies and selected bodies skipped, single-shape bodies skipped by Ungroup, `invalid`;
  - `splitShapes` and `ungroupBodies`: the §2.2 Split example; a rotated source (position through `R(θ)`), a polygon (centroid, vertices shifted); new body ids, names, index after the source and copied fields; joints, tracks and `rootBody` unchanged; returned shapes; one undo step each ("Split", "Ungroup"), exact undo and redo; Group then Ungroup puts every shape back in the same world place.
- `tests/geometry.test.js`: `polygonCentroid` for a square, a triangle, clockwise input, zero area (vertex average), no `-0`.
- `tests/editor.test.js`: the three actions enabled in Edit mode and refused with the mode reason in Animate and Simulate; disabled with reason `null` during a gesture and while a confirmation is pending; the state reasons; Group without internal joints never calls `confirm` and is synchronous; with them `confirm` is called once with the `groupRequest` above (example included), `true` groups as one step, `false` and a rejection change nothing, a mode change before the answer groups nothing; the selection after each action.
- `tests/hotkeys.test.js`: `Alt+G` → `split` with `key: 'g'` and with `key: '©', code: 'KeyG'`; `Ctrl+Alt+G` and `Alt+Shift+G` match nothing; a non-Alt letter row ignores `code`.
- In the browser: Ctrl+G, Ctrl+Shift+G and Alt+G on viewport and Hierarchy selections, the confirmation dialog, Undo and Redo, the Hierarchy rows following each operation; Alt+G in Chromium, Firefox and Safari (no menu bar focus or browser action).
