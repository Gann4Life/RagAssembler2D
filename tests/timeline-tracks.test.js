import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { createClip, createJoint, createShapeBody } from '../js/commands/create.js';
import { insertKey, setChannelKey, setJointAngleKey, setRootBodyAngleKey } from '../js/commands/keys.js';
import { addTrack, deleteTrack } from '../js/commands/tracks.js';
import { setProps } from '../js/commands/props.js';
import { channelValueAt, channelsOf, findTrack, neutralValue, trackValueAt } from '../js/model/clip-channels.js';
import { keyValueText, summaryKeys, trackGroups, trackMenu } from '../js/timeline-rows.js';
import { MIXED, channelRow, editCommand, keyCommand } from '../js/inspector/rows.js';
import { inspectorPage } from '../js/inspector/page.js';

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
}

function environment() {
  const editor = createEditor();
  const { model, history } = editor;
  const bodies = [0, 1, 2].map((x) =>
    model.get(history.execute(createShapeBody({ position: { x, y: 0 }, angle: 0, shape: { type: 'circle', radius: 0.4 } }))).parent,
  );
  history.execute(setProps([ROOT_UID], { rootBody: model.prop(bodies[0], 'id') }));
  const first = history.execute(createJoint({ bodyA: bodies[0], bodyB: bodies[1], anchor: { x: 0.5, y: 0 } }));
  const second = history.execute(createJoint({ bodyA: bodies[1], bodyB: bodies[2], anchor: { x: 1.5, y: 0 } }));
  history.execute(setProps([second], { name: 'knee' }));
  const clip = history.execute(createClip());
  return { ...editor, joints: [first, second], clip };
}

test('trackGroups lists the root first, then joints in joints order, each with sub-tracks in channel order', () => {
  const { model, history, joints, clip } = environment();
  history.execute(setChannelKey(clip, joints[1], 'damping', 0.2, 0.5));
  history.execute(setJointAngleKey(clip, joints[1], 0.1, 1));
  history.execute(addTrack(clip, joints[0], 'strength'));
  history.execute(addTrack(clip, ROOT_UID, 'gain'));
  history.execute(setChannelKey(clip, ROOT_UID, 'balance', 0, 0));
  history.execute(setChannelKey(clip, ROOT_UID, 'strength', 0, 1));
  history.execute(setRootBodyAngleKey(clip, 0.5, 0.2));
  const groups = trackGroups(model, clip);
  assert.deepEqual(groups.map((group) => [group.target, group.label]), [[ROOT_UID, 'Root'], [joints[0], model.prop(joints[0], 'name')], [joints[1], 'knee']]);
  assert.deepEqual(groups[0].tracks.map((track) => track.label), ['body angle', 'strength', 'balance', 'gain']);
  assert.deepEqual(groups[1].tracks.map((track) => [track.channel, track.keys.length]), [['strength', 0]]);
  assert.deepEqual(groups[2].tracks.map((track) => track.channel), ['angle', 'damping']);
  assert.equal(summaryKeys(groups.flatMap((group) => group.tracks), []).length, 4);
  assert.equal(groups[0].tracks[2].keys[0].v, 0);
  assert.deepEqual(trackGroups(model, null), []);
});

test('trackGroups shows the first of duplicate tracks and skips unknown targets', () => {
  const { model, history, joints, clip } = environment();
  const run = (props) => history.execute({ label: 'Raw', run: (tx) => tx.add(clip, 'tracks', undefined, { type: 'track', props, children: { keys: [] } }) });
  const kept = run({ target: model.prop(joints[0], 'id'), channel: 'gain' });
  run({ target: model.prop(joints[0], 'id'), channel: 'gain' });
  run({ target: 'nobody', channel: 'gain' });
  run({ target: model.prop(joints[0], 'id'), channel: 'bodyAngle' });
  const groups = trackGroups(model, clip);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].tracks.map((track) => track.track), [kept]);
});

test('addTrack adds an empty track in one undo step and refuses duplicates and invalid channels', () => {
  const { model, history, joints, clip } = environment();
  const track = history.execute(addTrack(clip, joints[0], 'gain'));
  assert.equal(history.state.undoLabel, 'Add track');
  assert.deepEqual(model.get(track).props, { target: model.prop(joints[0], 'id'), channel: 'gain' });
  assert.deepEqual(model.children(track, 'keys'), []);
  assert.throws(() => history.execute(addTrack(clip, joints[0], 'gain')), /already has/);
  assert.throws(() => history.execute(addTrack(clip, joints[0], 'bodyAngle')), /not valid/);
  assert.throws(() => history.execute(addTrack(ROOT_UID, joints[0], 'angle')), /not a clip/);
  history.undo();
  assert.deepEqual(model.children(clip, 'tracks'), []);
});

test('deleteTrack removes the track and its keys, drops them from the selection and undoes in one step', () => {
  const { model, history, selection, joints, clip } = environment();
  const key = history.execute(setChannelKey(clip, joints[0], 'strength', 0.5, 0.25));
  history.execute(setChannelKey(clip, joints[0], 'strength', 0.8, 0.5));
  const other = history.execute(setJointAngleKey(clip, joints[0], 0.2, 1));
  selection.set([key, other]);
  const track = model.get(key).parent;
  assert.equal(history.execute(deleteTrack(track)), 2);
  assert.equal(history.state.undoLabel, 'Delete track');
  assert.deepEqual(selection.timeline, [other]);
  assert.equal(trackGroups(model, clip)[0].tracks.length, 1);
  history.undo();
  assert.deepEqual(model.children(track, 'keys').map((uid) => model.prop(uid, 't')), [0.5, 0.8]);
  assert.throws(() => history.execute(deleteTrack(clip)), /not a track/);
  history.execute(deleteTrack(model.get(other).parent));
  history.execute(deleteTrack(track));
  assert.deepEqual(trackGroups(model, clip), []);
});

test('setChannelKey creates the track, updates a key at the same time and refuses out-of-range multipliers', () => {
  const { model, history, joints, clip } = environment();
  const key = history.execute(setChannelKey(clip, joints[0], 'strength', 0.41, 0.3));
  assert.equal(history.state.undoLabel, 'Key strength');
  near(model.prop(key, 't'), 0.4);
  assert.equal(model.prop(key, 'interp'), 'linear');
  history.execute(setProps([key], { interp: 'ease' }));
  assert.equal(history.execute(setChannelKey(clip, joints[0], 'strength', 0.4, 0)), key);
  assert.equal(model.prop(key, 'v'), 0);
  assert.equal(model.prop(key, 'interp'), 'ease');
  const exact = history.execute(setChannelKey(clip, ROOT_UID, 'gain', 0.41, 0.5, undefined, { snap: false }));
  assert.equal(model.prop(exact, 't'), 0.41);
  assert.throws(() => history.execute(setChannelKey(clip, joints[0], 'strength', 0, 1.5)), RangeError);
  assert.throws(() => history.execute(setChannelKey(clip, joints[0], 'strength', 0, -0.1)), RangeError);
  assert.throws(() => history.execute(setChannelKey(clip, joints[0], 'strength', Number.NaN, 0.5)), TypeError);
  assert.throws(() => history.execute(setChannelKey(clip, joints[0], 'bodyAngle', 0, 0.5)), /not valid/);
});

test('insertKey inserts a linear key at the snapped time in order, or returns the key already there', () => {
  const { model, history, joints, clip } = environment();
  const track = history.execute(addTrack(clip, joints[0], 'damping'));
  const late = history.execute(insertKey(track, 0.81, 0.2));
  assert.equal(history.state.undoLabel, 'Insert key');
  const early = history.execute(insertKey(track, 0.2, 0.7));
  assert.deepEqual(model.children(track, 'keys'), [early, late]);
  near(model.prop(late, 't'), 0.8);
  const steps = history.state.undoLabel;
  assert.equal(history.execute(insertKey(track, 0.8, 0.9)), late);
  assert.equal(model.prop(late, 'v'), 0.2);
  assert.equal(history.state.undoLabel, steps);
  assert.throws(() => history.execute(insertKey(track, 0.5, 2)), RangeError);
  assert.throws(() => history.execute(insertKey(clip, 0.5, 0.5)), /not a track/);
});

test('neutral and track values follow the clip blend, the root base and the keys', () => {
  const { model, history, joints, clip } = environment();
  history.execute(setProps([ROOT_UID], { 'channels.strength': 0.6 }));
  assert.equal(neutralValue(model, clip, ROOT_UID, 'strength'), 0.6);
  assert.equal(neutralValue(model, clip, ROOT_UID, 'bodyAngle'), 0);
  assert.equal(neutralValue(model, clip, joints[0], 'gain'), 1);
  assert.equal(channelValueAt(model, clip, ROOT_UID, 'strength', 0.5), 0.6);
  history.execute(setProps([clip], { blend: 'additive' }));
  assert.equal(neutralValue(model, clip, ROOT_UID, 'strength'), 1);
  assert.equal(neutralValue(model, clip, joints[0], 'angle'), 0);
  history.execute(setProps([clip], { blend: 'override', loop: false }));
  const track = history.execute(addTrack(clip, ROOT_UID, 'strength'));
  assert.equal(trackValueAt(model, track, 0.5), 0.6);
  history.execute(insertKey(track, 0, 1));
  history.execute(insertKey(track, 0.3, 0));
  near(trackValueAt(model, track, 0.15), 0.5);
  assert.equal(trackValueAt(model, track, 0.9), 0);
  assert.equal(findTrack(model, clip, ROOT_UID, 'strength'), track);
  assert.deepEqual(channelsOf(model, ROOT_UID), ['bodyAngle', 'strength', 'balance', 'gain', 'damping']);
  history.execute(setProps([ROOT_UID], { 'channels.balance': 0.3 }));
  assert.equal(neutralValue(model, clip, ROOT_UID, 'balance'), 0.3);
  assert.deepEqual(channelsOf(model, joints[0]), ['angle', 'strength', 'gain', 'damping']);
  assert.deepEqual(channelsOf(model, clip), []);
});

test('trackMenu targets the selected joint or root, offers balance after strength for the root, and gives the reasons', () => {
  const { model, history, joints, clip } = environment();
  assert.deepEqual(trackMenu(model, clip, []), { target: null, label: '', channels: [], reason: 'select one joint or the root' });
  assert.deepEqual(trackMenu(model, clip, [ROOT_UID]), { target: ROOT_UID, label: 'Root', channels: ['bodyAngle', 'strength', 'balance', 'gain', 'damping'], reason: null });
  history.execute(addTrack(clip, ROOT_UID, 'strength'));
  assert.deepEqual(trackMenu(model, clip, [ROOT_UID]).channels, ['bodyAngle', 'balance', 'gain', 'damping']);
  assert.equal(trackMenu(model, clip, [joints[0]]).channels.includes('balance'), false);
  assert.equal(trackMenu(model, null, [joints[1]]).reason, 'open a clip');
  assert.equal(trackMenu(model, clip, joints).reason, 'select one joint or the root');
  const body = model.get(model.uidOf(model.prop(joints[0], 'bodyA'))).uid;
  assert.equal(trackMenu(model, clip, [body]).reason, 'select one joint or the root');
  for (const channel of ['angle', 'strength', 'gain']) history.execute(addTrack(clip, joints[1], channel));
  assert.deepEqual(trackMenu(model, clip, [joints[1]]).channels, ['damping']);
  history.execute(addTrack(clip, joints[1], 'damping'));
  assert.equal(trackMenu(model, clip, [joints[1]]).reason, 'every channel of knee has a track');
});

test('keyValueText shows degrees, percent and sprite names', () => {
  const { model } = environment();
  assert.equal(keyValueText(model, 'angle', Math.PI / 4), '45°');
  assert.equal(keyValueText(model, 'bodyAngle', -0.5), '-28.6°');
  assert.equal(keyValueText(model, 'strength', 0.375), '37.5%');
  assert.equal(keyValueText(model, 'sprite', null), '(none)');
  assert.equal(keyValueText(model, 'sprite', 'missing'), 'missing');
});

function animateCtx(editor, uids, time = 0.5) {
  const { model, modes, clip } = editor;
  modes.openClip(clip);
  modes.setPlayhead(time);
  return { model, type: uids[0] === ROOT_UID ? 'root' : 'joint', uids, editable: false, reason: 'only in Edit mode', animate: { clip, time: modes.playhead, editable: true }, pixelsPerMeter: 32 };
}

test('channelRow: the key button adds the track and keys the field value at the playhead in one step', () => {
  const editor = environment();
  const { model, history, joints } = editor;
  const ctx = animateCtx(editor, [joints[0]]);
  const row = channelRow(ctx, { id: 'channels.strength', label: 'Strength', channel: 'strength' });
  assert.equal(row.readOnly, true);
  assert.equal(row.reason, 'click ◇ to animate this channel');
  assert.equal(row.value, 100);
  assert.equal(row.unit, '%');
  assert.deepEqual([row.min, row.max], [0, 100]);
  assert.equal(row.key.state, 'empty');
  assert.equal(row.key.label, 'Key strength at 0.50 s (not animated)');
  const key = history.execute(keyCommand(model, row.key));
  assert.equal(history.state.undoLabel, 'Key strength');
  assert.equal(model.prop(key, 'v'), 1);
  near(model.prop(key, 't'), 0.5);
  const keyed = channelRow(ctx, { id: 'channels.strength', label: 'Strength', channel: 'strength' });
  assert.equal(keyed.key.state, 'filled');
  assert.equal(keyed.readOnly, false);
  assert.equal(keyCommand(model, keyed.key), null);
  history.execute(editCommand(model, keyed.edit, 40, { pixelsPerMeter: 32 }));
  assert.equal(model.prop(key, 'v'), 0.4);
  assert.equal(model.children(model.get(key).parent, 'keys').length, 1);
  history.undo();
  assert.equal(model.prop(key, 'v'), 1);
});

test('channelRow: the root balance ◇ keys a root balance track from its base value', () => {
  const editor = environment();
  const { model, history, clip } = editor;
  history.execute(setProps([ROOT_UID], { 'channels.balance': 0.25 }));
  const row = channelRow(animateCtx(editor, [ROOT_UID]), { id: 'channels.balance', label: 'Balance', channel: 'balance' });
  assert.equal(row.value, 25);
  assert.equal(row.key.label, 'Key balance at 0.50 s (not animated)');
  const key = history.execute(keyCommand(model, row.key));
  assert.equal(history.state.undoLabel, 'Key balance');
  assert.equal(model.prop(key, 'v'), 0.25);
  assert.equal(model.get(key).parent, findTrack(model, clip, ROOT_UID, 'balance'));
});

test('channelRow: outlined without a key at the playhead, and several joints are read-only', () => {
  const editor = environment();
  const { model, history, joints, clip } = editor;
  history.execute(setChannelKey(clip, joints[0], 'gain', 0, 0.2));
  const outlined = channelRow(animateCtx(editor, [joints[0]]), { id: 'channels.gain', label: 'Gain', channel: 'gain' });
  assert.equal(outlined.key.state, 'outlined');
  near(outlined.value, 20);
  const several = channelRow(animateCtx(editor, joints), { id: 'channels.gain', label: 'Gain', channel: 'gain' });
  assert.equal(several.value, MIXED);
  assert.equal(several.readOnly, true);
  assert.equal(several.reason, 'select one joint');
  assert.equal(several.key.disabled, true);
  assert.equal(several.key.reason, 'select one joint');
  assert.equal(keyCommand(model, several.key), null);
});

test('inspector pages: root ◇ disabled outside Animate, joint channel rows only in Animate', () => {
  const editor = environment();
  const { selection, modes, joints, clip } = editor;
  const rowOf = (page, id) => page.sections.flatMap((section) => section.rows).find((row) => row.id === id);
  assert.equal(rowOf(inspectorPage(editor), 'channels.strength'), undefined);
  selection.set([ROOT_UID]);
  const edit = inspectorPage(editor);
  assert.equal(rowOf(edit, 'channels.balance').key.reason, 'only in Animate mode');
  assert.equal(rowOf(edit, 'channels.strength').readOnly, false);
  assert.equal(rowOf(edit, 'channels.strength').key.disabled, true);
  assert.equal(rowOf(edit, 'channels.strength').key.reason, 'only in Animate mode');
  selection.set([joints[0]]);
  assert.equal(inspectorPage(editor).sections.some((section) => section.id === 'animation'), false);
  modes.openClip(clip);
  const animate = inspectorPage(editor);
  const section = animate.sections.find((item) => item.id === 'animation');
  assert.deepEqual(section.rows.map((row) => row.id), ['channels.angle', 'channels.strength', 'channels.gain', 'channels.damping']);
  assert.equal(section.rows[0].reason, 'key angles with Pose or Key selected');
  assert.equal(section.rows[1].key.disabled, false);
});
