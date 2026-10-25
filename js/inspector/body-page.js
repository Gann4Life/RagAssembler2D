import { bodyMass } from '../../lib/geometry.js';
import { ROOT_UID } from '../model/model.js';
import { MIXED, fieldRow } from './rows.js';

const COMPUTED = 'computed from the shapes';

function massOf(model, body) {
  const fixtures = model.children(body, 'fixtures').map((uid) => ({ shape: model.prop(uid, 'shape'), density: model.prop(uid, 'density') }));
  return bodyMass(fixtures).mass;
}

function sharedMass(model, uids) {
  const masses = uids.map((uid) => massOf(model, uid));
  return masses.every((mass) => mass === masses[0]) ? masses[0] : MIXED;
}

function shapeItem(model, uid) {
  const name = model.prop(uid, 'name');
  const named = typeof name === 'string' && name !== '';
  const type = model.prop(uid, 'shape.type');
  return {
    uid,
    label: named ? name : String(model.prop(uid, 'id') ?? ''),
    muted: !named,
    icon: typeof type === 'string' ? type : 'shape',
  };
}

function isRootBody(model, uid) {
  const id = model.prop(ROOT_UID, 'rootBody');
  return typeof id === 'string' && model.uidOf(id) === uid;
}

/**
 * Sections of the Body page (`DESIGN.md` §5.7): BODY (name, id), TRANSFORM (position and angle, placed with the
 * subtree through `placeBodies`), PHYSICS (damping, `fixedRotation`, `bullet`, read-only mass), SHAPES (the shapes
 * of one body, `—` for several) and the Set as root body button ("Root body" when it already is). Pure.
 * @param {import('./rows.js').PageContext} ctx Page context; `uids` are bodies.
 * @returns {ReadonlyArray<import('./rows.js').InspectorSection>} Frozen sections.
 */
export function bodyPage(ctx) {
  const { model, uids } = ctx;
  const row = (path, overrides) => fieldRow(ctx, path, overrides);
  const single = uids.length === 1;
  const placement = (field, label) => Object.freeze({ kind: 'placement', uids: Object.freeze([...uids]), field, label });
  const sections = [
    { id: 'body', label: 'Body', rows: [row('name'), row('id')] },
    {
      id: 'transform',
      label: 'Transform',
      rows: [row('position', { edit: placement('position', 'Move') }), row('angle', { edit: placement('angle', 'Rotate') })],
    },
    {
      id: 'physics',
      label: 'Physics',
      rows: [
        row('linearDamping'),
        row('angularDamping'),
        row('fixedRotation'),
        row('bullet'),
        row('mass', { control: 'readout', dataUnit: 'kg', value: sharedMass(model, uids), reason: COMPUTED }),
      ],
    },
    {
      id: 'shapes',
      label: 'Shapes',
      rows: [
        row('shapes', {
          control: 'list',
          value: single ? null : MIXED,
          items: single ? model.children(uids[0], 'fixtures').map((uid) => shapeItem(model, uid)) : [],
          modeFree: true,
          edit: Object.freeze({ kind: 'select' }),
        }),
      ],
    },
    {
      id: 'actions',
      label: null,
      rows: [
        row('set-root-body', {
          label: single && isRootBody(model, uids[0]) ? 'Root body' : 'Set as root body',
          control: 'button',
          value: null,
          edit: Object.freeze({ kind: 'action', action: 'set-root-body', label: 'Set as root body' }),
        }),
      ],
    },
  ];
  return Object.freeze(sections.map((section) => Object.freeze({ ...section, rows: Object.freeze(section.rows) })));
}
