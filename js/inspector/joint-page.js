import { parentJoints } from '../model/queries.js';
import { resolvedChannelsAt } from '../model/clip-channels.js';
import { jointRest } from '../commands/transform.js';
import { MIXED, channelRow, fieldRow } from './rows.js';

const AUTO = 'set automatically from the rig';
const BODIES_READ_ONLY = 'not editable in the inspector yet';
const NO_CHILD = 'the joint has no child body';
const NO_ANCHOR = 'the joint has no placed anchor';
const REST_TOLERANCE = 1e-9;
const MAX_SPEED_HINT = 'Caps the correction speed only; keyed motion is never slowed by it.';
const ANGLE_REASON = 'key angles with Pose or Key selected';

function bodyLabel(model, id) {
  const uid = typeof id === 'string' ? model.uidOf(id) : null;
  const name = uid === null ? null : model.prop(uid, 'name');
  if (typeof name === 'string' && name !== '') return name;
  return typeof id === 'string' ? id : '';
}

function sharedBodyLabel(model, uids, path) {
  const labels = uids.map((uid) => bodyLabel(model, model.prop(uid, path)));
  return labels.every((label) => label === labels[0]) ? labels[0] : MIXED;
}

function restOf(model, uids) {
  const parents = parentJoints(model);
  const infos = uids.map((uid) => jointRest(model, uid, parents));
  const values = infos.map((info) => info.rest);
  const [first] = values;
  const same = values.every((value) => (value === null ? first === null : first !== null && Math.abs(value - first) <= REST_TOLERANCE));
  let reason = null;
  if (infos.some((info) => info.child === null)) reason = NO_CHILD;
  else if (infos.some((info) => !info.placed)) reason = NO_ANCHOR;
  return { value: same ? first : MIXED, reason };
}

/**
 * Sections of the Joint page (`DESIGN.md` §5.7): JOINT (name, id, type, bodyA and bodyB read-only, anchor, derived
 * rest angle, `collideConnected`), LIMITS, MOTOR (`maxTorque` read-only "auto (… N·m)", gain, damping, `maxSpeed`
 * with its hint), AIM (`aimAxis`) and, in Animate only, ANIMATION (the evaluated `angle` at the playhead, read-only,
 * and the `strength`, `gain` and `damping` channel rows with their key buttons ◇). The rest angle commits as a
 * `rest-angle` edit and is read-only, with its reason, when a joint has no child body or no placed anchor. Pure.
 * @param {import('./rows.js').PageContext} ctx Page context; `uids` are joints.
 * @returns {ReadonlyArray<import('./rows.js').InspectorSection>} Frozen sections.
 */
export function jointPage(ctx) {
  const { model, uids } = ctx;
  const row = (path, overrides) => fieldRow(ctx, path, overrides);
  const body = (path, label) =>
    row(path, { label, control: 'readout', value: sharedBodyLabel(model, uids, path), reason: BODIES_READ_ONLY, edit: null });
  const rest = restOf(model, uids);
  const limit = (name, label) => row(`limits.${name}`, { label, commitLabel: `Edit limit ${label.toLowerCase()}` });
  const motor = (name, label, overrides = {}) => row(`motor.${name}`, { label, commitLabel: `Edit motor ${label.toLowerCase()}`, ...overrides });
  const sections = [
    {
      id: 'joint',
      label: 'Joint',
      rows: [
        row('name'),
        row('id'),
        row('type'),
        body('bodyA', 'Body A'),
        body('bodyB', 'Body B'),
        row('anchor'),
        row('restAngle', {
          label: 'Rest angle',
          control: 'number',
          dataUnit: 'rad',
          value: rest.value,
          ...(rest.reason === null ? {} : { reason: rest.reason }),
          edit: Object.freeze({ kind: 'rest-angle', uids: Object.freeze([...uids]), label: 'Edit rest angle' }),
        }),
        row('collideConnected'),
      ],
    },
    { id: 'limits', label: 'Limits', rows: [limit('enabled', 'Enabled'), limit('lower', 'Lower'), limit('upper', 'Upper')] },
    {
      id: 'motor',
      label: 'Motor',
      rows: [
        motor('maxTorque', 'Max torque', {
          control: 'readout',
          unit: '',
          reason: AUTO,
          edit: null,
          textFormat: (text) => (text === '' ? '—' : `auto (${text} N·m)`),
        }),
        motor('gain', 'Gain'),
        motor('damping', 'Damping'),
        motor('maxSpeed', 'Max speed', { hint: MAX_SPEED_HINT }),
      ],
    },
    { id: 'aim', label: 'Aim', rows: [row('aimAxis', { label: 'Aim axis' })] },
  ];
  if (ctx.animate !== null) {
    const resolved = resolvedChannelsAt(model, ctx.animate.clip, ctx.animate.time);
    const angles = uids.map((uid) => resolved?.joints.get(model.prop(uid, 'id'))?.angle ?? 0);
    const angle = angles.every((value) => Math.abs(value - angles[0]) <= REST_TOLERANCE) ? angles[0] : MIXED;
    const channel = (name, label) => channelRow(ctx, { id: `channels.${name}`, label, channel: name });
    sections.push({
      id: 'animation',
      label: 'Animation',
      rows: [
        row('channels.angle', { label: 'Angle', control: 'number', dataUnit: 'rad', value: angle, animated: true, reason: ANGLE_REASON, edit: null }),
        channel('strength', 'Strength'),
        channel('gain', 'Gain'),
        channel('damping', 'Damping'),
      ],
    });
  }
  return Object.freeze(sections.map((section) => Object.freeze({ ...section, rows: Object.freeze(section.rows) })));
}
