import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { Model, ROOT_UID } from '../js/model/model.js';
import { loadJson, saveJson, toJson } from '../js/model/io.js';
import { createClip, createShapeBody } from '../js/commands/create.js';
import { deleteClip } from '../js/commands/delete.js';
import { setProps } from '../js/commands/props.js';
import { setClipLength } from '../js/commands/keys.js';
import { defaultsOf } from '../lib/schema.js';
import { validate } from '../lib/validate.js';
import { SNAP_STEP, fractionOfTime, rulerTicks, snapTime, timeAtOffset } from '../js/timeline-time.js';

const clipsOf = (editor) => editor.model.children(ROOT_UID, 'clips');

function editorWithBody() {
  const editor = createEditor();
  editor.history.execute(createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'circle', radius: 0.5 } }));
  return editor;
}

test('createClip appends a clip with a unique key and undoes in one step', () => {
  const { model, history } = createEditor();
  const first = history.execute(createClip());
  const second = history.execute(createClip());
  assert.deepEqual([model.prop(first, 'key'), model.prop(second, 'key')], ['new_clip', 'new_clip_2']);
  assert.equal(model.prop(first, 'length'), 1);
  assert.equal(model.prop(first, 'loop'), true);
  assert.equal(history.state.undoLabel, 'Create clip');
  history.undo();
  assert.deepEqual(model.children(ROOT_UID, 'clips'), [first]);
  history.redo();
  assert.equal(model.prop(second, 'key'), 'new_clip_2');
});

test('createClip avoids a key taken by a renamed clip', () => {
  const { model, history } = createEditor();
  const first = history.execute(createClip());
  history.execute(setProps([first], { key: 'new_clip_2' }));
  const second = history.execute(createClip());
  const third = history.execute(createClip());
  assert.equal(model.prop(second, 'key'), 'new_clip_2_2');
  assert.equal(model.prop(third, 'key'), 'new_clip_3');
});

test('createClip gives each new clip the first unused default name', () => {
  const { model, history } = createEditor();
  const names = () => clipsOf({ model }).map((uid) => model.prop(uid, 'name'));
  const first = history.execute(createClip());
  const second = history.execute(createClip());
  history.execute(createClip());
  assert.deepEqual(names(), ['New Clip', 'New Clip 2', 'New Clip 3']);
  history.execute(setProps([first], { name: 'Walk' }));
  history.execute(createClip());
  assert.deepEqual(names().slice(3), ['New Clip']);
  history.execute(deleteClip(second));
  const again = history.execute(createClip());
  assert.equal(model.prop(again, 'name'), 'New Clip 2');
});

test('renaming a clip is one undo step in Animate and the capability is allowed in Edit', () => {
  const { model, history, modes } = createEditor();
  const uid = history.execute(createClip());
  assert.equal(modes.can('clip.rename'), true);
  modes.openClip(uid);
  assert.equal(modes.can('clip.rename'), true);
  history.execute(setProps([uid], { name: 'Walk' }, 'Rename clip'));
  assert.equal(model.prop(uid, 'name'), 'Walk');
  assert.equal(model.prop(uid, 'key'), 'walk');
  assert.equal(history.state.undoLabel, 'Rename clip');
  history.undo();
  assert.equal(model.prop(uid, 'name'), 'New Clip');
  assert.equal(model.prop(uid, 'key'), 'new_clip');
  modes.startSimulate();
  assert.equal(modes.can('clip.rename'), false);
});

test('deleteClip removes the clip, undo restores it, and a non-clip is refused', () => {
  const { model, history, modes } = createEditor();
  const uid = history.execute(createClip());
  modes.openClip(uid);
  history.execute(deleteClip(uid));
  assert.deepEqual(clipsOf({ model }), []);
  assert.equal(modes.mode, 'edit');
  history.undo();
  assert.equal(clipsOf({ model }).length, 1);
  assert.throws(() => history.execute(deleteClip(ROOT_UID)), /not a clip/);
  assert.equal(history.state.undoLabel, 'Create clip');
});

test('length and loop edits are undoable and re-clamp the playhead', () => {
  const { model, history, modes } = createEditor();
  const uid = history.execute(createClip());
  modes.openClip(uid);
  modes.setPlayhead(0.9);
  history.execute(setProps([uid], { length: 0.5 }, 'Set clip length'));
  assert.equal(modes.playhead, 0.5);
  history.execute(setProps([uid], { loop: false }, 'Toggle clip loop'));
  history.undo();
  assert.equal(model.prop(uid, 'loop'), true);
  history.undo();
  assert.equal(model.prop(uid, 'length'), 1);
});

function clipWithContent(editor, loop) {
  const { tracks: _tracks, events: _events, ...props } = defaultsOf('clip');
  return editor.history.execute({
    label: 'Add clip',
    run: (tx) =>
      tx.add(ROOT_UID, 'clips', undefined, {
        type: 'clip',
        props: { ...props, length: 2, loop },
        children: {
          tracks: [
            {
              type: 'track',
              props: { target: 'root', channel: 'bodyAngle' },
              children: { keys: [0, 1, 1.5, 2].map((t) => ({ type: 'key', props: { t, v: 0, interp: 'linear' } })) },
            },
          ],
          events: [0.5, 1, 2].map((t) => ({ type: 'event', props: { t, name: 'step' } })),
        },
      }),
  });
}

test('setClipLength removes keys and events outside the new length in one undo step that restores them', () => {
  const { model, history } = createEditor();
  const clip = clipWithContent({ model, history }, false);
  const before = JSON.stringify(toJson(model, 'dev'));
  const removed = history.execute(setClipLength(clip, 1));
  assert.deepEqual(removed, { keys: 2, events: 1 });
  assert.equal(model.prop(clip, 'length'), 1);
  const track = model.children(clip, 'tracks')[0];
  assert.deepEqual(model.children(track, 'keys').map((uid) => model.prop(uid, 't')), [0, 1]);
  assert.deepEqual(model.children(clip, 'events').map((uid) => model.prop(uid, 't')), [0.5, 1]);
  const codes = validate(toJson(model, 'dev')).errors.map((error) => error.code);
  assert.equal(codes.includes('E_KEY_TIME_RANGE') || codes.includes('E_EVENT_TIME_RANGE'), false);
  assert.equal(history.state.undoLabel, 'Set clip length');
  history.undo();
  assert.equal(JSON.stringify(toJson(model, 'dev')), before);
  history.redo();
  assert.equal(model.prop(clip, 'length'), 1);
});

test('setClipLength on a looping clip also removes the event at the new length, and growing removes nothing', () => {
  const { model, history } = createEditor();
  const clip = clipWithContent({ model, history }, true);
  assert.deepEqual(history.execute(setClipLength(clip, 1)), { keys: 2, events: 2 });
  assert.deepEqual(history.execute(setClipLength(clip, 3)), { keys: 0, events: 0 });
  assert.equal(model.prop(clip, 'length'), 3);
});

test('setClipLength refuses a node that is not a clip and an invalid length without mutating', () => {
  const { model, history } = createEditor();
  const clip = clipWithContent({ model, history }, false);
  assert.throws(() => history.execute(setClipLength(ROOT_UID, 1)), /not a clip/);
  assert.throws(() => history.execute(setClipLength(clip, 0)), TypeError);
  assert.equal(model.prop(clip, 'length'), 2);
});

test('clips round-trip through save and load', () => {
  const editor = editorWithBody();
  const { model, history } = editor;
  const first = history.execute(createClip());
  history.execute(createClip());
  history.execute(setProps([first], { length: 2.5, loop: false }));
  const saved = saveJson(model, 'dev');
  assert.equal(saved.ok, true);
  const loaded = new Model();
  assert.equal(loadJson(loaded, saved.text).ok, true);
  assert.deepEqual(toJson(loaded, 'dev').clips, toJson(model, 'dev').clips);
  assert.deepEqual(
    loaded.children(ROOT_UID, 'clips').map((uid) => loaded.prop(uid, 'key')),
    ['new_clip', 'new_clip_2'],
  );
});

test('snapTime snaps to 1/30 s and clamps to the clip', () => {
  assert.equal(SNAP_STEP, 1 / 30);
  assert.equal(snapTime(0.5, 1), 15 * SNAP_STEP);
  assert.equal(snapTime(-1, 1), 0);
  assert.equal(snapTime(5, 1), 1);
  assert.equal(Object.is(snapTime(-0.001, 1), -0), false);
});

test('timeAtOffset maps the ruler width to the clip length', () => {
  assert.equal(timeAtOffset(100, 200, 2), 1);
  assert.equal(timeAtOffset(-20, 200, 2), 0);
  assert.equal(timeAtOffset(900, 200, 2), 2);
  assert.equal(timeAtOffset(10, 0, 2), 0);
  assert.equal(fractionOfTime(0.5, 2), 0.25);
  assert.equal(fractionOfTime(3, 2), 1);
  assert.equal(fractionOfTime(1, 0), 0);
});

test('rulerTicks stays under a dozen intervals and ends at the length', () => {
  for (const length of [0.2, 1, 2.5, 10, 120]) {
    const ticks = rulerTicks(length);
    assert.ok(ticks.length <= 14, `${length}: ${ticks.length}`);
    assert.equal(ticks[0], 0);
    assert.ok(ticks.at(-1) <= length);
  }
});

