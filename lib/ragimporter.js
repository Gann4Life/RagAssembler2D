import { SUPPORTED_VERSIONS, validate } from './validate.js';

/**
 * RagImporter entry point for LiquidFun and PIXI.js.
 * @type {Readonly<{ supportedVersions: ReadonlyArray<number>, validate: (json: *) => import('./validate.js').ValidationResult }>}
 */
export const RagImporter = Object.freeze({
  supportedVersions: SUPPORTED_VERSIONS,
  validate: (json) => validate(json),
});
