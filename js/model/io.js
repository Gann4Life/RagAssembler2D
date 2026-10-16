import { FORMAT, FORMAT_VERSION } from '../../lib/schema.js';
import { ROOT_UID } from './model.js';

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

/**
 * The document in the `.rag.json` data shape: plain copies of the props in collection order, without uids,
 * canonical key order, rounding or validation. Never changes the model.
 * @param {import('./model.js').Model} model Document model.
 * @returns {object} A new document object.
 */
export function toJson(model) {
  const { meta, units, preview, ...ragdoll } = structuredClone(model.get(ROOT_UID).props);
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    meta,
    units,
    preview,
    ragdoll,
    sprites: collection(model, 'sprites'),
    bodies: collection(model, 'bodies'),
    joints: collection(model, 'joints'),
    clips: collection(model, 'clips'),
  };
}
