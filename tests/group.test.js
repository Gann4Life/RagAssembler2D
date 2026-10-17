import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { jointTree } from '../js/model/queries.js';
import { groupBodies, groupPlan, splitParts, splitShapes, ungroupBodies, ungroupParts } from '../js/commands/group.js';
import { polygonCentroid } from '../lib/geometry.js';
import { defaultsOf } from '../lib/schema.js';

const EPSILON = 1e-9;
const COLLECTIONS = { root: ['sprites', 'bodies', 'joints', 'clips'], body: ['fixtures'], clip: ['tracks', 'events'], track: ['keys'] };

const circle = (center, radius = 0.25) => ({ type: 'circle', center, radius });
const box = (center, angle = 0, width = 0.5, height = 0.3) => ({ type: 'box', center, angle, width, height });
const polygon = (vertices) => ({ type: 'polygon', vertices });
const sprite = (offset, angle) => ({ asset: null, offset, angle, scale: [1, 1], z: 0, visible: true });

function build({ bodies = [], joints = [], clips = [], rootBody = null }) {
  const editor = createEditor();
  const uids = {};
  editor.history.execute({
    label: 'Build',
    run(tx) {
      const { fixtures: _fixtures, ...bodyDefaults } = defaultsOf('body');
      for (const { id, position = [0, 0], angle = 0, fields = {}, shapes } of bodies) {
        const fixtures = shapes.map(({ id: shapeId, shape, sprite: shapeSprite = null }) => ({
          type: 'shape',
          props: { ...defaultsOf('shape', shape.type), id: shapeId, name: `shape ${shapeId}`, shape, sprite: shapeSprite },
        }));
        uids[id] = tx.add(ROOT_UID, 'bodies', undefined, {
          type: 'body',
          props: { ...bodyDefaults, id, name: `body ${id}`, position, angle, ...fields },
          children: { fixtures },
        });
        shapes.forEach(({ id: shapeId }, index) => {
          uids[shapeId] = tx.model.children(uids[id], 'fixtures')[index];
        });
      }
      for (const { id, bodyA, bodyB, aimAxis = 0, name = id } of joints) {
        uids[id] = tx.add(ROOT_UID, 'joints', undefined, {
          type: 'joint',
          props: { ...defaultsOf('joint'), id, name, bodyA, bodyB, aimAxis },
        });
      }
      const { tracks: _tracks, events: _events, ...clipProps } = defaultsOf('clip');
      for (const { key, tracks } of clips) {
        uids[key] = tx.add(ROOT_UID, 'clips', undefined, {
          type: 'clip',
          props: { ...clipProps, key },
          children: {
            tracks: tracks.map(({ target, keys }) => ({
              type: 'track',
              props: { target, channel: 'angle' },
              children: { keys: Array.from({ length: keys }, (_, t) => ({ type: 'key', props: { t, value: 0.1 } })) },
            })),
          },
        });
        tracks.forEach(({ target }, index) => {
          uids[`${key}:${target}`] = tx.model.children(uids[key], 'tracks')[index];
        });
      }
      tx.set(ROOT_UID, 'rootBody', rootBody);
    },
  });
  return { editor, model: editor.model, history: editor.history, uids };
}

function dump(model, uid = ROOT_UID) {
  const node = model.get(uid);
  const children = {};
  for (const collection of COLLECTIONS[node.type] ?? []) {
    children[collection] = model.children(uid, collection).map((child) => dump(model, child));
  }
  return { uid, type: node.type, props: structuredClone(node.props), children };
}

function names(uids, list) {
  const byUid = new Map(Object.entries(uids).map(([name, uid]) => [uid, name]));
  return list.map((uid) => byUid.get(uid) ?? uid);
}

function near(actual, expected, message = '') {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message} expected ${expected}, got ${actual}`);
}

function nearAngle(actual, expected, message = '') {
  const difference = Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected));
  assert.ok(Math.abs(difference) < EPSILON, `${message} expected ${expected}, got ${actual}`);
}

function toWorld(model, body, [x, y]) {
  const [px, py] = model.prop(body, 'position');
  const angle = model.prop(body, 'angle');
  return [px + x * Math.cos(angle) - y * Math.sin(angle), py + x * Math.sin(angle) + y * Math.cos(angle)];
}

function shapePoints(record) {
  return record.type === 'polygon' ? record.vertices : [record.center];
}

function worldPlacement(model, shape) {
  const body = model.get(shape).parent;
  const record = model.prop(shape, 'shape');
  const bodyAngle = model.prop(body, 'angle');
  const shapeSprite = model.prop(shape, 'sprite');
  const localAngle = record.type === 'box' ? record.angle : 0;
  const frameAngle = bodyAngle + localAngle;
  const centroid = record.type === 'polygon' ? polygonCentroid(record.vertices) : null;
  const frameOrigin = centroid ? [centroid.x, centroid.y] : record.center;
  const spriteAt = shapeSprite
    ? toWorld(model, body, [
        frameOrigin[0] + shapeSprite.offset[0] * Math.cos(localAngle) - shapeSprite.offset[1] * Math.sin(localAngle),
        frameOrigin[1] + shapeSprite.offset[0] * Math.sin(localAngle) + shapeSprite.offset[1] * Math.cos(localAngle),
      ])
    : null;
  return {
    points: shapePoints(record).map((point) => toWorld(model, body, point)),
    angle: record.type === 'box' ? bodyAngle + record.angle : null,
    sprite: shapeSprite ? { at: spriteAt, angle: frameAngle + shapeSprite.angle } : null,
  };
}

function assertSamePlacement(actual, expected, label) {
  assert.equal(actual.points.length, expected.points.length, label);
  actual.points.forEach(([x, y], index) => {
    near(x, expected.points[index][0], `${label} point ${index} x`);
    near(y, expected.points[index][1], `${label} point ${index} y`);
  });
  if (expected.angle === null) assert.equal(actual.angle, null, label);
  else nearAngle(actual.angle, expected.angle, `${label} angle`);
  if (expected.sprite === null) {
    assert.equal(actual.sprite, null, label);
  } else {
    near(actual.sprite.at[0], expected.sprite.at[0], `${label} sprite x`);
    near(actual.sprite.at[1], expected.sprite.at[1], `${label} sprite y`);
    nearAngle(actual.sprite.angle, expected.sprite.angle, `${label} sprite angle`);
  }
}

function placements(model, shapes) {
  return new Map(shapes.map((shape) => [shape, worldPlacement(model, shape)]));
}

function noNegativeZero(value) {
  if (typeof value === 'number') return !Object.is(value, -0);
  if (value !== null && typeof value === 'object') return Object.values(value).every(noNegativeZero);
  return true;
}

function assertExactUndoRedo(history, model, command, expectedLabel) {
  const before = dump(model);
  const depth = history.state.undoLabel;
  const result = history.execute(command);
  const after = dump(model);
  assert.equal(history.state.undoLabel, expectedLabel);
  history.undo();
  assert.deepEqual(dump(model), before);
  assert.equal(history.state.undoLabel, depth);
  history.redo();
  assert.deepEqual(dump(model), after);
  return result;
}

const EXAMPLE = {
  bodies: [
    { id: 'b_1', shapes: [{ id: 'f_1', shape: circle([0, 0]) }] },
    { id: 'b_2', position: [1, 0], angle: Math.PI / 2, shapes: [{ id: 'f_2', shape: box([0, 0]) }] },
    { id: 'b_3', position: [3, 0], shapes: [{ id: 'f_3', shape: circle([0, 0]) }] },
  ],
  joints: [
    { id: 'j', bodyA: 'b_1', bodyB: 'b_2' },
    { id: 'k', bodyA: 'b_2', bodyB: 'b_3' },
  ],
  rootBody: 'b_1',
};

test('bodies of the selection: shapes and bodies mixed, duplicates and other types ignored, bodies order', () => {
  const { model, uids } = build({
    bodies: [
      { id: 'b_1', shapes: [{ id: 'f_1', shape: circle([0, 0]) }] },
      { id: 'b_2', shapes: [{ id: 'f_2', shape: circle([0, 0]) }, { id: 'f_3', shape: circle([1, 0]) }] },
      { id: 'b_3', shapes: [{ id: 'f_4', shape: circle([0, 0]) }] },
    ],
    joints: [{ id: 'j_1', bodyA: 'b_1', bodyB: 'b_3' }],
    clips: [{ key: 'c', tracks: [{ target: 'j_1', keys: 1 }] }],
  });
  const plan = groupPlan(model, [uids.f_4, uids.f_2, uids.f_3, uids.b_2, ROOT_UID, uids.j_1, uids.c, uids['c:j_1'], uids.f_4]);
  assert.deepEqual(names(uids, plan.bodies), ['b_2', 'b_3']);
  assert.deepEqual(names(uids, groupPlan(model, [uids.b_3, uids.f_1]).bodies), ['b_1', 'b_3']);
  assert.throws(() => groupPlan(model, [uids.f_1, 9999]), /Unknown node uid 9999/);
  assert.throws(() => splitParts(model, [9999]), Error);
  assert.throws(() => ungroupParts(model, [9999]), Error);
});

test('groupPlan: survivor is rootBody when merged, else the first merged body in bodies order', () => {
  const { model, uids } = build(EXAMPLE);
  assert.equal(groupPlan(model, [uids.f_2, uids.f_1]).survivor, uids.b_1);
  assert.equal(groupPlan(model, [uids.f_3, uids.f_2]).survivor, uids.b_2);
  assert.equal(groupPlan(model, [uids.b_3, uids.b_2]).survivor, uids.b_2);
});

test('groupPlan: internal, redirected, unassigned and unrelated joints, with the deleted tracks and clips', () => {
  const { model, uids } = build({
    bodies: ['b_1', 'b_2', 'b_3', 'b_4', 'b_5'].map((id, index) => ({ id, shapes: [{ id: `f_${index + 1}`, shape: circle([0, 0]) }] })),
    joints: [
      { id: 'j_1', bodyA: 'b_1', bodyB: 'b_2' },
      { id: 'j_2', bodyA: 'b_2', bodyB: 'b_3' },
      { id: 'j_3', bodyA: 'b_3', bodyB: 'b_4' },
      { id: 'j_4', bodyA: 'b_5', bodyB: 'b_2' },
      { id: 'j_5', bodyA: null, bodyB: null },
      { id: 'j_6', bodyA: 'b_4', bodyB: 'b_5' },
      { id: 'j_7', bodyA: 'b_1', bodyB: 'b_4' },
    ],
    clips: [
      { key: 'c_1', tracks: [{ target: 'j_2', keys: 2 }, { target: 'j_6', keys: 1 }] },
      { key: 'c_2', tracks: [{ target: 'j_1', keys: 3 }] },
    ],
    rootBody: 'b_1',
  });
  const plan = groupPlan(model, [uids.f_3, uids.f_2, uids.f_1]);
  assert.ok(Object.isFrozen(plan));
  assert.equal(plan.survivor, uids.b_1);
  assert.deepEqual(names(uids, plan.bodies), ['b_1', 'b_2', 'b_3']);
  assert.deepEqual(names(uids, plan.joints), ['j_1', 'j_2']);
  assert.deepEqual(names(uids, plan.redirected), ['j_3', 'j_4']);
  assert.deepEqual(names(uids, plan.deletion.tracks), ['c_1:j_2', 'c_2:j_1']);
  assert.deepEqual(plan.deletion.clips.map((clip) => [names(uids, [clip.uid])[0], clip.tracks, clip.keys]), [
    ['c_1', 1, 2],
    ['c_2', 1, 3],
  ]);
  assert.equal(plan.confirm, true);
  assert.equal(plan.empty, false);
  assert.equal(plan.invalid, false);
  const outside = groupPlan(model, [uids.f_2, uids.f_3]);
  assert.equal(outside.survivor, uids.b_2);
  assert.deepEqual(names(uids, outside.joints), ['j_2']);
  assert.deepEqual(names(uids, outside.redirected), ['j_3']);
  assert.equal(groupPlan(model, [uids.f_4, uids.f_5]).confirm, true);
});

test('groupPlan: empty with zero or one body', () => {
  const { model, uids } = build(EXAMPLE);
  for (const selected of [[], [ROOT_UID], [uids.f_1], [uids.b_1, uids.f_1], [uids.j]]) {
    const plan = groupPlan(model, selected);
    assert.equal(plan.empty, true);
    assert.equal(plan.confirm, false);
    assert.deepEqual(plan.joints, []);
  }
  assert.equal(groupPlan(model, []).survivor, null);
  assert.equal(groupPlan(model, [uids.f_2]).survivor, uids.b_2);
});

test('groupPlan: invalid for an invalid moved shape or a non-finite body transform, not for the survivor shapes', () => {
  const badShape = build({
    bodies: [
      { id: 'b_1', shapes: [{ id: 'f_1', shape: circle([0, 0], -1) }] },
      { id: 'b_2', shapes: [{ id: 'f_2', shape: circle([0, 0]) }] },
    ],
    rootBody: 'b_1',
  });
  assert.equal(groupPlan(badShape.model, [badShape.uids.f_1, badShape.uids.f_2]).invalid, false);
  const moved = build({
    bodies: [
      { id: 'b_1', shapes: [{ id: 'f_1', shape: circle([0, 0]) }] },
      { id: 'b_2', shapes: [{ id: 'f_2', shape: circle([0, 0]) }, { id: 'f_3', shape: polygon([[0, 0], [1, 0]]) }] },
    ],
    rootBody: 'b_1',
  });
  assert.equal(groupPlan(moved.model, [moved.uids.f_1, moved.uids.f_2]).invalid, true);
  const angle = build({
    bodies: [
      { id: 'b_1', shapes: [{ id: 'f_1', shape: circle([0, 0]) }] },
      { id: 'b_2', angle: Number.NaN, shapes: [{ id: 'f_2', shape: circle([0, 0]) }] },
    ],
  });
  assert.equal(groupPlan(angle.model, [angle.uids.f_1, angle.uids.f_2]).invalid, true);
  const survivorPosition = build({
    bodies: [
      { id: 'b_1', position: [Number.POSITIVE_INFINITY, 0], shapes: [{ id: 'f_1', shape: circle([0, 0]) }] },
      { id: 'b_2', shapes: [{ id: 'f_2', shape: circle([0, 0]) }] },
    ],
  });
  assert.equal(groupPlan(survivorPosition.model, [survivorPosition.uids.f_1, survivorPosition.uids.f_2]).invalid, true);
});

test('groupBodies: the DESIGN §2.2 example', () => {
  const { model, history, uids } = build(EXAMPLE);
  const result = history.execute(groupBodies([uids.f_2, uids.f_1]));
  assert.deepEqual(names(uids, model.children(ROOT_UID, 'bodies')), ['b_1', 'b_3']);
  assert.deepEqual(names(uids, model.children(uids.b_1, 'fixtures')), ['f_1', 'f_2']);
  assert.deepEqual(names(uids, result), ['f_1', 'f_2']);
  const record = model.prop(uids.f_2, 'shape');
  near(record.center[0], 1);
  near(record.center[1], 0);
  near(record.angle, Math.PI / 2);
  assert.deepEqual(names(uids, model.children(ROOT_UID, 'joints')), ['k']);
  assert.equal(model.prop(uids.k, 'bodyA'), 'b_1');
  assert.equal(model.prop(uids.k, 'bodyB'), 'b_3');
  assert.equal(model.prop(uids.k, 'aimAxis'), 0);
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'b_1');
  assert.equal(history.state.undoLabel, 'Group');
});

test('groupBodies keeps the world placement of circles, boxes, polygons and their sprites', () => {
  const { model, history, uids } = build({
    bodies: [
      { id: 'b_1', position: [0.5, -1], angle: 0.4, shapes: [{ id: 'f_1', shape: circle([0.1, 0.1]) }] },
      {
        id: 'b_2',
        position: [2, 1],
        angle: -1.1,
        shapes: [
          { id: 'f_2', shape: circle([0.3, 0.2]), sprite: sprite([0.1, 0.2], 0.3) },
          { id: 'f_3', shape: box([0.1, -0.4], 0.2), sprite: sprite([0.05, -0.1], 0.7) },
          { id: 'f_4', shape: polygon([[0, 0], [0.4, 0], [0.3, 0.5]]), sprite: sprite([-0.2, 0.1], -0.5) },
          { id: 'f_5', shape: circle([0, 0]) },
        ],
      },
    ],
  });
  const moved = ['f_2', 'f_3', 'f_4', 'f_5'].map((id) => uids[id]);
  const before = placements(model, moved);
  const boxSprite = structuredClone(model.prop(uids.f_3, 'sprite'));
  history.execute(groupBodies([uids.f_4, uids.f_1]));
  assert.deepEqual(names(uids, model.children(uids.b_1, 'fixtures')), ['f_1', 'f_2', 'f_3', 'f_4', 'f_5']);
  for (const shape of moved) assertSamePlacement(worldPlacement(model, shape), before.get(shape), names(uids, [shape])[0]);
  const delta = -1.1 - 0.4;
  const offset = model.prop(uids.f_2, 'sprite.offset');
  near(offset[0], 0.1 * Math.cos(delta) - 0.2 * Math.sin(delta));
  near(offset[1], 0.1 * Math.sin(delta) + 0.2 * Math.cos(delta));
  near(model.prop(uids.f_2, 'sprite.angle'), 0.3 + delta);
  near(model.prop(uids.f_4, 'sprite.angle'), -0.5 + delta);
  assert.deepEqual(model.prop(uids.f_3, 'sprite'), boxSprite);
  near(model.prop(uids.f_3, 'shape.angle'), 0.2 + delta);
  assert.equal(model.prop(uids.f_5, 'sprite'), null);
  for (const shape of moved) assert.ok(noNegativeZero(model.get(shape).props));
});

test('groupBodies wraps computed angles to (-π, π]', () => {
  const { model, history, uids } = build({
    bodies: [
      { id: 'b_1', angle: -3, shapes: [{ id: 'f_1', shape: circle([0, 0]) }] },
      { id: 'b_2', angle: 3, shapes: [{ id: 'f_2', shape: box([0, 0], 1) }] },
    ],
    joints: [{ id: 'j_1', bodyA: 'b_3', bodyB: 'b_2', aimAxis: 2 }],
  });
  history.execute(groupBodies([uids.f_1, uids.f_2]));
  for (const value of [model.prop(uids.f_2, 'shape.angle'), model.prop(uids.j_1, 'aimAxis')]) {
    assert.ok(value > -Math.PI && value <= Math.PI, String(value));
  }
  nearAngle(model.prop(uids.f_2, 'shape.angle'), 7);
  nearAngle(model.prop(uids.j_1, 'aimAxis'), 8);
});

test('groupBodies turns aimAxis by Δ only when bodyB is redirected', () => {
  const { model, history, uids } = build({
    bodies: [
      { id: 'b_1', angle: 0.2, shapes: [{ id: 'f_1', shape: circle([0, 0]) }] },
      { id: 'b_2', angle: 0.7, shapes: [{ id: 'f_2', shape: circle([0, 0]) }] },
      { id: 'b_3', angle: -0.3, shapes: [{ id: 'f_3', shape: circle([0, 0]) }] },
      { id: 'b_4', shapes: [{ id: 'f_4', shape: circle([0, 0]) }] },
    ],
    joints: [
      { id: 'j_1', bodyA: 'b_4', bodyB: 'b_2', aimAxis: 0.1 },
      { id: 'j_2', bodyA: 'b_3', bodyB: 'b_4', aimAxis: 0.4 },
      { id: 'j_3', bodyA: 'b_1', bodyB: 'b_4', aimAxis: 0.6 },
    ],
    rootBody: 'b_1',
  });
  history.execute(groupBodies([uids.f_1, uids.f_2, uids.f_3]));
  assert.equal(model.prop(uids.j_1, 'bodyB'), 'b_1');
  near(model.prop(uids.j_1, 'aimAxis'), 0.1 + 0.5);
  assert.equal(model.prop(uids.j_2, 'bodyA'), 'b_1');
  assert.equal(model.prop(uids.j_2, 'aimAxis'), 0.4);
  assert.equal(model.prop(uids.j_3, 'aimAxis'), 0.6);
});

test('groupBodies keeps the survivor id, name, fields and index; rootBody unchanged', () => {
  const { model, history, uids } = build({
    bodies: [
      { id: 'b_1', shapes: [{ id: 'f_1', shape: circle([0, 0]) }] },
      { id: 'b_2', fields: { linearDamping: 2, bullet: true }, shapes: [{ id: 'f_2', shape: circle([0, 0]) }] },
      { id: 'b_3', shapes: [{ id: 'f_3', shape: circle([0, 0]) }] },
      { id: 'b_4', fields: { linearDamping: 5 }, shapes: [{ id: 'f_4', shape: circle([0, 0]) }, { id: 'f_5', shape: circle([1, 0]) }] },
    ],
    rootBody: 'b_1',
  });
  const props = structuredClone(model.get(uids.b_2).props);
  history.execute(groupBodies([uids.f_5, uids.b_2]));
  assert.deepEqual(names(uids, model.children(ROOT_UID, 'bodies')), ['b_1', 'b_2', 'b_3']);
  assert.deepEqual(model.get(uids.b_2).props, props);
  assert.deepEqual(names(uids, model.children(uids.b_2, 'fixtures')), ['f_2', 'f_4', 'f_5']);
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'b_1');
});

test('groupBodies keeps two joints to the same outside body; the later one becomes a loop', () => {
  const { model, history, uids } = build({
    bodies: [
      { id: 'b_1', shapes: [{ id: 'f_1', shape: circle([0, 0]) }] },
      { id: 'b_2', shapes: [{ id: 'f_2', shape: circle([0, 0]) }] },
      { id: 'b_3', shapes: [{ id: 'f_3', shape: circle([0, 0]) }] },
    ],
    joints: [
      { id: 'j_1', bodyA: 'b_1', bodyB: 'b_3' },
      { id: 'j_2', bodyA: 'b_2', bodyB: 'b_3' },
    ],
    rootBody: 'b_1',
  });
  history.execute(groupBodies([uids.f_1, uids.f_2]));
  assert.deepEqual(names(uids, model.children(ROOT_UID, 'joints')), ['j_1', 'j_2']);
  assert.equal(model.prop(uids.j_2, 'bodyA'), 'b_1');
  assert.deepEqual(names(uids, [...jointTree(model).loops]), ['j_2']);
});

test('groupBodies is one Group step with exact undo and redo, keeping shape uids', () => {
  const { model, history, uids } = build({
    ...EXAMPLE,
    bodies: [
      ...EXAMPLE.bodies.slice(0, 2),
      { id: 'b_3', position: [3, 0], angle: 0.3, shapes: [{ id: 'f_3', shape: polygon([[0, 0], [1, 0], [0, 1]]), sprite: sprite([0.1, 0], 0.2) }] },
    ],
    joints: [...EXAMPLE.joints, { id: 'm', bodyA: 'b_1', bodyB: 'b_3' }],
    clips: [{ key: 'c', tracks: [{ target: 'j', keys: 2 }, { target: 'm', keys: 1 }] }],
  });
  const result = assertExactUndoRedo(history, model, groupBodies([uids.f_1, uids.f_2, uids.f_3]), 'Group');
  assert.deepEqual(names(uids, result), ['f_1', 'f_2', 'f_3']);
  assert.deepEqual(names(uids, model.children(uids.b_1, 'fixtures')), ['f_1', 'f_2', 'f_3']);
  assert.deepEqual(model.children(uids.c, 'tracks'), []);
});

test('groupBodies throws on an empty or invalid plan without mutating', () => {
  const { model, history, uids } = build({
    bodies: [
      { id: 'b_1', shapes: [{ id: 'f_1', shape: circle([0, 0]) }] },
      { id: 'b_2', shapes: [{ id: 'f_2', shape: circle([0, 0], 0) }] },
    ],
    joints: [{ id: 'j_1', bodyA: 'b_1', bodyB: 'b_2' }],
  });
  const before = dump(model);
  assert.throws(() => history.execute(groupBodies([uids.f_1])), Error);
  assert.throws(() => history.execute(groupBodies([uids.f_1, uids.f_2])), Error);
  assert.deepEqual(dump(model), before);
  assert.equal(history.state.undoLabel, 'Build');
});

test('groupBodies issues no geometry set when the transforms are equal', () => {
  const { model, history, uids } = build({
    bodies: [
      { id: 'b_1', position: [1, 2], angle: 0.3, shapes: [{ id: 'f_1', shape: circle([0.1, 0.2]) }] },
      {
        id: 'b_2',
        position: [1, 2],
        angle: 0.3,
        shapes: [
          { id: 'f_2', shape: box([0.4, 0.2], 0.1), sprite: sprite([0.1, 0.1], 0.2) },
          { id: 'f_3', shape: polygon([[0, 0], [1, 0], [0, 1]]), sprite: sprite([0.1, 0.1], 0.2) },
        ],
      },
    ],
  });
  const sets = [];
  model.on('change', ({ changes }) => sets.push(...changes.filter((change) => change.kind === 'set')));
  history.execute(groupBodies([uids.f_1, uids.f_2, uids.f_3]));
  assert.deepEqual(sets, []);
  assert.deepEqual(names(uids, model.children(uids.b_1, 'fixtures')), ['f_1', 'f_2', 'f_3']);
});

const SPLIT_RIG = {
  bodies: [
    {
      id: 'b_1',
      position: [2, 1],
      shapes: [
        { id: 'f_1', shape: circle([-0.5, 0]) },
        { id: 'f_2', shape: circle([0.5, 0]) },
        { id: 'f_3', shape: circle([0.5, 1]) },
      ],
    },
    { id: 'b_2', shapes: [{ id: 'f_4', shape: circle([0, 0]) }, { id: 'f_5', shape: circle([1, 0]) }] },
    { id: 'b_3', shapes: [{ id: 'f_6', shape: circle([0, 0]) }] },
  ],
  joints: [{ id: 'j_1', bodyA: 'b_1', bodyB: 'b_3' }],
  clips: [{ key: 'c', tracks: [{ target: 'j_1', keys: 1 }] }],
  rootBody: 'b_1',
};

test('splitParts: one part per body with some but not all shapes selected; selected bodies skipped', () => {
  const { model, uids } = build(SPLIT_RIG);
  const { parts, invalid } = splitParts(model, [uids.f_5, uids.f_3, uids.f_2, uids.f_6]);
  assert.deepEqual(
    parts.map(({ body, shapes }) => [names(uids, [body])[0], names(uids, shapes)]),
    [
      ['b_1', ['f_2', 'f_3']],
      ['b_2', ['f_5']],
    ],
  );
  assert.equal(invalid, false);
  assert.ok(Object.isFrozen(parts) && Object.isFrozen(parts[0]) && Object.isFrozen(parts[0].shapes));
  assert.deepEqual(splitParts(model, [uids.f_4, uids.f_5]).parts, []);
  assert.deepEqual(splitParts(model, [uids.b_1, uids.f_1]).parts, []);
  assert.deepEqual(splitParts(model, [uids.b_2]).parts, []);
  assert.deepEqual(splitParts(model, [ROOT_UID, uids.j_1]).parts, []);
});

test('ungroupParts: one single-shape part per shape after the first; single-shape bodies skipped', () => {
  const { model, uids } = build(SPLIT_RIG);
  const result = ungroupParts(model, [uids.f_6, uids.b_2, uids.f_1]);
  assert.deepEqual(names(uids, result.bodies), ['b_1', 'b_2']);
  assert.deepEqual(
    result.parts.map(({ body, shapes }) => [names(uids, [body])[0], names(uids, shapes)]),
    [
      ['b_1', ['f_2']],
      ['b_1', ['f_3']],
      ['b_2', ['f_5']],
    ],
  );
  assert.equal(result.invalid, false);
  assert.deepEqual(ungroupParts(model, [uids.f_6]).parts, []);
});

test('splitParts and ungroupParts: invalid for an invalid moved shape or source transform', () => {
  const { model, uids } = build({
    bodies: [
      { id: 'b_1', shapes: [{ id: 'f_1', shape: circle([0, 0], -1) }, { id: 'f_2', shape: circle([0, 0]) }] },
      { id: 'b_2', angle: Number.NaN, shapes: [{ id: 'f_3', shape: circle([0, 0]) }, { id: 'f_4', shape: circle([0, 0]) }] },
    ],
  });
  assert.equal(splitParts(model, [uids.f_2]).invalid, false);
  assert.equal(splitParts(model, [uids.f_1]).invalid, true);
  assert.equal(splitParts(model, [uids.f_3]).invalid, true);
  assert.equal(ungroupParts(model, [uids.b_1]).invalid, false);
  assert.equal(ungroupParts(model, [uids.b_2]).invalid, true);
});

test('splitShapes: the DESIGN §2.2 example, new body after its source with copied fields', () => {
  const rig = structuredClone(SPLIT_RIG);
  rig.bodies[0].fields = { linearDamping: 1.5, angularDamping: 0.5, fixedRotation: true, bullet: true };
  const { model, history, uids } = build(rig);
  const result = history.execute(splitShapes([uids.f_3, uids.f_2]));
  const bodies = model.children(ROOT_UID, 'bodies');
  assert.deepEqual(names(uids, bodies), ['b_1', bodies[1], 'b_2', 'b_3']);
  const created = bodies[1];
  const props = model.get(created).props;
  assert.equal(props.id, 'b_4');
  assert.equal(props.name, 'body_4');
  near(props.position[0], 2.5);
  near(props.position[1], 1.5);
  assert.equal(props.angle, 0);
  assert.deepEqual(
    [props.linearDamping, props.angularDamping, props.fixedRotation, props.bullet],
    [1.5, 0.5, true, true],
  );
  assert.deepEqual(names(uids, model.children(created, 'fixtures')), ['f_2', 'f_3']);
  assert.deepEqual([...model.prop(uids.f_2, 'shape.center')], [0, -0.5]);
  assert.deepEqual([...model.prop(uids.f_3, 'shape.center')], [0, 0.5]);
  assert.deepEqual(names(uids, model.children(uids.b_1, 'fixtures')), ['f_1']);
  assert.deepEqual(names(uids, result), ['f_2', 'f_3']);
  assert.deepEqual(names(uids, model.children(ROOT_UID, 'joints')), ['j_1']);
  assert.equal(model.prop(uids.j_1, 'bodyA'), 'b_1');
  assert.equal(model.prop(uids.j_1, 'bodyB'), 'b_3');
  assert.deepEqual(names(uids, model.children(uids.c, 'tracks')), ['c:j_1']);
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'b_1');
  assert.equal(history.state.undoLabel, 'Split');
});

test('splitShapes on a rotated source with a polygon keeps the world placement', () => {
  const vertices = [[0.5, 0], [1.5, 0], [1.5, 1], [0.5, 1.5]];
  const { model, history, uids } = build({
    bodies: [
      {
        id: 'b_1',
        position: [1, 1],
        angle: Math.PI / 2,
        shapes: [
          { id: 'f_1', shape: circle([0, 0]) },
          { id: 'f_2', shape: polygon(vertices), sprite: sprite([0.1, 0.2], 0.3) },
          { id: 'f_3', shape: box([1, 0], 0.4), sprite: sprite([0.1, 0.2], 0.3) },
        ],
      },
    ],
  });
  const before = placements(model, [uids.f_2, uids.f_3]);
  history.execute(splitShapes([uids.f_2]));
  const created = model.children(ROOT_UID, 'bodies')[1];
  const centroid = polygonCentroid(vertices);
  const position = model.prop(created, 'position');
  near(position[0], 1 - centroid.y);
  near(position[1], 1 + centroid.x);
  assert.equal(model.prop(created, 'angle'), Math.PI / 2);
  model.prop(uids.f_2, 'shape.vertices').forEach(([x, y], index) => {
    near(x, vertices[index][0] - centroid.x);
    near(y, vertices[index][1] - centroid.y);
  });
  const shifted = polygonCentroid(model.prop(uids.f_2, 'shape.vertices'));
  near(shifted.x, 0);
  near(shifted.y, 0);
  assert.deepEqual(model.prop(uids.f_2, 'sprite'), sprite([0.1, 0.2], 0.3));
  assertSamePlacement(worldPlacement(model, uids.f_2), before.get(uids.f_2), 'polygon');
  history.execute(splitShapes([uids.f_3]));
  assert.equal(model.prop(uids.f_3, 'shape.angle'), 0.4);
  assert.deepEqual([...model.prop(uids.f_3, 'shape.center')], [0, 0]);
  assertSamePlacement(worldPlacement(model, uids.f_3), before.get(uids.f_3), 'box');
});

test('splitShapes inserts the new bodies of one source in order, before the next source', () => {
  const { model, history, uids } = build(SPLIT_RIG);
  const result = history.execute(splitShapes([uids.f_5, uids.f_2]));
  const bodies = model.children(ROOT_UID, 'bodies');
  assert.deepEqual(names(uids, bodies).filter((name) => typeof name === 'string'), ['b_1', 'b_2', 'b_3']);
  assert.equal(bodies.indexOf(uids.b_2), 2);
  assert.equal(bodies.indexOf(uids.b_3), 4);
  assert.deepEqual(model.children(bodies[1], 'fixtures'), [uids.f_2]);
  assert.deepEqual(model.children(bodies[3], 'fixtures'), [uids.f_5]);
  assert.deepEqual(names(uids, result), ['f_2', 'f_5']);
});

test('splitShapes is one Split step with exact undo and redo, and throws without parts', () => {
  const { model, history, uids } = build(SPLIT_RIG);
  assertExactUndoRedo(history, model, splitShapes([uids.f_2, uids.f_3, uids.f_5]), 'Split');
  const before = dump(model);
  assert.throws(() => history.execute(splitShapes([uids.f_6])), Error);
  assert.deepEqual(dump(model), before);
});

test('ungroupBodies: one body per shape, joints and rootBody unchanged, every shape returned', () => {
  const { model, history, uids } = build(SPLIT_RIG);
  const result = history.execute(ungroupBodies([uids.f_1, uids.b_2, uids.f_6]));
  const bodies = model.children(ROOT_UID, 'bodies');
  assert.equal(bodies.length, 6);
  assert.deepEqual([bodies[0], bodies[3], bodies[5]], [uids.b_1, uids.b_2, uids.b_3]);
  for (const body of bodies) assert.equal(model.children(body, 'fixtures').length, 1);
  assert.deepEqual(model.children(bodies[1], 'fixtures'), [uids.f_2]);
  assert.deepEqual(model.children(bodies[2], 'fixtures'), [uids.f_3]);
  assert.deepEqual(model.children(bodies[4], 'fixtures'), [uids.f_5]);
  assert.deepEqual(bodies.slice(1).filter((body) => ![uids.b_2, uids.b_3].includes(body)).map((body) => model.prop(body, 'id')), ['b_4', 'b_5', 'b_6']);
  const second = model.prop(bodies[1], 'position');
  near(second[0], 2.5);
  near(second[1], 1);
  assert.deepEqual([...model.prop(uids.f_2, 'shape.center')], [0, 0]);
  assert.deepEqual(names(uids, result), ['f_1', 'f_2', 'f_3', 'f_4', 'f_5']);
  assert.deepEqual(names(uids, model.children(ROOT_UID, 'joints')), ['j_1']);
  assert.equal(model.prop(uids.j_1, 'bodyB'), 'b_3');
  assert.equal(model.prop(ROOT_UID, 'rootBody'), 'b_1');
  assert.equal(history.state.undoLabel, 'Ungroup');
});

test('ungroupBodies is one Ungroup step with exact undo and redo, and throws without parts', () => {
  const { model, history, uids } = build(SPLIT_RIG);
  assertExactUndoRedo(history, model, ungroupBodies([uids.b_1, uids.f_4]), 'Ungroup');
  const before = dump(model);
  assert.throws(() => history.execute(ungroupBodies([uids.f_6])), Error);
  assert.deepEqual(dump(model), before);
});

test('Group then Ungroup puts every shape back in the same world place', () => {
  const { model, history, uids } = build({
    bodies: [
      { id: 'b_1', position: [0.2, 0.3], angle: 0.5, shapes: [{ id: 'f_1', shape: circle([0, 0]), sprite: sprite([0.1, 0], 0.2) }] },
      { id: 'b_2', position: [-1, 2], angle: -2.5, shapes: [{ id: 'f_2', shape: box([0.1, 0.1], 0.3), sprite: sprite([0, 0.1], 0.4) }] },
      { id: 'b_3', position: [3, -1], angle: 2.9, shapes: [{ id: 'f_3', shape: polygon([[0, 0], [1, 0], [0.5, 0.8]]), sprite: sprite([0.2, 0.1], -0.1) }] },
    ],
  });
  const shapes = [uids.f_1, uids.f_2, uids.f_3];
  const before = placements(model, shapes);
  const grouped = history.execute(groupBodies(shapes));
  history.execute(ungroupBodies(grouped));
  assert.equal(model.children(ROOT_UID, 'bodies').length, 3);
  for (const shape of shapes) assertSamePlacement(worldPlacement(model, shape), before.get(shape), names(uids, [shape])[0]);
});
