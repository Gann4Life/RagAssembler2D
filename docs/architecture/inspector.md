# Inspector

> Status: built (#20: framework, root and body pages). The behavior is [`DESIGN.md` §5.7](../design/05-7-inspector.md#57-inspector--properties-panel); the modules are in [Module map: editor core](module-map-editor-core.md) and [Module map: tools and UI](module-map-tools-ui.md).

The inspector is split into a **core page model** (`js/inspector/*`, no DOM, tested under `node --test`) and one **UI panel** (`js/panels/inspector.js`) that only renders pages and routes commits. Pages never execute commands; the panel never reads schema, units or mode rules itself.

```
selection / model / modes / history ──▶ inspectorPage(core) ──▶ InspectorPage ──▶ panel DOM
                                                                     │ commit
panel ──▶ editCommand(model, edit, value, opts) ──▶ history.execute (props)
      ──▶ editor.setRootBody(uid)                                  (root-body)
      ──▶ editor.actions.run(action, { label })                    (action)
      ──▶ editor.selection.set([uid])                              (select)
```

## Page model

```
InspectorPage {
  kind:           'mixed' | 'unbuilt' | 'object'   an empty selection gives the root 'object' page
  type:           string | null      node type of the page ('root', 'body', …); null for mixed
  uids:           number[]           the objects shown, in selection order
  title:          string             e.g. 'Body · arm_l', '3 bodies', '3 objects selected'
  summary:        string | null      mixed only: count per type, e.g. '2 bodies, 1 joint'
  sections:       InspectorSection[] empty unless kind is 'object'
  pixelsPerMeter: number             document scale used for the display values (every kind)
  structure:      string             signature of kind, type, uids, mode, each section's id and each row's id, control and readOnly
}
InspectorSection { id: string, label: string | null, rows: InspectorRow[] }
InspectorRow {
  id:        string                  stable within the page: the schema path ('position', 'balance.gain') or a name ('mass', 'shapes', 'set-root-body', 'bodyAngle')
  label:     string
  control:   'text' | 'number' | 'vec2' | 'checkbox' | 'select' | 'list' | 'button' | 'readout'
  value:     *                       display units; MIXED when mixed; vec2 is [x, y], each component may be MIXED; readout is the formatted text
  text:      string | string[] | null   displayed text of text/number/readout rows ('' when mixed, '—' for a mixed readout), [x, y] for vec2, else null
  unit:      string                  display unit ('px', '°', '%', 'px/m', 'm/s²', '1/s', 'rad/s', 'N·m', 'kg') or ''
  min, max:  number | undefined      display units; exclusiveMin as in the schema
  options:   { value: number, label: string }[] | undefined   select: body uids; value null shows '(none)'
  items:     { uid, label, muted, icon }[] | undefined         list rows; muted when the label is the id; icon names the shape type
  readOnly:  boolean
  reason:    string | null           why read-only; null when editable and during a gesture
  animated:  boolean                 base value or evaluated value of a channel ◆ (#39 adds the key button from it)
  edit:      InspectorEdit | null
}
InspectorEdit =
  | { kind: 'props', uids, path, unit, label }        setProps of the value converted to the data unit
  | { kind: 'root-body' }                             editor.setRootBody(value)
  | { kind: 'action', action: ActionId, label }      editor.actions.run(action, { label }); enabled state and reason from the registry
  | { kind: 'select' }                               list item click: selection.set([uid])
RowOverrides {                       fieldRow's third argument: only what the schema cannot say
  label, commitLabel, control, value (data units), dataUnit, unit, options, items,
  reason      makes the row read-only for this reason in every mode (derived rows)
  textFormat  wraps a readout's formatted number, e.g. 'auto (… N·m)'
  animated    channel value; default from the schema
  modeFree    never made read-only by the mode or a gesture (lists that only select)
  edit        commit instead of a props edit of the path
}
PageContext {
  model, type, uids,
  editable:       boolean            modes.can('edit.rest') && !history.inGesture
  reason:         string | null      modes.reason('edit.rest'); null during a gesture
  animate:        { clip: number, time: number } | null   Animate mode with an open clip: modes.clip, modes.playhead
  pixelsPerMeter: number             the document value, or the schema default when not a finite number > 0
}
```

`MIXED` is a frozen sentinel exported by `js/inspector/rows.js`. `sharedValue(model, uids, path)` returns the common value (deep equality), a frozen `[x, y]` with `MIXED` per differing component when every value is a pair, else `MIXED`.

## Rules

- **Page choice** (`inspectorPage`): the list is `selection.objects`, or `selection.timeline` when `selection.focus` is `'timeline'`. Empty → `object` page of type `root` with `uids` `[ROOT_UID]` (showing it does not select the root). The timeline list empty while focused also falls back to the root page; several types → `mixed`; one type without an entry in `PAGE_BUILDERS` → `unbuilt`; else `object` with the builder's sections.
- **Rows from the schema** (`fieldRow(ctx, path, overrides)`): label, unit, range and `readOnly` come from `fieldsOf(type)` (the root page also reads `fieldsOf('document')`); display conversion through `js/units.js` (`m` → px, `rad` → °, `mult` → %). Labels default to the humanized last path segment (`linearDamping` → `Linear damping`, `id` → `ID`). A path outside the schema needs `control`.
- **Display text:** `text` follows the precision line of [`DESIGN.md` §5.7](../design/05-7-inspector.md#57-inspector--properties-panel); the per-unit table lives in `js/inspector/rows.js` (px, °, %, px/m: 1 decimal; m/s², 1/s, rad/s and unitless: 2; N·m, kg: 3 significant). The panel compares the typed text with `text` to decide whether a commit happens.
- **Read-only:** a row is read-only when its schema field is `R`, when it is derived (`reason` override: mass, `balance.maxTorque` shown as "auto", the locked root transform), when `editable` is false, and, in Animate, for every `animated` row (evaluated value, until #39). Reasons: derived rows give their own (`ids never change`, `the root transform is locked`, `computed from the shapes`, `set automatically from the rig`); an `animated` row in Animate gives `the value at the playhead`; otherwise the mode reason; during a gesture `null`. `modeFree` rows ignore the mode and gestures.
- **Animate values:** `animated` rows of the root page show `resolveChannels(toJson(model), [{ clip, time }]).root` for the open clip at the playhead (`strength`, `gain`, `damping` as %, `bodyAngle` in °). The Body page has no angle row. Body rows always show the document (rest-pose) values. The evaluation is cached per model and recomputed only when `model.revision`, the clip or the time changed (see Required changes).
- **Commits** (`editCommand(model, edit, displayValue, { component?, pixelsPerMeter })`): converts the display value back to data units. A `props` edit returns `setProps(uids, { [path]: value }, label)`; a vec2 component (`component` 0 or 1) returns one `setProps` per object, each keeping its other component, combined in one command (one undo step). Returns `null` when every uid already holds the value; throws for other edit kinds. Labels: `Rename` for `name`, `Pixels per meter` for `units.pixelsPerMeter` (as Settings), `Edit balance <label>` for the balance rows, else `Edit <label>`. The panel validates against `min`/`max` before calling it. The automatic motor torque runs in the same undo step as any rig change, as for every command ([Editor composition](editor-composition.md#editor-composition)).
- **`placeBodies(uids, values, label)`:** no inspector caller since the Body page became physics-only (2026-10-25 decision); kept in `js/commands/transform.js` with its tests for the Joint page (#23), which rotates a subtree about the joint anchor. One command; it places the bodies one after the other, a selected ancestor before the bodies of its subtree and otherwise in `uids` order, so each ends at the typed value. Each is read where the earlier ones left it (its current position and angle in the transaction's model) and gets one rigid transform of `manipulationParts(model, { bodies: [uid], joints: [] }, { subtree: true })`, written as `placeParts` does: `x`/`y` translate by the difference to the typed value; `angle` is `rotationAbout(rotationPivot(model, uid, false), Δangle)`, Select's ring pivot (the parent joint's anchor when it exists and is placed, else the body origin, so `rootBody` turns around its origin), and the position field then shows where the rotation put the origin. Throws like `placeParts` for a uid that is not a body or a non-finite value.
- **`rotationPivot` lives in `js/commands/transform.js`**, unchanged, because `placeBodies` needs it inside the transaction and `js/tools/manipulation.js` already imports `transform.js` (the reverse import would be a cycle). `manipulation.js` re-exports it, so its callers and `tests/manipulation.test.js` stay as they are.
- **`Editor.setRootBody(bodyUid)`:** returns `false` and changes nothing when the action would be refused for that body (not Edit mode, a gesture, a pending confirmation, not a body, already `rootBody`); otherwise runs `setRootBody(bodyUid)` and shows the status message the action shows, and returns `true`. The `set-root-body` action is `setRootBody(selectedBody())`.

## Panel

- `createInspector(element, editor)` replaces the dock placeholder of `inspector`, like the Hierarchy ([Editor boot](editor-boot.md#editor-boot)). It subscribes to model `change` and `reset`, `selection`, `mode`, `playhead` and `history`; each marks the panel dirty and requests one `requestAnimationFrame` flush, so bursts redraw once per frame.
- **Flush:** builds the page; when `structure` equals the rendered one, updates values in place, else rebuilds the DOM and moves focus to the row with the same `id` when one had it. A focused text or number field with a draft keeps it (not overwritten) unless the row became read-only or left the page.
- **Fields:** number and text inputs commit on Enter or blur when valid and their text differs from `row.text`, are `aria-invalid` while invalid and revert on blur; Esc reverts and blurs. Checkboxes and selects commit on `change`. Mixed values show an empty input with the `—` placeholder. Read-only fields use `readOnly` (`aria-disabled` for checkboxes, selects and buttons) and show the reason with `js/tooltip.js`. Action buttons take their enabled state from `actions.isEnabled` and `actions.reason`, and their tooltip from `actionTitle({ id, label, shortcut })`, where `shortcut` is the `keys` of the first `HOTKEYS` row of that action (`js/hotkeys.js`), so it reads e.g. "Set as root body (Shift+R)", as the header, toolbar and menus do; the button also gets `aria-keyshortcuts`. Refreshed on every flush.
- Hotkeys: the dispatcher already ignores keys typed in text inputs and selects (`js/hotkeys.js`); the panel adds no key handling of its own beyond Enter and Esc on its fields.

## Required changes (#20 review)

- **`Model.revision`** (`js/model/model.js`): a read-only getter, an integer that starts at 0 and grows by one immediately before every `change` and `reset` emit (so listeners already see the new value). Nothing else reads or writes it.
- **`js/inspector/root-page.js`:** the playhead cache stays a module-level `WeakMap<Model, { revision, clip, time, channels }>`, but subscribes to nothing: it recomputes when `model.revision`, `clip` or `time` differs from the cached one. This keeps `rootPage` pure (no listener registered as a side effect of building a page).
- **`js/panels/inspector.js`:** imports `HOTKEYS` from `js/hotkeys.js` for the action button tooltip and `aria-keyshortcuts`, as above.

## Open items for later pages

- **#22 (shape page) and any page with `integer` schema fields:** `InspectorRow` gains `integer: boolean` (true for schema type `integer`), and the panel's number parsing rejects a non-integer text for those rows (`aria-invalid`, revert on blur), so `fieldRow` never hands `editCommand` a decimal for an integer field.
