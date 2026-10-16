import { FORMAT, FORMAT_VERSION } from '../../lib/schema.js';
import { migrate } from '../../lib/migrate.js';
import { validate } from '../../lib/validate.js';
import { serialize } from '../../lib/serialize.js';
import { ROOT_UID, emptyRootSnapshot } from './model.js';

const NESTED = Object.freeze({
  body: Object.freeze(['fixtures']),
  clip: Object.freeze(['tracks', 'events']),
  track: Object.freeze(['keys']),
});

function recordOf(model, uid) {
  const node = model.get(uid);
  const record = structuredClone(node.props);
  for (const collection of NESTED[node.type] ?? []) {
    record[collection] = model.children(uid, collection).map((child) => recordOf(model, child));
  }
  return record;
}

function collection(model, name) {
  return model.children(ROOT_UID, name).map((uid) => recordOf(model, uid));
}

const CHILD_TYPES = Object.freeze({
  sprites: 'spriteAsset',
  bodies: 'body',
  joints: 'joint',
  clips: 'clip',
  fixtures: 'shape',
  tracks: 'track',
  keys: 'key',
  events: 'event',
});

const FIXTURES_FIELD = 'fixtures';
const ROOT_COLLECTIONS = Object.freeze(['sprites', 'bodies', 'joints', 'clips']);

/**
 * The document in the `.rag.json` data shape: plain copies of the props in collection order, without uids,
 * with `meta` derived (`name` from the root's `name`, `editorVersion` as given). Not in canonical key order, not
 * rounded and not validated. Never changes the model.
 * @param {import('./model.js').Model} model Document model.
 * @param {string} editorVersion Version of the running editor.
 * @returns {object} A new document object.
 * @throws {TypeError} When `editorVersion` is not a non-empty string.
 */
export function toJson(model, editorVersion) {
  if (typeof editorVersion !== 'string' || editorVersion === '') {
    throw new TypeError('editorVersion must be a non-empty string');
  }
  const { meta: ignoredMeta, units, preview, ...ragdoll } = structuredClone(model.get(ROOT_UID).props);
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    meta: { name: ragdoll.name, editorVersion },
    units,
    preview,
    ragdoll,
    sprites: collection(model, 'sprites'),
    bodies: collection(model, 'bodies'),
    joints: collection(model, 'joints'),
    clips: collection(model, 'clips'),
  };
}

/**
 * Result of {@link loadJson}.
 * @typedef {object} LoadResult
 * @property {boolean} ok Whether the document was loaded.
 * @property {ReadonlyArray<object>} errors Validation errors; the model is untouched when not empty.
 * @property {ReadonlyArray<object>} warnings Validation warnings, `W_UNKNOWN_FIELD` included.
 * @property {ReadonlyArray<string>} notes One line per applied migration step.
 */

function decodePointer(pointer) {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function dropKey(json, pointer) {
  const segments = decodePointer(pointer);
  let node = json;
  for (const segment of segments.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return;
    node = node[segment];
  }
  if (node !== null && typeof node === 'object') delete node[segments[segments.length - 1]];
}

function snapshotOf(type, record, collections) {
  const props = {};
  const children = {};
  for (const [key, value] of Object.entries(record)) {
    if (collections.includes(key)) {
      children[key] = value.map((item) => snapshotOf(CHILD_TYPES[key], item, NESTED[CHILD_TYPES[key]] ?? []));
    } else {
      props[key] = value;
    }
  }
  return { type, props, children };
}

function rootSnapshot(json) {
  const { ragdoll, meta, units, preview } = json;
  const children = {};
  for (const name of ROOT_COLLECTIONS) {
    children[name] = json[name].map((item) => snapshotOf(CHILD_TYPES[name], item, NESTED[CHILD_TYPES[name]] ?? []));
  }
  return { type: 'root', props: { ...ragdoll, meta, units, preview }, children };
}

function fillAbsentSprites(json) {
  for (const body of json.bodies) {
    for (const shape of body[FIXTURES_FIELD]) {
      if (shape.sprite === undefined) shape.sprite = null;
    }
  }
}

function problem(code, message) {
  return Object.freeze({ severity: 'error', code, message, path: '', target: null });
}

/**
 * Loads a `.rag.json` text into the model: parses, migrates, validates, drops unknown fields and resets the
 * model with cause `load`. A file with errors is rejected and the model is untouched.
 * @param {import('./model.js').Model} model Document model.
 * @param {string} text File text.
 * @returns {Readonly<LoadResult>} The outcome; non-JSON text gives one `E_FORMAT` error.
 * @throws {TypeError} When `text` is not a string.
 */
export function loadJson(model, text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return Object.freeze({
      ok: false,
      errors: Object.freeze([problem('E_FORMAT', 'File is not valid JSON')]),
      warnings: Object.freeze([]),
      notes: Object.freeze([]),
    });
  }
  const { json, notes } = migrate(parsed);
  const { errors, warnings } = validate(json);
  const frozenNotes = Object.freeze([...notes]);
  if (errors.length > 0) {
    return Object.freeze({ ok: false, errors: Object.freeze([...errors]), warnings: Object.freeze([...warnings]), notes: frozenNotes });
  }
  const copy = structuredClone(json);
  for (const warning of warnings) {
    if (warning.code === 'W_UNKNOWN_FIELD') dropKey(copy, warning.path);
  }
  fillAbsentSprites(copy);
  model.reset(rootSnapshot(copy), 'load');
  return Object.freeze({ ok: true, errors: Object.freeze([]), warnings: Object.freeze([...warnings]), notes: frozenNotes });
}

/**
 * Result of {@link saveJson}.
 * @typedef {object} SaveResult
 * @property {boolean} ok Whether the document can be written (no validation errors).
 * @property {ReadonlyArray<object>} errors Validation errors; the file is blocked when not empty.
 * @property {ReadonlyArray<object>} warnings Validation warnings; they never block.
 * @property {string|null} text Canonical `.rag.json` text, `null` when not ok.
 * @property {string|null} fileName Download name, `null` when not ok.
 */

const FILE_NAME_FALLBACK = 'ragdoll';
const FILE_NAME_MAX_CODE_POINTS = 100;
const FILE_NAME_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]/g;
const RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * The download name of a document: the sanitized `name` plus `.rag.json`. Forbidden and control characters become
 * `_`, whitespace runs one space, the name is cut to 100 code points and trimmed of spaces and dots. An empty
 * result, a non-string `name` or a reserved Windows device name before the first dot gives `ragdoll.rag.json`.
 * @param {*} name Root name.
 * @returns {string} File name.
 */
export function ragFileName(name) {
  const cleaned =
    typeof name === 'string'
      ? Array.from(name.replace(FILE_NAME_FORBIDDEN, '_').replace(/\s+/g, ' '))
          .slice(0, FILE_NAME_MAX_CODE_POINTS)
          .join('')
          .replace(/^[ .]+|[ .]+$/g, '')
      : '';
  const stem = cleaned.split('.', 1)[0];
  const usable = cleaned !== '' && !RESERVED_DEVICE_NAME.test(stem);
  return `${usable ? cleaned : FILE_NAME_FALLBACK}.rag.json`;
}

/**
 * Exports, validates and serializes the document for saving. Never changes the model or its history.
 * @param {import('./model.js').Model} model Document model.
 * @param {string} editorVersion Version of the running editor.
 * @returns {Readonly<SaveResult>} `ok: false` with the errors and no text when validation finds errors.
 * @throws {TypeError} When `editorVersion` is not a non-empty string.
 */
export function saveJson(model, editorVersion) {
  const json = toJson(model, editorVersion);
  const { errors, warnings } = validate(json);
  const frozenErrors = Object.freeze([...errors]);
  const frozenWarnings = Object.freeze([...warnings]);
  if (errors.length > 0) {
    return Object.freeze({ ok: false, errors: frozenErrors, warnings: frozenWarnings, text: null, fileName: null });
  }
  return Object.freeze({
    ok: true,
    errors: frozenErrors,
    warnings: frozenWarnings,
    text: serialize(json),
    fileName: ragFileName(json.ragdoll.name),
  });
}

/**
 * Replaces the document with the empty one, cause `new`. Confirmation of unsaved changes belongs to the caller.
 * @param {import('./model.js').Model} model Document model.
 * @returns {void}
 */
export function newDocument(model) {
  model.reset(emptyRootSnapshot(), 'new');
}

function indexIn(segment, list) {
  if (!/^(0|[1-9]\d*)$/.test(segment)) return null;
  const index = Number(segment);
  return index < list.length ? list[index] : null;
}

/**
 * Maps a validation problem path to the model node it points into.
 * @param {import('./model.js').Model} model Document model.
 * @param {string} pointer Problem `path` (RFC 6901) from validating `toJson` of the same model state.
 * @returns {number|null} Node uid, or `null` for document-level and unresolvable paths.
 */
export function uidAtPath(model, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return null;
  const [head, index, field, nested] = decodePointer(pointer);
  if (head === 'ragdoll') return ROOT_UID;
  if (!ROOT_COLLECTIONS.includes(head) || index === undefined) return null;
  const uid = indexIn(index, model.children(ROOT_UID, head));
  if (uid === null || head !== 'bodies' || field !== FIXTURES_FIELD || nested === undefined) return uid;
  return indexIn(nested, model.children(uid, FIXTURES_FIELD));
}
