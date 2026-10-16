import { fieldsOf } from './schema.js';

const DECIMALS = 5;

function roundNumber(value) {
  const rounded = Number(value.toFixed(DECIMALS));
  return rounded === 0 ? 0 : rounded;
}

function plain(value) {
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) < 1e21 ? roundNumber(value) : value;
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPath(record, segments) {
  let value = record;
  for (const segment of segments) {
    if (!isObject(value) || !Object.hasOwn(value, segment)) return undefined;
    value = value[segment];
  }
  return value;
}

function writePath(target, segments, value) {
  let node = target;
  for (const segment of segments.slice(0, -1)) {
    node[segment] ??= {};
    node = node[segment];
  }
  node[segments[segments.length - 1]] = value;
}

function convert(spec, value) {
  if (spec.type === 'root') return canonical('root', value);
  if (spec.type === 'sprite') return value === null || value === undefined ? null : canonical('sprite', value);
  if (spec.type.startsWith('list:')) {
    const itemType = spec.type.slice('list:'.length);
    return Array.isArray(value) ? value.map((item) => canonical(itemType, item)) : value;
  }
  return plain(value);
}

function canonical(type, record) {
  const variant = type === 'shape' ? record?.shape?.type : undefined;
  const out = {};
  for (const spec of fieldsOf(type, variant)) {
    const segments = spec.path.split('.');
    const value = readPath(record, segments);
    if (value === undefined && !(spec.optional && spec.type === 'sprite')) continue;
    writePath(out, segments, convert(spec, value));
  }
  return out;
}

/**
 * Canonical `.rag.json` text of a document object: keys in schema order (unknown keys left out), numbers rounded to
 * 1e-5 without trailing zeros, `-0` as `0`, an absent `fixtures[].sprite` as `null`, 2-space indent, `\n`, final
 * newline. Formats only: no validation, no `meta` derivation, never mutates `json`.
 * @param {object} json Document object without validation errors.
 * @returns {string} The file text.
 */
export function serialize(json) {
  return `${JSON.stringify(canonical('document', json), null, 2)}\n`;
}
