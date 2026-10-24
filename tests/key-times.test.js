import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { ghostTimes, keyTimes } from '../js/model/key-times.js';
import { defaultsOf } from '../lib/schema.js';

function clipWith(editor, tracks, { length = 1, events = [] } = {}) {
  const { tracks: _tracks, events: _events, ...props } = defaultsOf('clip');
  return editor.history.execute({
    label: 'Add clip',
    run: (tx) =>
      tx.add(ROOT_UID, 'clips', undefined, {
        type: 'clip',
        props: { ...props, length },
        children: {
          tracks: tracks.map(([target, channel, times]) => ({
            type: 'track',
            props: { target, channel },
            children: { keys: times.map((t) => ({ type: 'key', props: { t, v: 0, interp: 'linear' } })) },
          })),
          events: events.map((t) => ({ type: 'event', props: { t, name: 'step' } })),
        },
      }),
  });
}

test('keyTimes lists the distinct key times of every track in [0, length], ascending, without events', () => {
  const editor = createEditor();
  const clip = clipWith(
    editor,
    [
      ['j_a', 'angle', [0.5, 0, 1]],
      ['root', 'bodyAngle', [0.5, 0.25, 0.5000000001]],
      ['s_head', 'sprite', [0.75, 1.5]],
    ],
    { events: [0.1, 0.9] },
  );
  assert.deepEqual(keyTimes(editor.model, clip), [0, 0.25, 0.5, 0.75, 1]);
});

test('keyTimes is empty without a clip, for a node that is not a clip, and for a clip without keys', () => {
  const editor = createEditor();
  assert.deepEqual(keyTimes(editor.model, null), []);
  assert.deepEqual(keyTimes(editor.model, ROOT_UID), []);
  assert.deepEqual(keyTimes(editor.model, clipWith(editor, [])), []);
});

test('ghostTimes keeps only the nearest key time on each side and skips the playhead step', () => {
  const stepOf = (t) => Math.round(t * 60);
  assert.deepEqual(ghostTimes([0, 0.25, 0.5, 0.75, 1], 0.5, stepOf), [
    { t: 0.25, side: 'behind' },
    { t: 0.75, side: 'ahead' },
  ]);
  assert.deepEqual(ghostTimes([0, 0.25, 1], 0.3, stepOf), [
    { t: 0.25, side: 'behind' },
    { t: 1, side: 'ahead' },
  ]);
  assert.deepEqual(ghostTimes([0, 1], 0.004, stepOf), [{ t: 1, side: 'ahead' }]);
  assert.deepEqual(ghostTimes([0, 1], 0.6, stepOf), [
    { t: 0, side: 'behind' },
    { t: 1, side: 'ahead' },
  ]);
});
