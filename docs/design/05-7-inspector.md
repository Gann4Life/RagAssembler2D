# 5.7 Inspector / Properties panel
Default location ([§5.2](05-2-panels.md#52-panels)): right bottom. The inspector always shows the public properties of the selection and lets the user edit them. With multiple objects of the same type selected, it edits shared fields, and mixed values are shown as `—`.

- **Display units:** pixels and degrees in the UI, meters and radians in the file. Multipliers are shown as %, 0–100. Other units are shown as stored, with their unit ([`docs/schema.md`](../schema.md), Unit).
- **Display precision:** without trailing zeros, px, °, %, and px/m with 1 decimal; m/s², 1/s, rad/s and unitless values with 2; N·m and kg with 3 significant digits. A field commits only when its text differs from the displayed text, so leaving a field untouched never writes a rounded value; typed values are stored exactly.
- **Animation (key buttons ◇).** The multiplier channels have a **key button ◇** next to their field: the Ragdoll page's strength, balance, gain and damping (root channels) and the Joint page's strength, gain and damping (joint channels).
  - **States:** empty when the open clip has no track for the channel; outlined when it has one but no key at the playhead; filled when a key of that track sits at the playhead (same 1e-6 s tolerance as the Summary row, [§5.8](05-8-animation-timeline.md#58-animation-timeline)). Its tooltip and accessible name say the state and the action, e.g. "Key strength at 0.40 s (not animated)".
  - **Click:** adds the track when missing and inserts or updates the key at the playhead with the field's current value, as one undo step "Key *channel*". There is no right-click action: keys are deleted in the timeline (Delete keys).
  - **Field in Animate with a clip open:** shows the open clip's track value at the playhead (the clip's own value, before blending with the base or other layers; a keyless or missing track shows the channel's neutral value, as the timeline's double-click uses). An animated channel (it has a track) is editable: a commit inserts or updates the key at the playhead, one undo step "Key *channel*"; out-of-range values revert like any field. A non-animated channel is read-only with the reason "click ◇ to animate this channel", so base values change only in Edit mode.
  - **Edit and Simulate:** ◇ is shown disabled with the reason "only in Animate mode"; root multiplier fields edit the base values (`ragdoll.channels`) in Edit mode, and joint channel rows are hidden (they have no base value).
  - **Several joints selected:** the joint ◇ buttons are disabled and the joint channel fields read-only, both with the reason "select one joint".
  - **Angles and sprites:** the joint `angle` and root `bodyAngle` rows show the evaluated value at the playhead read-only, without ◇, with the reason "key angles with Pose or Key selected" ([§5.5](05-5-tools.md#55-tools), [§5.8](05-8-animation-timeline.md#58-animation-timeline)). The sprite asset key button comes with sprite tracks.
- **Page.** The inspector shows one page for the objects list of the selection (the timeline list when the selection's focus is the timeline, [§5.8](05-8-animation-timeline.md#58-animation-timeline)):
  - nothing selected: the **Document** page (below), the document-level settings and nothing else;
  - the root selected: the **Ragdoll** page, ragdoll fields only (no document settings);
  - objects of different types: "*N* objects selected" and the count per type (e.g. "2 bodies, 1 joint"), no fields;
  - one type: its page, titled with the type and the name (or the count when several are selected). A type whose page is not built yet shows its title and "Properties: not available yet".
- **Shared and mixed values.** With several objects of one type selected, every field of the page is shown; a field whose value differs between them shows `—` (empty, `—` as placeholder) and a commit writes the typed value to all of them. A vector field is mixed per component. Lists and read-only derived values that differ show `—`. A mixed checkbox is shown indeterminate; a click sets all of them to true.
- **Editing.** Text and number fields commit on Enter or blur when the value is valid and changed; while invalid (not a number, out of range) they are marked invalid and revert on blur. Enter commits and keeps the focus in the field, with its text selected; Esc reverts and leaves the field. Checkboxes and dropdowns commit on change. Every commit is one undo step through the command stack, labelled after the field (e.g. "Edit linear damping"). Ranges are checked in display units (`≥ 0`, multipliers 0–100 %, `pixelsPerMeter` > 0).
- **Modes** ([§5.1](05-1-modes.md#51-editor-modes)). Edit: fields are editable unless marked read-only. Animate: non-animatable fields are read-only and show the document (rest-pose) values. Simulate: every field is read-only and shows the document values, not the live physics state. A read-only field gives its reason on hover and focus (the mode reason, or why the value is derived). Fields are also read-only, without a reason, during a viewport drag or scrub.
- **Refresh.** The inspector follows selection, document, mode and playhead changes, and redraws at most once per frame however many arrive. A field being typed in keeps its text until it commits or reverts, unless it becomes read-only or its object leaves the selection.

**Document** (nothing selected; it does not select the root)

| Property | Notes |
|---|---|
| pixelsPerMeter | Editor and runtime render scale, px/m, > 0. The same value as Settings › Document ([§5.3](05-3-header.md#53-header)). |
| preview gravity | `preview.gravity`, x and y in m/s². Editor-only: Simulate and the clip simulation use it ([§5.1](05-1-modes.md#51-editor-modes)). |

**Ragdoll (root)** (the root selected)

| Property | Notes |
|---|---|
| name | Ragdoll name, default `root`; Save writes it as `meta.name` and suggests `<name>.rag.json` ([§5.3](05-3-header.md#53-header)). |
| id | `root`, read-only. |
| position, angle | Read-only: the locked root transform ([§2.1](02-object-model.md#21-root-the-ragdoll-itself)). |
| rootBody | Dropdown of the bodies in document order (name, or id when the name is empty). Choosing one runs Set as root body on it ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)), with the same undo step and status message, so clips keep their look. While `rootBody` is `null` it shows "(none)", which cannot be chosen. Edit mode only. |
| strength, balance, gain, damping ◇ | Drive group, in this order. Base global multipliers (0–100 %) in Edit mode; root channels with key buttons in Animate mode (Animation, above). `strength` scales the joint motors, `balance` the balance controller, `gain` and `damping` both ([§3.2](03-physics-drive-model.md#32-balance-controller-rootbody-orientation)). |
| body angle | Animate mode only: the evaluated root `bodyAngle` at the playhead, in degrees ([§4.2](04-animation-model.md#42-channels)), read-only. No base field. |
| balance | A group with `enabled` (checkbox), `maxTorque` (N·m), `gain` (1/s), `damping`, `maxSpeed` (rad/s) of the balance controller ([§3.2](03-physics-drive-model.md#32-balance-controller-rootbody-orientation)), all ≥ 0. `maxTorque` is automatic, like a joint's: read-only, shown as "auto (*value* N·m)", since every rig change sets it to the suggestion ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels), Automatic motor torque). Not animatable. |

**Body** (a rigidbody: invisible in the viewport, its shapes define its collision area; the page has no position or angle, transforms come from the viewport tools)

| Property | Notes |
|---|---|
| name, id (read-only) | |
| linearDamping, angularDamping | 1/s, ≥ 0. |
| fixedRotation, bullet | bool. |
| mass | `body.mass`, kg, > 0, default 1, shown with 3 significant digits. Editable; with several bodies selected it shows `—` when they differ and a commit sets all of them. Shapes only distribute it ([§3.3](03-physics-drive-model.md#33-body-mass)). A commit recomputes the automatic motor torques ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)). Not animatable. |
| shapes | List of the body's shapes (name, or id when the name is empty); clicking one selects it. With several bodies selected the row shows `—`. |
| Set as root body | Button, runs the Set as root body action ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) and is disabled with its reason like it; shown as "Root body" when the body already is `rootBody`. |

**Shape (fixture)**

| Property | Notes |
|---|---|
| name, id (read-only), type (read-only) | |
| circle: center, radius | |
| box: center, width, height, angle | |
| polygon: vertex list | Editable x/y rows, validated convex. |
| friction, restitution | Defaults 0.6, 0. No density: the body's mass is distributed by area ([§3.3](03-physics-drive-model.md#33-body-mass)). |
| isSensor | bool. |
| selfCollide | bool, default false ([§2.5](02-object-model.md#25-collision-rules)). |
| categoryBits, maskBits | 16-bit checkbox grid. |
| color | Editor and debug-draw only. |
| **Sprite:** asset | Dropdown with thumbnails, or "(none)". Animatable as the `sprite` channel; its key button comes with sprite tracks. |
| **Sprite:** offset, angle, scale, z, visible | [§2.3](02-object-model.md#23-sprites). |

**Joint (revolute)**

| Property | Notes |
|---|---|
| name, id (read-only), type (read-only) | |
| bodyA, bodyB | Read-only: each body's name (or id when the name is empty). No swap or reassignment in the inspector for now ([§12](12-open-items.md#12-open-items--to-verify), Joint body swap). |
| anchor | Root-local, px in the UI. An edit moves only the anchor, like ALT + dragging the joint ([§5.5](05-5-tools.md#55-tools)): no body moves. Validation warns when it ends outside both bodies' shapes ([§6.4](06-file-format.md#64-validation)). |
| rest angle | `bodyB.angle − bodyA.angle` in degrees (derived, not stored, [§2.4](02-object-model.md#24-joints)). An edit turns the subtree of the joint's **child body** (the body it is the parent joint of, [§2.4](02-object-model.md#24-joints)) about the anchor until the rest angle is the typed value, as the Select rotation ring does on this joint without ALT ([§5.5](05-5-tools.md#55-tools)); bodyA and the parent side stay. When the child is bodyA (reversed joint) the subtree turns the opposite way. Limits, `aimAxis` and keys stay, since they are relative to rest. Read-only with its reason when the joint has no child body (a loop joint, or invalid bodies) or no placed anchor. Not animatable: Edit mode only. This is the inspector's only rotation of bodies (the Body page has none). |
| collideConnected | Default false. |
| limits: enabled, lower, upper | Degrees in the UI. `lower ≤ 0` and `upper ≥ 0`, so `lower ≤ 0 ≤ upper` always holds; other values are invalid and revert. |
| motor: maxTorque | Read-only, shown as "auto (*value* N·m)": it is automatic ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels), Automatic motor torque) and every rig change sets it to the suggestion, `—` with no suggestion. A user-set torque is a later feature ([§12](12-open-items.md#12-open-items--to-verify), User-set motor torque). |
| motor: gain, damping, maxSpeed | Base values ([§3](03-physics-drive-model.md#3-physics-drive-model-springs-via-motors)), ≥ 0; gain in 1/s, maxSpeed in rad/s. maxSpeed's hint: "Caps the correction speed only; keyed motion is never slowed by it." |
| aimAxis | Degrees in the UI, any finite value, local to bodyB ([§4.8](04-animation-model.md#48-procedural-joint-control)). |
| angle | Animate mode only: the evaluated `angle` channel at the playhead, in degrees, read-only (Animation, above). |
| strength ◇, gain ◇, damping ◇ | Animate mode only: the joint's multiplier channels (0–100 %) with key buttons (Animation, above). Distinct from the motor's base gain and damping. |

**Sprite asset**

| Property | Notes |
|---|---|
| name, id (read-only) | |
| src | Relative path. |
| size | Native pixel size and size in meters, read-only. |
| used by | Read-only list. |

**Clip**: all properties of [§4.1](04-animation-model.md#41-clips). Editing `key` shows a warning that game code referencing the old key will break.

**Key** (selected in the timeline; not built yet, #174)

| Property | Notes |
|---|---|
| time | Snapped to the timeline step unless snap is off. |
| value | Degrees for `angle` and `bodyAngle`, % for multipliers (0–100 %; other values are invalid and revert), an asset dropdown for `sprite`. Editable in Animate mode only. With several keys selected it follows the shared-values rule; when they mix value kinds (angle, multiplier, sprite) it shows `—` read-only with the reason "keys of different kinds". A commit is one undo step "Edit key value". |
| interp | linear / step / ease (`step` only for `sprite`). |

**Event** (selected in the timeline)

| Property | Notes |
|---|---|
| time | |
| name | Required. |
| data | Text field. Parsed as JSON when valid, otherwise stored as a string. |
