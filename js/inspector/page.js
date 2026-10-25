import { defaultsOf } from '../../lib/schema.js';
import { ROOT_UID } from '../model/model.js';
import { bodyPage } from './body-page.js';
import { rootPage } from './root-page.js';

/**
 * What the inspector shows for the current selection.
 * @typedef {object} InspectorPage
 * @property {'mixed'|'unbuilt'|'object'} kind Objects of several types, a type without a page, or one type's page;
 *   an empty selection gives the root `object` page.
 * @property {string|null} type Node type of the page; `null` when mixed.
 * @property {ReadonlyArray<number>} uids Objects shown, in selection order.
 * @property {string} title E.g. `Body · arm_l`, `3 bodies`, `3 objects selected`.
 * @property {string|null} summary Mixed only: the count per type, e.g. `2 bodies, 1 joint`.
 * @property {ReadonlyArray<import('./rows.js').InspectorSection>} sections Empty unless `kind` is `object`.
 * @property {number} pixelsPerMeter Document scale used for the display values, px/m.
 * @property {string} structure Signature of kind, type, uids, mode and each section's and row's id, control and
 *   read-only state; equal signatures can be updated in place.
 */

/**
 * Page builders by node type. Later object types add one entry each.
 * @type {Readonly<Record<string, (ctx: import('./rows.js').PageContext) => ReadonlyArray<import('./rows.js').InspectorSection>>>}
 */
export const PAGE_BUILDERS = Object.freeze({ root: rootPage, body: bodyPage });

const TYPE_NAMES = Object.freeze({
  root: ['Ragdoll', 'ragdoll', 'ragdolls'],
  spriteAsset: ['Sprite asset', 'sprite asset', 'sprite assets'],
  body: ['Body', 'body', 'bodies'],
  shape: ['Shape', 'shape', 'shapes'],
  joint: ['Joint', 'joint', 'joints'],
  clip: ['Clip', 'clip', 'clips'],
  key: ['Key', 'key', 'keys'],
  event: ['Event', 'event', 'events'],
});

const FALLBACK_PIXELS_PER_METER = defaultsOf('document').units.pixelsPerMeter;

function names(type) {
  return TYPE_NAMES[type] ?? [type, type, `${type}s`];
}

function countOf(count, type) {
  const [, one, many] = names(type);
  return `${count} ${count === 1 ? one : many}`;
}

function labelOf(model, uid) {
  for (const path of ['name', 'id', 'key']) {
    const value = model.prop(uid, path);
    if (typeof value === 'string' && value !== '') return value;
  }
  return '';
}

function titleOf(model, type, uids) {
  if (uids.length > 1) return countOf(uids.length, type);
  const label = labelOf(model, uids[0]);
  return label === '' ? names(type)[0] : `${names(type)[0]} · ${label}`;
}

function pixelsPerMeterOf(model) {
  const value = model.prop(ROOT_UID, 'units.pixelsPerMeter');
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : FALLBACK_PIXELS_PER_METER;
}

function structureOf(kind, type, uids, mode, sections) {
  return JSON.stringify([
    kind,
    type,
    uids,
    mode,
    sections.map((section) => [section.id, section.rows.map((row) => [row.id, row.control, row.readOnly])]),
  ]);
}

function page(fields, mode) {
  const sections = fields.sections ?? Object.freeze([]);
  return Object.freeze({
    summary: null,
    ...fields,
    uids: Object.freeze([...fields.uids]),
    sections,
    structure: structureOf(fields.kind, fields.type, fields.uids, mode, sections),
  });
}

/**
 * The inspector page of the selection (`DESIGN.md` §5.7): the objects list, or the timeline list when it has the
 * focus; nothing selected gives the Ragdoll (root) page; several types give a `mixed` page; a type without a builder
 * gives an `unbuilt` page. Rows are editable only in Edit mode without a gesture; in Animate, animated rows show the
 * value at the playhead. Pure.
 * @param {{ model: import('../model/model.js').Model, selection: import('../model/selection.js').Selection,
 *   modes: import('../modes.js').Modes, history: import('../commands/history.js').History }} editor Editor core parts.
 * @returns {Readonly<InspectorPage>} The page.
 */
export function inspectorPage({ model, selection, modes, history }) {
  const list = selection.focus === 'timeline' ? selection.timeline : selection.objects;
  const uids = list.length === 0 ? [ROOT_UID] : [...list];
  const pixelsPerMeter = pixelsPerMeterOf(model);
  const types = [];
  const counts = new Map();
  for (const uid of uids) {
    const type = model.get(uid)?.type ?? 'unknown';
    if (!counts.has(type)) types.push(type);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  if (types.length > 1) {
    return page({
      kind: 'mixed',
      type: null,
      uids,
      title: `${uids.length} objects selected`,
      summary: types.map((type) => countOf(counts.get(type), type)).join(', '),
      pixelsPerMeter,
    }, modes.mode);
  }
  const [type] = types;
  const title = titleOf(model, type, uids);
  const build = Object.hasOwn(PAGE_BUILDERS, type) ? PAGE_BUILDERS[type] : null;
  if (build === null) return page({ kind: 'unbuilt', type, uids, title, pixelsPerMeter }, modes.mode);
  const gesture = history.inGesture;
  const ctx = Object.freeze({
    model,
    type,
    uids: Object.freeze([...uids]),
    editable: modes.can('edit.rest') && !gesture,
    reason: gesture ? null : modes.reason('edit.rest'),
    animate: modes.mode === 'animate' && modes.clip !== null ? Object.freeze({ clip: modes.clip, time: modes.playhead }) : null,
    pixelsPerMeter,
  });
  return page({ kind: 'object', type, uids, title, sections: build(ctx), pixelsPerMeter }, modes.mode);
}
