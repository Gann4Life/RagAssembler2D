import { ROOT_UID } from '../model/model.js';
import { resolvedChannelsAt } from '../model/clip-channels.js';
import { channelRow, fieldRow } from './rows.js';

const LOCKED = 'the root transform is locked';
const AUTO = 'set automatically from the rig';
const ANGLE_REASON = 'key angles with Pose or Key selected';

function labelOf(model, uid) {
  const name = model.prop(uid, 'name');
  return typeof name === 'string' && name !== '' ? name : String(model.prop(uid, 'id') ?? '');
}

function rootBodyUid(model) {
  const id = model.prop(ROOT_UID, 'rootBody');
  const uid = typeof id === 'string' ? model.uidOf(id) : null;
  return uid !== null && model.get(uid)?.type === 'body' ? uid : null;
}

function freeze(sections) {
  return Object.freeze(sections.map((section) => Object.freeze({ ...section, rows: Object.freeze(section.rows) })));
}

function documentSections(ctx) {
  return freeze([
    {
      id: 'document',
      label: 'Document',
      rows: [fieldRow(ctx, 'units.pixelsPerMeter', { label: 'Pixels per meter' }), fieldRow(ctx, 'preview.gravity', { label: 'Preview gravity' })],
    },
  ]);
}

/**
 * Sections of the Document page (`ctx.type` `document`: nothing selected) or of the Ragdoll (root) page
 * (`DESIGN.md` §5.7). Document: DOCUMENT (`pixelsPerMeter`, preview gravity). Ragdoll: RAGDOLL (name, id, locked
 * position and angle, `rootBody` dropdown), DRIVE (strength, balance, gain and damping multipliers with their key
 * buttons ◇: base values outside Animate, the open clip's values at the playhead in Animate, plus the evaluated root
 * body angle, read-only) and BALANCE CONTROLLER (`maxTorque` read-only "auto"). Pure.
 * @param {import('./rows.js').PageContext} ctx Page context; `uids` is `[ROOT_UID]`, `type` is `root` or `document`.
 * @returns {ReadonlyArray<import('./rows.js').InspectorSection>} Frozen sections.
 */
export function rootPage(ctx) {
  if (ctx.type === 'document') return documentSections(ctx);
  const { model } = ctx;
  const row = (path, overrides) => fieldRow(ctx, path, overrides);
  const resolved = ctx.animate === null ? null : resolvedChannelsAt(model, ctx.animate.clip, ctx.animate.time);
  const channel = (name, label) => channelRow(ctx, { id: `channels.${name}`, label, channel: name });
  const drive = [channel('strength', 'Strength'), channel('balance', 'Balance'), channel('gain', 'Gain'), channel('damping', 'Damping')];
  if (resolved?.root?.bodyAngle !== undefined) {
    drive.push(row('bodyAngle', { label: 'Body angle', control: 'number', dataUnit: 'rad', value: resolved.root.bodyAngle, animated: true, reason: ANGLE_REASON, edit: null }));
  }
  const balance = (name, label, overrides = {}) => row(`balance.${name}`, { label, commitLabel: `Edit balance ${label.toLowerCase()}`, ...overrides });
  const sections = [
    {
      id: 'ragdoll',
      label: 'Ragdoll',
      rows: [
        row('name'),
        row('id'),
        row('position', { reason: LOCKED }),
        row('angle', { reason: LOCKED }),
        row('rootBody', {
          label: 'Root body',
          control: 'select',
          value: rootBodyUid(model),
          options: model.children(ROOT_UID, 'bodies').map((uid) => ({ value: uid, label: labelOf(model, uid) })),
          edit: Object.freeze({ kind: 'root-body' }),
        }),
      ],
    },
    { id: 'drive', label: 'Drive', rows: drive },
    {
      id: 'balance',
      label: 'Balance controller',
      rows: [
        balance('enabled', 'Enabled'),
        balance('maxTorque', 'Max torque', { control: 'readout', unit: '', reason: AUTO, textFormat: (text) => `auto (${text} N·m)` }),
        balance('gain', 'Gain'),
        balance('damping', 'Damping'),
        balance('maxSpeed', 'Max speed'),
      ],
    },
  ];
  return freeze(sections);
}
