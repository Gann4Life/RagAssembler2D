# Validation

> Status: built (#25). The rules, codes and problem record are specified in [`DESIGN.md` §6.4](../design/06-file-format.md#64-validation); this file covers the modules and how the editor consumes them.

## Modules

- **`lib/validate.js`** (pure, imports `lib/schema.js` and `lib/geometry.js`):
  - `validate(json, options?) → ValidationResult`, `ValidationResult { errors: Problem[], warnings: Problem[] }`. `options.hasImage(asset) → boolean` is optional; exceptions it throws propagate (the never-throws guarantee covers the input, not the caller's callback).
  - `SUPPORTED_VERSIONS`: frozen `[FORMAT_VERSION]`, the versions `validate` accepts after its gate.
  - `PROBLEM_CODES`: frozen `Record<code, 'error' | 'warning'>` with exactly the codes of §6.4, so tests and the editor can enumerate them.
  - Typedefs `Problem` (`severity`, `code`, `message`, `path`, `target`), `ProblemTarget` (`type`, `id`), `ValidationResult`, `ValidateOptions`.
  - `W_DUPLICATE_NAME` is one warning per duplicated name within a kind (bodies, joints, shapes): `path` is the second occurrence, the message lists every colliding id, and equal names across kinds do not warn.
  - Generic checks (`E_FIELD_*`, `W_UNKNOWN_FIELD`) walk `fieldsOf(type, variant)` of `lib/schema.js`; no type, range, enum or key list is redeclared. Every other code is a hand-written rule.
- **`lib/geometry.js`** gains `polygonProblems(vertices) → 'count' | 'degenerate' | 'notCcw' | 'notConvex' | null`: the first failing check in that order, with the §6.4 thresholds; `null` for a valid polygon. Never throws (non-arrays and non-`vec2` items give `'count'` or are left to `E_FIELD_TYPE` by the caller). `W_ANCHOR_OUTSIDE` uses `pointInShape` with a 0.001 m tolerance and `W_BODY_ZERO_MASS` uses `bodyMass`.
- **`lib/ragimporter.js`** (#25 part): `RagImporter.validate(json)` calls `validate(json)` without options, and `RagImporter.supportedVersions` is `SUPPORTED_VERSIONS`. `parse` (#44) throws `RagFormatError` carrying `errors` when there are any.

## Agreement with editor rules

- **Drawing:** every shape for which `shapeGeometryValid` is `false` has at least one error (unknown `type`: `E_FIELD_ENUM`; non-finite numbers: `E_FIELD_TYPE`; non-positive size: `E_FIELD_RANGE`; fewer than 3 vertices: `E_POLYGON_VERTEX_COUNT`). The converse does not hold: concave, clockwise and degenerate drafts are drawn but invalid.
- **Joint graph:** `W_BODY_UNLINKED` and `W_JOINT_LOOP` use the rule of `jointTree` ([Joint graph](joint-graph.md#joint-graph)) on JSON ids. `lib/` cannot import `js/model/queries.js`, so the rule is implemented twice and tests run the same graphs through both.

## Editor consumers (later issues, no change to `lib/validate.js` needed)

- **Problems panel (#26):** runs `validate(toJson(model), { hasImage })` debounced after `change` and `reset`. `toJson` keeps model child order ([§6.5](../design/06-file-format.md#65-round-trip-guarantee)), so the array indices of `path` resolve to model nodes (`/ragdoll` → root, `/sprites/i`, `/bodies/i`, `/bodies/i/fixtures/j`, `/joints/i`, `/clips/i`, deeper paths → the enclosing one); clicking a problem selects that node, duplicates included. The uids of nodes with errors feed `gizmos.setInvalid`. `target` is for display.
- **Load (#28):** parse text → `migrate` → `validate` → the result is shown (unknown fields as `W_UNKNOWN_FIELD`) → `loadJson`. Whether errors block the load is decided in #28; the model accepts invalid documents.
- **Save (#27, #28):** `toJson(model)` → `validate` → blocked when `errors.length > 0`.
