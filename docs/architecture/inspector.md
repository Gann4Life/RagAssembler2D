# Inspector

> Status: planned (#20). The behavior is [`DESIGN.md` §5.7](../design/05-7-inspector.md#57-inspector--properties-panel); the modules are in the [Module map](module-map.md).

The inspector is split into a **core page model** (`js/inspector/*`, no DOM, tested under `node --test`) and one **UI panel** (`js/panels/inspector.js`) that only renders pages and routes commits. Pages never execute commands; the panel never reads schema, units or mode rules itself.

```
selection / model / modes / history ──▶ inspectorPage(core) ──▶ InspectorPage ──▶ panel DOM
                                                                     │ commit
panel ──▶ editCommand(model, edit, value) ──▶ history.execute      (props, placement)
      ──▶ editor.setRootBody(uid)                                  (root-body)
      ──▶ editor.actions.run(action, { label })                    (action)
      ──▶ editor.selection.set([uid])                              (select)
```

## Page model

```
InspectorPage {
  kind:      'mixed' | 'unbuilt' | 'object'   an empty selection gives the root 'object' page
  type:      string | null           node type of the page ('root', 'body', …); null for mixed
  uids:      number[]                the objects shown, in selection order
  title:     string                  e.g. 'Body · arm_l', '3 bodies', '3 objects selected'
  summary:   string | null           mixed only: count per type, e.g. '2 bodies, 1 joint'
  sections:  InspectorSection[]      empty unless kind is 'object'
  structure: string                  signature of kind, type, uids, mode and each row's id, control and readOnly
}
InspectorSection { id: string, label: string | null, rows: InspectorRow[] }
InspectorRow {
  id:        string                  stable within the page: the schema path ('position', 'balance.gain') or a name ('mass', 'shapes', 'set-root-body', 'bodyAngle')
  label:     string
  control:   'text' | 'number' | 'vec2' | 'checkbox' | 'select' | 'list' | 'button' | 'readout'
  value:     *                       display units; MIXED when mixed; vec2 is [x, y], each component may be MIXED; readout is the formatted text
  unit:      string                  display unit ('px', '°', '%', 'px/m', 'm/s²', '1/s', 'rad/s', 'N·m', 'kg') or ''
  min, max:  number | undefined      display units; exclusiveMin as in the schema
  options:   { value: number, label: string }[] | undefined   select: body uids; value null shows '(none)'
  items:     { uid: number, label: string }[] | undefined     list rows
  readOnly:  boolean
  reason:    string | null           why read-only (mode reason or derived reason); null during a gesture
  animated:  boolean                 base value or evaluated value of a channel ◆ (#39 adds the key button from it)
  edit:      InspectorEdit | null
}
InspectorEdit =
  | { kind: 'props', uids, path, unit }            setProps of fromDisplay(value); vec2 rows of this kind have one uid
  | { kind: 'placement', uids, field: 'x' | 'y' | 'angle' }   placeBodies
  | { kind: 'root-body' }                          editor.setRootBody(value)
  | { kind: 'action', action: ActionId }          editor.actions.run; enabled state and reason from the registry
  | { kind: 'select' }                            list item click: selection.set([uid])
PageContext {
  model, type, uids,
  editable:       boolean            modes.can('edit.rest') && !history.inGesture
  reason:         string | null      modes.reason('edit.rest')
  animate:        { clip: number, time: number } | null   Animate mode: modes.clip, modes.playhead
  pixelsPerMeter: number             the document value, or the schema default when not a finite number > 0
}
```

`MIXED` is a frozen sentinel exported by `js/inspector/rows.js`. `sharedValue(model, uids, path)` returns the common value (deep equality for vectors, `MIXED` per vector component when they differ), else `MIXED`.

## Rules

- **Page choice** (`inspectorPage`): the list is `selection.objects`, or `selection.timeline` when `selection.focus` is `'timeline'`. Empty → `object` page of type `root` with `uids` `[ROOT_UID]` (showing it does not select the root). The timeline list empty while focused also falls back to the root page; several types → `mixed`; one type without an entry in `PAGE_BUILDERS` → `unbuilt`; else `object` with the builder's sections.
- **Rows from the schema** (`fieldRow`): label, unit, range and `readOnly` come from `fieldsOf(type)`; display conversion through `js/units.js` (`m` → px, `rad` → °, `mult` → %). Pages pass overrides only for what the schema cannot say (control kind, derived reason, a placement edit).
- **Read-only:** a row is read-only when its schema field is `R`, when it is derived (mass, `balance.maxTorque` shown as "auto"), when `editable` is false, and, in Animate, for every `animated` row (evaluated value, until #39). Reasons: derived rows give their own (`ids never change`, `the root transform is locked`, `computed from the shapes`, `set automatically from the rig`); otherwise the mode reason; during a gesture `null`.
- **Animate values:** `animated` rows of the root page show `resolveChannels(toJson(model), [{ clip, time }]).root` for the open clip at the playhead (`strength`, `gain`, `damping` as %, `bodyAngle` in °). The body angle row exists only in Animate. Body rows always show the document (rest-pose) values.
- **Commits** (`editCommand`): converts the display value back to data units and returns `setProps(uids, { [path]: value }, label)` or `placeBodies(uids, { [field]: value }, label)`; `null` when every uid already holds the value. Labels: `Rename` for `name`, `Move` for position, `Rotate` for angle, `Pixels per meter` for `units.pixelsPerMeter` (as Settings), else `Edit <label>`. The panel validates against `min`/`max` before calling it. The automatic motor torque runs in the same undo step as any rig change, as for every command ([Editor composition](editor-composition.md#editor-composition)).
- **`placeBodies(uids, values, label)`:** one command; for each uid in order, reads the body's current position and angle in the transaction's model (so a body moved by an earlier one's subtree is read where it now is) and applies one rigid transform to `manipulationParts(model, { bodies: [uid], joints: [] }, { subtree: true })`, writing the results as `placeParts` does: `x`/`y` translate by the difference to the typed value; `angle` is `rotationAbout(rotationPivot(model, uid, false), Δangle)`, Select's ring pivot (the parent joint's anchor when it exists and is placed, else the body origin, so `rootBody` turns around its origin), and the position field then shows where the rotation put the origin. Throws like `placeParts` for a uid that is not a body or a non-finite value.
- **`rotationPivot` moves to `js/commands/transform.js`**, unchanged, because `placeBodies` needs it inside the transaction and `js/tools/manipulation.js` already imports `transform.js` (the reverse import would be a cycle). `manipulation.js` re-exports it (`export { rotationPivot } from '../commands/transform.js'`), so its callers and `tests/manipulation.test.js` stay as they are.
- **`Editor.setRootBody(bodyUid)`:** returns `false` and changes nothing when the action would be refused for that body (not Edit mode, a gesture, a pending confirmation, not a body, already `rootBody`); otherwise runs `setRootBody(bodyUid)` and shows the status message the action shows, and returns `true`. The `set-root-body` action becomes `setRootBody(selectedBody())`.

## Panel

- `createInspector(element, editor)` replaces the dock placeholder of `inspector`, like the Hierarchy. It subscribes to model `change` and `reset`, `selection`, `mode`, `playhead` and `history`; each marks the panel dirty and requests one `requestAnimationFrame` flush, so bursts redraw once per frame.
- **Flush:** builds the page; when `structure` equals the rendered one, updates values in place, else rebuilds the DOM and moves focus to the row with the same `id` when one had it. A focused text or number field with a draft keeps it (not overwritten) unless the row became read-only or left the page.
- **Fields:** number and text inputs commit on Enter or blur when valid and changed, are `aria-invalid` while invalid and revert on blur; Esc reverts and blurs. Checkboxes and selects commit on `change`. Mixed values show an empty input with the `—` placeholder. Read-only fields use `readOnly` (`aria-disabled` for checkboxes, selects and buttons) and show the reason with `js/tooltip.js`. Action buttons take their enabled state and text from `actions.isEnabled`, `actions.reason` and `actionTitle`, refreshed on every flush.
- Hotkeys: the dispatcher already ignores keys typed in text inputs and selects (`js/hotkeys.js`); the panel adds no key handling of its own beyond Enter and Esc on its fields.
