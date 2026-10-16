# 6. File format (`.rag.json`)

## 6.1 Complete example

```json
{
  "format": "ragassembler",
  "version": 1,
  "meta": { "name": "humanoid", "editorVersion": "0.1.0" },
  "units": { "pixelsPerMeter": 32 },
  "preview": { "gravity": [0, -10] },
  "ragdoll": {
    "id": "root",
    "name": "humanoid",
    "position": [0, 0],
    "angle": 0,
    "rootBody": "b_torso",
    "channels": { "strength": 1, "gain": 1, "damping": 1 }
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
  - `ragdoll.position/angle` is the root's placement in the editor scene and is **ignored by runtime spawn**, which uses its own transform.
- **`ragdoll.channels`**: base values of the global multipliers when no clip animates them.
- **`sprites[].src`**: path relative to the `.rag.json` file. It is used as the texture key unless the host provides a resolver ([§7.3](07-ragimporter.md#73-sprites-and-rendering)).
- **`fixtures[].sprite`**: optional; `null` or absent means no sprite.
- **`tracks[].target`**: `"root"`, a joint id or a shape id.
  - Valid channels for `root`: `strength | gain | damping`.
  - Valid channels for a joint: `angle | strength | gain | damping`.
  - Valid channel for a shape: `sprite` (key values are a sprite asset id or `null`).
- **Editor-only data:** `editor` objects (on fixtures), `preview` and `ragdoll.position/angle`. RagImporter ignores them, except `editor.color`, which is used by `debug` drawing.
- **Explicit values:** every field is written explicitly, even when it equals its default, so files are self-describing. A missing field is an error, except `fixtures[].sprite` (absent means `null`).
- **Field schema:** the type, default (for new objects), range or enum, unit and editor-only flag of every field, in canonical key order, are listed in `docs/schema.md`. That table and its code version (`lib/schema.js`) must agree with this section and [§6.1](#61-complete-example).

## 6.3 Versioning
- `version` is an integer and increases on any breaking change.
- The editor migrates older versions on load and always saves the latest one.
- RagImporter declares the versions it supports and **throws** on any other version, with a clear message.
- Unknown fields:
  - RagImporter ignores them;
  - the editor drops them with a warning.

## 6.4 Validation
Shared by the editor (Problems panel, load, save) and RagImporter (`parse`), via `RagImporter.validate(json) → { errors, warnings }`.

**Errors** (block save / parse):
- `format` is not `"ragassembler"`, or `version` is unsupported.
- A missing field, a field of the wrong type, or a value outside the range or enum given for it in `docs/schema.md`.
- Duplicate ids (across bodies, shapes, joints and sprite assets), use of the reserved `root` id, or a missing (`null`) or unknown `rootBody`.
- A body without fixtures.
- A joint with a missing `bodyA`/`bodyB`, or `bodyA == bodyB`.
- `lower > 0` or `upper < 0` when limits are enabled.
- A non-positive size or radius.
- A polygon that is not convex or CCW, has fewer than 3 or more than 8 vertices, or is degenerate.
- A sprite that references an unknown asset, or has a scale of 0.
- A duplicate or invalid clip `key`.
- A track with an unknown target, a channel invalid for its target, or more than one track for the same `target + channel` in a clip.
- Keys unsorted, duplicated in `t`, or outside `[0, length]`.
- A multiplier value outside 0–1.
- A `sprite` key whose value is not an existing asset id or `null`, or whose `interp` is not `step`.
- `length ≤ 0`, `speed ≤ 0`, or `fadeIn`/`fadeOut < 0`.
- An event with an empty `name`, or a `t` out of range ([§4.7](04-animation-model.md#47-events)).

**Warnings:**
- A body not connected to `rootBody`.
- A joint anchor outside both bodies' shapes.
- A body with zero mass.
- Loop joints.
- An empty clip (no tracks and no events).
- A sprite asset that is unused, or whose image is missing in the editor.

## 6.5 Round-trip guarantee
**Load → Save produces a byte-identical file** for any valid file written by the same format version. To achieve this:
- Key order follows the example above.
- Arrays keep editor order: sprite assets in Assets panel order; bodies, joints and clips in hierarchy/list order; fixtures in body order; keys sorted by `t`; events sorted by `t`.
- Numbers are rounded to 1e-5 and written without trailing zeros. `-0` is written as `0`.
- 2-space indentation, `\n` line endings, final newline.
- Sprite images are written back unchanged (same bytes, same paths).
