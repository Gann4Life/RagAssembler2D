# Hierarchy and deletion

Behavior: [`DESIGN.md` §5.6](../design/05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels) (Hierarchy), [§2.1](../design/02-object-model.md#21-root-the-ragdoll-itself) (`rootBody`), [§1](../design/01-conventions.md#1-conventions) (Undo), [§5.9](../design/05-9-hotkeys.md#59-hotkeys-defaults). Everything that decides *what* is shown, deleted or focused is core and tested under Node; the panel only renders and routes input.

| Concern | Core (Node-tested) | UI |
|---|---|---|
| References, joint edges | `js/model/queries.js` (`referencesTo`, `jointEdges`) | — |
| Deletion cascade and its undo step | `js/commands/delete.js` (`deletionPlan`, `deleteObjects`) | — |
| Unassigned joint | `js/commands/create.js` (`createJoint` with `null` bodies) | — |
| `delete`, `add-shape`, `add-joint` actions | `js/editor.js` | Del through `dispatchKey`; buttons in the panel |
| Tree items, Unlinked group, marks, search, visible rows | `js/model/hierarchy.js` | `js/panels/hierarchy.js` |
| Tree keyboard moves | `js/tree-nav.js` | `js/panels/hierarchy.js` |

**Queries.** Two additions to `js/model/queries.js`; the [Joint graph](joint-graph.md#joint-graph) rules hold.
- **`jointEdges(model) → ReadonlyArray<{ uid, a, b }>`:** the existing private helper, exported unchanged: the joints, in `joints` order, whose `bodyA` and `bodyB` resolve to two different `body` nodes, with `a`/`b` their body uids.
- **`referencesTo(model, uid) → { joints: number[], tracks: number[] }`:** the joints (in `joints` order) whose `bodyA` or `bodyB` resolves to `uid`, each listed once, and the tracks (clip order, then track order) whose `target` resolves to `uid`. A reference resolves through `model.uidOf` (the first holder of a duplicated id, as everywhere). Both lists are empty when nothing references `uid`. Throws `Error` for an unknown uid.

**Deletion.** `js/commands/delete.js` (core). Imports `js/model/model.js` (`ROOT_UID`) and `js/model/queries.js` (`referencesTo`).

```
DeletionPlan {
  bodies:   number[]   bodies removed with all their shapes, in `bodies` order
  shapes:   number[]   shapes removed alone (their body keeps other shapes), body order, then fixture order
  joints:   number[]   in `joints` order
  tracks:   number[]   clip order, then track order
  clips:    ReadonlyArray<{ uid: number, tracks: number, keys: number }>
                       one entry per clip holding a removed track, clip order: its removed tracks and their keys
  rootBody: { from: string, to: string | null } | null    the new `rootBody` when the current one is removed
  confirm:  boolean    tracks.length > 0
  empty:    boolean    nothing to remove
}
```

- **`deletionPlan(model, uids) → DeletionPlan`** (frozen; reads the model only):
  1. `Error` for an unknown uid. Duplicates are ignored, and so are uids that are not bodies, shapes or joints (the root, sprite assets, clips, tracks, keys, events).
  2. `bodies`: the requested bodies, plus every body with at least one fixture whose fixtures are all requested shapes.
  3. `shapes`: the requested shapes whose body is not in `bodies`.
  4. `joints`: the requested joints plus `referencesTo(body).joints` of every body in `bodies`, deduplicated.
  5. `tracks`: `referencesTo(x).tracks` of every joint in `joints`, every shape in `shapes` and every fixture of every body in `bodies`, deduplicated.
  6. `clips`: the clips that hold a track in `tracks` (a track's parent clip), in `clips` order; `tracks` counts those tracks and `keys` the `keys` children of those tracks. Empty when `tracks` is.
  7. `rootBody`: when the root's `rootBody` resolves to a body in `bodies`, `{ from, to }` with `to` the id of the first body in `bodies` order that is not removed, or `null`; otherwise `null`.
- **`deleteObjects(uids, label = 'Delete') → Command`:** `run(tx)` computes `deletionPlan(tx.model, uids)` itself (so the plan is never stale) and throws `Error` when it is `empty`, before mutating. Then one `tx.remove` per track, joint, shape in `shapes` and body (a body's fixtures go with it), in that order, then `tx.set(ROOT_UID, 'rootBody', to)` when `plan.rootBody` is not `null`. `run` returns the plan.
  - **Exact undo and redo** come from history: every `remove` op records its subtree snapshot with uids and its index, undo applies the inverses in reverse order, and redo re-applies the recorded ops without calling `run` ([Commands and undo](commands-and-undo.md#commands-and-undo)). Ids, uids, names, order, values and `rootBody` come back identical.
  - The selection prunes the removed uids ([Selection](selection.md#selection)). No clip is removed, so the open clip and the mode never change (the gesture re-entrancy of [Commands and undo](commands-and-undo.md#commands-and-undo) cannot occur; the action is disabled in gestures anyway).
  - It reads no mode, selection or confirmation: the action does.

**`createJoint` (#19 change).** `bodyA` and `bodyB` may both be `null`: an **unassigned joint**. The body, same-body and `jointBetween` checks are skipped and the props keep `bodyA: null`, `bodyB: null`. One `null` and one uid throws `Error`. Everything else is unchanged (id, name, `anchor`, `limits`, one `add` op, the joint uid returned).

**Actions** registered by `js/editor.js` (core), with `modeReason` as for the other actions:

| Action | `isEnabled` | `reason` | `run` |
|---|---|---|---|
| `delete` | `selection.focus === 'objects' && modes.can('edit.rest') && !history.inGesture && !confirming && !deletionPlan(model, selection.objects).empty` | with `selection.focus === 'objects'`: `modeReason('edit.rest')` when it is not `null`; else, outside a gesture and a confirmation and with `selection.objects` exactly `[ROOT_UID]`, `'the ragdoll root cannot be deleted'`; else `null`. With timeline focus `null` | `uids` = a copy of `selection.objects`, `plan = deletionPlan(model, uids)`. Without `plan.confirm`: `history.execute(deleteObjects(uids))` at once, returns `undefined`. With it: sets `confirming`, calls `confirm(deleteRequest(model, plan))` and returns that promise chained to a `Promise<void>` that never rejects; on settle clears `confirming`, and on `true`, if the `isEnabled` rule (without `confirming`) still holds for `uids`, runs `history.execute(deleteObjects(uids))`. `false`, a rejection or a disabled rule delete nothing |
| `add-shape` | `modes.can('edit.rest') && !history.inGesture` | `modeReason('edit.rest')` | `uid = history.execute(createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'box', width, height } }, 'Add shape'))` with `width`/`height` from `defaultsOf('shape', 'box').shape`, then `selection.set([uid])` |
| `add-joint` | same as `add-shape` | same | `uid = history.execute(createJoint({ bodyA: null, bodyB: null, anchor: { x: 0, y: 0 } }, 'Add joint'))`, then `selection.set([uid])` |

- None is repeatable. Del reaches `delete` through the existing `HOTKEYS` row from any focus except text fields. During a gesture the three are disabled; in Edit mode their reason is then `null`, elsewhere it stays the mode reason ([Actions and hotkeys](actions-and-hotkeys.md#actions-and-hotkeys)).
- The timeline issue that selects keys and events (#34) extends `delete` for `selection.focus === 'timeline'`; until then it is disabled there with no reason.
- **Confirmation** ([`DESIGN.md` §5.6](../design/05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels), #124): asked only when `plan.confirm`, through the `confirm` option of `createEditor` ([Editor composition](editor-composition.md#editor-composition)); `js/main.js` backs it with `confirmDialog` (`js/confirm-dialog.js`). `confirming` is a private flag of `js/editor.js`, so a second Del or click cannot open a second confirmation; `history`, `mode` and `selection` listeners refresh the buttons, and the dialog is modal, so nothing else can change while it is open. #124 must merge before any issue that can bring tracks into the document (Load #27, tracks #33).
- **`deleteRequest(model, plan) → ConfirmRequest`** (private to `js/editor.js`, tested through a fake `confirm`), with `n(count, word)` = `"<count> <word>"`, `s` appended when `count ≠ 1` (`body` → `bodies`):
  - `kind: 'delete'`, `title: 'Delete animation tracks?'`, `confirmLabel: 'Delete'`, `cancelLabel: 'Cancel'`;
  - `message`: `"Deleting <objects> also removes <n(T, 'track')> and <n(K, 'key')> from <n(C, 'clip')>. Undo restores them."`, where `T`, `K`, `C` are `plan.tracks.length`, the sum of `plan.clips[].keys` and `plan.clips.length`, and `<objects>` joins the non-zero parts of `n(bodies, 'body')`, `n(shapes, 'shape')`, `n(joints, 'joint')` with `, ` and a final ` and `;
  - `items`: one string per `plan.clips` entry, `"<label>: <n(tracks, 'track')>, <n(keys, 'key')>"`, `label` the clip's `name`, or its `key` when the name is empty.
  - Example: one body with two joints, three tracks with 12 keys in "Walk" and one track with 4 keys in "Run" → `"Deleting 1 body and 2 joints also removes 4 tracks and 16 keys from 2 clips. Undo restores them."`, items `["Walk: 3 tracks, 12 keys", "Run: 1 track, 4 keys"]`.

**Tree model.** `js/model/hierarchy.js` (core). Imports `js/model/model.js` (`ROOT_UID`) and `js/model/queries.js` (`jointEdges`).

```
HierarchyItem {
  key:       string                       String(uid) for objects, UNLINKED_KEY ('unlinked') for the group
  kind:      'root' | 'body' | 'shape' | 'joint' | 'unlinked'
  uid:       number | null                null for the group
  name:      string                       the `name` prop, '' when absent or not a string; '' for the group
  id:        string | null                the `id` prop; null for the group
  label:     string                       name, or id when name is ''; 'Unlinked' for the group
  shapeType: 'circle' | 'box' | 'polygon' | null    shapes only (`shape.type`), else null
  loop:      boolean                      joint leaf that closes a cycle
  loopTo:    string | null                loop leaves only: the `label` of the joint's bodyB item; else null; never searched
  unassigned: boolean                     joint that is not an edge
  children:  ReadonlyArray<HierarchyItem>
}
HierarchyRow {
  item, level (1 for the root), posInSet, setSize (1-based, among visible siblings),
  parentIndex (index of the parent row, -1 for the root),
  expandable (has visible children), expanded (expandable and key not in `collapsed`),
  match: { field: 'label' | 'id', indices: number[] } | null   what matched the query (label tried first)
  dimmed: boolean                         with a query, a row shown only as an ancestor of a match
}
```

- **`hierarchyTree(model) → HierarchyItem`** (the root item; deep-frozen, fresh on every call):
  - The root item's children are the component of `rootBody` (when it resolves to a body), then the group item when it has children.
  - **Components:** a breadth-first search over `jointEdges(model)` from a start body, with the [Joint graph](joint-graph.md#joint-graph) visiting rule (bodies in discovery order, their edges in `joints` order). An edge to an undiscovered body is a tree joint: its item is a child of the current body's item and holds the child body's item. After the search, every edge between two bodies of the component that is not a tree joint becomes a leaf under its `bodyA` item, with `loop: true` and `loopTo` the label of its `bodyB` (the same name-or-id rule as `label`).
  - A body item holds its shapes (fixture order), then its joint items (tree joints and loop leaves) in `joints` order.
  - Start bodies: `rootBody`, then, for the group, every body not yet placed, in `bodies` order, each starting a new component.
  - The group then lists the joints that are not edges, in `joints` order, as leaves with `unassigned: true`.
  - For the `rootBody` component, the tree joints and loop leaves equal `jointTree(model).parent` and `.loops` (tested); unlinked components mark their cycles `loop` too ([decision](../decisions.md)).
- **`hierarchyRows(tree, { collapsed = new Set(), query = '' } = {}) → HierarchyRow[]`**, in preorder:
  - Without a query (empty after trimming): every item whose ancestors are all expanded; `match` is `null`, `dimmed` `false`.
  - With a query: an item is kept when `fuzzyMatch(query, label)` or `fuzzyMatch(query, id)` is not `null` (the group never matches; `loopTo` and the badges are never searched), or when it has a kept descendant. Visible rows are the kept items whose kept ancestors are not in `collapsed`. `expandable` counts kept children only. Kept items that do not match are `dimmed`. No match gives `[]`.
  - The caller passes its persistent collapsed set without a query and a separate search set, emptied whenever the query changes, with one ([`DESIGN.md` §5.6](../design/05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)).
- **`fuzzyMatch(query, text) → number[] | null`:** spaces are removed from `query`; both sides are compared lower-cased, per character; the result is the indices in `text` of the greedy leftmost subsequence match, `[]` for an empty query, `null` when it does not match. Example: `fuzzyMatch('knl', 'knee_l')` → `[0, 1, 5]`.
- **`ancestorKeys(tree, uid) → string[]`:** keys of the item's ancestors, root first, without the item; `[]` when no item has `uid`.

**Tree keys.** `js/tree-nav.js` (core, no imports):

```
TreeMove { kind: 'focus' | 'expand' | 'collapse', index }
treeKey(rows: ReadonlyArray<{ expandable, expanded, parentIndex }>, index, key) → TreeMove | null
```

- `null` for a key other than `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, or for empty `rows`. An `index` outside `rows` acts as 0.
- `ArrowDown` → focus `min(index + 1, last)`; `ArrowUp` → focus `max(index − 1, 0)`; `Home` → focus 0; `End` → focus last. No wrap.
- `ArrowRight`: expandable and collapsed → expand `index`; expandable and expanded → focus `index + 1`; else focus `index`.
- `ArrowLeft`: expandable and expanded → collapse `index`; else `parentIndex ≥ 0` → focus `parentIndex`; else focus `index`.
- Handled keys always return a move, even one that changes nothing, so the panel prevents their default (page scroll, the `Home` hotkey).

**Panel.** `js/panels/hierarchy.js` (UI): `createHierarchy(element, editor) → { destroy() }`, mounted by `js/main.js` ([Editor boot](editor-boot.md#editor-boot)). It never executes commands: Add and Delete go through `actions.run`, selection through `editor.selection`.
- **DOM:** it replaces the element's content with `div.hierarchy-toolbar` (an `input[type=search]` with `placeholder="Search"`, `aria-label="Search hierarchy"` and `aria-controls` the tree; an Add `button[aria-label=Add][aria-haspopup=menu]` showing the visible text "Add" and a chevron icon, which also opens its menu on ArrowDown (first item) and ArrowUp (last item); an icon-only Delete `button[aria-label=Delete]` holding a trash-can inline SVG, right of Add), then `ul#hierarchy-tree[role=tree][aria-label=Hierarchy][aria-multiselectable=true]` with `aria-describedby` pointing to a visually hidden `p` in the panel, "Arrow keys move and select. Shift adds to the selection, Control moves without selecting. Space toggles. Shift click toggles, Control click deselects. Delete removes the selection, F frames it.", then a hidden `p` "No matches". Rows are flat `li[role=treeitem]` with `aria-level`, `aria-posinset`, `aria-setsize`, `aria-expanded` (expandable rows only) and `aria-selected` (object rows only; the group row has none), keyed and reused by `item.key`, so a row element that survives a re-render keeps focus. One row has `tabindex="0"` (the roving stop), the others `-1`. A row holds an expand arrow (`aria-hidden`; a click toggles expansion only), a decorative kind icon (inline SVG as in the Tools overlay), the label with matched characters in `<mark>`, the id in muted text when `match.field === 'id'`, and its badges: a muted "loop" badge followed by muted "→ `loopTo`" on loop leaves, an "unassigned" badge in `--error` on unassigned joints; the group row shows a warning-triangle icon in `--warning` and the label "Unlinked" in muted text. Indentation follows `level`. Sprite thumbnails are added with the asset store (#21).
- **Accessible names:** each row has `aria-label` (its visible children are not read): `"<label>, <kind>"`, then `", id <id>"` when `match.field === 'id'`, `", loop joint to <loopTo>"` on loop leaves and `", unassigned joint"` on unassigned joints. Kinds: `ragdoll root`, `body`, `circle shape`, `box shape`, `polygon shape`, `joint`. The group row is `"Unlinked, warning: not connected to the root body"`.
- **State:** `collapsed` (persistent `Set<key>`), `searchCollapsed` (emptied on every query change), `query`, the roving key. Model `reset` empties both sets. Nothing is stored or undoable.
- **Updates:** a model `change` or `reset` marks the tree dirty; the panel rebuilds `hierarchyTree` and re-renders at most once per animation frame (`requestAnimationFrame`). `selection` events re-render the `aria-selected` state; `history`, `mode`, `selection` and model events refresh the buttons from `actions.isEnabled` and `actions.reason`.
- **Selection sync:** row clicks call `selection.set([uid])`, `toggle(uid)` (SHIFT) or `remove([uid])` (CTRL or Cmd; CTRL wins); a click on the group row only focuses it, and a double click on it toggles its expansion; a double click on an object row calls `selection.set([uid])` and runs the `frame-selection` action (the F hotkey's action); a click on the tree's empty area calls `selection.clear()`. Keyboard focus moves from `treeKey` apply the same rule with `set` (no modifier), `add` (SHIFT) or nothing (CTRL), skipping the group row; Space (with or without CTRL) calls `toggle`. Alt-modified keys are ignored by the tree, and Shift+Space also toggles. Handled keys call `preventDefault`, so `dispatchKey` skips them; Del, Esc, F and letters are not handled and reach the hotkeys.
- **Reveal:** the panel flags its own selection calls. A `selection` event it did not cause reveals the uids newly in `objects`: their `ancestorKeys` leave both collapsed sets, and after the next render the last of them that has a row is scrolled into view (`scrollIntoView({ block: 'nearest' })`) and becomes the roving stop, without moving DOM focus. Rows hidden by the query are not revealed. Because a creation selects in the same turn as its model change, a pending reveal is applied after the pending rebuild.
- **Focus repair:** before re-rendering, the panel records whether focus was in the tree and the roving row's index. Collapsing an ancestor of the roving row moves the stop to the collapsed row. When the roving key has no row afterwards, the roving stop goes to the row now at that index, or the last row, and gets DOM focus when the tree had it. A query change that hides the roving row moves the stop to the first row.
- **Search:** the `input` event sets the query and empties `searchCollapsed`. Esc in a non-empty field clears it (handled by the field; `dispatchKey` ignores text fields anyway). ArrowDown in the field (`preventDefault`ed) makes the first visible row the roving stop and focuses it, without touching the selection; with no rows it does nothing.
- **Buttons:** the Add button is enabled from `add-shape` (`add-joint` has the same rule); while disabled a click or Enter/Space does not open the menu. Enabled, it opens `openMenu(addButton, [{ id: 'add-shape', label: 'Add shape', kind: 'item' }, { id: 'add-joint', label: 'Add joint', kind: 'item' }], { onSelect })`, where `onSelect` clears an active query (as an empty `input` would: query `''`, `searchCollapsed` emptied, field value cleared), runs `actions.run(item.id)` and focuses the Add button; Esc returns focus to it through `js/menu.js`. The Delete button runs `delete`. Both use `aria-disabled` and stay focusable; tooltips through `attachTooltip(button, text, { placement: 'below' })` with `actionTitle({ id, label, shortcut }, enabled, reason)` ("Delete (Del)", "Delete (Del) (the ragdoll root cannot be deleted)", "Add (not available in Animate mode)").
- **Styles** (`css/editor.css`): the panel overrides the `.dock-panel` centering with `place-items: stretch` and `grid-template-rows: auto minmax(0, 1fr)`; the tree fills the remaining height with its own `overflow: auto`, so the empty area below the rows is part of the tree and a click there clears the selection. Labels ellipsize (`min-width: 0`, `text-overflow: ellipsis`) and badges have `flex-shrink: 0`. Tokens in `:root`, used by every panel that needs them: `--error: #e5484d`, `--warning: #f5a524`. Selected rows: background `color-mix(in srgb, var(--focus) 35%, transparent)`; the focused row: `outline: 2px solid var(--focus)`, `outline-offset: -2px`, drawn on `:focus-visible`. Dimmed ancestors use `color: var(--text-muted)`, not opacity (icons and badges stay legible). `<mark>`: no background, `color: var(--focus)`, `font-weight: 600`.
- **Not in #19:** highlighting a hovered row's object in the viewport (follow-up issue).
- `destroy()` removes listeners, tooltips, the frame callback and the content.

**Tests (#19):**
- `tests/delete.test.js`: `deletionPlan` table (the only shape of a body → the body; one of two shapes → the shape; every shape of a grouped body → the body; a body and its shape → the body once; a lone joint; joints cascading as `bodyA` and as `bodyB`; tracks of a removed joint, of a removed shape and of a shape inside a removed body, in several clips; root tracks never; `rootBody` moving to the first remaining body or to `null`; root, clip and sprite asset uids ignored; unknown uid `Error`; `empty`; `confirm` exactly when tracks are removed; `clips` order and track and key counts, empty without tracks). `deleteObjects` on `createEditor()`: one step labelled "Delete", undo restoring the identical document (snapshots with ids, uids, order and `rootBody`) and redo removing it again with the same uids, the selection pruned, `Error` on an empty plan with nothing mutated.
- `tests/queries.test.js`: `jointEdges` and `referencesTo` (both directions, a joint referencing one body twice listed once, tracks in clip and track order, empty lists, unknown uid).
- `tests/create.test.js`: `createJoint` with both bodies `null` (props, id, name, undo, redo) and `Error` for one `null`.
- `tests/hierarchy.test.js`: `hierarchyTree` (empty ragdoll; chain and branch order; single-shape and grouped bodies; loop leaf under `bodyA` with `loopTo` the bodyB label, `null` elsewhere; unlinked components and their start bodies; unassigned joints; no group when empty; `rootBody` `null` with bodies; labels falling back to ids; agreement with `jointTree` on the `rootBody` component); `hierarchyRows` (collapse, levels, `posInSet`/`setSize`, `parentIndex`, query with dimmed ancestors, id matches, the group never matching, `loopTo` never matching, no match, collapse during a query); the `fuzzyMatch` table; `ancestorKeys`.
- `tests/tree-nav.test.js`: the `treeKey` table, including the no-op moves at the ends and on leaves.
- `tests/editor.test.js`: `delete`, `add-shape` and `add-joint` enabled in Edit mode, refused with the mode reason in Animate and Simulate, disabled with reason `null` during a gesture, `delete` disabled for an empty selection, the root alone (reason "the ragdoll root cannot be deleted", the mode reason winning in Animate and Simulate, `null` during a gesture) and timeline focus; Add creates, selects and is one undo step; Del through `dispatchKey` deletes the selection. #124: with a fake `confirm`, a deletion without tracks never calls it and is synchronous; with tracks it is called once with the `deleteRequest` above (example included), `true` deletes as one undo step, `false` and a rejection delete nothing, `delete` is disabled with reason `null` while the promise is pending, and a mode change before it resolves deletes nothing; the default `confirm` deletes; a non-function `confirm` throws `TypeError`.
- In the browser: rows appear for everything the tools and Add create; viewport and row selection follow each other both ways; Del from the viewport and from the tree, then Undo and Redo; search (highlights, dimmed ancestors, ArrowDown from the field, Add clearing it), keyboard navigation, double-click framing, expansion and focus repair; the Add menu (disabled does not open, focus back on Add) and the Add and Delete tooltips below their buttons; row accessible names and the tree description with a screen reader.
