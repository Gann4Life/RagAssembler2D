# 5.7 Inspector / Properties panel
Default location ([§5.2](05-2-panels.md#52-panels)): right bottom. The inspector always shows the public properties of the selection and lets the user edit them. With multiple objects of the same type selected, it edits shared fields, and mixed values are shown as `—`.

- **Display units:** pixels and degrees in the UI, meters and radians in the file. Multipliers are shown as %, 0–100. Other units are shown as stored, with their unit ([`docs/schema.md`](../schema.md), Unit).
- **Display precision:** without trailing zeros, px, °, %, and px/m with 1 decimal; m/s², 1/s, rad/s and unitless values with 2; N·m and kg with 3 significant digits. A field commits only when its text differs from the displayed text, so leaving a field untouched never writes a rounded value; typed values are stored exactly.
- **Animation:** in Animate mode, animatable properties show a **key button ◆**. It is filled when a key exists at the playhead; clicking inserts or updates the key, and right-click removes it. The field shows the evaluated value at the playhead. Until key buttons exist (#39), animatable fields show the evaluated value read-only.
- **Page.** The inspector shows one page for the objects list of the selection (the timeline list when the selection's focus is the timeline, [§5.8](05-8-animation-timeline.md#58-animation-timeline)):
  - nothing selected: the Ragdoll (root) page, so document settings are always at hand;
  - objects of different types: "*N* objects selected" and the count per type (e.g. "2 bodies, 1 joint"), no fields;
  - one type: its page, titled with the type and the name (or the count when several are selected). A type whose page is not built yet shows its title and "Properties: not available yet".
- **Shared and mixed values.** With several objects of one type selected, every field of the page is shown; a field whose value differs between them shows `—` (empty, `—` as placeholder) and a commit writes the typed value to all of them. A vector field is mixed per component. Lists and read-only derived values that differ show `—`. A mixed checkbox is shown indeterminate; a click sets all of them to true.
- **Editing.** Text and number fields commit on Enter or blur when the value is valid and changed; while invalid (not a number, out of range) they are marked invalid and revert on blur. Enter commits and keeps the focus in the field, with its text selected; Esc reverts and leaves the field. Checkboxes and dropdowns commit on change. Every commit is one undo step through the command stack, labelled after the field (e.g. "Edit linear damping"). Ranges are checked in display units (`≥ 0`, multipliers 0–100 %, `pixelsPerMeter` > 0).
- **Modes** ([§5.1](05-1-modes.md#51-editor-modes)). Edit: fields are editable unless marked read-only. Animate: non-animatable fields are read-only and show the document (rest-pose) values. Simulate: every field is read-only and shows the document values, not the live physics state. A read-only field gives its reason on hover and focus (the mode reason, or why the value is derived). Fields are also read-only, without a reason, during a viewport drag or scrub.
- **Refresh.** The inspector follows selection, document, mode and playhead changes, and redraws at most once per frame however many arrive. A field being typed in keeps its text until it commits or reverts, unless it becomes read-only or its object leaves the selection.

**Ragdoll (root)**

| Property | Notes |
|---|---|
| name | Ragdoll name, default `root`; Save writes it as `meta.name` and suggests `<name>.rag.json` ([§5.3](05-3-header.md#53-header)). |
| id | `root`, read-only. |
| position, angle | Read-only: the locked root transform ([§2.1](02-object-model.md#21-root-the-ragdoll-itself)). |
| rootBody | Dropdown of the bodies in document order (name, or id when the name is empty). Choosing one runs Set as root body on it ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)), with the same undo step and status message, so clips keep their look. While `rootBody` is `null` it shows "(none)", which cannot be chosen. Edit mode only. |
| pixelsPerMeter | Editor and runtime render scale, px/m, > 0. The same value as Settings › Document ([§5.3](05-3-header.md#53-header)). |
| preview gravity | `preview.gravity`, x and y in m/s². Editor-only: Simulate and the clip simulation use it ([§5.1](05-1-modes.md#51-editor-modes)). |
| strength, gain, damping ◆ | Base global multipliers (0–100 %). Animatable as root channels. |
| body angle ◆ | Animate mode only: the evaluated root `bodyAngle` at the playhead, in degrees ([§4.2](04-animation-model.md#42-channels)). No base field. |
| balance | A group with `enabled` (checkbox), `maxTorque` (N·m), `gain` (1/s), `damping`, `maxSpeed` (rad/s) of the balance controller ([§3.2](03-physics-drive-model.md#32-balance-controller-rootbody-orientation)), all ≥ 0. `maxTorque` is automatic, like a joint's: read-only, shown as "auto (*value* N·m)", since every rig change sets it to the suggestion ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels), Automatic motor torque). Not animatable. |

**Body** (a rigidbody: invisible in the viewport, its shapes define its collision area; the page has no position or angle, transforms come from the viewport tools)

| Property | Notes |
|---|---|
| name, id (read-only) | |
| linearDamping, angularDamping | 1/s, ≥ 0. |
| fixedRotation, bullet | bool. |
| mass | Read-only, kg, 3 significant digits: computed from the shapes and their density (`bodyMass`). |
| shapes | List of the body's shapes (name, or id when the name is empty); clicking one selects it. With several bodies selected the row shows `—`. |
| Set as root body | Button, runs the Set as root body action ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) and is disabled with its reason like it; shown as "Root body" when the body already is `rootBody`. |

**Shape (fixture)**

| Property | Notes |
|---|---|
| name, id (read-only), type (read-only) | |
| circle: center, radius | |
| box: center, width, height, angle | |
| polygon: vertex list | Editable x/y rows, validated convex. |
| density, friction, restitution | Defaults 1, 0.6, 0. |
| isSensor | bool. |
| selfCollide | bool, default false ([§2.5](02-object-model.md#25-collision-rules)). |
| categoryBits, maskBits | 16-bit checkbox grid. |
| color | Editor and debug-draw only. |
| **Sprite:** asset ◆ | Dropdown with thumbnails, or "(none)". Animatable as the `sprite` channel. |
| **Sprite:** offset, angle, scale, z, visible | [§2.3](02-object-model.md#23-sprites). |

**Joint (revolute)**

| Property | Notes |
|---|---|
| name, id (read-only), type (read-only) | |
| bodyA, bodyB | Dropdowns, plus a swap button. |
| anchor | Root-local. |
| collideConnected | Default false. |
| limits: enabled, lower, upper | Degrees in the UI, `lower ≤ 0 ≤ upper`. |
| motor: maxTorque, gain, damping, maxSpeed | Base values ([§3](03-physics-drive-model.md#3-physics-drive-model-springs-via-motors)). maxTorque is automatic ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels), Automatic motor torque): shown read-only with "auto" until user-set values are specified ([§12](12-open-items.md#12-open-items--to-verify)). |
| aimAxis | Degrees in the UI ([§4.8](04-animation-model.md#48-procedural-joint-control)). |
| angle ◆, strength ◆, gain ◆, damping ◆ | Animated channels at the playhead. |

**Sprite asset**

| Property | Notes |
|---|---|
| name, id (read-only) | |
| src | Relative path. |
| size | Native pixel size and size in meters, read-only. |
| used by | Read-only list. |

**Clip**: all properties of [§4.1](04-animation-model.md#41-clips). Editing `key` shows a warning that game code referencing the old key will break.

**Key** (selected in the timeline)

| Property | Notes |
|---|---|
| time | Snapped to the timeline step unless snap is off. |
| value | Degrees for `angle`, % for multipliers, an asset dropdown for `sprite`. |
| interp | linear / step / ease (`step` only for `sprite`). |

**Event** (selected in the timeline)

| Property | Notes |
|---|---|
| time | |
| name | Required. |
| data | Text field. Parsed as JSON when valid, otherwise stored as a string. |
