# 5.7 Inspector / Properties panel
Default location ([§5.2](05-2-panels.md#52-panels)): right bottom. The inspector always shows the public properties of the selection and lets the user edit them. With multiple objects of the same type selected, it edits shared fields, and mixed values are shown as `—`.

- **Display units:** pixels and degrees in the UI, meters and radians in the file. Multipliers are shown as %.
- **Animation:** in Animate mode, animatable properties show a **key button ◆**. It is filled when a key exists at the playhead; clicking inserts or updates the key, and right-click removes it. The field shows the evaluated value at the playhead.

**Ragdoll (root)**

| Property | Notes |
|---|---|
| name | Ragdoll name, default `root`; Save writes it as `meta.name` and suggests `<name>.rag.json` ([§5.3](05-3-header.md#53-header)). |
| id | `root`, read-only. |
| position, angle | Read-only: the locked root transform ([§2.1](02-object-model.md#21-root-the-ragdoll-itself)). |
| rootBody | Dropdown of bodies. |
| pixelsPerMeter | Editor and runtime render scale. |
| preview gravity | Editor preview only. |
| strength, gain, damping ◆ | Base global multipliers (0–100 %). Animatable as root channels. |

**Body**

| Property | Notes |
|---|---|
| name, id (read-only) | |
| position, angle | Root-local, rest pose. |
| linearDamping, angularDamping | ≥ 0. |
| fixedRotation, bullet | bool. |
| mass | Read-only, computed from shapes. |
| shapes | List; clicking one selects it. |

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
| motor: maxTorque, gain, damping, maxSpeed | Base values ([§3](03-physics-drive-model.md#3-physics-drive-model-springs-via-motors)). |
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
