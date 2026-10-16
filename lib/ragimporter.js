import { SUPPORTED_VERSIONS, validate } from './validate.js';
import { RagDef } from './def.js';

const configured = { Box2D: null, PIXI: null };

function isLibrary(value) {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function resolveLibrary(key, label) {
  const value = configured[key] ?? globalThis[key];
  if (!isLibrary(value)) {
    throw new Error(`RagImporter needs ${label}: load it before spawning or pass it to RagImporter.configure`);
  }
  return value;
}

function resolveLibraries() {
  return { Box2D: resolveLibrary('Box2D', 'liquidfun.js (Box2D)'), PIXI: resolveLibrary('PIXI', 'PIXI.js (PIXI)') };
}

/**
 * Error thrown by `RagImporter.parse` when validation finds at least one error.
 */
export class RagFormatError extends Error {
  /**
   * @param {string} message Summary naming the unsupported version or the first error.
   * @param {ReadonlyArray<object>} errors Validation errors.
   * @param {ReadonlyArray<object>} warnings Validation warnings.
   */
  constructor(message, errors, warnings) {
    super(message);
    this.name = 'RagFormatError';
    /** @type {ReadonlyArray<object>} */
    this.errors = Object.freeze([...errors]);
    /** @type {ReadonlyArray<object>} */
    this.warnings = Object.freeze([...warnings]);
  }
}

function formatErrorMessage(json, errors) {
  const [first] = errors;
  if (first.code === 'E_VERSION_UNSUPPORTED') {
    return `Unsupported .rag.json version ${json.version}; supported: ${SUPPORTED_VERSIONS.join(', ')}`;
  }
  return `Invalid .rag.json: ${errors.length} error(s); first: ${first.code} at ${first.path}`;
}

function configure(options) {
  for (const key of ['Box2D', 'PIXI']) {
    if (options?.[key] !== undefined) configured[key] = options[key];
  }
}

function parse(json) {
  const { errors, warnings } = validate(json);
  if (errors.length > 0) throw new RagFormatError(formatErrorMessage(json, errors), errors, warnings);
  return new RagDef(json, resolveLibraries);
}

/**
 * RagImporter entry point for LiquidFun and PIXI.js.
 * `configure` sets the namespaces used instead of the globals (`undefined` keeps, `null` returns to the global).
 * `parse` validates and returns an immutable `RagDef`; it throws `RagFormatError` when validation reports errors.
 * @type {Readonly<{
 *   configure: (options?: { Box2D?: *, PIXI?: * }) => void,
 *   parse: (json: *) => RagDef,
 *   validate: (json: *) => import('./validate.js').ValidationResult,
 *   supportedVersions: ReadonlyArray<number>,
 * }>}
 */
export const RagImporter = Object.freeze({
  configure,
  parse,
  validate: (json) => validate(json),
  supportedVersions: SUPPORTED_VERSIONS,
});
