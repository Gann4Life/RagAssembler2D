# 6. File format (`.rag.json`)

## 6.1 Complete example

```json
{
  "format": "ragassembler",
  "version": 2,
  "meta": { "name": "humanoid", "editorVersion": "0.1.0" },
  "units": { "pixelsPerMeter": 32 },
  "preview": { "gravity": [0, -10] },
  "ragdoll": {
    "id": "root",
    "name": "humanoid",
    "position": [0, 0],
    "angle": 0,
    "rootBody": "b_torso",
    "channels": { "strength": 1, "gain": 1, "damping": 1 },
    "balance": { "enabled": true, "maxTorque": 26, "gain": 10, "damping": 0.5, "maxSpeed": 20 }
  },
  "sprites": [
    { "id": "s_torso", "name": "torso", "src": "humanoid/torso.png" },
    { "id": "s_face_normal", "name": "face_normal", "src": "humanoid/face_normal.png" },
    { "id": "s_face_dead", "name": "face_dead", "src": "humanoid/face_dead.png" }
  ],
  "bodies": [
    {
      "id": "b_torso",
      "name": "torso",
      "position": [0, 1.2],
      "angle": 0,
      "linearDamping": 0,
      "angularDamping": 0.1,
      "fixedRotation": false,
      "bullet": false,
      "fixtures": [
        {
          "id": "f_torso",
          "name": "torso",
          "shape": { "type": "box", "center": [0, 0], "width": 0.4, "height": 0.7, "angle": 0 },
          "density": 1,
          "friction": 0.6,
          "restitution": 0,
          "isSensor": false,
          "selfCollide": false,
          "filter": { "categoryBits": 1, "maskBits": 65535 },
          "sprite": { "asset": "s_torso", "offset": [0, 0.02], "angle": 0, "scale": [1, 1], "z": 10, "visible": true },
          "editor": { "color": "#c8a07a" }
        }
      ]
    }
  ],
  "joints": [
    {
      "id": "j_knee_l",
      "name": "knee_l",
      "type": "revolute",
      "bodyA": "b_thigh_l",
      "bodyB": "b_shin_l",
      "anchor": [-0.1, 0.5],
      "collideConnected": false,
      "limits": { "enabled": true, "lower": -2.4, "upper": 0 },
      "motor": { "maxTorque": 80, "gain": 10, "damping": 0.5, "maxSpeed": 20 },
      "aimAxis": 0
    }
  ],
  "clips": [
    {
      "key": "dead",
      "name": "Dead",
      "loop": false,
      "hold": true,
      "layer": 200,
      "blend": "override",
      "length": 5,
      "fadeIn": 0,
      "fadeOut": 0,
      "speed": 1,
      "tracks": [
        {
          "target": "root",
          "channel": "strength",
          "keys": [
            { "t": 0, "v": 1, "interp": "linear" },
            { "t": 5, "v": 0, "interp": "linear" }
          ]
        },
        {
          "target": "f_head",
          "channel": "sprite",
          "keys": [{ "t": 0, "v": "s_face_dead", "interp": "step" }]
        }
      ],
      "events": [{ "t": 5, "name": "fully_dead", "data": null }]
    }
  ]
}
```

(The example is abbreviated: a valid file would also contain `b_thigh_l`, `b_shin_l` and the head body with shape `f_head`.)

## 6.2 Field reference
- **Coordinate spaces:**
  - `shape` coordinates are local to the body;
  - `sprite.offset/angle` are local to the shape's frame ([§2.2](02-object-model.md#22-bodies-and-shapes));
  - `bodies[].position/angle` and `joints[].anchor` are local to the root, in rest pose;
  - `joints[].aimAxis` is local to bodyB;
  - `ragdoll.position/angle` is the root's placement in the editor scene and is **ignored by runtime spawn**, which uses its own transform. The editor never changes it ([§2.1](02-object-model.md#21-root-the-ragdoll-itself)): new documents write `[0, 0]` and `0`, and loaded values are kept, drawn and saved back as they are.
- **`ragdoll.name`**: the ragdoll's name, `"root"` in a new document. Save writes it as `meta.name` and uses it for the suggested file name ([§5.3](05-3-header.md#53-header)).
- **`ragdoll.channels`**: base values of the global multipliers when no clip animates them.
- **`ragdoll.balance`**: the balance controller that keeps `rootBody` at the root `bodyAngle` ([§3.2](03-physics-drive-model.md#32-balance-controller-rootbody-orientation)). `enabled` (boolean) turns it on; `maxTorque` (N·m, ≥ 0), `gain` (1/s, ≥ 0), `damping` (≥ 0) and `maxSpeed` (rad/s, ≥ 0) mean what they mean on a joint motor. Consumed by RagImporter.
- **`sprites[].src`**: path relative to the `.rag.json` file. It is used as the texture key unless the host provides a resolver ([§7.3](07-ragimporter.md#73-sprites-and-rendering)).
- **`fixtures[].sprite`**: optional; `null` or absent means no sprite.
- **`tracks[].target`**: `"root"`, a joint id or a shape id.
  - Valid channels for `root`: `strength | gain | damping | bodyAngle`.
  - Valid channels for a joint: `angle | strength | gain | damping`.
  - Valid channel for a shape: `sprite` (key values are a sprite asset id or `null`).
- **`meta`**: written by Save, not edited by the user: `meta.name` repeats `ragdoll.name` and `meta.editorVersion` names the editor version that saved the file ([§6.5](#65-round-trip-guarantee)). Their loaded values affect nothing.
- **Editor-only data:** `editor` objects (on fixtures), `meta`, `preview` and `ragdoll.position/angle`. RagImporter ignores them, except `editor.color`, which is used by `debug` drawing.
- **Explicit values:** every field is written explicitly, even when it equals its default, so files are self-describing. A missing field is an error, except `fixtures[].sprite` (absent means `null`).
- **Field schema:** the type, default (for new objects), range or enum, unit and editor-only flag of every field, in canonical key order, are listed in `docs/schema.md`. That table and its code version (`lib/schema.js`) must agree with this section and [§6.1](#61-complete-example).

## 6.3 Versioning
- `version` is an integer and increases on any breaking change.
- The editor migrates older versions on load and always saves the latest one. Migration is an ordered chain of pure steps, one per version (N → N+1), each tested on its own; a breaking change adds its step. A file with errors after migration is rejected ([§5.3](05-3-header.md#53-header)).
- RagImporter declares the versions it supports (`RagImporter.supportedVersions`) and **throws** on any other version, with a clear message; `validate` reports it as `E_VERSION_UNSUPPORTED` ([§6.4](#64-validation)).
- **History.** The latest version is **2**; `supportedVersions` is `[2]`, so files saved as version 1 must be opened and saved again in the editor before a host loads them.
  - **1 → 2** (root `bodyAngle` channel and `ragdoll.balance`, [§3.2](03-physics-drive-model.md#32-balance-controller-rootbody-orientation)): adds `ragdoll.balance = { enabled: false, maxTorque, gain: 10, damping: 0.5, maxSpeed: 20 }`, with `maxTorque` = `balanceTorqueSuggestion` of the document, or `80` when it is `null`. `enabled: false` keeps the old runtime behavior (no torque on `rootBody`); the user turns it on in the root inspector. Nothing else changes: version 1 files have no `bodyAngle` tracks. When `ragdoll` is not an object the step adds nothing and validation reports the file.
- Unknown fields:
  - RagImporter ignores them;
  - the editor drops them with a warning (`W_UNKNOWN_FIELD`).

## 6.4 Validation
Shared by the editor (Problems panel, load, save) and RagImporter (`parse`), via `RagImporter.validate(json) → { errors, warnings }`. Errors block save and `parse`; warnings never block.

**Contract:**
- `validate` **never throws** for any input: any value `JSON.parse` can return, and editor JSON with `undefined`, `NaN` or `Infinity` in it. It needs neither liquidfun.js nor PIXI.js.
- Each entry is a **problem** `{ severity, code, message, path, target }`:
  - `severity`: `"error"` or `"warning"`, fixed per code (tables below);
  - `code`: stable identifier from the tables below. Codes are the contract: they are never renamed or reused, only added;
  - `message`: one English sentence for people, sentence case, no trailing period, starting with the object kind and its name when it has a usable one (`Joint "knee_l": bodyA and bodyB are the same body`). It names fields by their schema path and quotes no length or angle values (the editor shows pixels and degrees, [§1](01-conventions.md#1-conventions)). Wording is not stable; code against `code`;
  - `path`: [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901) to the offending value in the validated JSON (`"/bodies/2/fixtures/0/shape/radius"`; `""` for the whole document). A missing field points where it should be; a duplicate points at the later occurrence;
  - `target`: the innermost object on `path` that the editor can select, as `{ type, id }`: `type` is `root`, `spriteAsset`, `body`, `shape`, `joint` or `clip` (the `docs/schema.md` type names), `id` is that object's `id` (a clip's `key`). It is `null` for document-level paths (`/format`, `/version`, `/meta`, `/units`, `/preview`) and when that object's `id` (`key`) is not a string. Problems inside tracks, keys and events target their clip.
- **Gate:** if the input is not an object, `format` is wrong or `version` is not in `RagImporter.supportedVersions`, only those errors are returned.
- **No cascades:** a rule that reads a field skips it when that field already has an error (a non-number `radius` gives `E_FIELD_TYPE` only), and a `(path, code)` pair is reported at most once.
- **Order** is deterministic for a given input and otherwise unspecified.
- **Editor-only input:** the editor may pass `{ hasImage(asset) → boolean }` as a second argument to get `W_SPRITE_IMAGE_MISSING`; without it that check is skipped. `RagImporter.validate` takes no options.
- Every shape that fails the editor's drawing rule (`shapeGeometryValid` in `lib/geometry.js`) gets at least one error.

**Errors:**

| Code | Condition | Path |
|---|---|---|
| `E_FORMAT` | The input is not an object, or `format` is not `"ragassembler"`. The editor's loader also uses it for text that is not valid JSON. | `""` or `/format` |
| `E_VERSION_UNSUPPORTED` | `version` is missing or not one of `RagImporter.supportedVersions` ([§6.3](#63-versioning)). | `/version` |
| `E_FIELD_MISSING` | A field of `docs/schema.md` is absent (only `fixtures[].sprite` is optional). | the field |
| `E_FIELD_TYPE` | Wrong type: numbers must be finite, `integer` whole, `vec2` two finite numbers, `color` `#rrggbb`, references a string (or `null` where allowed), lists arrays of objects. | the field |
| `E_FIELD_RANGE` | Outside the field's range in `docs/schema.md`, or not its constant (`ragdoll.id` is `"root"`). This covers non-positive sizes and radii, `length`/`speed ≤ 0`, negative fades, damping, motor and `balance` values, `channels` outside 0–1, and `limits.lower > 0` or `limits.upper < 0` whether or not limits are enabled. | the field |
| `E_FIELD_ENUM` | Not one of the field's enum values. | the field |
| `E_ID_EMPTY` | An empty `id` (sprite asset, body, shape or joint). | `…/id` |
| `E_ID_DUPLICATE` | An `id` already used earlier, across sprite assets, bodies, shapes and joints. | `…/id` |
| `E_ID_RESERVED` | An object other than the root uses the id `root`. | `…/id` |
| `E_ROOT_BODY_MISSING` | `rootBody` is `null`. | `/ragdoll/rootBody` |
| `E_ROOT_BODY_UNKNOWN` | `rootBody` is not a body id. | `/ragdoll/rootBody` |
| `E_BODY_NO_FIXTURES` | A body with an empty `fixtures` list. | `/bodies/i/fixtures` |
| `E_POLYGON_VERTEX_COUNT` | Fewer than 3 or more than 8 vertices. | `…/shape/vertices` |
| `E_POLYGON_DEGENERATE` | Two vertices closer than 0.0025 m, or three consecutive vertices collinear (cross product of the two edges within 1e-9 m²). | `…/shape/vertices` |
| `E_POLYGON_NOT_CCW` | Negative signed area (clockwise). | `…/shape/vertices` |
| `E_POLYGON_NOT_CONVEX` | A reflex vertex, or edges that turn more than once around (self-intersecting star). | `…/shape/vertices` |
| `E_SPRITE_ASSET_UNKNOWN` | `sprite.asset` is neither `null` nor a sprite asset id. | `…/sprite/asset` |
| `E_SPRITE_SCALE_ZERO` | A `sprite.scale` component is 0. | `…/sprite/scale` |
| `E_JOINT_BODY_MISSING` | `bodyA` or `bodyB` is `null`. | `/joints/i/bodyA` or `bodyB` |
| `E_JOINT_BODY_UNKNOWN` | `bodyA` or `bodyB` is not a body id. | `/joints/i/bodyA` or `bodyB` |
| `E_JOINT_SAME_BODY` | `bodyA == bodyB`. | `/joints/i/bodyB` |
| `E_CLIP_KEY_INVALID` | `key` does not match `[a-z0-9_]+`. | `/clips/i/key` |
| `E_CLIP_KEY_DUPLICATE` | `key` already used by an earlier clip. | `/clips/i/key` |
| `E_TRACK_TARGET_UNKNOWN` | `target` is not `"root"`, a joint id or a shape id. | `…/tracks/j/target` |
| `E_TRACK_CHANNEL` | `channel` is not valid for the target ([§6.2](#62-field-reference)). | `…/tracks/j/channel` |
| `E_TRACK_DUPLICATE` | An earlier track of the clip has the same `target + channel`. | `…/tracks/j` |
| `E_KEYS_UNSORTED` | A key's `t` is smaller than the previous key's. | `…/keys/k/t` |
| `E_KEY_TIME_DUPLICATE` | A key's `t` equals the previous key's. | `…/keys/k/t` |
| `E_KEY_TIME_RANGE` | A key's `t` is outside `[0, length]`. | `…/keys/k/t` |
| `E_KEY_VALUE` | `v` does not fit the channel: a multiplier not in 0–1, an angle (`angle`, `bodyAngle`) not a finite number, a `sprite` value neither `null` nor an asset id. | `…/keys/k/v` |
| `E_KEY_INTERP_SPRITE` | A `sprite` key whose `interp` is not `step`. | `…/keys/k/interp` |
| `E_EVENT_NAME_EMPTY` | An event with an empty `name`. | `…/events/k/name` |
| `E_EVENT_TIME_RANGE` | An event `t` outside `[0, length)` in a loop clip or `[0, length]` otherwise ([§4.7](04-animation-model.md#47-events)). | `…/events/k/t` |

**Warnings:**

| Code | Condition | Path |
|---|---|---|
| `W_UNKNOWN_FIELD` | A key not in `docs/schema.md` for that object (and shape type). Not checked inside `json` values (`events[].data`). RagImporter ignores such fields; the editor drops them on load ([§6.3](#63-versioning)). | the key |
| `W_BODY_UNLINKED` | A body not connected to `rootBody` through joints. Checked only when `rootBody` is a body id. | `/bodies/i` |
| `W_JOINT_LOOP` | A loop joint ([§2.4](02-object-model.md#24-joints)). | `/joints/i` |
| `W_ANCHOR_OUTSIDE` | The anchor is farther than 0.001 m from every shape of both bodies, in rest pose. | `/joints/i/anchor` |
| `W_BODY_ZERO_MASS` | A body with fixtures and no errors in them whose total mass is 0. | `/bodies/i` |
| `W_MOTOR_OVERPOWERED` | `motor.maxTorque` is more than 1000 × the joint's suggested torque ([§3.1](03-physics-drive-model.md#31-suggested-motor-torque)), which makes light bodies gain energy on contact. Skipped when the suggestion is `null`, and when the document has any error in `bodies` or in that joint (no cascades). The message names Fit motor torque ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) and quotes no values. | `/joints/i/motor/maxTorque` |
| `W_CLIP_EMPTY` | A clip with no tracks and no events. | `/clips/i` |
| `W_SPRITE_UNUSED` | A sprite asset referenced by no `sprite.asset` and no `sprite` key value. | `/sprites/i` |
| `W_SPRITE_IMAGE_MISSING` | Editor only: `hasImage(asset)` returned `false`. | `/sprites/i/src` |
| `W_DUPLICATE_NAME` | One warning per duplicated name within a kind (bodies, joints, shapes; all shapes of the file form one kind). `path` is the second occurrence and the message lists every colliding id. Equal names across kinds do not warn. Runtime lookups by name return the first ([§7.1](07-ragimporter.md#71-api)). | `…/name` |

Joint edges, unlinked bodies and loop joints follow one rule, shared with the editor's joint graph: a joint is an edge when `bodyA` and `bodyB` are two different body ids; a breadth-first search from `rootBody`, visiting edges in `joints` order, marks tree joints; every other edge between reachable bodies is a loop joint.

## 6.5 Round-trip guarantee
Save always writes the **canonical form**:
- Key order follows the example above.
- Arrays keep editor order: sprite assets in Assets panel order; bodies, joints and clips in hierarchy/list order; fixtures in body order; keys sorted by `t`; events sorted by `t`.
- Numbers are rounded to 1e-5 and written without trailing zeros. `-0` is written as `0`. This applies to every number, `json` values (`events[].data`) included; keys inside `json` values keep their order.
- 2-space indentation, `\n` line endings, final newline.
- An array whose items are all numbers (e.g. a `vec2`) is written on one line as `[x, y]`, with `, ` between items; every other array and every object is expanded, one item or key per line; empty arrays and objects are `[]` and `{}`. The §6.1 example is compacted for reading and is not canonical.
- `meta` is derived on every Save, never copied from the loaded file:
  - `meta.name` is `ragdoll.name`;
  - `meta.editorVersion` is the running editor's version: the `version` of the deployed `version.json` without its leading `v` (`v0.4.0` → `0.4.0`), or `dev` when it is unavailable (local server, failed or pending fetch).
  - The model export takes the editor version as a parameter and reads no global state, so tests pass it explicitly. Validation before Save and in the Problems panel runs on that export, so a document never saved has no missing `meta` field.
- Sprite images are written back unchanged (same bytes, same paths).

**Load → Save is byte-identical** for a canonical file: valid, at the latest format version, without unknown fields, written by the rules above, with `meta.name` equal to `ragdoll.name` and `meta.editorVersion` equal to the running editor's version. Every file Save writes is canonical for the editor that wrote it, so saving it again from that editor version gives the same bytes.

Any other valid file loads and saves without losing data; the output differs from the input only by:
- `meta.editorVersion` (a file saved by another editor version, including `dev`) and `meta.name` (when it differed from `ragdoll.name`);
- migration from an older format version ([§6.3](#63-versioning));
- dropped unknown fields (`W_UNKNOWN_FIELD`, [§6.3](#63-versioning));
- canonical formatting: key order, number rounding and whitespace.
