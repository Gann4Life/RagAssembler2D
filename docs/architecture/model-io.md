# Model I/O

> Status: planned (#27). `toJson(model)` exists since #145 ([Tools: Pose](tools-pose.md#tools-pose)); everything else here is the agreed design.

Behavior in [`DESIGN.md` §6.3–6.5](../design/06-file-format.md#63-versioning). Modules:

| Module | Layer | Role |
|---|---|---|
| `js/model/io.js` | Core | Model ⇄ file data. The only caller of `model.reset`. |
| `lib/migrate.js` | Pure | Ordered chain of per-version steps. |
| `lib/serialize.js` | Pure | Canonical text of a document object. Formats only. |
| `lib/validate.js` | Pure | Unchanged ([Validation](validation.md#modules)). |
| `js/version.js` | Core | The running editor's version, from `version.json` through an injected `fetch`. |

## Contracts

```
toJson(model, editorVersion) → object
  As built by #145, plus meta = { name: root props `name`, editorVersion }; the loaded meta is ignored.
  TypeError when editorVersion is not a non-empty string. Never changes the model.

loadJson(model, text) → LoadResult                 LoadResult { ok, errors, warnings, notes } (frozen arrays)
  1. JSON.parse(text). A SyntaxError gives ok false with one error
     { severity: 'error', code: 'E_FORMAT', message: 'File is not valid JSON', path: '', target: null }.
     TypeError when text is not a string.
  2. migrate(parsed) → { json, notes }.
  3. validate(json) without options (images are checked by the Problems panel after the load).
  4. errors.length > 0: return { ok: false, errors, warnings, notes }; the model is untouched.
  5. On its own copy: delete every key named by a W_UNKNOWN_FIELD path (the warning stays in `warnings`);
     an absent fixtures[].sprite becomes null.
  6. model.reset(snapshot, 'load'): root props = { ...ragdoll, meta, units, preview }; children sprites,
     bodies (fixtures), joints, clips (tracks (keys), events), in file order.
  7. return { ok: true, errors: [], warnings, notes }.
  A malformed migration chain (TypeError from migrate) and a reset failure propagate: both are bugs.

newDocument(model) → void
  model.reset(emptyRootSnapshot(), 'new'). The unsaved-changes confirmation belongs to the New action.

uidAtPath(model, pointer) → number | null
  pointer: a problem `path` (RFC 6901, `~1` and `~0` decoded) from validating toJson of the same model state,
  so array indices are model child order.
  /ragdoll…                                   → ROOT_UID
  /sprites/i…                                 → sprite asset uid
  /bodies/i, /bodies/i/<non-fixtures field>…  → body uid
  /bodies/i/fixtures/j…                       → shape uid
  /joints/i…                                  → joint uid
  /clips/i… (tracks, keys, events included)   → clip uid
  "", /format, /version, /meta…, /units…, /preview…, an index that is not a canonical decimal in range,
  any other path                              → null     (matches Problem.target being null, DESIGN §6.4)

migrate(json, chain = MIGRATIONS) → { json, notes }
  MigrationStep { from, to = from + 1, up(json) → object (pure, new object) }; see the Module map row.

serialize(json) → string
  See the Module map row.

loadVersion(fetchFn) → Promise<VersionInfo>        VersionInfo { editorVersion, label }; never rejects
```

## Flows

- **Load (#28 wires the file picker and drop):** text → `loadJson`. On `ok: false` the errors are shown and nothing changes; on `ok: true` warnings and notes are shown, and `reset` clears history, selection and the open gesture ([Commands and undo](commands-and-undo.md#commands-and-undo)).
- **Save (#28):** `json = toJson(model, editor.editorVersion())` → `validate(json, { hasImage })` → blocked when `errors.length > 0` → `serialize(json)`.
- **New (wired after #124):** the action asks through `confirm` when `history.dirty`, then `newDocument(model)`.
- **Round trip:** for a canonical file, `serialize(toJson(model, v))` after `loadJson(model, text)` equals `text` when `v` is the file's `meta.editorVersion` ([`DESIGN.md` §6.5](../design/06-file-format.md#65-round-trip-guarantee)).

## Tests

- `tests/model-io.test.js`: `toJson` meta derivation and the `TypeError`; `loadJson` on non-JSON, a wrong version, a file with errors (model untouched, no `reset` event), unknown fields dropped with their warnings, absent `sprite` → `null`; `newDocument`; the `uidAtPath` table; byte-identical load → save over the canonical fixtures.
- `tests/migrate.test.js` (migration is tested here with injected chains, since `loadJson` always uses `MIGRATIONS`): empty `MIGRATIONS` leaves version 1 documents as the same object; an injected v1 → v2 → v3 chain runs in order from each start version, never mutates its input, and gives one note per step; unknown, newer and non-object inputs are returned unchanged; malformed chains throw `TypeError`; the last `MIGRATIONS` step, if any, ends at `FORMAT_VERSION`.
- `tests/serialize.test.js`: key order against `fieldsOf` for every type and shape variant, unknown keys not written, rounding table (`0.1 + 0.2`, `1e-6`, `-0`, `-1e-6`, integers, `json` values), whitespace and final newline.
- `tests/version.test.js` (fake `fetchFn`): `v0.4.0` → `0.4.0`, no `v` kept as is, label with and without commit, rejection, non-OK, bad JSON and missing `version` → `dev`.
