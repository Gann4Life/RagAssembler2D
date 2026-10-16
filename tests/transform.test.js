import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { manipulationParts, placeParts, rotationAbout, transformParts } from '../js/commands/transform.js';
import { defaultsOf } from '../lib/schema.js';

const EPSILON = 1e-9;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message ?? ''} expected ${expected}, got ${actual}`);
}

function build({ bodies, joints = [], rootBody = 'b_1' }) {
  const model = new Model();
  const history = new History(model);
  const uids = {};
  history.execute({
    label: 'Build',
    run(tx) {
      for (const [id, props] of Object.entries(bodies)) {
        uids[id] = tx.add(ROOT_UID, 'bodies', undefined, { type: 'body', props: { id, ...props }, children: { fixtures: [] } });
      }
      joints.forEach(([bodyA, bodyB, anchor], index) => {
        const id = `j_${index + 1}`;
        const props = { ...defaultsOf('joint'), id, bodyA, bodyB, anchor };
        uids[id] = tx.add(ROOT_UID, 'joints', undefined, { type: 'joint', props });
      });
      tx.set(ROOT_UID, 'rootBody', rootBody);
    },
  });
  return { model, history, uids };
}

function arm() {
  return build({
    bodies: {
      b_1: { position: [0, 0], angle: 0 },
      b_2: { position: [1, 0], angle: 0 },
      b_3: { position: [2, 0], angle: 0.5 },
      b_4: { position: [3, 0], angle: 0 },
    },
    joints: [
      ['b_1', 'b_2', [0.5, 0]],
      ['b_2', 'b_3', [1.5, 0]],
      ['b_3', 'b_4', [2.5, 0]],
    ],
  });
}

function names(parts, uids) {
  const byUid = new Map(Object.entries(uids).map(([name, uid]) => [uid, name]));
  return { bodies: parts.bodies.map((entry) => byUid.get(entry.uid)), anchors: parts.anchors.map((entry) => byUid.get(entry.uid)) };
}

function partsOf(model, uids, bodies, joints, subtree) {
  return manipulationParts(model, { bodies: bodies.map((id) => uids[id]), joints: joints.map((id) => uids[id]) }, { subtree });
}

test('manipulationParts: a body carries its subtree, its parent joint and the internal joints', () => {
  const { model, uids } = arm();
  const parts = partsOf(model, uids, ['b_2'], [], true);
  assert.deepEqual(names(parts, uids), { bodies: ['b_2', 'b_3', 'b_4'], anchors: ['j_1', 'j_2', 'j_3'] });
  assert.deepEqual(parts.bodies[1], { uid: uids.b_3, position: { x: 2, y: 0 }, angle: 0.5 });
  assert.deepEqual(parts.anchors[0], { uid: uids.j_1, anchor: { x: 0.5, y: 0 } });
  assert.ok(Object.isFrozen(parts) && Object.isFrozen(parts.bodies) && Object.isFrozen(parts.bodies[0]));
});

test('manipulationParts without subtree keeps the parent joint and leaves child joints', () => {
  const { model, uids } = arm();
  assert.deepEqual(names(partsOf(model, uids, ['b_3'], [], false), uids), { bodies: ['b_3'], anchors: ['j_2'] });
  assert.deepEqual(names(partsOf(model, uids, ['b_1'], [], false), uids), { bodies: ['b_1'], anchors: [] });
});

test('manipulationParts: loop joints count only when both ends move', () => {
  const { model, uids } = build({
    bodies: { b_1: {}, b_2: {}, b_3: {}, b_4: {} },
    joints: [
      ['b_1', 'b_2', [0, 0]],
      ['b_2', 'b_3', [1, 0]],
      ['b_2', 'b_4', [2, 0]],
      ['b_3', 'b_4', [3, 0]],
    ],
  });
  assert.deepEqual(names(partsOf(model, uids, ['b_2'], [], true), uids), {
    bodies: ['b_2', 'b_3', 'b_4'],
    anchors: ['j_1', 'j_2', 'j_3', 'j_4'],
  });
  assert.deepEqual(names(partsOf(model, uids, ['b_3'], [], true), uids), { bodies: ['b_3'], anchors: ['j_2'] });
  assert.deepEqual(names(partsOf(model, uids, ['b_4'], [], true), uids), { bodies: ['b_4'], anchors: ['j_3'] });
});

test('manipulationParts: selected joints are added once, unplaced anchors are skipped', () => {
  const { model, uids } = build({
    bodies: { b_1: {}, b_2: {}, b_3: {} },
    joints: [
      ['b_1', 'b_2', [0, 0]],
      ['b_2', 'b_3', null],
      ['b_2', 'b_3', [Number.NaN, 0]],
    ],
  });
  assert.deepEqual(names(partsOf(model, uids, ['b_2'], ['j_1', 'j_2'], true), uids), { bodies: ['b_2', 'b_3'], anchors: ['j_1'] });
  assert.deepEqual(names(partsOf(model, uids, [], ['j_1', 'j_3'], true), uids), { bodies: [], anchors: ['j_1'] });
});

test('manipulationParts reads a missing or malformed position as the origin and a missing angle as 0', () => {
  const { model, uids } = build({ bodies: { b_1: {}, b_2: { position: 'x', angle: 'y' }, b_3: { position: [1, Number.NaN] } } });
  const parts = partsOf(model, uids, ['b_1', 'b_2', 'b_3'], [], false);
  for (const entry of parts.bodies) assert.deepEqual({ position: entry.position, angle: entry.angle }, { position: { x: 0, y: 0 }, angle: 0 });
});

test('manipulationParts counts overlapping subtrees once, in model order', () => {
  const { model, uids } = arm();
  const parts = partsOf(model, uids, ['b_3', 'b_2', 'b_4'], [], true);
  assert.deepEqual(names(parts, uids), { bodies: ['b_2', 'b_3', 'b_4'], anchors: ['j_1', 'j_2', 'j_3'] });
});

test('manipulationParts without subtree is a subset of the subtree result, entry by entry', () => {
  const { model, uids } = arm();
  for (const [bodies, joints] of [[['b_2'], []], [['b_3'], ['j_1']], [['b_1', 'b_4'], []]]) {
    const full = partsOf(model, uids, bodies, joints, true);
    const only = partsOf(model, uids, bodies, joints, false);
    for (const entry of only.bodies) assert.deepEqual(full.bodies.find((other) => other.uid === entry.uid), entry);
    for (const entry of only.anchors) assert.deepEqual(full.anchors.find((other) => other.uid === entry.uid), entry);
  }
});

test('manipulationParts throws for uids of the wrong type', () => {
  const { model, uids } = arm();
  assert.throws(() => manipulationParts(model, { bodies: [uids.j_1], joints: [] }, { subtree: true }), Error);
  assert.throws(() => manipulationParts(model, { bodies: [], joints: [uids.b_1] }, { subtree: true }), Error);
  assert.throws(() => manipulationParts(model, { bodies: [999], joints: [] }, { subtree: false }), Error);
});

test('transformParts translates and rotates, adding the angle', () => {
  const parts = Object.freeze({
    bodies: [{ uid: 1, position: { x: 1, y: 0 }, angle: 0.25 }],
    anchors: [{ uid: 2, anchor: { x: 0, y: 2 } }],
  });
  const moved = transformParts(parts, { x: 1, y: -1, angle: 0 });
  assert.deepEqual(moved.bodies[0], { uid: 1, position: { x: 2, y: -1 }, angle: 0.25 });
  assert.deepEqual(moved.anchors[0], { uid: 2, anchor: { x: 1, y: 1 } });
  assert.ok(Object.isFrozen(moved.bodies[0]));
  const turned = transformParts(parts, rotationAbout({ x: 1, y: 0 }, Math.PI / 2));
  near(turned.bodies[0].position.x, 1);
  near(turned.bodies[0].position.y, 0);
  near(turned.bodies[0].angle, 0.25 + Math.PI / 2);
  near(turned.anchors[0].anchor.x, -1);
  near(turned.anchors[0].anchor.y, -1);
});

test('rotationAbout keeps the pivot fixed and transformParts never yields -0', () => {
  const pivot = { x: 0.3, y: -1.7 };
  const t = rotationAbout(pivot, 1.1);
  assert.equal(t.angle, 1.1);
  const fixed = transformParts({ bodies: [{ uid: 1, position: pivot, angle: 0 }], anchors: [] }, t).bodies[0].position;
  near(fixed.x, pivot.x);
  near(fixed.y, pivot.y);
  const zero = transformParts({ bodies: [{ uid: 1, position: { x: -0, y: 0 }, angle: -0 }], anchors: [{ uid: 2, anchor: { x: 0, y: -0 } }] }, {
    x: 0,
    y: -0,
    angle: -0,
  });
  assert.ok(!Object.is(zero.bodies[0].position.x, -0));
  assert.ok(!Object.is(zero.bodies[0].position.y, -0));
  assert.ok(!Object.is(zero.bodies[0].angle, -0));
  assert.ok(!Object.is(zero.anchors[0].anchor.y, -0));
});

function recordOps(model) {
  const changes = [];
  model.on('change', ({ changes: list }) => changes.push(...list));
  return changes;
}

test('placeParts sets only the changed paths, so a pure move issues no angle op', () => {
  const { model, history, uids } = arm();
  const changes = recordOps(model);
  const parts = transformParts(partsOf(model, uids, ['b_3'], [], true), { x: 0.5, y: 0, angle: 0 });
  history.execute(placeParts(parts));
  const paths = changes.map((change) => `${change.kind}:${change.path}`).sort();
  assert.deepEqual(paths, ['set:anchor', 'set:anchor', 'set:position', 'set:position']);
  assert.deepEqual(model.prop(uids.b_3, 'position'), [2.5, 0]);
  assert.deepEqual(model.prop(uids.b_4, 'position'), [3.5, 0]);
  assert.deepEqual(model.prop(uids.j_2, 'anchor'), [2, 0]);
  assert.deepEqual(model.prop(uids.j_3, 'anchor'), [3, 0]);
  assert.deepEqual(model.prop(uids.j_1, 'anchor'), [0.5, 0]);
  assert.equal(history.state.undoLabel, 'Move');
});

test('placeParts is one history step with its label, undone and redone', () => {
  const { model, history, uids } = arm();
  const parts = transformParts(partsOf(model, uids, ['b_2'], [], true), rotationAbout({ x: 0.5, y: 0 }, Math.PI));
  history.execute(placeParts(parts, 'Rotate'));
  assert.equal(history.state.undoLabel, 'Rotate');
  near(model.prop(uids.b_4, 'position')[0], -2);
  near(model.prop(uids.b_3, 'angle'), 0.5 + Math.PI);
  history.undo();
  assert.deepEqual(model.prop(uids.b_4, 'position'), [3, 0]);
  assert.equal(model.prop(uids.b_3, 'angle'), 0.5);
  assert.equal(history.state.undoLabel, 'Build');
  history.redo();
  near(model.prop(uids.b_2, 'position')[0], 0);
  assert.equal(history.state.undoLabel, 'Rotate');
});

test('placeParts with the current values records nothing', () => {
  const { model, history, uids } = arm();
  history.execute(placeParts(partsOf(model, uids, ['b_1'], [], true)));
  assert.equal(history.state.undoLabel, 'Build');
});

test('placeParts checks every entry before mutating', () => {
  const { model, history, uids } = arm();
  const good = { uid: uids.b_2, position: { x: 9, y: 9 }, angle: 0 };
  const cases = [
    [{ bodies: [good, { uid: uids.j_1, position: { x: 0, y: 0 }, angle: 0 }], anchors: [] }, Error],
    [{ bodies: [good], anchors: [{ uid: uids.b_1, anchor: { x: 0, y: 0 } }] }, Error],
    [{ bodies: [good, { uid: uids.b_3, position: { x: Number.NaN, y: 0 }, angle: 0 }], anchors: [] }, RangeError],
    [{ bodies: [good, { uid: uids.b_3, position: { x: 0, y: 0 }, angle: Infinity }], anchors: [] }, RangeError],
    [{ bodies: [good], anchors: [{ uid: uids.j_1, anchor: { x: 0, y: Number.NaN } }] }, RangeError],
  ];
  for (const [parts, type] of cases) {
    assert.throws(() => history.execute(placeParts(parts)), type);
    assert.deepEqual(model.prop(uids.b_2, 'position'), [1, 0]);
    assert.equal(history.state.undoLabel, 'Build');
  }
});
