# Property schema

> Status: **(planned)**. The code version is `lib/schema.js` ([architecture](architecture.md#schema)). This document describes it and must match it field for field.

One schema per object type of the `.rag.json` format ([`DESIGN.md` §6](../DESIGN.md#6-file-format-ragjson)). It is the **single source** for:

| Consumer | Uses |
|---|---|
| Editor model (#9) | `defaultsOf(type)` for every new object. |
| Validation (#25) | Field types, ranges and enums: one generic error per violation ([`DESIGN.md` §6.4](../DESIGN.md#64-validation)). Cross-field rules (limits around 0, convex polygons, key order, references) stay hand-written in `lib/validate.js`. |
| Serializer (#27) | Key order: the row order below is the canonical order of [`DESIGN.md` §6.5](../DESIGN.md#65-round-trip-guarantee). Only schema fields are written. |
| Inspector (#20, #22, #23) | Rows, read-only flags, ranges, enums, and the display unit derived from the data unit. |

## Columns

- **Path:** dotted path inside the object's JSON record. Consecutive rows with the same prefix form one nested object (`limits.enabled`, `limits.lower`, `limits.upper` → `"limits": { … }`).
- **Type:** `string`, `number`, `integer`, `boolean`, `vec2` (`[x, y]`), `vec2[]`, `enum`, `ref:<type>` (an id of that type, or `null` where noted), `color` (`#rrggbb`), `json` (any JSON value), `list:<type>` (ordered child collection).
- **Default:** value given to new objects. Loaded files never get defaults: every field is explicit ([`DESIGN.md` §6.2](../DESIGN.md#62-field-reference)), and a missing field is an error unless marked *optional*.
- **Range:** per-field constraint checked by validation. `>0` means exclusive.
- **Unit:** data unit (file and model). The UI unit follows [`DESIGN.md` §1](../DESIGN.md#1-conventions): `m` → px (× `pixelsPerMeter`), `rad` → degrees, `mult` (0–1) → %. Other units are shown as stored.
- **Flags:** `E` editor-only (RagImporter ignores it), `R` read-only in the inspector, `V` variant (only for the listed shape type), `A` base value of an animation channel.

## document (file top level)

| Path | Type | Default | Range | Unit | Flags |
|---|---|---|---|---|---|
| `format` | string | `"ragassembler"` | constant | — | R |
| `version` | integer | `FORMAT_VERSION` (1) | supported versions | — | R |
| `meta.name` | string | `"ragdoll"` | — | — | E, R |
| `meta.editorVersion` | string | running editor version | — | — | E, R |
| `units.pixelsPerMeter` | number | `32` | >0 | px/m | |
| `preview.gravity` | vec2 | `[0, -10]` | — | m/s² | E |
| `ragdoll` | root | — | — | — | |
| `sprites` | list:spriteAsset | `[]` | — | — | |
| `bodies` | list:body | `[]` | — | — | |
| `joints` | list:joint | `[]` | — | — | |
| `clips` | list:clip | `[]` | — | — | |

`meta.name` and `meta.editorVersion` are not shown as editable fields; how Save updates them is an open item (see the end of this document).

## root (`ragdoll`)

| Path | Type | Default | Range | Unit | Flags |
|---|---|---|---|---|---|
| `id` | string | `"root"` | constant | — | R |
| `name` | string | `"ragdoll"` | — | — | |
| `position` | vec2 | `[0, 0]` | — | m | E |
| `angle` | number | `0` | — | rad | E |
| `rootBody` | ref:body or `null` | `null` | an existing body | — | |
| `channels.strength` | number | `1` | 0–1 | mult | A |
| `channels.gain` | number | `1` | 0–1 | mult | A |
| `channels.damping` | number | `1` | 0–1 | mult | A |

The root inspector also shows `units.pixelsPerMeter` and `preview.gravity` from the document.

## spriteAsset (`sprites[]`)

| Path | Type | Default | Range | Unit | Flags |
|---|---|---|---|---|---|
| `id` | string | generated `s_<n>` | unique | — | R |
| `name` | string | imported file name without extension | — | — | |
| `src` | string | imported file name | relative path | — | |

Inspector-only, derived: `size` (native px and m), `used by`.

## body (`bodies[]`)

| Path | Type | Default | Range | Unit | Flags |
|---|---|---|---|---|---|
| `id` | string | generated `b_<n>` | unique | — | R |
| `name` | string | `body_<n>` | — | — | |
| `position` | vec2 | `[0, 0]` | — | m | |
| `angle` | number | `0` | — | rad | |
| `linearDamping` | number | `0` | ≥0 | 1/s | |
| `angularDamping` | number | `0` | ≥0 | 1/s | |
| `fixedRotation` | boolean | `false` | — | — | |
| `bullet` | boolean | `false` | — | — | |
| `fixtures` | list:shape | — | ≥1 item | — | |

Inspector-only, derived: `mass` (kg, from `lib/geometry.js`), `shapes` list.

## shape (`fixtures[]`)

| Path | Type | Default | Range | Unit | Flags |
|---|---|---|---|---|---|
| `id` | string | generated `f_<n>` | unique | — | R |
| `name` | string | `<type>_<n>` | — | — | |
| `shape.type` | enum | set by the creating tool | `circle`, `box`, `polygon` | — | R |
| `shape.center` | vec2 | `[0, 0]` | — | m | V circle, box |
| `shape.radius` | number | `0.25` | >0 | m | V circle |
| `shape.width` | number | `0.5` | >0 | m | V box |
| `shape.height` | number | `0.5` | >0 | m | V box |
| `shape.angle` | number | `0` | — | rad | V box |
| `shape.vertices` | vec2[] | set by the Polygon tool | 3–8 items | m | V polygon |
| `density` | number | `1` | ≥0 | kg/m² | |
| `friction` | number | `0.6` | ≥0 | — | |
| `restitution` | number | `0` | ≥0 | — | |
| `isSensor` | boolean | `false` | — | — | |
| `selfCollide` | boolean | `false` | — | — | |
| `filter.categoryBits` | integer | `1` | 0–65535 | — | |
| `filter.maskBits` | integer | `65535` | 0–65535 | — | |
| `sprite` | sprite or `null` | `null` | — | — | optional (absent = `null`) |
| `editor.color` | color | `"#8c9eb5"` | `#rrggbb` | — | E (read by `debug` draw) |

Variant rows keep their relative order, so a box is written `type, center, width, height, angle` and a circle `type, center, radius`.

## sprite (`fixtures[].sprite`)

| Path | Type | Default | Range | Unit | Flags |
|---|---|---|---|---|---|
| `asset` | ref:spriteAsset or `null` | `null` | an existing asset | — | A (shape `sprite`) |
| `offset` | vec2 | `[0, 0]` | — | m | |
| `angle` | number | `0` | — | rad | |
| `scale` | vec2 | `[1, 1]` | each ≠ 0 | — | |
| `z` | integer | `0` | — | — | |
| `visible` | boolean | `true` | — | — | |

## joint (`joints[]`)

| Path | Type | Default | Range | Unit | Flags |
|---|---|---|---|---|---|
| `id` | string | generated `j_<n>` | unique | — | R |
| `name` | string | `joint_<n>` | — | — | |
| `type` | enum | `"revolute"` | `revolute` | — | R |
| `bodyA` | ref:body or `null` | `null` (set by the Hinge tool) | an existing body | — | |
| `bodyB` | ref:body or `null` | `null` (set by the Hinge tool) | an existing body | — | |
| `anchor` | vec2 | `[0, 0]` | — | m | |
| `collideConnected` | boolean | `false` | — | — | |
| `limits.enabled` | boolean | `false` | — | — | |
| `limits.lower` | number | `0` | ≤0 | rad | |
| `limits.upper` | number | `0` | ≥0 | rad | |
| `motor.maxTorque` | number | `80` | ≥0 | N·m | |
| `motor.gain` | number | `10` | ≥0 | 1/s | |
| `motor.damping` | number | `0.5` | ≥0 | — | |
| `motor.maxSpeed` | number | `20` | ≥0 | rad/s | |
| `aimAxis` | number | `0` | — | rad | |

The motor defaults are provisional until the motor stability spike (#52) tunes them. `null` bodies are allowed in the model and in drafts, and are validation errors in files. The animated channels (`angle`, `strength`, `gain`, `damping` ◆) are not fields: the inspector shows their evaluated values at the playhead.

## clip (`clips[]`)

| Path | Type | Default | Range | Unit | Flags |
|---|---|---|---|---|---|
| `key` | string | `autoClipKey(name)` | `[a-z0-9_]+`, unique | — | |
| `name` | string | `"New Clip"` | — | — | |
| `loop` | boolean | `true` | — | — | |
| `hold` | boolean | `true` | — | — | |
| `layer` | integer | `0` | ≥0 | — | |
| `blend` | enum | `"override"` | `override`, `additive` | — | |
| `length` | number | `1` | >0 | s | |
| `fadeIn` | number | `0` | ≥0 | s | |
| `fadeOut` | number | `0` | ≥0 | s | |
| `speed` | number | `1` | >0 | — | |
| `tracks` | list:track | `[]` | — | — | |
| `events` | list:event | `[]` | — | — | |

**`autoClipKey(name, takenKeys)`:** lower-case `name`, replace every run of characters outside `[a-z0-9]` with `_`, trim leading and trailing `_`, use `clip` if the result is empty, then append `_2`, `_3`, … until it is not in `takenKeys`. "New Clip" → `new_clip`.

**Key follows name:** when a clip is renamed, if its current `key` equals `autoClipKey(oldName, otherKeys)`, the rename command also sets `key = autoClipKey(newName, otherKeys)`. A hand-edited key no longer matches, so it stops following ([`DESIGN.md` §4.1](../DESIGN.md#41-clips)).

## track (`tracks[]`)

| Path | Type | Default | Range | Unit | Flags |
|---|---|---|---|---|---|
| `target` | ref | set on creation | `"root"`, a joint id or a shape id | — | R |
| `channel` | enum | set on creation | valid for the target (below) | — | R |
| `keys` | list:key | `[]` | — | — | |

## key (`keys[]`)

| Path | Type | Default | Range | Unit | Flags |
|---|---|---|---|---|---|
| `t` | number | playhead time | 0 ≤ t ≤ clip `length` | s | |
| `v` | channel value | evaluated value at `t` | by channel (below) | by channel | |
| `interp` | enum | `"linear"`; `"step"` for `sprite` | `linear`, `step`, `ease`; only `step` for `sprite` | — | |

## event (`events[]`)

| Path | Type | Default | Range | Unit | Flags |
|---|---|---|---|---|---|
| `t` | number | clicked time | [`DESIGN.md` §4.7](../DESIGN.md#47-events) | s | |
| `name` | string | `"event"` | non-empty | — | |
| `data` | json | `null` | any JSON value | — | |

## Channels

`CHANNELS` in `lib/schema.js`, from [`DESIGN.md` §4.2](../DESIGN.md#42-channels):

| Target | Channel | Kind | Key value | Unit | Default when not animated |
|---|---|---|---|---|---|
| root | `strength`, `gain`, `damping` | multiplier | number 0–1 | mult | `ragdoll.channels.<channel>` |
| joint | `angle` | angle | number | rad | `0` |
| joint | `strength`, `gain`, `damping` | multiplier | number 0–1 | mult | `1` |
| shape | `sprite` | discrete | sprite asset id or `null` | — | the shape's `sprite.asset` |

## Code form

`lib/schema.js` is pure data plus small helpers. It imports nothing.

```js
/**
 * @typedef {object} FieldSpec
 * @property {string} path Dotted path inside the record.
 * @property {string} type One of the types listed in docs/schema.md.
 * @property {*} default Default value; `undefined` when set by the creating tool.
 * @property {number} [min] Lower bound.
 * @property {number} [max] Upper bound.
 * @property {boolean} [exclusiveMin] Whether `min` itself is invalid.
 * @property {ReadonlyArray<string>} [enum] Allowed values.
 * @property {string} unit Data unit (`m`, `rad`, `s`, `mult`, …) or `''`.
 * @property {boolean} editorOnly Ignored by RagImporter.
 * @property {boolean} readOnly Not editable in the inspector.
 * @property {boolean} [optional] May be absent in a file (read as `null`).
 * @property {ReadonlyArray<string>} [variants] Shape types the field applies to.
 * @property {string} [channel] Channel whose base value this field holds.
 */
```

| Export | Contract |
|---|---|
| `FORMAT`, `FORMAT_VERSION` | `"ragassembler"`, `1`. |
| `SCHEMA` | Frozen `Record<ObjectType, ReadonlyArray<FieldSpec>>` for `document`, `root`, `spriteAsset`, `body`, `shape`, `sprite`, `joint`, `clip`, `track`, `key`, `event`, in canonical order. |
| `CHANNELS` | Frozen table above. |
| `fieldsOf(type, variant?)` | Fields of a type, filtered by shape variant, in canonical order. |
| `defaultsOf(type, variant?)` | Fresh nested object with every default; list fields are `[]`. |
| `autoClipKey(name, takenKeys)` | Rule above. |

## Open items

- **`meta.name` vs `ragdoll.name`, and `meta.editorVersion` on Save:** [`DESIGN.md` §6](../DESIGN.md#6-file-format-ragjson) does not say whether Save rewrites them, which affects byte-identical round-trip across editor versions. Until decided, the serializer writes the model's values unchanged.
