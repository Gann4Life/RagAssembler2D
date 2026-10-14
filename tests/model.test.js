import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { defaultsOf } from '../lib/schema.js';

function bodySnapshot(model, shapeCount = 1, variant = 'box') {
  const bodyId = model.nextId('b');
  const n = bodyId.slice(2);
  const fixtures = Array.from({ length: shapeCount }, () => {
    const id = model.nextId('f');
    return { type: 'shape', props: { id, name: `${variant}_${id.slice(2)}`, ...defaultsOf('shape', variant) } };
  });
  const { fixtures: omitted, ...props } = defaultsOf('body');
  return {
    type: 'body',
    props: { id: bodyId, name: `body_${n}`, ...props },
    children: { fixtures },
  };
}

function addBody(model, shapeCount = 1) {
  const [op] = model.applyOps([
    { op: 'add', snapshot: bodySnapshot(model, shapeCount), parent: ROOT_UID, collection: 'bodies' },
  ]);
  return op.snapshot.uid;
}

function record(model) {
  const events = [];
  model.on('change', (payload) => events.push(['change', payload]));
  model.on('reset', (payload) => events.push(['reset', payload]));
  return events;
}

function clipSnapshot(key, trackCount = 0) {
  const { tracks, events, ...props } = defaultsOf('clip');
  return {
    type: 'clip',
    props: { ...props, key },
    children: {
      tracks: Array.from({ length: trackCount }, (unused, index) => ({
        type: 'track',
        props: { target: 'root', channel: ['strength', 'gain', 'damping'][index] },
        children: { keys: [{ type: 'key', props: { t: 0, v: 1, interp: 'linear' } }] },
      })),
      events: [{ type: 'event', props: { t: 0, ...defaultsOf('event') } }],
    },
  };
}

test('a new model holds the root with schema defaults and empty collections', () => {
  const model = new Model();
  const root = model.get(ROOT_UID);
  assert.equal(root.type, 'root');
  assert.equal(root.parent, null);
  assert.equal(root.collection, null);
  assert.deepEqual(root.props, {
    ...defaultsOf('root'),
    meta: { name: 'ragdoll' },
    units: { pixelsPerMeter: 32 },
    preview: { gravity: [0, -10] },
  });
  assert.ok(Object.isFrozen(root.props));
  assert.ok(Object.isFrozen(root.props.channels));
  assert.equal(model.uidOf('root'), ROOT_UID);
  for (const collection of ['sprites', 'bodies', 'joints', 'clips']) {
    assert.deepEqual(model.children(ROOT_UID, collection), []);
  }
  assert.throws(() => model.children(ROOT_UID, 'fixtures'));
  assert.equal(model.get(999), null);
});

test('the node tree follows docs/architecture.md collections', () => {
  const model = new Model();
  const bodyUid = addBody(model, 2);
  const [clipOp] = model.applyOps([{ op: 'add', snapshot: clipSnapshot('run', 1), parent: ROOT_UID, collection: 'clips' }]);
  const clipUid = clipOp.snapshot.uid;
  assert.equal(model.children(bodyUid, 'fixtures').length, 2);
  const [trackUid] = model.children(clipUid, 'tracks');
  assert.equal(model.get(trackUid).type, 'track');
  assert.equal(model.get(model.children(trackUid, 'keys')[0]).type, 'key');
  assert.equal(model.get(model.children(clipUid, 'events')[0]).type, 'event');
  assert.throws(() =>
    model.applyOps([{ op: 'add', snapshot: { type: 'joint', props: {} }, parent: ROOT_UID, collection: 'bodies' }]),
  );
  assert.throws(() =>
    model.applyOps([{ op: 'add', snapshot: { type: 'key', props: {} }, parent: bodyUid, collection: 'keys' }]),
  );
  assert.throws(() =>
    model.applyOps([{ op: 'add', snapshot: { type: 'root', props: {} }, parent: ROOT_UID, collection: 'bodies' }]),
  );
});

test('shape sprite is a prop, not a node', () => {
  const model = new Model();
  const bodyUid = addBody(model);
  const [shapeUid] = model.children(bodyUid, 'fixtures');
  const sprite = { ...defaultsOf('sprite'), asset: 's_1', z: 3 };
  model.applyOps([{ op: 'set', uid: shapeUid, path: 'sprite', value: sprite }]);
  assert.deepEqual(model.prop(shapeUid, 'sprite'), sprite);
  model.applyOps([{ op: 'set', uid: shapeUid, path: 'sprite.z', value: 4 }]);
  assert.equal(model.prop(shapeUid, 'sprite.z'), 4);
  assert.equal(model.prop(shapeUid, 'sprite.missing'), undefined);
});

test('body transforms and joint anchors are stored root-local as given, in meters and radians', () => {
  const model = new Model();
  model.applyOps([{ op: 'set', uid: ROOT_UID, path: 'position', value: [3, 4] }]);
  const bodyUid = addBody(model);
  model.applyOps([
    { op: 'set', uid: bodyUid, path: 'position', value: [0.5, -1.25] },
    { op: 'set', uid: bodyUid, path: 'angle', value: Math.PI / 2 },
  ]);
  const [jointOp] = model.applyOps([
    {
      op: 'add',
      snapshot: { type: 'joint', props: { id: model.nextId('j'), name: 'joint_1', ...defaultsOf('joint'), anchor: [0.1, 0.2] } },
      parent: ROOT_UID,
      collection: 'joints',
    },
  ]);
  assert.deepEqual(model.prop(bodyUid, 'position'), [0.5, -1.25]);
  assert.equal(model.prop(bodyUid, 'angle'), Math.PI / 2);
  assert.deepEqual(model.prop(jointOp.snapshot.uid, 'anchor'), [0.1, 0.2]);
});

test('new objects built from defaultsOf keep those defaults in the model', () => {
  const model = new Model();
  const bodyUid = addBody(model);
  const { fixtures, ...bodyDefaults } = defaultsOf('body');
  const props = model.get(bodyUid).props;
  for (const [key, value] of Object.entries(bodyDefaults)) assert.deepEqual(props[key], value, key);
  assert.equal(props.name, 'body_1');
  const shape = model.get(model.children(bodyUid, 'fixtures')[0]).props;
  assert.equal(shape.name, 'box_1');
  assert.deepEqual(shape.shape, defaultsOf('shape', 'box').shape);
});

test('every node gets a unique uid and file ids map to uids', () => {
  const model = new Model();
  const bodyUid = addBody(model, 2);
  const shapeUids = model.children(bodyUid, 'fixtures');
  const uids = [ROOT_UID, bodyUid, ...shapeUids];
  assert.equal(new Set(uids).size, uids.length);
  assert.ok(uids.every((uid) => Number.isInteger(uid) && uid > 0));
  assert.equal(model.uidOf('b_1'), bodyUid);
  assert.equal(model.uidOf('f_1'), shapeUids[0]);
  assert.equal(model.uidOf('f_2'), shapeUids[1]);
  assert.equal(model.uidOf('b_404'), null);
});

test('uids are stable across remove and restore, and never reused for new nodes', () => {
  const model = new Model();
  const bodyUid = addBody(model, 2);
  const shapeUids = [...model.children(bodyUid, 'fixtures')];
  const [removal] = model.applyOps([{ op: 'remove', uid: bodyUid }]);
  assert.equal(model.get(bodyUid), null);
  assert.equal(model.uidOf('b_1'), null);
  model.applyOps([
    { op: 'add', snapshot: removal.snapshot, parent: removal.parent, collection: removal.collection, index: removal.index },
  ], 'undo');
  assert.equal(model.uidOf('b_1'), bodyUid);
  assert.deepEqual(model.children(bodyUid, 'fixtures'), shapeUids);
  model.applyOps([{ op: 'remove', uid: bodyUid }]);
  const newUid = addBody(model);
  assert.ok(![bodyUid, ...shapeUids].includes(newUid));
  assert.ok(newUid > Math.max(bodyUid, ...shapeUids));
});

test('restoring a snapshot whose uid is live is rejected', () => {
  const model = new Model();
  const bodyUid = addBody(model);
  const snapshot = { ...bodySnapshot(model), uid: bodyUid };
  assert.throws(() => model.applyOps([{ op: 'add', snapshot, parent: ROOT_UID, collection: 'bodies' }]));
});

test('applyOps emits one change event per batch, with its cause', () => {
  const model = new Model();
  const events = record(model);
  const bodyUid = addBody(model);
  model.applyOps([
    { op: 'set', uid: bodyUid, path: 'name', value: 'torso' },
    { op: 'set', uid: bodyUid, path: 'angle', value: 1 },
  ], 'redo');
  assert.equal(events.length, 2);
  assert.equal(events[0][1].cause, 'do');
  assert.deepEqual(events[1], [
    'change',
    {
      cause: 'redo',
      changes: [
        { kind: 'set', uid: bodyUid, type: 'body', path: 'name', value: 'torso', previous: 'body_1' },
        { kind: 'set', uid: bodyUid, type: 'body', path: 'angle', value: 1, previous: 0 },
      ],
    },
  ]);
  assert.ok(Object.isFrozen(events[1][1].changes));
  assert.throws(() => model.applyOps([], 'later'));
});

test('applyOps emits nothing when no op has an effect', () => {
  const model = new Model();
  const events = record(model);
  const [op] = model.applyOps([{ op: 'set', uid: ROOT_UID, path: 'position', value: [0, 0] }]);
  model.applyOps([]);
  assert.deepEqual(events, []);
  assert.deepEqual(op, { op: 'set', uid: ROOT_UID, path: 'position', value: [0, 0], previous: [0, 0] });
});

test('adding a subtree reports parents before children', () => {
  const model = new Model();
  addBody(model);
  const events = record(model);
  const bodyUid = addBody(model, 2);
  const [first, second] = model.children(bodyUid, 'fixtures');
  assert.deepEqual(events[0][1].changes, [
    { kind: 'add', uid: bodyUid, type: 'body', parent: ROOT_UID, collection: 'bodies', index: 1 },
    { kind: 'add', uid: first, type: 'shape', parent: bodyUid, collection: 'fixtures', index: 0 },
    { kind: 'add', uid: second, type: 'shape', parent: bodyUid, collection: 'fixtures', index: 1 },
  ]);
});

test('removing a subtree reports children before parents', () => {
  const model = new Model();
  const [clipOp] = model.applyOps([{ op: 'add', snapshot: clipSnapshot('run', 2), parent: ROOT_UID, collection: 'clips' }]);
  const clipUid = clipOp.snapshot.uid;
  const [trackA, trackB] = model.children(clipUid, 'tracks');
  const [keyA] = model.children(trackA, 'keys');
  const [keyB] = model.children(trackB, 'keys');
  const [eventUid] = model.children(clipUid, 'events');
  const events = record(model);
  model.applyOps([{ op: 'remove', uid: clipUid }]);
  assert.deepEqual(
    events[0][1].changes.map((change) => [change.kind, change.uid, change.index]),
    [
      ['remove', keyA, 0],
      ['remove', trackA, 0],
      ['remove', keyB, 0],
      ['remove', trackB, 1],
      ['remove', eventUid, 0],
      ['remove', clipUid, 0],
    ],
  );
  assert.equal(model.get(keyA), null);
  assert.equal(model.clipByKey('run'), null);
});

test('set replaces frozen props without touching the previous object', () => {
  const model = new Model();
  const before = model.get(ROOT_UID).props;
  const [op] = model.applyOps([{ op: 'set', uid: ROOT_UID, path: 'channels.gain', value: 0.5 }]);
  const after = model.get(ROOT_UID).props;
  assert.equal(before.channels.gain, 1);
  assert.equal(after.channels.gain, 0.5);
  assert.notEqual(before, after);
  assert.ok(Object.isFrozen(after) && Object.isFrozen(after.channels));
  assert.equal(op.previous, 1);
  assert.throws(() => model.applyOps([{ op: 'set', uid: ROOT_UID, path: 'name.first', value: 'x' }]));
  assert.throws(() => model.applyOps([{ op: 'set', uid: ROOT_UID, path: '', value: 'x' }]));
  assert.throws(() => model.applyOps([{ op: 'set', uid: ROOT_UID, path: 'id', value: 'b_1' }]));
});

test('a value passed to set is copied, so later mutation of the input has no effect', () => {
  const model = new Model();
  const value = [1, 2];
  model.applyOps([{ op: 'set', uid: ROOT_UID, path: 'position', value }]);
  value[0] = 9;
  assert.deepEqual(model.prop(ROOT_UID, 'position'), [1, 2]);
});

test('a failing batch is reverted, emits nothing and rethrows', () => {
  const model = new Model();
  const bodyUid = addBody(model);
  const events = record(model);
  const bodyCountBefore = model.children(ROOT_UID, 'bodies').length;
  assert.throws(() =>
    model.applyOps([
      { op: 'set', uid: bodyUid, path: 'name', value: 'torso' },
      { op: 'add', snapshot: bodySnapshot(model), parent: ROOT_UID, collection: 'bodies' },
      { op: 'remove', uid: 12345 },
    ]),
  );
  assert.equal(model.prop(bodyUid, 'name'), 'body_1');
  assert.equal(model.children(ROOT_UID, 'bodies').length, bodyCountBefore);
  assert.deepEqual(events, []);
});

test('move reorders and reparents, reporting from and to slots', () => {
  const model = new Model();
  const a = addBody(model);
  const b = addBody(model, 2);
  const events = record(model);
  model.applyOps([{ op: 'move', uid: b, to: { parent: ROOT_UID, collection: 'bodies', index: 0 } }]);
  assert.deepEqual(model.children(ROOT_UID, 'bodies'), [b, a]);
  const [shape] = model.children(b, 'fixtures');
  const [op] = model.applyOps([{ op: 'move', uid: shape, to: { parent: a, collection: 'fixtures' } }]);
  assert.deepEqual(op.from, { parent: b, collection: 'fixtures', index: 0 });
  assert.deepEqual(op.to, { parent: a, collection: 'fixtures', index: 1 });
  assert.equal(model.get(shape).parent, a);
  assert.deepEqual(events.map(([, payload]) => payload.changes[0].kind), ['move', 'move']);
  assert.throws(() => model.applyOps([{ op: 'move', uid: shape, to: { parent: ROOT_UID, collection: 'bodies' } }]));
  assert.throws(() => model.applyOps([{ op: 'move', uid: ROOT_UID, to: { parent: a, collection: 'fixtures' } }]));
});

test('nextId allocates above every id of that prefix seen in the session', () => {
  const model = new Model();
  assert.equal(model.nextId('b'), 'b_1');
  assert.equal(model.nextId('b'), 'b_2');
  assert.equal(model.nextId('j'), 'j_1');
  model.reset({
    type: 'root',
    props: { ...model.get(ROOT_UID).props, rootBody: 'b_torso' },
    children: {
      bodies: [
        { type: 'body', props: { id: 'b_7', name: 'a' }, children: { fixtures: [{ type: 'shape', props: { id: 'f_4', name: 'x' } }] } },
        { type: 'body', props: { id: 'b_torso', name: 'torso' } },
      ],
      joints: [{ type: 'joint', props: { id: 'j_knee', name: 'knee', bodyA: 'b_12', bodyB: 'b_7' } }],
      sprites: [{ type: 'spriteAsset', props: { id: 's_02', name: 'head', src: 'head.png' } }],
    },
  }, 'load');
  assert.equal(model.nextId('b'), 'b_13');
  assert.equal(model.nextId('f'), 'f_5');
  assert.equal(model.nextId('j'), 'j_2');
  assert.equal(model.nextId('s'), 's_3');
  model.applyOps([{ op: 'remove', uid: model.uidOf('b_7') }]);
  model.reset({ type: 'root', props: model.get(ROOT_UID).props }, 'new');
  assert.equal(model.nextId('b'), 'b_14');
  model.applyOps([{ op: 'set', uid: ROOT_UID, path: 'rootBody', value: 'b_40' }]);
  assert.equal(model.nextId('b'), 'b_41');
});

test('nextId only accepts the b, f, j and s prefixes, so root stays reserved', () => {
  const model = new Model();
  for (const prefix of ['root', 'r', 'x', 'b_', '']) assert.throws(() => model.nextId(prefix), prefix);
  assert.equal(model.uidOf('root'), ROOT_UID);
});

test('reset replaces the document with fresh uids and emits reset', () => {
  const model = new Model();
  const oldBody = addBody(model);
  const events = record(model);
  model.reset({
    type: 'root',
    props: { ...defaultsOf('root'), name: 'humanoid' },
    children: {
      bodies: [{ uid: oldBody, type: 'body', props: { id: 'b_torso', name: 'torso' } }],
      clips: [clipSnapshot('dead')],
    },
  }, 'recover');
  assert.deepEqual(events, [['reset', { cause: 'recover' }]]);
  assert.equal(model.prop(ROOT_UID, 'name'), 'humanoid');
  const [bodyUid] = model.children(ROOT_UID, 'bodies');
  assert.ok(bodyUid > oldBody);
  assert.equal(model.uidOf('b_torso'), bodyUid);
  assert.equal(model.uidOf('b_1'), null);
  assert.equal(model.get(model.clipByKey('dead')).type, 'clip');
  assert.equal(model.clipByKey('run'), null);
});

test('an invalid reset leaves the model unchanged and emits nothing', () => {
  const model = new Model();
  const bodyUid = addBody(model);
  const events = record(model);
  assert.throws(() => model.reset({ type: 'body', props: {} }));
  assert.throws(() => model.reset({ type: 'root', props: {}, children: { bodies: [{ type: 'joint', props: {} }] } }));
  assert.throws(() => model.reset({ type: 'root', props: {}, children: { wheels: [] } }));
  assert.throws(() => model.reset({ type: 'root', props: {} }, 'later'));
  assert.equal(model.uidOf('b_1'), bodyUid);
  assert.deepEqual(events, []);
});

test('on returns an unsubscribe function and off removes listeners', () => {
  const model = new Model();
  let count = 0;
  const unsubscribe = model.on('change', () => count++);
  const listener = () => count++;
  model.on('change', listener);
  unsubscribe();
  model.off('change', listener);
  addBody(model);
  assert.equal(count, 0);
});

test('children lists and nodes are frozen', () => {
  const model = new Model();
  addBody(model);
  const bodies = model.children(ROOT_UID, 'bodies');
  assert.ok(Object.isFrozen(bodies));
  assert.ok(Object.isFrozen(model.get(bodies[0])));
  assert.throws(() => bodies.push(1), TypeError);
});

test('batch emits one change with every effective change and returns frozen ops and changes', () => {
  const model = new Model();
  const events = record(model);
  const result = model.batch(() => {
    const uid = addBody(model, 2);
    model.applyOps([{ op: 'set', uid, path: 'name', value: 'renamed' }]);
  });
  assert.equal(events.length, 1);
  assert.equal(events[0][1].cause, 'do');
  assert.deepEqual(events[0][1].changes, result.changes);
  assert.deepEqual(result.changes.map((change) => change.kind), ['add', 'add', 'add', 'set']);
  assert.equal(result.ops.length, 2);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.ops));
  assert.ok(Object.isFrozen(result.changes));
});

test('batch lets later calls read the earlier writes', () => {
  const model = new Model();
  model.batch(() => {
    const uid = addBody(model);
    assert.equal(model.get(uid).type, 'body');
    model.applyOps([{ op: 'set', uid, path: 'name', value: 'seen' }]);
    assert.equal(model.prop(uid, 'name'), 'seen');
  });
  assert.equal(model.children(ROOT_UID, 'bodies').length, 1);
});

test('batch reverts every applied op and emits nothing when the callback throws', () => {
  const model = new Model();
  const keep = addBody(model);
  const events = record(model);
  const before = model.get(keep).props;
  assert.throws(() => model.batch(() => {
    addBody(model);
    model.applyOps([{ op: 'set', uid: keep, path: 'name', value: 'changed' }]);
    model.applyOps([{ op: 'remove', uid: keep }]);
    throw new Error('boom');
  }), /boom/);
  assert.equal(events.length, 0);
  assert.deepEqual(model.children(ROOT_UID, 'bodies'), [keep]);
  assert.deepEqual(model.get(keep).props, before);
  model.applyOps([{ op: 'set', uid: keep, path: 'name', value: 'after' }]);
  assert.equal(events.length, 1);
});

test('batch keeps earlier ops when a later applyOps call fails atomically and the callback handles it', () => {
  const model = new Model();
  const events = record(model);
  model.batch(() => {
    const uid = addBody(model);
    assert.throws(() => model.applyOps([
      { op: 'set', uid, path: 'name', value: 'x' },
      { op: 'remove', uid: 9999 },
    ]));
    assert.notEqual(model.prop(uid, 'name'), 'x');
  });
  assert.equal(model.children(ROOT_UID, 'bodies').length, 1);
  assert.equal(events.length, 1);
});

test('batch cannot nest and a failed nested call leaves the outer batch usable', () => {
  const model = new Model();
  model.batch(() => {
    assert.throws(() => model.batch(() => {}), /nested/);
    addBody(model);
  });
  assert.equal(model.children(ROOT_UID, 'bodies').length, 1);
  assert.doesNotThrow(() => model.batch(() => {}));
});

test('batch accepts only the do cause for applyOps', () => {
  const model = new Model();
  const uid = addBody(model);
  for (const cause of ['undo', 'redo', 'cancel']) {
    assert.throws(() => model.batch(() => {
      model.applyOps([{ op: 'set', uid, path: 'name', value: 'x' }], cause);
    }));
  }
  assert.notEqual(model.prop(uid, 'name'), 'x');
});

test('reset throws inside a batch and works after it', () => {
  const model = new Model();
  assert.throws(() => model.batch(() => model.reset({ type: 'root', props: {} })));
  assert.doesNotThrow(() => model.reset({ type: 'root', props: {} }));
});

test('an empty batch or one with only no-op changes emits nothing', () => {
  const model = new Model();
  const uid = addBody(model);
  const events = record(model);
  const empty = model.batch(() => {});
  assert.deepEqual(empty.ops, []);
  assert.deepEqual(empty.changes, []);
  const noop = model.batch(() => {
    model.applyOps([{ op: 'set', uid, path: 'name', value: model.prop(uid, 'name') }]);
  });
  assert.equal(noop.ops.length, 1);
  assert.deepEqual(noop.changes, []);
  assert.equal(events.length, 0);
});

test('a listener error is rethrown after the batch is committed', () => {
  const model = new Model();
  model.on('change', () => {
    throw new Error('listener');
  });
  assert.throws(() => model.batch(() => addBody(model)), /listener/);
  assert.equal(model.children(ROOT_UID, 'bodies').length, 1);
  assert.doesNotThrow(() => model.applyOps([]));
});

test('props naming a child collection are rejected on add, reset and set', () => {
  const model = new Model();
  const bodyUid = addBody(model);
  const events = record(model);
  const bad = { ...bodySnapshot(model), props: { ...bodySnapshot(model).props, fixtures: [] } };
  assert.throws(() => model.applyOps([{ op: 'add', snapshot: bad, parent: ROOT_UID, collection: 'bodies' }]), /fixtures/);
  assert.throws(() => model.reset({ type: 'root', props: { bodies: [] } }), /bodies/);
  assert.throws(() => model.applyOps([{ op: 'set', uid: bodyUid, path: 'fixtures', value: [] }]), /fixtures/);
  assert.throws(() => model.applyOps([{ op: 'set', uid: bodyUid, path: 'fixtures.0.name', value: 'x' }]), /fixtures/);
  assert.throws(() => model.applyOps([{ op: 'set', uid: ROOT_UID, path: 'clips', value: [] }]), /clips/);
  assert.equal(model.children(ROOT_UID, 'bodies').length, 1);
  assert.equal(events.length, 0);
});
