import { balanceTorqueSuggestion, motorTorqueSuggestions } from '../../lib/motor.js';
import { ROOT_UID } from './model.js';

/**
 * What the automatic motor torque changed.
 * @typedef {object} TorqueChange
 * @property {number} joints Number of joints whose `motor.maxTorque` was set.
 * @property {number|null} balance New `ragdoll.balance.maxTorque` in N·m, `null` when it was not changed.
 */

/**
 * One value the automatic motor torque writes.
 * @typedef {object} TorqueUpdate
 * @property {number|null} joint Index in `joints` of the joint to set, `null` for the balance.
 * @property {number} value Suggested torque, N·m.
 */

const RIG_TYPES = new Set(['body', 'shape', 'joint']);
const SIGNIFICANT_DIGITS = 3;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The values that differ from their suggestion in a `.rag.json` document: each joint's `motor.maxTorque` against
 * `motorTorqueSuggestions` and `ragdoll.balance.maxTorque` against `balanceTorqueSuggestion`. A `null` suggestion,
 * or a joint or balance without a motor record, gives no update. Pure.
 * @param {object} json Document in the file data shape.
 * @returns {TorqueUpdate[]} Joint updates in `joints` order, then the balance.
 */
export function torqueUpdates(json) {
  const updates = [];
  const joints = Array.isArray(json?.joints) ? json.joints : [];
  const suggestions = motorTorqueSuggestions(json);
  joints.forEach((joint, index) => {
    if (!isObject(joint) || !isObject(joint.motor)) return;
    const value = suggestions.get(joint.id);
    if (typeof value === 'number' && joint.motor.maxTorque !== value) updates.push({ joint: index, value });
  });
  const balance = isObject(json?.ragdoll) ? json.ragdoll.balance : undefined;
  const value = balanceTorqueSuggestion(json);
  if (isObject(balance) && typeof value === 'number' && balance.maxTorque !== value) updates.push({ joint: null, value });
  return updates;
}

function changeOf(updates) {
  if (updates.length === 0) return null;
  const balance = updates.find((update) => update.joint === null);
  return Object.freeze({ joints: updates.filter((update) => update.joint !== null).length, balance: balance?.value ?? null });
}

/**
 * Sets every motor and balance torque of a document to its suggestion, in place.
 * @param {object} json Document in the file data shape; mutated.
 * @returns {Readonly<TorqueChange>|null} What changed, or `null` when nothing did.
 */
export function applyTorqueToJson(json) {
  const updates = torqueUpdates(json);
  for (const { joint, value } of updates) {
    if (joint === null) json.ragdoll.balance.maxTorque = value;
    else json.joints[joint].motor.maxTorque = value;
  }
  return changeOf(updates);
}

/**
 * Writes the automatic motor torque through a transaction: every joint and balance torque of the model that
 * differs from its suggestion on `json`, the same model exported to the file data shape.
 * @param {import('../commands/history.js').Transaction} tx Open transaction.
 * @param {object} json `toJson` of `tx.model` in its current state.
 * @returns {Readonly<TorqueChange>|null} What changed, or `null` when nothing did.
 */
export function applyTorque(tx, json) {
  const updates = torqueUpdates(json);
  const joints = tx.model.children(ROOT_UID, 'joints');
  for (const { joint, value } of updates) {
    if (joint === null) tx.set(ROOT_UID, 'balance.maxTorque', value);
    else tx.set(joints[joint], 'motor.maxTorque', value);
  }
  return changeOf(updates);
}

/**
 * Whether applied model operations change what the suggestions read: a body, shape or joint (set, added, removed or
 * moved), or the root's `rootBody`.
 * @param {import('./model.js').Model} model Document model after the operations.
 * @param {ReadonlyArray<object>} ops Applied operations, as `model.applyOps` returns them.
 * @returns {boolean}
 */
export function touchesRig(model, ops) {
  return ops.some((op) => {
    if (op.op === 'add' || op.op === 'remove') return op.snapshot !== undefined && RIG_TYPES.has(op.snapshot.type);
    if (op.op === 'set' && op.uid === ROOT_UID) return op.path === 'rootBody';
    return RIG_TYPES.has(model.get(op.uid)?.type);
  });
}

/**
 * A torque in N·m rounded to 3 significant digits, written without exponent or trailing zeros.
 * @param {number} value Torque, N·m.
 * @returns {string} E.g. `41.2`, `1230`, `0.00012`.
 */
export function formatTorque(value) {
  if (!Number.isFinite(value) || value === 0) return '0';
  const rounded = Number(value.toPrecision(SIGNIFICANT_DIGITS));
  const decimals = Math.max(0, SIGNIFICANT_DIGITS - 1 - Math.floor(Math.log10(Math.abs(rounded))));
  const text = rounded.toFixed(decimals);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

function jointsPart(count) {
  return `${count} ${count === 1 ? 'joint' : 'joints'}`;
}

/**
 * Status message of a command that changed torques: `Motor torque: 3 joints updated, balance 41.2 N·m`,
 * `Motor torque: 1 joint updated` or `Motor torque: balance 41.2 N·m`.
 * @param {Readonly<TorqueChange>|null} change What changed.
 * @returns {string|null} The message, or `null` when nothing changed.
 */
export function torqueMessage(change) {
  if (change === null) return null;
  const balance = change.balance === null ? null : `balance ${formatTorque(change.balance)} N·m`;
  if (change.joints === 0) return `Motor torque: ${balance}`;
  return `Motor torque: ${jointsPart(change.joints)} updated${balance === null ? '' : `, ${balance}`}`;
}

/**
 * Load note of the automatic motor torque: `Motor torque set to the suggestion: 3 joints, balance 41.2 N·m`.
 * @param {Readonly<TorqueChange>|null} change What Load changed.
 * @returns {string|null} The note, or `null` when nothing changed.
 */
export function torqueLoadNote(change) {
  if (change === null) return null;
  const parts = [];
  if (change.joints > 0) parts.push(jointsPart(change.joints));
  if (change.balance !== null) parts.push(`balance ${formatTorque(change.balance)} N·m`);
  return `Motor torque set to the suggestion: ${parts.join(', ')}`;
}
