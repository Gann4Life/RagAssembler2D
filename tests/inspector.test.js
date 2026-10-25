import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { loadJson } from '../js/model/io.js';
import { setProps } from '../js/commands/props.js';
import { MIXED, editCommand, fieldRow, sharedValue } from '../js/inspector/rows.js';
import { PAGE_BUILDERS, inspectorPage } from '../js/inspector/page.js';
import { rootPage } from '../js/inspector/root-page.js';
import { bodyPage } from '../js/inspector/body-page.js';
import { rigDocument } from './helpers/rigs.js';

const near = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-9, `${label} ${actual} !== ${expected}`);

function rigJson() {
  const json = rigDocument('puppet', 'base', [
    { id: 'base', at: [0, 0.1], shapes: [{ type: 'box', center: [0, 0], width: 0.6, height: 0.2, angle: 0 }] },
    { id: 'pole', at: [0, 0.7], angle: 0.5, shapes: [{ type: 'box', center: [0, 0], width: 0.1, height: 1, angle: 0 }, { type: 'circle', center: [0, 0.5], radius: 0.1 }], parent: 'base', anchor: [0, 0.2] },
    { id: 'tip', at: [0, 1.3], shapes: [{ type: 'circle', center: [0, 0], radius: 0.1 }], parent: 'pole', anchor: [0, 1.2] },
  ]);
  json.bodies[2].fixtures[0].name = '';
  json.clips.push({
    key: 'walk',
    name: 'walk',
    loop: false,
    hold: true,
    layer: 0,
    blend: 'override',
    length: 2,
    fadeIn: 0,
    fadeOut: 0,
    speed: 1,
    tracks: [
      { target: 'root', channel: 'strength', keys: [{ t: 0, v: 0.5, interp: 'linear' }, { t: 2, v: 0.25, interp: 'linear' }] },
      { target: 'root', channel: 'bodyAngle', keys: [{ t: 0, v: Math.PI / 2, interp: 'linear' }] },
    ],
    events: [],
  });
  return json;
}

function setup() {
  const editor = createEditor();
  const result = loadJson(editor.model, JSON.stringify(rigJson()));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const { model } = editor;
  const uid = (id) => model.uidOf(id);
  const page = () => inspectorPage(editor);
  const rowOf = (current, id) => current.sections.flatMap((section) => section.rows).find((row) => row.id === id);
  return { editor, model, uid, page, rowOf };
}

function ctxOf(editor, type, uids, overrides = {}) {
  return { model: editor.model, type, uids, editable: true, reason: null, animate: null, pixelsPerMeter: 32, ...overrides };
}

test('inspector: an empty selection shows the Ragdoll page without selecting the root', () => {
  const { editor, page } = setup();
  const current = page();
  assert.equal(current.kind, 'object');
  assert.equal(current.type, 'root');
  assert.deepEqual(current.uids, [ROOT_UID]);
  assert.equal(current.title, 'Ragdoll · puppet');
  assert.equal(current.summary, null);
  assert.deepEqual(current.sections.map((section) => section.id), ['ragdoll', 'document', 'drive', 'balance']);
  assert.deepEqual(current.sections.map((section) => section.label), ['Ragdoll', 'Document', 'Drive', 'Balance']);
  assert.deepEqual(editor.selection.objects, []);
  editor.selection.set([ROOT_UID]);
  assert.equal(page().structure, current.structure);
  assert.equal(PAGE_BUILDERS.root, rootPage);
  assert.equal(PAGE_BUILDERS.body, bodyPage);
  assert.ok(Object.isFrozen(PAGE_BUILDERS));
});

test('inspector: several types give a mixed page, a type without a builder an unbuilt page', () => {
  const { editor, uid, page, model } = setup();
  editor.selection.set([uid('b_base'), uid('j_pole'), uid('b_tip')]);
  const mixed = page();
  assert.equal(mixed.kind, 'mixed');
  assert.equal(mixed.type, null);
  assert.equal(mixed.title, '3 objects selected');
  assert.equal(mixed.summary, '2 bodies, 1 joint');
  assert.deepEqual(mixed.sections, []);
  assert.deepEqual(mixed.uids, [uid('b_base'), uid('j_pole'), uid('b_tip')]);
  editor.selection.set([uid('j_pole')]);
  assert.equal(page().kind, 'unbuilt');
  assert.equal(page().title, 'Joint · pole');
  const shapes = model.children(uid('b_pole'), 'fixtures');
  editor.selection.set([...shapes]);
  assert.equal(page().title, '2 shapes');
  assert.equal(page().type, 'shape');
  editor.selection.set([uid('b_base'), uid('b_pole')]);
  assert.equal(page().title, '2 bodies');
});

test('inspector: the timeline list is shown when focused, and the root page when it is empty', () => {
  const { editor, model, page } = setup();
  const clip = model.children(ROOT_UID, 'clips')[0];
  const track = model.children(clip, 'tracks')[0];
  const key = model.children(track, 'keys')[0];
  editor.selection.set([key]);
  assert.equal(editor.selection.focus, 'timeline');
  assert.equal(page().kind, 'unbuilt');
  assert.equal(page().title, 'Key');
  editor.selection.remove([key]);
  assert.equal(editor.selection.focus, 'timeline');
  assert.equal(page().type, 'root');
});

test('inspector: body rows show display units, the mass, the shapes and the root body button', () => {
  const { editor, uid, page, rowOf, model } = setup();
  editor.selection.set([uid('b_pole')]);
  const current = page();
  assert.equal(current.title, 'Body · pole');
  assert.deepEqual(current.sections.map((section) => section.id), ['body', 'transform', 'physics', 'shapes', 'actions']);
  const position = rowOf(current, 'position');
  assert.equal(position.control, 'vec2');
  assert.equal(position.unit, 'px');
  near(position.value[0], 0);
  near(position.value[1], 22.4);
  assert.deepEqual(position.text, ['0', '22.4']);
  assert.deepEqual(position.edit, { kind: 'placement', uids: [uid('b_pole')], field: 'position', label: 'Move' });
  const angle = rowOf(current, 'angle');
  assert.equal(angle.unit, '°');
  near(angle.value, 0.5 * 180 / Math.PI);
  assert.equal(angle.text, '28.6');
  assert.equal(angle.edit.field, 'angle');
  const damping = rowOf(current, 'linearDamping');
  assert.equal(damping.label, 'Linear damping');
  assert.equal(damping.unit, '1/s');
  assert.equal(damping.min, 0);
  assert.equal(damping.text, '0');
  assert.equal(rowOf(current, 'fixedRotation').control, 'checkbox');
  assert.equal(rowOf(current, 'fixedRotation').value, false);
  const mass = rowOf(current, 'mass');
  assert.equal(mass.control, 'readout');
  assert.equal(mass.unit, 'kg');
  assert.equal(mass.value, String(Number((0.1 + Math.PI * 0.01).toPrecision(3))));
  assert.equal(mass.readOnly, true);
  assert.equal(mass.reason, 'computed from the shapes');
  const shapes = rowOf(current, 'shapes');
  assert.equal(shapes.control, 'list');
  assert.deepEqual(shapes.items.map((item) => [item.label, item.muted, item.icon]), [['pole_0', false, 'box'], ['pole_1', false, 'circle']]);
  assert.deepEqual(shapes.items.map((item) => item.uid), [...model.children(uid('b_pole'), 'fixtures')]);
  assert.deepEqual(shapes.edit, { kind: 'select' });
  const button = rowOf(current, 'set-root-body');
  assert.equal(button.label, 'Set as root body');
  assert.deepEqual(button.edit, { kind: 'action', action: 'set-root-body', label: 'Set as root body' });
  editor.selection.set([uid('b_base')]);
  assert.equal(rowOf(page(), 'set-root-body').label, 'Root body');
  editor.selection.set([uid('b_tip')]);
  const tip = rowOf(page(), 'shapes').items[0];
  assert.deepEqual([tip.label, tip.muted], ['f_tip_0', true]);
});

test('inspector: shared values are shown once, differing ones as MIXED, per vector component', () => {
  const { editor, uid, page, rowOf, model } = setup();
  editor.selection.set([uid('b_pole'), uid('b_tip')]);
  const current = page();
  const name = rowOf(current, 'name');
  assert.equal(name.value, MIXED);
  assert.equal(name.text, '');
  const position = rowOf(current, 'position');
  assert.equal(position.value[0], 0);
  assert.equal(position.value[1], MIXED);
  assert.deepEqual(position.text, ['0', '']);
  assert.equal(rowOf(current, 'angle').value, MIXED);
  assert.equal(rowOf(current, 'linearDamping').value, 0);
  assert.equal(rowOf(current, 'mass').value, MIXED);
  assert.equal(rowOf(current, 'mass').text, '—');
  assert.equal(rowOf(current, 'shapes').value, MIXED);
  assert.deepEqual(rowOf(current, 'shapes').items, []);
  assert.equal(rowOf(current, 'set-root-body').label, 'Set as root body');
  assert.deepEqual(sharedValue(model, [uid('b_pole'), uid('b_tip')], 'position'), [0, MIXED]);
  assert.deepEqual(sharedValue(model, [uid('b_pole'), uid('b_tip')], 'bullet'), false);
  assert.equal(sharedValue(model, [uid('b_pole'), uid('b_tip')], 'id'), MIXED);
});

test('inspector: root rows convert units and show balance maxTorque as automatic', () => {
  const { editor, page, rowOf, uid } = setup();
  editor.history.execute(setProps([ROOT_UID], { 'units.pixelsPerMeter': 100, 'channels.gain': 0.25 }));
  const current = page();
  assert.equal(current.pixelsPerMeter, 100);
  const ppm = rowOf(current, 'units.pixelsPerMeter');
  assert.deepEqual([ppm.label, ppm.value, ppm.unit, ppm.min, ppm.exclusiveMin, ppm.text], ['Pixels per meter', 100, 'px/m', 0, true, '100']);
  const gain = rowOf(current, 'channels.gain');
  assert.deepEqual([gain.label, gain.value, gain.unit, gain.min, gain.max, gain.animated], ['Gain', 25, '%', 0, 100, true]);
  const gravity = rowOf(current, 'preview.gravity');
  assert.deepEqual([gravity.label, gravity.unit, gravity.text], ['Preview gravity', 'm/s²', ['0', '-10']]);
  const rootBody = rowOf(current, 'rootBody');
  assert.equal(rootBody.control, 'select');
  assert.equal(rootBody.value, uid('b_base'));
  assert.deepEqual(rootBody.options.map((option) => option.label), ['base', 'pole', 'tip']);
  assert.deepEqual(rootBody.edit, { kind: 'root-body' });
  const torque = rowOf(current, 'balance.maxTorque');
  assert.equal(torque.control, 'readout');
  assert.equal(torque.readOnly, true);
  assert.equal(torque.reason, 'set automatically from the rig');
  assert.match(torque.value, /^auto \(\d+(\.\d+)? N·m\)$/);
  assert.equal(torque.unit, '');
  assert.equal(rowOf(current, 'balance.enabled').value, true);
  assert.equal(rowOf(current, 'balance.damping').unit, '');
  assert.equal(rowOf(current, 'id').reason, 'ids never change');
  assert.equal(rowOf(current, 'position').reason, 'the root transform is locked');
  assert.equal(rowOf(current, 'angle').readOnly, true);
  assert.equal(rowOf(current, 'bodyAngle'), undefined);
  assert.equal(rowOf(current, 'name').readOnly, false);
  assert.equal(rowOf(current, 'rootBody').readOnly, false);
  editor.selection.set([uid('b_pole')]);
  near(rowOf(page(), 'position').value[1], 70);
});

test('inspector: a rootBody that is not set shows no value', () => {
  const { editor, page, rowOf } = setup();
  editor.history.execute(setProps([ROOT_UID], { rootBody: null }));
  assert.equal(rowOf(page(), 'rootBody').value, null);
});

test('inspector: Animate makes non-animated rows read-only and shows root channels at the playhead', () => {
  const { editor, page, rowOf, uid, model } = setup();
  editor.actions.run('mode:animate');
  editor.modes.setPlayhead(1);
  const root = page();
  const strength = rowOf(root, 'channels.strength');
  assert.equal(strength.readOnly, true);
  assert.equal(strength.reason, 'the value at the playhead');
  near(strength.value, 37.5);
  assert.equal(strength.text, '37.5');
  near(rowOf(root, 'channels.gain').value, 100);
  const bodyAngle = rowOf(root, 'bodyAngle');
  assert.equal(bodyAngle.readOnly, true);
  near(bodyAngle.value, 90);
  assert.equal(bodyAngle.unit, '°');
  assert.equal(bodyAngle.edit, null);
  assert.equal(rowOf(root, 'name').readOnly, true);
  assert.equal(rowOf(root, 'name').reason, 'only in Edit mode');
  assert.equal(rowOf(root, 'id').reason, 'ids never change');
  assert.equal(model.prop(ROOT_UID, 'channels.strength'), 1);
  editor.selection.set([uid('b_pole')]);
  const body = page();
  assert.equal(rowOf(body, 'position').readOnly, true);
  near(rowOf(body, 'position').value[1], 22.4);
  assert.equal(rowOf(body, 'linearDamping').reason, 'only in Edit mode');
  assert.equal(rowOf(body, 'shapes').readOnly, false);
  editor.selection.clear();
  editor.modes.setPlayhead(2);
  assert.equal(page().structure, root.structure);
  near(rowOf(page(), 'channels.strength').value, 25);
  editor.actions.run('mode:edit');
  assert.notEqual(page().structure, root.structure);
  assert.equal(rowOf(page(), 'bodyAngle'), undefined);
  assert.equal(rowOf(page(), 'channels.strength').value, 100);
});

test('inspector: playhead channels are cached per model change, clip and time', () => {
  const { editor, model } = setup();
  editor.actions.run('mode:animate');
  editor.modes.setPlayhead(1);
  let evaluations = 0;
  const children = model.children.bind(model);
  model.children = (uid, collection) => {
    if (collection === 'clips') evaluations += 1;
    return children(uid, collection);
  };
  const clip = editor.modes.clip;
  const render = (time) => rootPage(ctxOf(editor, 'root', [ROOT_UID], { animate: { clip, time } }));
  const cost = (time) => {
    const before = evaluations;
    render(time);
    return evaluations - before;
  };
  const full = cost(1);
  assert.ok(full > 0);
  assert.equal(cost(1), 0);
  assert.equal(cost(2), full);
  assert.equal(cost(2), 0);
  editor.history.execute(setProps([ROOT_UID], { 'channels.gain': 0.5 }));
  assert.equal(cost(2), full);
  assert.equal(cost(2), 0);
});

test('inspector: a failing playhead evaluation falls back to the document values', () => {
  const { editor, model } = setup();
  const children = model.children.bind(model);
  model.children = (uid, collection) => {
    if (collection === 'clips') throw new Error('boom');
    return children(uid, collection);
  };
  const sections = rootPage(ctxOf(editor, 'root', [ROOT_UID], { animate: { clip: 1, time: 0 } }));
  const rows = sections.flatMap((section) => section.rows);
  assert.equal(rows.find((row) => row.id === 'bodyAngle'), undefined);
  assert.ok(rows.find((row) => row.id === 'channels.strength'));
});

test('inspector: Simulate shows document values, every field read-only', () => {
  const { editor, page, rowOf } = setup();
  editor.modes.startSimulate();
  const current = page();
  const rows = current.sections.flatMap((section) => section.rows);
  assert.ok(rows.every((row) => row.readOnly));
  assert.equal(rowOf(current, 'channels.strength').value, 100);
  assert.equal(rowOf(current, 'channels.strength').reason, 'only in Edit mode');
  assert.equal(rowOf(current, 'bodyAngle'), undefined);
});

test('inspector: during a gesture fields are read-only without a mode reason', () => {
  const { editor, page, rowOf, uid } = setup();
  editor.selection.set([uid('b_pole')]);
  const before = page();
  editor.history.beginGesture();
  const current = page();
  assert.equal(rowOf(current, 'name').readOnly, true);
  assert.equal(rowOf(current, 'name').reason, null);
  assert.equal(rowOf(current, 'id').reason, 'ids never change');
  assert.equal(rowOf(current, 'shapes').readOnly, false);
  assert.notEqual(current.structure, before.structure);
  editor.history.cancelGesture();
  assert.equal(page().structure, before.structure);
});

test('inspector: the structure ignores values and follows selection and mode', () => {
  const { editor, page, uid } = setup();
  editor.selection.set([uid('b_pole')]);
  const before = page();
  editor.history.execute(setProps([uid('b_pole')], { name: 'mast', linearDamping: 2 }));
  const renamed = page();
  assert.equal(renamed.structure, before.structure);
  assert.equal(renamed.title, 'Body · mast');
  editor.selection.set([uid('b_tip')]);
  assert.notEqual(page().structure, before.structure);
});

test('editCommand: props edits convert display units and label the undo step', () => {
  const { editor, page, rowOf, model, uid } = setup();
  const { history } = editor;
  const opts = { pixelsPerMeter: 32 };
  const root = page();
  history.execute(editCommand(model, rowOf(root, 'name').edit, 'doll', opts));
  assert.equal(model.prop(ROOT_UID, 'name'), 'doll');
  assert.equal(history.state.undoLabel, 'Rename');
  assert.equal(editCommand(model, rowOf(root, 'name').edit, 'doll', opts), null);
  history.execute(editCommand(model, rowOf(root, 'channels.strength').edit, 50, opts));
  assert.equal(model.prop(ROOT_UID, 'channels.strength'), 0.5);
  assert.equal(history.state.undoLabel, 'Edit strength');
  history.execute(editCommand(model, rowOf(root, 'units.pixelsPerMeter').edit, 64, opts));
  assert.equal(model.prop(ROOT_UID, 'units.pixelsPerMeter'), 64);
  assert.equal(history.state.undoLabel, 'Pixels per meter');
  history.execute(editCommand(model, rowOf(root, 'balance.gain').edit, 4, opts));
  assert.equal(model.prop(ROOT_UID, 'balance.gain'), 4);
  assert.equal(history.state.undoLabel, 'Edit balance gain');
  history.execute(editCommand(model, rowOf(root, 'balance.enabled').edit, false, opts));
  assert.equal(model.prop(ROOT_UID, 'balance.enabled'), false);
  history.execute(editCommand(model, rowOf(root, 'preview.gravity').edit, -9.8, { component: 1, pixelsPerMeter: 32 }));
  assert.deepEqual(model.prop(ROOT_UID, 'preview.gravity'), [0, -9.8]);
  assert.equal(history.state.undoLabel, 'Edit preview gravity');
  editor.selection.set([uid('b_pole'), uid('b_tip')]);
  const bodies = page();
  history.execute(editCommand(model, rowOf(bodies, 'linearDamping').edit, 1.5, opts));
  assert.equal(model.prop(uid('b_pole'), 'linearDamping'), 1.5);
  assert.equal(model.prop(uid('b_tip'), 'linearDamping'), 1.5);
  assert.equal(history.state.undoLabel, 'Edit linear damping');
  history.undo();
  assert.equal(model.prop(uid('b_pole'), 'linearDamping'), 0);
  assert.equal(model.prop(uid('b_tip'), 'linearDamping'), 0);
});

test('editCommand: a vec2 component edit of several objects keeps each other component, in one step', () => {
  const { editor, model, uid } = setup();
  const edit = { kind: 'props', uids: [uid('b_pole'), uid('b_tip')], path: 'position', unit: 'm', label: 'Edit position' };
  editor.history.execute(editCommand(model, edit, 64, { component: 0, pixelsPerMeter: 32 }));
  assert.deepEqual(model.prop(uid('b_pole'), 'position'), [2, 0.7]);
  assert.deepEqual(model.prop(uid('b_tip'), 'position'), [2, 1.3]);
  assert.equal(editor.history.state.undoLabel, 'Edit position');
  editor.history.undo();
  assert.deepEqual(model.prop(uid('b_tip'), 'position'), [0, 1.3]);
  assert.equal(editCommand(model, edit, 0, { component: 0, pixelsPerMeter: 32 }), null);
});

test('editCommand: placement edits move and rotate bodies with their subtrees', () => {
  const { editor, page, rowOf, model, uid } = setup();
  const { history } = editor;
  editor.selection.set([uid('b_pole')]);
  const current = page();
  history.execute(editCommand(model, rowOf(current, 'position').edit, 32, { component: 0, pixelsPerMeter: 32 }));
  assert.deepEqual(model.prop(uid('b_pole'), 'position'), [1, 0.7]);
  near(model.prop(uid('b_tip'), 'position')[0], 1);
  near(model.prop(uid('j_tip'), 'anchor')[0], 1);
  assert.deepEqual(model.prop(uid('b_base'), 'position'), [0, 0.1]);
  assert.equal(history.state.undoLabel, 'Move');
  history.undo();
  history.execute(editCommand(model, rowOf(current, 'angle').edit, 90, { pixelsPerMeter: 32 }));
  assert.equal(history.state.undoLabel, 'Rotate');
  near(model.prop(uid('b_pole'), 'angle'), Math.PI / 2);
  const pole = model.prop(uid('b_pole'), 'position');
  const pivot = model.prop(uid('j_pole'), 'anchor');
  assert.deepEqual(pivot, [0, 0.2]);
  near(Math.hypot(pole[0] - pivot[0], pole[1] - pivot[1]), 0.5);
  assert.equal(editCommand(model, rowOf(current, 'angle').edit, 90, { pixelsPerMeter: 32 }), null);
  assert.throws(() => editCommand(model, rowOf(current, 'position').edit, 3, { pixelsPerMeter: 32 }), /component/);
  assert.throws(() => editCommand(model, { kind: 'root-body' }, 3, { pixelsPerMeter: 32 }), /not a command/);
});

test('fieldRow: a path outside the schema needs a control; derived reasons hold in every mode', () => {
  const { editor, uid } = setup();
  const ctx = ctxOf(editor, 'body', [uid('b_pole')]);
  assert.throws(() => fieldRow(ctx, 'nothing'), /Unknown field/);
  const row = fieldRow(ctx, 'mass', { control: 'readout', dataUnit: 'kg', value: 1234.5, reason: 'computed from the shapes' });
  assert.equal(row.value, '1230');
  assert.equal(row.edit, null);
  const locked = fieldRow({ ...ctx, editable: false, reason: null }, 'name');
  assert.equal(locked.readOnly, true);
  assert.equal(locked.reason, null);
  assert.equal(locked.edit.kind, 'props');
  assert.ok(Object.isFrozen(row));
});
