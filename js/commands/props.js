import { autoClipKey } from '../../lib/schema.js';
import { ROOT_UID } from '../model/model.js';

function firstSegment(path) {
  return String(path).split('.')[0];
}

function clipKeys(model) {
  return new Map(model.children(ROOT_UID, 'clips').map((clip) => [clip, model.prop(clip, 'key')]));
}

function keysExcept(keys, uid) {
  return [...keys].filter(([clip]) => clip !== uid).map(([, key]) => key);
}

/**
 * Builds a command that sets the same props on one or more nodes. Renaming a clip also applies the
 * key-follows-name rule (`docs/schema.md`), clip by clip in `uids` order; an explicit `key` in `values` wins.
 * Types, ranges and references are not checked.
 * @param {number[]} uids Nodes to edit, in order.
 * @param {Object<string, *>} values New values by dotted path, e.g. `{ 'limits.upper': 1.2 }` (meters, radians).
 * @param {string} [label] Undo step label.
 * @returns {import('./history.js').Command} The command.
 * @throws {Error} When `run` finds `uids` or `values` empty, an unknown uid, or a path starting with `id`;
 *   nothing is mutated then.
 */
export function setProps(uids, values, label = 'Edit properties') {
  return Object.freeze({
    label,
    run(tx) {
      const { model } = tx;
      if (!Array.isArray(uids) || uids.length === 0) throw new Error('setProps needs at least one uid');
      const entries = Object.entries(values ?? {});
      if (entries.length === 0) throw new Error('setProps needs at least one value');
      for (const [path] of entries) {
        if (firstSegment(path) === 'id') throw new Error('Ids never change');
      }
      for (const uid of uids) {
        if (!model.get(uid)) throw new Error(`Unknown node uid ${uid}`);
      }
      const keysBefore = clipKeys(model);
      const renamesClips = Object.hasOwn(values, 'name') && !Object.hasOwn(values, 'key');
      for (const uid of uids) {
        const node = model.get(uid);
        const followsName = renamesClips && node.type === 'clip';
        const oldName = followsName ? model.prop(uid, 'name') : undefined;
        const oldKey = followsName ? model.prop(uid, 'key') : undefined;
        for (const [path, value] of entries) tx.set(uid, path, value);
        if (!followsName) continue;
        if (oldKey !== autoClipKey(oldName, keysExcept(keysBefore, uid))) continue;
        tx.set(uid, 'key', autoClipKey(values.name, keysExcept(clipKeys(model), uid)));
      }
    },
  });
}
