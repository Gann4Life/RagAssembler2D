import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { jointTree } from '../js/model/queries.js';
import { UNLINKED_KEY, ancestorKeys, fuzzyMatch, hierarchyRows, hierarchyTree } from '../js/model/hierarchy.js';
import { defaultsOf } from '../lib/schema.js';

function build({ bodies = {}, joints = [], rootBody = null, names = {}, types = {} }) {
  const model = new Model();
  const history = new History(model);
  const uids = {};
  history.execute({
    label: 'Build',
    run(tx) {
      for (const [id, shapes] of Object.entries(bodies)) {
        const fixtures = shapes.map((shapeId) => ({
          type: 'shape',
          props: { id: shapeId, name: names[shapeId] ?? '', shape: { type: types[shapeId] ?? 'circle' } },
        }));
        const props = Object.hasOwn(names, id) ? { id, name: names[id] } : { id };
        uids[id] = tx.add(ROOT_UID, 'bodies', undefined, { type: 'body', props, children: { fixtures } });
        shapes.forEach((shapeId, index) => {
          uids[shapeId] = tx.model.children(uids[id], 'fixtures')[index];
        });
      }
      joints.forEach(([bodyA, bodyB], index) => {
        const id = `j_${index + 1}`;
        uids[id] = tx.add(ROOT_UID, 'joints', undefined, {
          type: 'joint',
          props: { ...defaultsOf('joint'), id, name: names[id] ?? '', bodyA, bodyB },
        });
      });
      tx.set(ROOT_UID, 'rootBody', rootBody);
    },
  });
  return { model, uids };
}

function outline(item, depth = 0) {
  const marks = `${item.loop ? ` loop→${item.loopTo}` : ''}${item.unassigned ? ' unassigned' : ''}`;
  const line = `${'  '.repeat(depth)}${item.kind} ${item.label}${marks}`;
  return [line, ...item.children.flatMap((child) => outline(child, depth + 1))];
}

function rowLines(rows) {
  return rows.map((row) => `${'  '.repeat(row.level - 1)}${row.item.label}`);
}

test('hierarchyTree: an empty ragdoll is the root alone', () => {
  const { model } = build({});
  const tree = hierarchyTree(model);
  assert.deepEqual(outline(tree), ['root ragdoll']);
  assert.equal(tree.key, String(ROOT_UID));
  assert.equal(tree.uid, ROOT_UID);
  assert.equal(tree.id, 'root');
  assert.equal(tree.name, 'ragdoll');
});

test('hierarchyTree: chains and branches go body, shapes, then joints in joints order, each holding its child body', () => {
  const { model } = build({
    bodies: { b_1: ['f_1'], b_2: ['f_2'], b_3: ['f_3', 'f_4'], b_4: ['f_5'] },
    joints: [['b_1', 'b_2'], ['b_3', 'b_1'], ['b_2', 'b_4']],
    rootBody: 'b_1',
  });
  assert.deepEqual(outline(hierarchyTree(model)), [
    'root ragdoll',
    '  body b_1',
    '    shape f_1',
    '    joint j_1',
    '      body b_2',
    '        shape f_2',
    '        joint j_3',
    '          body b_4',
    '            shape f_5',
    '    joint j_2',
    '      body b_3',
    '        shape f_3',
    '        shape f_4',
  ]);
});

test('hierarchyTree: items carry kind, uid, name, id, label and shape type', () => {
  const { model, uids } = build({
    bodies: { b_1: ['f_1', 'f_2'] },
    rootBody: 'b_1',
    names: { b_1: 'torso', f_1: 'chest' },
    types: { f_2: 'box' },
  });
  const [body] = hierarchyTree(model).children;
  assert.equal(body.key, String(uids.b_1));
  assert.deepEqual([body.kind, body.uid, body.name, body.id, body.label, body.shapeType], ['body', uids.b_1, 'torso', 'b_1', 'torso', null]);
  const [chest, box] = body.children;
  assert.deepEqual([chest.label, chest.shapeType, chest.loop, chest.unassigned], ['chest', 'circle', false, false]);
  assert.deepEqual([box.name, box.label, box.shapeType], ['', 'f_2', 'box']);
});

test('hierarchyTree: a loop joint is a leaf under its bodyA', () => {
  const { model } = build({
    bodies: { b_1: ['f_1'], b_2: ['f_2'], b_3: ['f_3'] },
    joints: [['b_1', 'b_2'], ['b_2', 'b_3'], ['b_3', 'b_1'], ['b_2', 'b_1']],
    rootBody: 'b_1',
  });
  assert.deepEqual(outline(hierarchyTree(model)), [
    'root ragdoll',
    '  body b_1',
    '    shape f_1',
    '    joint j_1',
    '      body b_2',
    '        shape f_2',
    '        joint j_2 loop→b_3',
    '        joint j_4 loop→b_1',
    '    joint j_3',
    '      body b_3',
    '        shape f_3',
  ]);
});

test('hierarchyTree: loopTo is the bodyB name or id on loop leaves and null elsewhere; it is never searched', () => {
  const { model } = build({
    bodies: { b_1: ['f_1'], b_2: ['f_2'], b_3: ['f_3'] },
    joints: [['b_1', 'b_2'], ['b_1', 'b_3'], ['b_2', 'b_3']],
    rootBody: 'b_1',
    names: { b_3: 'forearm' },
  });
  const tree = hierarchyTree(model);
  const items = [];
  const collect = (item) => {
    items.push(item);
    item.children.forEach(collect);
  };
  collect(tree);
  const loops = items.filter((item) => item.loop);
  assert.deepEqual(loops.map((item) => [item.label, item.loopTo]), [['j_3', 'forearm']]);
  assert.ok(items.filter((item) => !item.loop).every((item) => item.loopTo === null));
  assert.deepEqual(hierarchyRows(tree, { query: 'fore' }).at(-1).item.kind, 'body');
  assert.ok(hierarchyRows(tree, { query: 'fore' }).every((row) => row.item.kind !== 'joint' || row.dimmed));
});

test('hierarchyTree: unlinked parts are joint trees under the Unlinked group, then unassigned joints', () => {
  const { model } = build({
    bodies: { b_1: ['f_1'], b_4: ['f_4'], b_2: ['f_2'], b_3: ['f_3'], b_5: ['f_5'], b_6: ['f_6'] },
    joints: [[null, null], ['b_3', 'b_4'], ['b_1', 'b_9'], ['b_5', 'b_6'], ['b_6', 'b_2'], ['b_2', 'b_5'], ['b_1', 'b_1'], ['b_1', null]],
    rootBody: 'b_1',
  });
  const tree = hierarchyTree(model);
  assert.deepEqual(outline(tree), [
    'root ragdoll',
    '  body b_1',
    '    shape f_1',
    '  unlinked Unlinked',
    '    body b_4',
    '      shape f_4',
    '      joint j_2',
    '        body b_3',
    '          shape f_3',
    '    body b_2',
    '      shape f_2',
    '      joint j_5',
    '        body b_6',
    '          shape f_6',
    '      joint j_6',
    '        body b_5',
    '          shape f_5',
    '          joint j_4 loop→b_6',
    '    joint j_1 unassigned',
    '    joint j_3 unassigned',
    '    joint j_7 unassigned',
    '    joint j_8 unassigned',
  ]);
  const group = tree.children[1];
  assert.deepEqual([group.key, group.uid, group.name, group.id, group.loopTo], [UNLINKED_KEY, null, '', null, null]);
});

test('hierarchyTree: no Unlinked group when everything is linked; rootBody null puts every body in it', () => {
  const linked = build({ bodies: { b_1: ['f_1'], b_2: ['f_2'] }, joints: [['b_1', 'b_2']], rootBody: 'b_1' });
  assert.ok(hierarchyTree(linked.model).children.every((item) => item.kind !== 'unlinked'));
  const loose = build({ bodies: { b_1: ['f_1'], b_2: ['f_2'] }, joints: [['b_1', 'b_2']], rootBody: null });
  assert.deepEqual(outline(hierarchyTree(loose.model)), [
    'root ragdoll',
    '  unlinked Unlinked',
    '    body b_1',
    '      shape f_1',
    '      joint j_1',
    '        body b_2',
    '          shape f_2',
  ]);
});

test('hierarchyTree: every body, shape and joint has exactly one item', () => {
  const { model } = build({
    bodies: { b_1: ['f_1'], b_2: ['f_2', 'f_3'], b_3: ['f_4'], b_4: ['f_5'] },
    joints: [['b_1', 'b_2'], ['b_2', 'b_3'], ['b_3', 'b_1'], ['b_4', null], ['b_4', 'b_4']],
    rootBody: 'b_1',
  });
  const uids = [];
  const collect = (item) => {
    if (item.uid !== null) uids.push(item.uid);
    item.children.forEach(collect);
  };
  collect(hierarchyTree(model));
  const expected = [
    ROOT_UID,
    ...model.children(ROOT_UID, 'bodies').flatMap((body) => [body, ...model.children(body, 'fixtures')]),
    ...model.children(ROOT_UID, 'joints'),
  ];
  assert.deepEqual([...uids].sort((a, b) => a - b), [...expected].sort((a, b) => a - b));
});

test('hierarchyTree agrees with jointTree on the rootBody component', () => {
  const { model } = build({
    bodies: { b_1: ['f_1'], b_2: ['f_2'], b_3: ['f_3'], b_4: ['f_4'], b_5: ['f_5'], b_6: ['f_6'] },
    joints: [['b_1', 'b_2'], ['b_1', 'b_3'], ['b_3', 'b_4'], ['b_2', 'b_4'], ['b_4', 'b_5'], ['b_5', 'b_3'], ['b_6', 'b_6']],
    rootBody: 'b_1',
  });
  const expected = jointTree(model);
  const parent = new Map();
  const loops = new Set();
  const walk = (item) => {
    for (const child of item.children) {
      if (child.kind === 'joint' && child.loop) loops.add(child.uid);
      else if (child.kind === 'joint') parent.set(child.children[0].uid, child.uid);
      walk(child);
    }
  };
  walk(hierarchyTree(model).children[0]);
  assert.deepEqual(parent, expected.parent);
  assert.deepEqual(loops, expected.loops);
});

test('hierarchyTree is deep-frozen and new on every call', () => {
  const { model } = build({ bodies: { b_1: ['f_1'] }, rootBody: 'b_1' });
  const first = hierarchyTree(model);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.children));
  assert.ok(Object.isFrozen(first.children[0].children[0]));
  assert.notEqual(hierarchyTree(model), first);
  assert.deepEqual(hierarchyTree(model), first);
});

const CHAIN = {
  bodies: { b_1: ['f_1'], b_2: ['f_2', 'f_3'], b_3: ['f_4'], b_9: ['f_9'] },
  joints: [['b_1', 'b_2'], ['b_1', 'b_3'], [null, null]],
  rootBody: 'b_1',
  names: { b_1: 'torso', b_2: 'upper arm', f_2: 'knee_l', f_3: 'knee_r', j_1: 'shoulder' },
};

test('hierarchyRows lists every row in preorder with levels, positions and parents', () => {
  const { model } = build(CHAIN);
  const rows = hierarchyRows(hierarchyTree(model));
  assert.deepEqual(rowLines(rows), [
    'ragdoll',
    '  torso',
    '    f_1',
    '    shoulder',
    '      upper arm',
    '        knee_l',
    '        knee_r',
    '    j_2',
    '      b_3',
    '        f_4',
    '  Unlinked',
    '    b_9',
    '      f_9',
    '    j_3',
  ]);
  assert.deepEqual(
    rows.map((row) => [row.posInSet, row.setSize, row.parentIndex]),
    [[1, 1, -1], [1, 2, 0], [1, 3, 1], [2, 3, 1], [1, 1, 3], [1, 2, 4], [2, 2, 4], [3, 3, 1], [1, 1, 7], [1, 1, 8], [2, 2, 0], [1, 2, 10], [1, 1, 11], [2, 2, 10]],
  );
  assert.deepEqual(
    rows.filter((row) => !row.expandable).map((row) => row.item.label),
    ['f_1', 'knee_l', 'knee_r', 'f_4', 'f_9', 'j_3'],
  );
  assert.ok(rows.every((row) => row.match === null && row.dimmed === false));
  assert.ok(rows.every((row) => row.expanded === row.expandable));
});

test('hierarchyRows hides the descendants of collapsed rows', () => {
  const { model, uids } = build(CHAIN);
  const tree = hierarchyTree(model);
  const rows = hierarchyRows(tree, { collapsed: new Set([String(uids.j_1), UNLINKED_KEY]) });
  assert.deepEqual(rowLines(rows), ['ragdoll', '  torso', '    f_1', '    shoulder', '    j_2', '      b_3', '        f_4', '  Unlinked']);
  const shoulder = rows[3];
  assert.deepEqual([shoulder.expandable, shoulder.expanded], [true, false]);
  assert.deepEqual(rowLines(hierarchyRows(tree, { collapsed: new Set([String(ROOT_UID)]) })), ['ragdoll']);
});

test('hierarchyRows with a query keeps matches and their dimmed ancestors, expanded', () => {
  const { model, uids } = build(CHAIN);
  const tree = hierarchyTree(model);
  const rows = hierarchyRows(tree, { query: 'knl', collapsed: new Set() });
  assert.deepEqual(rowLines(rows), ['ragdoll', '  torso', '    shoulder', '      upper arm', '        knee_l']);
  assert.deepEqual(rows.map((row) => row.dimmed), [true, true, true, true, false]);
  assert.deepEqual(rows[4].match, { field: 'label', indices: [0, 1, 5] });
  assert.deepEqual(rows.map((row) => [row.posInSet, row.setSize]), [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1]]);
  assert.deepEqual([rows[3].expandable, rows[3].expanded], [true, true]);
  assert.deepEqual(rowLines(hierarchyRows(tree, { query: '  KNEE ' })).slice(-2), ['        knee_l', '        knee_r']);
  const collapsed = hierarchyRows(tree, { query: 'knl', collapsed: new Set([String(uids.j_1)]) });
  assert.deepEqual(rowLines(collapsed), ['ragdoll', '  torso', '    shoulder']);
});

test('hierarchyRows matches ids when the label does not match', () => {
  const { model } = build(CHAIN);
  const rows = hierarchyRows(hierarchyTree(model), { query: 'b2' });
  assert.deepEqual(rowLines(rows), ['ragdoll', '  torso', '    shoulder', '      upper arm']);
  assert.deepEqual(rows[3].match, { field: 'id', indices: [0, 2] });
  assert.equal(rows[3].dimmed, false);
  assert.equal(rows[3].expandable, false);
  const byLabel = hierarchyRows(hierarchyTree(model), { query: 'f4' });
  assert.deepEqual(byLabel.at(-1).match, { field: 'label', indices: [0, 2] });
});

test('hierarchyRows: the Unlinked group never matches, and no match gives no rows', () => {
  const { model } = build(CHAIN);
  const tree = hierarchyTree(model);
  assert.deepEqual(hierarchyRows(tree, { query: 'Unlinked' }), []);
  assert.deepEqual(hierarchyRows(tree, { query: 'zzz' }), []);
  const rows = hierarchyRows(tree, { query: 'j3' });
  assert.deepEqual(rowLines(rows), ['ragdoll', '  Unlinked', '    j_3']);
  assert.deepEqual(rows.map((row) => row.dimmed), [true, true, false]);
  assert.equal(rows[0].match, null);
  assert.equal(hierarchyRows(tree, { query: 'rag' })[0].dimmed, false);
});

test('fuzzyMatch finds the leftmost ordered characters, ignoring case and spaces', () => {
  const cases = [
    ['knl', 'knee_l', [0, 1, 5]],
    ['', 'anything', []],
    ['   ', 'x', []],
    ['KN', 'knee', [0, 1]],
    ['k n', 'knee_l', [0, 1]],
    ['ee', 'knee', [2, 3]],
    ['b2', 'B_2', [0, 2]],
    ['lk', 'knee_l', null],
    ['abc', 'ab', null],
    ['a', '', null],
    ['a', null, null],
  ];
  for (const [query, text, expected] of cases) assert.deepEqual(fuzzyMatch(query, text), expected, `${query} / ${text}`);
});

test('ancestorKeys lists the keys above an item, root first', () => {
  const { model, uids } = build(CHAIN);
  const tree = hierarchyTree(model);
  const root = String(ROOT_UID);
  assert.deepEqual(ancestorKeys(tree, uids.f_3), [root, String(uids.b_1), String(uids.j_1), String(uids.b_2)]);
  assert.deepEqual(ancestorKeys(tree, uids.f_9), [root, UNLINKED_KEY, String(uids.b_9)]);
  assert.deepEqual(ancestorKeys(tree, uids.j_3), [root, UNLINKED_KEY]);
  assert.deepEqual(ancestorKeys(tree, uids.b_1), [root]);
  assert.deepEqual(ancestorKeys(tree, ROOT_UID), []);
  assert.deepEqual(ancestorKeys(tree, 999), []);
});
