import { FORMAT } from './schema.js';
import { balanceTorqueSuggestion } from './motor.js';

/**
 * One migration step.
 * @typedef {object} MigrationStep
 * @property {number} from Format version it reads.
 * @property {number} to Format version it writes; `from + 1`.
 * @property {(json: object) => object} up Pure: returns a new document, never mutates its argument.
 */

const DEFAULT_BALANCE_TORQUE = 80;

function addBalance(json) {
  const { ragdoll } = json;
  if (ragdoll === null || typeof ragdoll !== 'object' || Array.isArray(ragdoll)) return { ...json };
  const balance = {
    enabled: true,
    maxTorque: balanceTorqueSuggestion(withUnitMass(json)) ?? DEFAULT_BALANCE_TORQUE,
    gain: 10,
    damping: 0.5,
    maxSpeed: 20,
  };
  return { ...json, ragdoll: { ...ragdoll, balance } };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withMass(body) {
  const result = {};
  let placed = false;
  for (const [key, value] of Object.entries(body)) {
    if (key === 'mass') continue;
    result[key] = value;
    if (key === 'angle') {
      result.mass = 1;
      placed = true;
    }
  }
  if (!placed) result.mass = 1;
  return result;
}

function withoutDensity(fixture) {
  if (!isPlainObject(fixture)) return fixture;
  const { density, ...rest } = fixture;
  return rest;
}

function addBodyMass(json) {
  if (!Array.isArray(json.bodies)) return { ...json };
  const bodies = json.bodies.map((body) => {
    if (!isPlainObject(body)) return body;
    const massed = withMass(body);
    if (Array.isArray(massed.fixtures)) massed.fixtures = massed.fixtures.map(withoutDensity);
    return massed;
  });
  return { ...json, bodies };
}

function withUnitMass(json) {
  return Array.isArray(json.bodies) ? { ...json, bodies: json.bodies.map((body) => (isPlainObject(body) ? withMass(body) : body)) } : json;
}

/**
 * Ordered steps from older format versions to `FORMAT_VERSION` (`DESIGN.md` §6.3). 1 → 2 adds `ragdoll.balance`,
 * enabled, with the suggested balance torque for 1 kg bodies (80 N·m when there is none); 2 → 3 adds `mass: 1`
 * to every body and removes fixture `density`.
 * @type {ReadonlyArray<MigrationStep>}
 */
export const MIGRATIONS = Object.freeze([
  Object.freeze({ from: 1, to: 2, up: addBalance }),
  Object.freeze({ from: 2, to: 3, up: addBodyMass }),
]);

function checkChain(chain) {
  if (!Array.isArray(chain)) throw new TypeError('Migration chain must be an array');
  chain.forEach((step, index) => {
    const valid =
      step !== null &&
      typeof step === 'object' &&
      Number.isInteger(step.from) &&
      step.to === step.from + 1 &&
      typeof step.up === 'function';
    if (!valid) throw new TypeError(`Migration step ${index} is malformed`);
    if (index > 0 && step.from !== chain[index - 1].to) throw new TypeError(`Migration step ${index} is not consecutive`);
  });
}

/**
 * Migrates a document to the latest format version, applying each step whose `from` equals the document's version.
 * Returns the input object itself when no step applies, so `validate` reports unknown or wrong inputs.
 * @param {*} json Parsed document.
 * @param {ReadonlyArray<MigrationStep>} [chain] Steps; `MIGRATIONS` by default.
 * @returns {{ json: *, notes: string[] }} The document and one note per applied step.
 * @throws {TypeError} When the chain is malformed.
 */
export function migrate(json, chain = MIGRATIONS) {
  checkChain(chain);
  const notes = [];
  if (json === null || typeof json !== 'object' || Array.isArray(json) || json.format !== FORMAT) return { json, notes };
  let current = json;
  for (const step of chain) {
    if (current.version !== step.from) continue;
    current = { ...step.up(current), version: step.to };
    notes.push(`Migrated from format version ${step.from} to ${step.to}`);
  }
  return { json: current, notes };
}
