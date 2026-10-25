# Property schema

> Status: built. The code version is `lib/schema.js` ([architecture](architecture/schema.md#schema)). This document describes it and must match it field for field. Its consumers other than the model are planned.

One schema per object type of the `.rag.json` format ([`DESIGN.md` §6](design/06-file-format.md#6-file-format-ragjson)). It is the **single source** for:

| Consumer | Uses |
|---|---|
| Editor model (#9) | `defaultsOf('root')` and `defaultsOf('document')` for the empty document. |
| Creation commands (#14–#16, #19, #21) | `defaultsOf(type, variant)` for every new object, plus the fields the tool sets. |
| Validation (#25) | Field presence, types, ranges and enums: one generic error per violation (`E_FIELD_MISSING`, `E_FIELD_TYPE`, `E_FIELD_RANGE`, `E_FIELD_ENUM`), and `W_UNKNOWN_FIELD` for keys not listed here ([`DESIGN.md` §6.4](design/06-file-format.md#64-validation)). Ranges apply unconditionally (`limits.lower`/`upper` also when limits are disabled). Rules not expressible as a field spec (ids, references, polygon count and shape, sprite `scale ≠ 0`, clip key pattern and uniqueness, key order and values, `step` for `sprite`, non-empty event names) stay hand-written in `lib/validate.js`. |
| Serializer (#27) | Key order: the row order below is the canonical order of [`DESIGN.md` §6.5](design/06-file-format.md#65-round-trip-guarantee). Only schema fields are written. |
| Inspector (#20, #22, #23) | Rows, read-only flags, ranges, enums, and the display unit derived from the data unit. |

## Columns

- **Path:** dotted path inside the object's JSON record. Consecutive rows with the same prefix form one nested object (`limits.enabled`, `limits.lower`, `limits.upper` → `"limits": { … }`).
- **Type:** `string`, `number`, `integer`, `boolean`, `vec2` (`[x, y]`), `vec2[]`, `enum`, `ref:<type>` (an id of that type, or `null` where noted), `ref` (an id of one of the kinds given in Range), `color` (`#rrggbb`), `json` (any JSON value), `channel` (a key value, typed by the track's channel), `root` / `sprite` (a nested record described by its own table), `list:<type>` (ordered child collection).
- **Default:** value given to new objects. "Set by the creating tool", "generated" and context-dependent defaults are `undefined` in `lib/schema.js`; the creating command supplies them. Loaded files never get defaults: every field is explicit ([`DESIGN.md` §6.2](design/06-file-format.md#62-field-reference)), and a missing field is an error unless marked *optional*.
- **Range:** per-field constraint checked by validation. `>0` means exclusive.
- **Unit:** data unit (file and model). The UI unit follows [`DESIGN.md` §1](design/01-conventions.md#1-conventions): `m` → px (× `pixelsPerMeter`), `rad` → degrees, `mult` (0–1) → %. Other units are shown as stored.
- **Flags:** `E` editor-only (RagImporter ignores it), `R` read-only in the inspector, `V` variant (only for the listed shape type), `A` base value of an animation channel.

## document (file top level)

| Path | Type | Default | Range | Unit | Flags |
|---|---|---|---|---|---|
| `format` | string | `"ragassembler"` | constant | — | R |
| `version` | integer | `FORMAT_VERSION` (2) | supported versions | — | R |
| `meta.name` | string | `"root"` (Save writes `ragdoll.name`) | — | — | E, R |
| `meta.editorVersion` | string | set by Save (running editor version) | — | — | E, R |
| `units.pixelsPerMeter` | number | `32` | >0 | px/m | |
| `preview.gravity` | vec2 | `[0, -10]` | — | m/s² | E |
| `ragdoll` | root | — | — | — | |
| `sprites` | list:spriteAsset | `[]` | — | — | |
| `bodies` | list:body | `[]` | — | — | |
| `joints` | list:joint | `[]` | — | — | |
| `clips` | list:clip | `[]` | — | — | |

`meta.name` and `meta.editorVersion` are not shown in the inspector. Save derives both, ignoring the values in the model: `meta.name` is `ragdoll.name` and `meta.editorVersion` is the running editor's version, `dev` when unknown ([`DESIGN.md` §6.5](design/06-file-format.md#65-round-trip-guarantee)). `toJson(model, editorVersion)` (#27) applies the rule, so validation and the serializer see the derived values.

## root (`ragdoll`)

| Path | Type | Default | Range | Unit | Flags |
|---|---|---|---|---|---|
| `id` | string | `"root"` | constant | — | R |
| `name` | string | `"root"` | — | — | |
| `position` | vec2 | `[0, 0]` | — | m | E, R |
| `angle` | number | `0` | — | rad | E, R |
| `rootBody` | ref:body or `null` | `null` | an existing body | — | |
| `channels.strength` | number | `1` | 0–1 | mult | A |
| `channels.gain` | number | `1` | 0–1 | mult | A |
| `channels.damping` | number | `1` | 0–1 | mult | A |
| `balance.enabled` | boolean | `true` | — | — | |
| `balance.maxTorque` | number | `80` (the editor suggests the balance torque automatically on every rig change, `DESIGN.md` §3.2) | ≥0 | N·m | |
| `balance.gain` | number | `10` | ≥0 | 1/s | |
| `balance.damping` | number | `0.5` | ≥0 | — | |
| `balance.maxSpeed` | number | `20` | ≥0 | rad/s | |

New documents and the 1 → 2 migration both write `balance.enabled = true` ([`DESIGN.md` §6.3](design/06-file-format.md#63-versioning)). The root `bodyAngle` channel ◆ has no field here: the inspector shows its evaluated value at the playhead in Animate mode.

The root inspector also shows `units.pixelsPerMeter` and `preview.gravity` from the document. `position` and `angle` are locked: no editor command writes them, and loaded values are kept ([`DESIGN.md` §2.1](design/02-object-model.md#21-root-the-ragdoll-itself)).

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

In default names (`body_<n>`, `<type>_<n>`, `joint_<n>`), `<n>` is the number of the object's own generated id: body `b_3` is `body_3`, shape `f_5` of type circle is `circle_5`. Shape creation (#14) uses the circle and box size defaults above for a click without a drag ([`DESIGN.md` §5.5](design/05-5-tools.md#55-tools)).

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
| `motor.maxTorque` | number | `80` (the Hinge tool writes the suggested torque, `DESIGN.md` §3.1) | ≥0 | N·m | |
| `motor.gain` | number | `10` | ≥0 | 1/s | |
| `motor.damping` | number | `0.5` | ≥0 | — | |
| `motor.maxSpeed` | number | `20` | ≥0 | rad/s | |
| `aimAxis` | number | `0` | — | rad | |

Joint creation by the Hinge tool (#16, `createJoint`) sets `id`, `name` (`joint_<n>`), `bodyA`, `bodyB` and `anchor`, and `limits` only for a drag (enabled, `−θ`/`θ`); a pin keeps the default disabled limits, and every other field takes the default above ([`DESIGN.md` §5.5](design/05-5-tools.md#55-tools)). Hierarchy *Add joint* (#19) sets only `id`, `name` and `anchor` `[0, 0]`, leaving `bodyA` and `bodyB` `null` ([`DESIGN.md` §5.6](design/05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)). The motor defaults are provisional until the motor stability spike (#52) tunes them. `null` bodies are allowed in the model and in drafts, and are validation errors in files. The animated channels (`angle`, `strength`, `gain`, `damping` ◆) are not fields: the inspector shows their evaluated values at the playhead.

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

The schema default `new_clip` is `autoClipKey("New Clip")` with no taken keys; the create command (#19) recomputes it against the existing keys.

**Key follows name:** when a clip is renamed, if its current `key` equals `autoClipKey(oldName, otherKeys)`, the rename command (`setProps` in `js/commands/props.js`, #10) also sets `key = autoClipKey(newName, otherKeys)` in the same transaction. The model and the schema do not apply this rule. A hand-edited key no longer matches, so it stops following ([`DESIGN.md` §4.1](design/04-animation-model.md#41-clips)).

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
| `t` | number | clicked time | [`DESIGN.md` §4.7](design/04-animation-model.md#47-events) | s | |
| `name` | string | `"event"` | non-empty | — | |
| `data` | json | `null` | any JSON value | — | |

## Channels

`CHANNELS` in `lib/schema.js`, from [`DESIGN.md` §4.2](design/04-animation-model.md#42-channels):

| Target | Channel | Kind | Key value | Unit | Default when not animated |
|---|---|---|---|---|---|
| root | `strength`, `gain`, `damping` | multiplier | number 0–1 | mult | `ragdoll.channels.<channel>` |
| root | `bodyAngle` | angle | number | rad | `0` |
| joint | `angle` | angle | number | rad | `0` |
| joint | `strength`, `gain`, `damping` | multiplier | number 0–1 | mult | `1` |
| shape | `sprite` | discrete | sprite asset id or `null` | — | the shape's `sprite.asset` |

Code form: `CHANNELS[target][channel] = { kind, unit, min?, max?, default, basePath }`. `kind` is `multiplier`, `angle` or `discrete`; `min`/`max` (0, 1) are given for multipliers only. When `basePath` is a string, the not-animated value is the target's prop at that path (`null` when it is absent, e.g. a shape without `sprite`) and `default` is `null`; otherwise `default` is the constant.

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
| `FORMAT`, `FORMAT_VERSION` | `"ragassembler"`, `2`. |
| `SCHEMA` | Frozen `Record<ObjectType, ReadonlyArray<FieldSpec>>` for `document`, `root`, `spriteAsset`, `body`, `shape`, `sprite`, `joint`, `clip`, `track`, `key`, `event`, in canonical order. |
| `CHANNELS` | Frozen table above. |
| `fieldsOf(type, variant?)` | Fields of a type, filtered by shape variant, in canonical order. |
| `defaultsOf(type, variant?)` | Fresh, mutable nested object with every defined default, in canonical order. Fields with an `undefined` default are left out, except `shape.type`, which is the variant when one is given. List fields are `[]`: callers building a model snapshot move them to `children`, since the model rejects collection names in props. |
| `autoClipKey(name, takenKeys)` | Rule above. |
