import { ROOT_UID } from './model.js';
import { jointEdges } from './queries.js';

/**
 * Key of the Unlinked group item.
 * @type {string}
 */
export const UNLINKED_KEY = 'unlinked';

/**
 * One item of the Hierarchy tree: the root, a body, a shape, a joint or the Unlinked group.
 * @typedef {object} HierarchyItem
 * @property {string} key `String(uid)` for objects, {@link UNLINKED_KEY} for the group.
 * @property {'root'|'body'|'shape'|'joint'|'unlinked'} kind Item kind.
 * @property {number|null} uid Node uid, `null` for the group.
 * @property {string} name The `name` prop, `''` when absent or not a string, `''` for the group.
 * @property {string|null} id The `id` prop, `null` when absent and for the group.
 * @property {string} label Name, or id when the name is empty; `'Unlinked'` for the group.
 * @property {'circle'|'box'|'polygon'|null} shapeType Shape type for shapes, else `null`.
 * @property {boolean} loop Joint leaf that closes a cycle.
 * @property {string|null} loopTo For loop leaves, the label of the joint's bodyB; else `null`. Never searched.
 * @property {boolean} unassigned Joint that does not connect two different existing bodies.
 * @property {boolean} rootBody The body named by `rootBody`.
 * @property {ReadonlyArray<HierarchyItem>} children Child items, in display order.
 */

/**
 * One visible row of the Hierarchy tree.
 * @typedef {object} HierarchyRow
 * @property {HierarchyItem} item Item shown.
 * @property {number} level Depth, 1 for the root.
 * @property {number} posInSet 1-based position among its visible siblings.
 * @property {number} setSize Number of visible siblings, itself included.
 * @property {number} parentIndex Index of the parent row, -1 for the root.
 * @property {boolean} expandable Whether the item has visible children.
 * @property {boolean} expanded Whether it is expandable and not collapsed.
 * @property {{ field: 'label'|'id', indices: number[] }|null} match What matched the query, `null` without one.
 * @property {boolean} dimmed Whether, with a query, the row is shown only as an ancestor of a match.
 */

function deepFreeze(item) {
  for (const child of item.children) deepFreeze(child);
  Object.freeze(item.children);
  return Object.freeze(item);
}

function namesOf(props) {
  const name = typeof props.name === 'string' ? props.name : '';
  const id = typeof props.id === 'string' ? props.id : null;
  return { name, id, label: name !== '' ? name : (id ?? '') };
}

function labelOf(model, uid) {
  return namesOf(model.get(uid).props).label;
}

function objectItem(model, uid, kind, extra = {}) {
  const { props } = model.get(uid);
  const { name, id, label } = namesOf(props);
  return {
    key: String(uid),
    kind,
    uid,
    name,
    id,
    label,
    shapeType: kind === 'shape' ? (props.shape?.type ?? null) : null,
    loop: false,
    loopTo: null,
    unassigned: false,
    rootBody: false,
    children: [],
    ...extra,
  };
}

function componentItem(model, edges, start, placed) {
  const treeJoints = new Map();
  const members = new Set([start]);
  placed.add(start);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const body = queue[head];
    for (const edge of edges) {
      if (edge.a !== body && edge.b !== body) continue;
      const other = edge.a === body ? edge.b : edge.a;
      if (placed.has(other)) continue;
      placed.add(other);
      members.add(other);
      treeJoints.set(edge.uid, { parent: body, child: other });
      queue.push(other);
    }
  }
  const loops = new Set(
    edges.filter((edge) => !treeJoints.has(edge.uid) && members.has(edge.a) && members.has(edge.b)).map((edge) => edge.uid),
  );
  const bodyItem = (body) => {
    const shapes = model.children(body, 'fixtures').map((uid) => objectItem(model, uid, 'shape'));
    const joints = [];
    for (const edge of edges) {
      const tree = treeJoints.get(edge.uid);
      if (tree?.parent === body) {
        joints.push(objectItem(model, edge.uid, 'joint', { children: [bodyItem(tree.child)] }));
      } else if (loops.has(edge.uid) && edge.a === body) {
        joints.push(objectItem(model, edge.uid, 'joint', { loop: true, loopTo: labelOf(model, edge.b) }));
      }
    }
    return objectItem(model, body, 'body', { children: [...shapes, ...joints] });
  };
  return bodyItem(start);
}

function rootBodyUid(model) {
  const id = model.prop(ROOT_UID, 'rootBody');
  if (typeof id !== 'string') return null;
  const uid = model.uidOf(id);
  return uid !== null && model.get(uid).type === 'body' ? uid : null;
}

/**
 * Builds the Hierarchy tree: the root, the joint tree from `rootBody`, then the Unlinked group with the other
 * joint trees and the unassigned joints. Every body, shape and joint has exactly one item.
 * @param {import('./model.js').Model} model Document model.
 * @returns {Readonly<HierarchyItem>} The root item, deep-frozen and new on every call.
 */
export function hierarchyTree(model) {
  const edges = jointEdges(model);
  const placed = new Set();
  const root = objectItem(model, ROOT_UID, 'root');
  const start = rootBodyUid(model);
  if (start !== null) {
    const tree = componentItem(model, edges, start, placed);
    root.children.push({ ...tree, rootBody: true });
  }
  const group = {
    key: UNLINKED_KEY,
    kind: 'unlinked',
    uid: null,
    name: '',
    id: null,
    label: 'Unlinked',
    shapeType: null,
    loop: false,
    loopTo: null,
    unassigned: false,
    rootBody: false,
    children: [],
  };
  for (const body of model.children(ROOT_UID, 'bodies')) {
    if (!placed.has(body)) group.children.push(componentItem(model, edges, body, placed));
  }
  const edgeUids = new Set(edges.map((edge) => edge.uid));
  for (const joint of model.children(ROOT_UID, 'joints')) {
    if (!edgeUids.has(joint)) group.children.push(objectItem(model, joint, 'joint', { unassigned: true }));
  }
  if (group.children.length > 0) root.children.push(group);
  return deepFreeze(root);
}

/**
 * Fuzzy-matches a query against a text: the query characters, spaces removed, must appear in the text in the same
 * order, compared case-insensitively.
 * @param {string} query Search query.
 * @param {string|null} text Text to search.
 * @returns {number[]|null} Indices in `text` of the leftmost greedy match, `[]` for an empty query, or `null`.
 */
export function fuzzyMatch(query, text) {
  const wanted = String(query ?? '').replace(/\s+/g, '');
  if (wanted === '') return [];
  const source = typeof text === 'string' ? text : '';
  const indices = [];
  let next = 0;
  for (let index = 0; index < source.length && next < wanted.length; index++) {
    if (source[index].toLowerCase() === wanted[next].toLowerCase()) {
      indices.push(index);
      next++;
    }
  }
  return next === wanted.length ? indices : null;
}

function matchOf(item, query) {
  if (item.kind === 'unlinked') return null;
  const label = fuzzyMatch(query, item.label);
  if (label !== null) return { field: 'label', indices: label };
  const id = item.id === null ? null : fuzzyMatch(query, item.id);
  return id === null ? null : { field: 'id', indices: id };
}

function keptTree(item, query) {
  const children = item.children.map((child) => keptTree(child, query)).filter((child) => child !== null);
  const match = matchOf(item, query);
  if (match === null && children.length === 0) return null;
  return { item, match, children };
}

function plainTree(item) {
  return { item, match: null, children: item.children.map(plainTree) };
}

/**
 * Lists the visible rows of a Hierarchy tree in preorder. Without a query every item whose ancestors are expanded
 * is visible. With a query only matching items and their ancestors are kept, ancestors that do not match are
 * dimmed, and `collapsed` applies to the kept items.
 * @param {Readonly<HierarchyItem>} tree Root item from {@link hierarchyTree}.
 * @param {{ collapsed?: ReadonlySet<string>, query?: string }} [options] Collapsed item keys and search query.
 * @returns {HierarchyRow[]} Visible rows; `[]` when a query matches nothing.
 */
export function hierarchyRows(tree, { collapsed = new Set(), query = '' } = {}) {
  const trimmed = String(query ?? '').trim();
  const searching = trimmed !== '';
  const top = searching ? keptTree(tree, trimmed) : plainTree(tree);
  const rows = [];
  const visit = (node, level, posInSet, setSize, parentIndex) => {
    const expandable = node.children.length > 0;
    const expanded = expandable && !collapsed.has(node.item.key);
    const index = rows.length;
    rows.push({
      item: node.item,
      level,
      posInSet,
      setSize,
      parentIndex,
      expandable,
      expanded,
      match: node.match,
      dimmed: searching && node.match === null,
    });
    if (!expanded) return;
    node.children.forEach((child, position) => visit(child, level + 1, position + 1, node.children.length, index));
  };
  if (top !== null) visit(top, 1, 1, 1, -1);
  return rows;
}

/**
 * Lists the keys of an item's ancestors.
 * @param {Readonly<HierarchyItem>} tree Root item from {@link hierarchyTree}.
 * @param {number} uid Uid of the item.
 * @returns {string[]} Ancestor keys, root first, without the item; `[]` when no item has `uid`.
 */
export function ancestorKeys(tree, uid) {
  const path = [];
  const find = (item) => {
    if (item.uid === uid) return true;
    path.push(item.key);
    if (item.children.some(find)) return true;
    path.pop();
    return false;
  };
  return find(tree) ? path : [];
}
