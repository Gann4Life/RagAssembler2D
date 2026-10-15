import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { Selection } from '../js/model/selection.js';
import { defaultsOf } from '../lib/schema.js';

function setup() {
  const model = new Model();
  const history = new History(model);
  const selection = new Selection(model);
  const events = [];
  selection.on('selection', (state) => events.push(state));
  const add = (collection, snapshot, parent = ROOT_UID) =>
    history.execute({ label: 'Add', run: (tx) => tx.add(parent, collection, undefined, snapshot) });
  const body = () => {
    const { fixtures, ...props } = defaultsOf('body');
    return add('bodies', { type: 'body', props: { ...props, id: model.nextId('b'), name: 'b' } });
  };
  const clip = () => {
    const { tracks, events: clipEvents, ...props } = defaultsOf('clip');
    return add('clips', {
      type: 'clip',
      props,
      children: {
        tracks: [{ type: 'track', props: { target: 'root', channel: 'strength' }, children: { keys: [{ type: 'key', props: { t: 0, v: 1 } }] } }],
        events: [{ type: 'event', props: { t: 0, ...defaultsOf('event') } }],
      },
    });
  };
  return { model, history, selection, events, body, clip };
}

test('a new selection is empty with focus on objects', () => {
  const { selection } = setup();
  assert.deepEqual(selection.state, { objects: [], timeline: [], focus: 'objects' });
  assert.ok(Object.isFrozen(selection.objects));
  assert.ok(Object.isFrozen(selection.timeline));
});

test('set, add, toggle and remove manage the objects list in selection order', () => {
  const { selection, events, body } = setup();
  const [a, b, c] = [body(), body(), body()];
  selection.set([b, a, b]);
  assert.deepEqual(selection.objects, [b, a]);
  selection.add([c, a]);
  assert.deepEqual(selection.objects, [b, a, c]);
  selection.toggle(a);
  assert.deepEqual(selection.objects, [b, c]);
  selection.toggle(a);
  assert.deepEqual(selection.objects, [b, c, a]);
  selection.remove([b, 9999]);
  assert.deepEqual(selection.objects, [c, a]);
  assert.equal(selection.has(c), true);
  assert.equal(selection.has(b), false);
  assert.equal(events.length, 5);
  assert.ok(events.every((state) => Object.isFrozen(state)));
});

test('the root and clips belong to objects, keys and events to timeline', () => {
  const { model, selection, clip } = setup();
  const clipUid = clip();
  const track = model.children(clipUid, 'tracks')[0];
  const key = model.children(track, 'keys')[0];
  const event = model.children(clipUid, 'events')[0];
  selection.set([ROOT_UID, clipUid]);
  selection.set([key, event]);
  assert.deepEqual(selection.state, { objects: [ROOT_UID, clipUid], timeline: [key, event], focus: 'timeline' });
  assert.throws(() => selection.set([track]), /cannot be selected/);
  assert.throws(() => selection.add([clipUid, key]), /mix/);
  assert.throws(() => selection.toggle(9999), /Unknown/);
  assert.throws(() => selection.set([9999]), /Unknown/);
});

test('set, add and toggle move focus; remove and clear keep it', () => {
  const { model, selection, clip } = setup();
  const clipUid = clip();
  const event = model.children(clipUid, 'events')[0];
  selection.add([event]);
  assert.equal(selection.focus, 'timeline');
  selection.toggle(clipUid);
  assert.equal(selection.focus, 'objects');
  selection.remove([clipUid]);
  assert.equal(selection.focus, 'objects');
  selection.set([event]);
  selection.clear();
  assert.deepEqual(selection.state, { objects: [], timeline: [], focus: 'timeline' });
});

test('set with an empty list clears both lists and add with an empty list does nothing', () => {
  const { selection, events, body } = setup();
  const a = body();
  selection.set([a]);
  selection.add([]);
  assert.equal(events.length, 1);
  selection.set([]);
  assert.deepEqual(selection.objects, []);
  assert.equal(events.length, 2);
});

test('calls that change nothing emit nothing', () => {
  const { selection, events, body } = setup();
  const a = body();
  selection.clear();
  selection.remove([a]);
  selection.set([a]);
  selection.set([a]);
  selection.add([a]);
  assert.equal(events.length, 1);
});

test('removed nodes are pruned once per change, and undo never adds to the selection', () => {
  const { model, history, selection, events, body, clip } = setup();
  const a = body();
  const b = body();
  const clipUid = clip();
  const event = model.children(clipUid, 'events')[0];
  selection.set([a, b]);
  selection.set([event]);
  events.length = 0;
  history.execute({
    label: 'Delete',
    run: (tx) => {
      tx.remove(a);
      tx.remove(clipUid);
    },
  });
  assert.deepEqual(events, [{ objects: [b], timeline: [], focus: 'timeline' }]);
  history.undo();
  assert.deepEqual(selection.objects, [b]);
  assert.deepEqual(selection.timeline, []);
  assert.equal(events.length, 1);
});

test('reset clears both lists and focuses objects', () => {
  const { model, selection, events, clip } = setup();
  const clipUid = clip();
  selection.set([model.children(clipUid, 'events')[0]]);
  events.length = 0;
  model.reset({ type: 'root', props: model.get(ROOT_UID).props }, 'load');
  assert.deepEqual(events, [{ objects: [], timeline: [], focus: 'objects' }]);
});
