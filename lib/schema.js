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

/** File format identifier written in `format`. */
export const FORMAT = 'ragassembler';

/** Format version written by the editor. */
export const FORMAT_VERSION = 1;

const SHAPE_TYPES = ['circle', 'box', 'polygon'];

function field(path, type, defaultValue, options = {}) {
  const spec = {
    path,
    type,
    default: defaultValue,
    unit: options.unit ?? '',
    editorOnly: options.editorOnly ?? false,
    readOnly: options.readOnly ?? false,
  };
  for (const key of ['min', 'max', 'exclusiveMin', 'enum', 'optional', 'variants', 'channel']) {
    if (options[key] !== undefined) spec[key] = options[key];
  }
  return deepFreeze(spec);
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

const positive = { min: 0, exclusiveMin: true };
const nonNegative = { min: 0 };
const multiplier = { min: 0, max: 1, unit: 'mult' };
const bits = { min: 0, max: 65535 };

/**
 * Property schema per object type, in canonical key order.
 * @type {Readonly<Record<string, ReadonlyArray<FieldSpec>>>}
 */
export const SCHEMA = deepFreeze({
  document: [
    field('format', 'string', FORMAT, { readOnly: true }),
    field('version', 'integer', FORMAT_VERSION, { readOnly: true }),
    field('meta.name', 'string', 'root', { editorOnly: true, readOnly: true }),
    field('meta.editorVersion', 'string', undefined, { editorOnly: true, readOnly: true }),
    field('units.pixelsPerMeter', 'number', 32, { ...positive, unit: 'px/m' }),
    field('preview.gravity', 'vec2', [0, -10], { unit: 'm/s²', editorOnly: true }),
    field('ragdoll', 'root', undefined),
    field('sprites', 'list:spriteAsset', []),
    field('bodies', 'list:body', []),
    field('joints', 'list:joint', []),
    field('clips', 'list:clip', []),
  ],
  root: [
    field('id', 'string', 'root', { readOnly: true }),
    field('name', 'string', 'root'),
    field('position', 'vec2', [0, 0], { unit: 'm', editorOnly: true, readOnly: true }),
    field('angle', 'number', 0, { unit: 'rad', editorOnly: true, readOnly: true }),
    field('rootBody', 'ref:body', null),
    field('channels.strength', 'number', 1, { ...multiplier, channel: 'strength' }),
    field('channels.gain', 'number', 1, { ...multiplier, channel: 'gain' }),
    field('channels.damping', 'number', 1, { ...multiplier, channel: 'damping' }),
  ],
  spriteAsset: [
    field('id', 'string', undefined, { readOnly: true }),
    field('name', 'string', undefined),
    field('src', 'string', undefined),
  ],
  body: [
    field('id', 'string', undefined, { readOnly: true }),
    field('name', 'string', undefined),
    field('position', 'vec2', [0, 0], { unit: 'm' }),
    field('angle', 'number', 0, { unit: 'rad' }),
    field('linearDamping', 'number', 0, { ...nonNegative, unit: '1/s' }),
    field('angularDamping', 'number', 0, { ...nonNegative, unit: '1/s' }),
    field('fixedRotation', 'boolean', false),
    field('bullet', 'boolean', false),
    field('fixtures', 'list:shape', []),
  ],
  shape: [
    field('id', 'string', undefined, { readOnly: true }),
    field('name', 'string', undefined),
    field('shape.type', 'enum', undefined, { enum: SHAPE_TYPES, readOnly: true }),
    field('shape.center', 'vec2', [0, 0], { unit: 'm', variants: ['circle', 'box'] }),
    field('shape.radius', 'number', 0.25, { ...positive, unit: 'm', variants: ['circle'] }),
    field('shape.width', 'number', 0.5, { ...positive, unit: 'm', variants: ['box'] }),
    field('shape.height', 'number', 0.5, { ...positive, unit: 'm', variants: ['box'] }),
    field('shape.angle', 'number', 0, { unit: 'rad', variants: ['box'] }),
    field('shape.vertices', 'vec2[]', undefined, { unit: 'm', variants: ['polygon'] }),
    field('density', 'number', 1, { ...nonNegative, unit: 'kg/m²' }),
    field('friction', 'number', 0.6, nonNegative),
    field('restitution', 'number', 0, nonNegative),
    field('isSensor', 'boolean', false),
    field('selfCollide', 'boolean', false),
    field('filter.categoryBits', 'integer', 1, bits),
    field('filter.maskBits', 'integer', 65535, bits),
    field('sprite', 'sprite', null, { optional: true }),
    field('editor.color', 'color', '#8c9eb5', { editorOnly: true }),
  ],
  sprite: [
    field('asset', 'ref:spriteAsset', null, { channel: 'sprite' }),
    field('offset', 'vec2', [0, 0], { unit: 'm' }),
    field('angle', 'number', 0, { unit: 'rad' }),
    field('scale', 'vec2', [1, 1]),
    field('z', 'integer', 0),
    field('visible', 'boolean', true),
  ],
  joint: [
    field('id', 'string', undefined, { readOnly: true }),
    field('name', 'string', undefined),
    field('type', 'enum', 'revolute', { enum: ['revolute'], readOnly: true }),
    field('bodyA', 'ref:body', null),
    field('bodyB', 'ref:body', null),
    field('anchor', 'vec2', [0, 0], { unit: 'm' }),
    field('collideConnected', 'boolean', false),
    field('limits.enabled', 'boolean', false),
    field('limits.lower', 'number', 0, { max: 0, unit: 'rad' }),
    field('limits.upper', 'number', 0, { min: 0, unit: 'rad' }),
    field('motor.maxTorque', 'number', 80, { ...nonNegative, unit: 'N·m' }),
    field('motor.gain', 'number', 10, { ...nonNegative, unit: '1/s' }),
    field('motor.damping', 'number', 0.5, nonNegative),
    field('motor.maxSpeed', 'number', 20, { ...nonNegative, unit: 'rad/s' }),
    field('aimAxis', 'number', 0, { unit: 'rad' }),
  ],
  clip: [
    field('key', 'string', autoClipKey('New Clip')),
    field('name', 'string', 'New Clip'),
    field('loop', 'boolean', true),
    field('hold', 'boolean', true),
    field('layer', 'integer', 0, nonNegative),
    field('blend', 'enum', 'override', { enum: ['override', 'additive'] }),
    field('length', 'number', 1, { ...positive, unit: 's' }),
    field('fadeIn', 'number', 0, { ...nonNegative, unit: 's' }),
    field('fadeOut', 'number', 0, { ...nonNegative, unit: 's' }),
    field('speed', 'number', 1, positive),
    field('tracks', 'list:track', []),
    field('events', 'list:event', []),
  ],
  track: [
    field('target', 'ref', undefined, { readOnly: true }),
    field('channel', 'enum', undefined, {
      enum: ['angle', 'strength', 'gain', 'damping', 'sprite'],
      readOnly: true,
    }),
    field('keys', 'list:key', []),
  ],
  key: [
    field('t', 'number', undefined, { ...nonNegative, unit: 's' }),
    field('v', 'channel', undefined),
    field('interp', 'enum', 'linear', { enum: ['linear', 'step', 'ease'] }),
  ],
  event: [
    field('t', 'number', undefined, { unit: 's' }),
    field('name', 'string', 'event'),
    field('data', 'json', null),
  ],
});

const multiplierChannel = (base) => ({ kind: 'multiplier', unit: 'mult', min: 0, max: 1, ...base });

/**
 * Animation channels per target type (`root`, `joint`, `shape`). Each entry gives the channel
 * `kind` (`multiplier`, `angle`, `discrete`), the key value `unit`, the key value range for
 * multipliers, and either a constant `default` or the `basePath` of the target prop that holds it.
 * @type {Readonly<Record<string, Readonly<Record<string, Readonly<{ kind: string, unit: string,
 *   min?: number, max?: number, default: (number|null), basePath: (string|null) }>>>>>}
 */
export const CHANNELS = deepFreeze({
  root: {
    strength: multiplierChannel({ default: null, basePath: 'channels.strength' }),
    gain: multiplierChannel({ default: null, basePath: 'channels.gain' }),
    damping: multiplierChannel({ default: null, basePath: 'channels.damping' }),
  },
  joint: {
    angle: { kind: 'angle', unit: 'rad', default: 0, basePath: null },
    strength: multiplierChannel({ default: 1, basePath: null }),
    gain: multiplierChannel({ default: 1, basePath: null }),
    damping: multiplierChannel({ default: 1, basePath: null }),
  },
  shape: {
    sprite: { kind: 'discrete', unit: '', default: null, basePath: 'sprite.asset' },
  },
});

function specsOf(type) {
  const specs = SCHEMA[type];
  if (!specs) throw new Error(`Unknown object type "${type}"`);
  return specs;
}

/**
 * Lists the fields of an object type in canonical order.
 * @param {string} type Object type, a key of `SCHEMA`.
 * @param {string} [variant] Shape type; when given, fields of other variants are left out.
 * @returns {ReadonlyArray<FieldSpec>} Field specs.
 * @throws {Error} When the type or the variant is unknown.
 */
export function fieldsOf(type, variant) {
  const specs = specsOf(type);
  if (variant === undefined) return specs;
  if (type !== 'shape' || !SHAPE_TYPES.includes(variant)) {
    throw new Error(`Unknown variant "${variant}" for "${type}"`);
  }
  return specs.filter((spec) => !spec.variants || spec.variants.includes(variant));
}

/**
 * Builds a fresh nested object with every default of an object type, in canonical order.
 * Fields whose default is set by the creating tool are left out, except `shape.type`, which is
 * the variant when one is given. List fields are `[]`.
 * @param {string} type Object type, a key of `SCHEMA`.
 * @param {string} [variant] Shape type.
 * @returns {object} New mutable object.
 * @throws {Error} When the type or the variant is unknown.
 */
export function defaultsOf(type, variant) {
  const result = {};
  for (const spec of fieldsOf(type, variant)) {
    const value = spec.path === 'shape.type' && variant !== undefined ? variant : spec.default;
    if (value === undefined) continue;
    const segments = spec.path.split('.');
    let target = result;
    for (const segment of segments.slice(0, -1)) {
      target[segment] ??= {};
      target = target[segment];
    }
    target[segments[segments.length - 1]] = structuredClone(value);
  }
  return result;
}

/**
 * Generates a clip key from a clip name: lower-case, runs outside `[a-z0-9]` become `_`,
 * leading and trailing `_` are trimmed, `clip` when empty, then `_2`, `_3`, … until unused.
 * @param {string} name Clip name.
 * @param {Iterable<string>} [takenKeys] Keys already in use.
 * @returns {string} Clip key.
 */
export function autoClipKey(name, takenKeys = []) {
  const taken = new Set(takenKeys);
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'clip';
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}
