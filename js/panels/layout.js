/**
 * @typedef {'tools' | 'hierarchy' | 'assets' | 'problems' | 'inspector' | 'timeline'} PanelId
 */

/**
 * @typedef {object} PanelSpec
 * @property {string} title Tab and menu label.
 * @property {string} group Default stack the panel belongs to.
 * @property {'left' | 'right' | 'top' | 'bottom'} edge Default workspace edge.
 * @property {number} size Default size along the edge axis (px).
 * @property {{ width: number, height: number }} min Minimum size including the tab bar (px).
 */

/**
 * @typedef {object} SplitNode
 * @property {'split'} type
 * @property {'row' | 'column'} dir Axis along which the children are laid out.
 * @property {LayoutNode[]} children
 * @property {(number | null)[]} sizes Child sizes along the axis (px); exactly one `null` marks the fill child.
 */

/**
 * @typedef {object} StackNode
 * @property {'stack'} type
 * @property {string} id Stack id, `s<n>` for generated stacks.
 * @property {PanelId[]} panels Tabs in order.
 * @property {PanelId} active The visible tab.
 */

/**
 * @typedef {SplitNode | StackNode | { type: 'viewport' }} LayoutNode
 */

/**
 * @typedef {object} Layout
 * @property {1} version
 * @property {LayoutNode} tree
 * @property {{ [id: string]: { stackId: string, index: number } }} closed Where each closed panel was.
 */

/**
 * @typedef {{ kind: 'tab', stackId: string, index: number }
 *   | { kind: 'split', stackId: string, side: 'left' | 'right' | 'top' | 'bottom' }
 *   | { kind: 'edge', side: 'left' | 'right' | 'top' | 'bottom' }} Drop
 * A `split` drop with `stackId: 'viewport'` splits the viewport node.
 */

/**
 * @typedef {object} Rect
 * @property {number} x CSS px from the workspace content left edge.
 * @property {number} y CSS px from the workspace content top edge.
 * @property {number} width CSS px.
 * @property {number} height CSS px.
 */

/**
 * @typedef {object} Gutter
 * @property {ReadonlyArray<number>} path Child indexes from the root to the split.
 * @property {number} index The gutter lies between children `index` and `index + 1`.
 * @property {'row' | 'column'} dir Axis of the split.
 * @property {Rect} rect Gutter area (px).
 * @property {number} value Current size of the child the gutter resizes (px).
 * @property {number} min Smallest allowed value (px).
 * @property {number} max Largest allowed value (px).
 */

/**
 * @typedef {object} LayoutRects
 * @property {Map<string, Rect>} stacks Rect of every stack by id.
 * @property {Rect} viewport Rect of the viewport.
 * @property {Gutter[]} gutters Every gutter, in tree order.
 * @property {number} width Content width (px), at least the workspace width.
 * @property {number} height Content height (px), at least the workspace height.
 * @property {Map<string, Rect[]>} [tabs] Measured tab rects per stack, supplied by the caller for {@link dropAt}.
 */

/** Stored layout record version. */
export const LAYOUT_VERSION = 1;

const GUTTER = 4;
const TAB_BAR = 28;
const EDGE_STRIP = 16;
const ZONE_RATIO = 0.25;
const ZONE_MIN = 24;
const ZONE_MAX = 80;
const VIEWPORT_TARGET = 'viewport';
const SIDES = Object.freeze(['left', 'right', 'top', 'bottom']);

/**
 * Panel table from `DESIGN.md` §5.2, in Window menu order.
 * @type {Readonly<Record<PanelId, Readonly<PanelSpec>>>}
 */
export const PANELS = deepFreeze({
  tools: { title: 'Tools', group: 'tools', edge: 'left', size: 72, min: { width: 56, height: 120 } },
  hierarchy: { title: 'Hierarchy', group: 'hap', edge: 'right', size: 300, min: { width: 200, height: 96 } },
  assets: { title: 'Assets', group: 'hap', edge: 'right', size: 300, min: { width: 200, height: 96 } },
  problems: { title: 'Problems', group: 'hap', edge: 'right', size: 300, min: { width: 200, height: 96 } },
  inspector: { title: 'Inspector', group: 'inspector', edge: 'right', size: 300, min: { width: 200, height: 96 } },
  timeline: { title: 'Timeline', group: 'timeline', edge: 'bottom', size: 220, min: { width: 320, height: 120 } },
});

/** Minimum viewport size (px). */
export const VIEWPORT_MIN = Object.freeze({ width: 240, height: 160 });

const PANEL_IDS = Object.freeze(Object.keys(PANELS));

/**
 * Builds the default layout of `DESIGN.md` §5.2.
 * @param {{ width: number, height: number }} workspace Workspace size (px); the Hierarchy stack starts at half the right column.
 * @returns {Readonly<Layout>}
 */
export function defaultLayout(workspace) {
  const timeline = PANELS.timeline.size;
  const rightColumn = workspace.height - timeline - GUTTER;
  const hapHeight = Math.max(PANELS.hierarchy.min.height, Math.floor((rightColumn - GUTTER) / 2));
  return normalize({
    version: LAYOUT_VERSION,
    tree: split('column', [
      split('row', [
        stack('s1', ['tools']),
        { type: 'viewport' },
        split('column', [stack('s2', ['hierarchy', 'assets', 'problems']), stack('s3', ['inspector'])], [hapHeight, null]),
      ], [PANELS.tools.size, null, PANELS.inspector.size]),
      stack('s4', ['timeline']),
    ], [null, timeline]),
    closed: {},
  });
}

/**
 * Normalizes a structurally valid layout: drops empty stacks, collapses single-child splits,
 * flattens nested splits of the same direction, gives freed space to the previous sibling (else the next),
 * re-derives the fill child of every split and fixes `active`.
 * @param {Layout} layout
 * @returns {Readonly<Layout>} A new frozen layout.
 */
export function normalize(layout) {
  const closed = {};
  for (const [id, entry] of Object.entries(layout.closed ?? {})) {
    closed[id] = { stackId: entry.stackId, index: entry.index };
  }
  return deepFreeze({
    version: LAYOUT_VERSION,
    tree: normalizeNode(layout.tree) ?? { type: 'viewport' },
    closed,
  });
}

/**
 * Checks a stored layout value.
 * @param {unknown} value Parsed JSON.
 * @returns {string | null} The first reason the value is invalid, or `null` when it is valid.
 */
export function validateLayout(value) {
  if (!isObject(value)) return 'not an object';
  if (value.version !== LAYOUT_VERSION) return `unsupported version ${JSON.stringify(value.version ?? null)}`;
  const state = { panels: new Set(), stacks: new Set(), viewports: 0 };
  const reason = checkNode(value.tree, state);
  if (reason) return reason;
  if (state.viewports !== 1) return 'viewport must appear exactly once';
  if (!isObject(value.closed)) return 'closed is not an object';
  for (const [id, entry] of Object.entries(value.closed)) {
    if (!Object.hasOwn(PANELS, id)) return `unknown panel id "${id}"`;
    if (state.panels.has(id)) return `repeated panel id "${id}"`;
    state.panels.add(id);
    if (!isObject(entry) || typeof entry.stackId !== 'string' || !Number.isInteger(entry.index) || entry.index < 0) {
      return `malformed closed entry for "${id}"`;
    }
  }
  return null;
}

/**
 * Restores a stored layout, falling back to the default when it is invalid.
 * Panels missing from both `tree` and `closed` are added by the reopen rule.
 * @param {unknown} value Parsed stored value.
 * @param {{ width: number, height: number }} workspace Workspace size (px).
 * @returns {{ layout: Readonly<Layout>, warning: string | null }}
 */
export function restoreLayout(value, workspace) {
  const reason = validateLayout(value);
  if (reason) return { layout: defaultLayout(workspace), warning: `Stored layout ignored: ${reason}` };
  let layout = normalize(value);
  for (const id of PANEL_IDS) {
    if (!findPanel(layout.tree, id) && !Object.hasOwn(layout.closed, id)) layout = openPanel(layout, id, workspace);
  }
  return { layout, warning: null };
}

/**
 * Makes an open panel the active tab of its stack.
 * @param {Layout} layout
 * @param {PanelId} id
 * @returns {Readonly<Layout>}
 * @throws {Error} When the panel is unknown or closed.
 */
export function activatePanel(layout, id) {
  assertPanel(id);
  const next = structuredClone(layout);
  const location = findPanel(next.tree, id);
  if (!location) throw new Error(`Panel is not open: ${id}`);
  location.stack.active = id;
  return normalize(next);
}

/**
 * Closes an open panel and records its stack and index for reopening.
 * @param {Layout} layout
 * @param {PanelId} id
 * @returns {Readonly<Layout>}
 * @throws {Error} When the panel is unknown or already closed.
 */
export function closePanel(layout, id) {
  assertPanel(id);
  const next = structuredClone(layout);
  const location = findPanel(next.tree, id);
  if (!location) throw new Error(`Panel is not open: ${id}`);
  detachPanel(location);
  next.closed[id] = { stackId: location.stack.id, index: location.index };
  return normalize(next);
}

/**
 * Reopens a panel by the reopen rule and activates it: its previous stack and index if that stack exists,
 * else a stack holding a panel of its default group, else its default workspace edge.
 * @param {Layout} layout
 * @param {PanelId} id
 * @param {{ width: number, height: number }} workspace Workspace size (px).
 * @returns {Readonly<Layout>}
 * @throws {Error} When the panel is unknown or already open.
 */
export function openPanel(layout, id, workspace) {
  assertPanel(id);
  if (findPanel(layout.tree, id)) throw new Error(`Panel is already open: ${id}`);
  const next = structuredClone(layout);
  const record = next.closed[id];
  delete next.closed[id];
  const previous = record ? findStack(next.tree, record.stackId) : null;
  if (previous) {
    previous.panels.splice(Math.min(record.index, previous.panels.length), 0, id);
    previous.active = id;
    return normalize(next);
  }
  const groupStack = findGroupStack(next.tree, PANELS[id].group);
  if (groupStack) {
    groupStack.panels.push(id);
    groupStack.active = id;
    return normalize(next);
  }
  dockAtEdge(next, id, PANELS[id].edge, workspace);
  return normalize(next);
}

/**
 * Tells whether an open panel can be moved with a drop.
 * Refused: closed or unknown panels, malformed drops, missing stacks, tabbing onto the viewport,
 * and the panel's own stack when it is its only tab.
 * @param {Layout} layout
 * @param {PanelId} id
 * @param {Drop} drop
 * @returns {boolean}
 */
export function canDrop(layout, id, drop) {
  if (!Object.hasOwn(PANELS, id) || !isObject(drop)) return false;
  const source = findPanel(layout.tree, id);
  if (!source) return false;
  if (drop.kind === 'edge') return SIDES.includes(drop.side);
  if (drop.kind !== 'tab' && drop.kind !== 'split') return false;
  if (drop.kind === 'split' && !SIDES.includes(drop.side)) return false;
  if (drop.stackId === VIEWPORT_TARGET) return drop.kind === 'split';
  const target = findStack(layout.tree, drop.stackId);
  if (!target) return false;
  if (drop.kind === 'tab' && (!Number.isInteger(drop.index) || drop.index < 0 || drop.index > target.panels.length)) {
    return false;
  }
  return !(target.id === source.stack.id && target.panels.length === 1);
}

/**
 * Moves an open panel with a drop accepted by {@link canDrop}, and activates it.
 * @param {Layout} layout
 * @param {PanelId} id
 * @param {Drop} drop
 * @param {{ width: number, height: number }} workspace Workspace size (px).
 * @returns {Readonly<Layout>}
 * @throws {Error} When the panel is unknown or the drop is refused.
 */
export function movePanel(layout, id, drop, workspace) {
  assertPanel(id);
  if (!canDrop(layout, id, drop)) throw new Error(`Drop not allowed for panel ${id}`);
  const next = structuredClone(layout);
  const source = findPanel(next.tree, id);
  if (drop.kind === 'tab') {
    const target = findStack(next.tree, drop.stackId);
    const index = target === source.stack && source.index < drop.index ? drop.index - 1 : drop.index;
    detachPanel(source);
    target.panels.splice(index, 0, id);
    target.active = id;
    return normalize(next);
  }
  if (drop.kind === 'edge') {
    detachPanel(source);
    dockAtEdge(next, id, drop.side, workspace);
    return normalize(next);
  }
  const rects = computeRects(layout, workspace);
  const targetRect = drop.stackId === VIEWPORT_TARGET ? rects.viewport : rects.stacks.get(drop.stackId);
  detachPanel(source);
  const target = drop.stackId === VIEWPORT_TARGET ? findViewport(next.tree) : findStack(next.tree, drop.stackId);
  const dir = axisDir(drop.side);
  const sizes = splitSizes(targetRect[axisKey(dir)], PANELS[id].min[axisKey(dir)], minSize(target)[axisKey(dir)]);
  const moved = stack(nextStackId(next), [id]);
  const first = drop.side === 'left' || drop.side === 'top';
  const replacement = split(
    dir,
    first ? [moved, target] : [target, moved],
    first ? [sizes.moved, sizes.target] : [sizes.target, sizes.moved],
  );
  next.tree = replaceNode(next.tree, target, replacement);
  return normalize(next);
}

/**
 * Sets the size of the child controlled by a gutter, clamped to the gutter's `[min, max]`.
 * The gutter resizes child `index` when the fill child comes after it, else child `index + 1`.
 * @param {Layout} layout
 * @param {ReadonlyArray<number>} path Child indexes from the root to the split.
 * @param {number} index Gutter index inside the split.
 * @param {number} value Requested size (px).
 * @param {{ width: number, height: number }} workspace Workspace size (px).
 * @returns {Readonly<Layout>}
 * @throws {Error} When the path, index or value is invalid.
 */
export function resizeSplit(layout, path, index, value, workspace) {
  const node = nodeAt(layout.tree, path);
  if (!node || node.type !== 'split') throw new Error(`No split at path [${path.join(', ')}]`);
  if (!Number.isInteger(index) || index < 0 || index >= node.children.length - 1) {
    throw new Error(`No gutter ${index} in split [${path.join(', ')}]`);
  }
  if (!Number.isFinite(value)) throw new Error('Split size must be a finite number');
  const gutter = computeRects(layout, workspace).gutters.find(
    (candidate) => candidate.index === index && samePath(candidate.path, path),
  );
  const next = structuredClone(layout);
  const target = nodeAt(next.tree, path);
  target.sizes[controlledChild(target, index)] = Math.round(Math.min(gutter.max, Math.max(gutter.min, value)));
  return normalize(next);
}

/**
 * Computes the rectangles of every stack, the viewport and every gutter.
 * Fixed children get their size and the fill child the rest; when the fill falls below its minimum the others
 * shrink in proportion to their size above their own minimum, and the content grows past the workspace when the
 * minimums do not fit.
 * @param {Layout} layout
 * @param {{ width: number, height: number }} workspace Workspace size (px).
 * @returns {LayoutRects}
 */
export function computeRects(layout, workspace) {
  const min = minSize(layout.tree);
  const width = Math.max(workspace.width, min.width);
  const height = Math.max(workspace.height, min.height);
  const out = { stacks: new Map(), viewport: null, gutters: [], width, height };
  placeNode(layout.tree, { x: 0, y: 0, width, height }, [], out);
  return out;
}

/**
 * Finds the drop under a point while dragging a panel tab: workspace edge strips first, then a stack's tab bar,
 * then stack (or viewport) edge zones, then the stack center.
 * @param {Layout} layout
 * @param {LayoutRects} rects Result of {@link computeRects}, optionally with measured `tabs`.
 * @param {{ x: number, y: number }} point Pointer position (px, workspace content coordinates).
 * @param {PanelId} panelId The dragged panel.
 * @returns {{ drop: Drop, preview: Rect } | null} `null` when nothing can be docked there.
 */
export function dropAt(layout, rects, point, panelId) {
  if (!inside(point, { x: 0, y: 0, width: rects.width, height: rects.height })) return null;
  const result = edgeDrop(rects, point, panelId) ?? stackDrop(layout, rects, point, panelId) ?? viewportDrop(rects, point, panelId);
  if (!result || !canDrop(layout, panelId, result.drop)) return null;
  return result;
}

function edgeDrop(rects, point, panelId) {
  const distances = [
    ['left', point.x],
    ['right', rects.width - point.x],
    ['top', point.y],
    ['bottom', rects.height - point.y],
  ].filter(([, distance]) => distance < EDGE_STRIP);
  if (distances.length === 0) return null;
  const [side] = distances.reduce((best, entry) => (entry[1] < best[1] ? entry : best));
  const size = edgeSize(panelId, side, rects);
  const previews = {
    left: { x: 0, y: 0, width: size, height: rects.height },
    right: { x: rects.width - size, y: 0, width: size, height: rects.height },
    top: { x: 0, y: 0, width: rects.width, height: size },
    bottom: { x: 0, y: rects.height - size, width: rects.width, height: size },
  };
  return { drop: { kind: 'edge', side }, preview: previews[side] };
}

function stackDrop(layout, rects, point, panelId) {
  for (const [stackId, rect] of rects.stacks) {
    if (!inside(point, rect)) continue;
    const target = findStack(layout.tree, stackId);
    if (!target) return null;
    if (point.y < rect.y + TAB_BAR) return tabBarDrop(target, rect, rects.tabs?.get(stackId), point);
    const side = zoneSide(point, rect);
    if (side) return splitDrop(stackId, rect, side, panelId, minSize(withoutPanel(target, panelId)));
    return { drop: { kind: 'tab', stackId, index: target.panels.length }, preview: { ...rect } };
  }
  return null;
}

function viewportDrop(rects, point, panelId) {
  if (!rects.viewport || !inside(point, rects.viewport)) return null;
  const side = zoneSide(point, rects.viewport);
  return side ? splitDrop(VIEWPORT_TARGET, rects.viewport, side, panelId, VIEWPORT_MIN) : null;
}

function tabBarDrop(target, rect, tabs, point) {
  const bar = { x: rect.x, y: rect.y, width: rect.width, height: TAB_BAR };
  if (!tabs || tabs.length === 0) {
    return { drop: { kind: 'tab', stackId: target.id, index: target.panels.length }, preview: bar };
  }
  const index = tabs.filter((tab) => tab.x + tab.width / 2 < point.x).length;
  const last = tabs[tabs.length - 1];
  const caretX = index < tabs.length ? tabs[index].x : last.x + last.width;
  return {
    drop: { kind: 'tab', stackId: target.id, index },
    preview: { x: caretX - 1, y: rect.y, width: 2, height: TAB_BAR },
  };
}

function splitDrop(stackId, rect, side, panelId, targetMin) {
  const dir = axisDir(side);
  const key = axisKey(dir);
  const { moved } = splitSizes(rect[key], PANELS[panelId].min[key], targetMin[key]);
  const previews = {
    left: { x: rect.x, y: rect.y, width: moved, height: rect.height },
    right: { x: rect.x + rect.width - moved, y: rect.y, width: moved, height: rect.height },
    top: { x: rect.x, y: rect.y, width: rect.width, height: moved },
    bottom: { x: rect.x, y: rect.y + rect.height - moved, width: rect.width, height: moved },
  };
  return { drop: { kind: 'split', stackId, side }, preview: previews[side] };
}

function zoneSide(point, rect) {
  const zoneX = clamp(rect.width * ZONE_RATIO, ZONE_MIN, ZONE_MAX);
  const zoneY = clamp(rect.height * ZONE_RATIO, ZONE_MIN, ZONE_MAX);
  const candidates = [
    ['left', (point.x - rect.x) / zoneX],
    ['right', (rect.x + rect.width - point.x) / zoneX],
    ['top', (point.y - rect.y) / zoneY],
    ['bottom', (rect.y + rect.height - point.y) / zoneY],
  ].filter(([, ratio]) => ratio < 1);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, entry) => (entry[1] < best[1] ? entry : best))[0];
}

function splitSizes(extent, movedMin, targetMin) {
  const half = Math.floor((extent - GUTTER) / 2);
  const moved = Math.max(movedMin, Math.min(half, extent - GUTTER - targetMin));
  const target = Math.max(targetMin, extent - GUTTER - moved);
  return { moved, target };
}

function edgeSize(panelId, side, workspace) {
  const key = axisKey(axisDir(side));
  const spec = PANELS[panelId];
  return Math.max(spec.min[key], Math.min(spec.size, Math.floor(workspace[key] / 3)));
}

function dockAtEdge(layout, id, side, workspace) {
  const moved = stack(nextStackId(layout), [id]);
  const size = edgeSize(id, side, workspace);
  const first = side === 'left' || side === 'top';
  layout.tree = split(
    axisDir(side),
    first ? [moved, layout.tree] : [layout.tree, moved],
    first ? [size, null] : [null, size],
  );
}

function placeNode(node, rect, path, out) {
  if (node.type === 'viewport') {
    out.viewport = rect;
    return;
  }
  if (node.type === 'stack') {
    out.stacks.set(node.id, rect);
    return;
  }
  const key = axisKey(node.dir);
  const start = node.dir === 'row' ? 'x' : 'y';
  const mins = node.children.map((child) => minSize(child)[key]);
  const extents = distribute(node, rect[key], mins);
  const fillIndex = node.sizes.indexOf(null);
  let cursor = rect[start];
  node.children.forEach((child, index) => {
    placeNode(child, { ...rect, [start]: cursor, [key]: extents[index] }, [...path, index], out);
    cursor += extents[index];
    if (index === node.children.length - 1) return;
    const controlled = controlledChild(node, index);
    out.gutters.push({
      path: Object.freeze([...path]),
      index,
      dir: node.dir,
      rect: { ...rect, [start]: cursor, [key]: GUTTER },
      value: extents[controlled],
      min: mins[controlled],
      max: extents[controlled] + Math.max(0, extents[fillIndex] - mins[fillIndex]),
    });
    cursor += GUTTER;
  });
}

function distribute(node, extent, mins) {
  const fillIndex = node.sizes.indexOf(null);
  const available = extent - GUTTER * (node.children.length - 1);
  const sizes = node.sizes.map((size, index) => (index === fillIndex ? 0 : Math.max(mins[index], Math.round(size))));
  let fill = available - sum(sizes);
  if (fill < mins[fillIndex]) {
    const deficit = mins[fillIndex] - fill;
    const slack = sizes.map((size, index) => (index === fillIndex ? 0 : size - mins[index]));
    const totalSlack = sum(slack);
    if (totalSlack > 0) {
      const ratio = Math.min(1, deficit / totalSlack);
      slack.forEach((amount, index) => {
        sizes[index] -= Math.min(amount, Math.ceil(amount * ratio));
      });
    }
    fill = Math.max(mins[fillIndex], available - sum(sizes));
  }
  sizes[fillIndex] = fill;
  return sizes;
}

function minSize(node) {
  if (node.type === 'viewport') return VIEWPORT_MIN;
  if (node.type === 'stack') {
    return node.panels.reduce(
      (min, id) => ({ width: Math.max(min.width, PANELS[id].min.width), height: Math.max(min.height, PANELS[id].min.height) }),
      { width: 0, height: 0 },
    );
  }
  const along = axisKey(node.dir);
  const across = along === 'width' ? 'height' : 'width';
  const mins = node.children.map(minSize);
  return {
    [along]: sum(mins.map((min) => min[along])) + GUTTER * (mins.length - 1),
    [across]: Math.max(...mins.map((min) => min[across])),
  };
}

function normalizeNode(node) {
  if (node.type === 'viewport') return { type: 'viewport' };
  if (node.type === 'stack') {
    if (node.panels.length === 0) return null;
    return {
      type: 'stack',
      id: node.id,
      panels: [...node.panels],
      active: node.panels.includes(node.active) ? node.active : node.panels[0],
    };
  }
  const kept = [];
  const keptSizes = [];
  let carry = 0;
  node.children.forEach((child, index) => {
    const normalized = normalizeNode(child);
    const size = node.sizes[index] ?? null;
    if (!normalized) {
      const freed = typeof size === 'number' ? size + GUTTER : 0;
      if (kept.length > 0) keptSizes[kept.length - 1] = grow(keptSizes[kept.length - 1], freed);
      else carry += freed;
      return;
    }
    kept.push(normalized);
    keptSizes.push(grow(size, carry));
    carry = 0;
  });
  const children = [];
  const sizes = [];
  kept.forEach((child, index) => {
    if (child.type !== 'split' || child.dir !== node.dir) {
      children.push(child);
      sizes.push(keptSizes[index]);
      return;
    }
    const inner = [...child.sizes];
    const slot = keptSizes[index];
    const innerFill = inner.indexOf(null);
    if (typeof slot === 'number' && innerFill >= 0) {
      const fixed = sum(inner.filter((size) => typeof size === 'number'));
      const innerMin = minSize(child.children[innerFill])[axisKey(node.dir)];
      inner[innerFill] = Math.max(innerMin, slot - fixed - GUTTER * (inner.length - 1));
    }
    children.push(...child.children);
    sizes.push(...inner);
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  const viewportIndex = children.findIndex(containsViewport);
  const fillIndex = viewportIndex >= 0 ? viewportIndex : children.length - 1;
  return {
    type: 'split',
    dir: node.dir,
    children,
    sizes: sizes.map((size, index) => {
      if (index === fillIndex) return null;
      return isPositive(size) ? size : minSize(children[index])[axisKey(node.dir)];
    }),
  };
}

function checkNode(node, state) {
  if (!isObject(node)) return 'malformed node';
  if (node.type === 'viewport') {
    state.viewports += 1;
    return null;
  }
  if (node.type === 'stack') return checkStack(node, state);
  if (node.type !== 'split') return 'malformed node';
  if (node.dir !== 'row' && node.dir !== 'column') return 'malformed split: dir must be "row" or "column"';
  if (!Array.isArray(node.children) || node.children.length === 0) return 'malformed split: no children';
  if (!Array.isArray(node.sizes) || node.sizes.length !== node.children.length) return 'sizes do not match children';
  if (node.sizes.filter((size) => size === null).length !== 1) return 'split must have exactly one null size';
  if (node.sizes.some((size) => size !== null && !isPositive(size))) return 'size must be a finite number > 0';
  for (const child of node.children) {
    const reason = checkNode(child, state);
    if (reason) return reason;
  }
  return null;
}

function checkStack(node, state) {
  if (typeof node.id !== 'string' || node.id === '' || node.id === VIEWPORT_TARGET) return 'malformed stack id';
  if (state.stacks.has(node.id)) return `repeated stack id "${node.id}"`;
  state.stacks.add(node.id);
  if (!Array.isArray(node.panels)) return 'malformed stack: panels must be an array';
  if (node.panels.length === 0) return 'empty stack';
  for (const id of node.panels) {
    if (typeof id !== 'string' || !Object.hasOwn(PANELS, id)) return `unknown panel id ${JSON.stringify(id)}`;
    if (state.panels.has(id)) return `repeated panel id "${id}"`;
    state.panels.add(id);
  }
  if (!node.panels.includes(node.active)) return 'active panel not in its stack';
  return null;
}

function detachPanel(location) {
  const { stack: owner, index } = location;
  const id = owner.panels[index];
  owner.panels.splice(index, 1);
  if (owner.active === id) owner.active = owner.panels[Math.min(index, owner.panels.length - 1)];
}

function withoutPanel(node, id) {
  const panels = node.panels.filter((panel) => panel !== id);
  return { ...node, panels };
}

function findPanel(node, id) {
  if (node.type === 'stack') {
    const index = node.panels.indexOf(id);
    return index >= 0 ? { stack: node, index } : null;
  }
  if (node.type === 'split') {
    for (const child of node.children) {
      const found = findPanel(child, id);
      if (found) return found;
    }
  }
  return null;
}

function findStack(node, stackId) {
  return findNode(node, (candidate) => candidate.type === 'stack' && candidate.id === stackId);
}

function findViewport(node) {
  return findNode(node, (candidate) => candidate.type === 'viewport');
}

function findGroupStack(node, group) {
  return findNode(
    node,
    (candidate) => candidate.type === 'stack' && candidate.panels.some((id) => PANELS[id].group === group),
  );
}

function findNode(node, predicate) {
  if (predicate(node)) return node;
  if (node.type !== 'split') return null;
  for (const child of node.children) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function replaceNode(node, target, replacement) {
  if (node === target) return replacement;
  if (node.type !== 'split') return node;
  node.children = node.children.map((child) => replaceNode(child, target, replacement));
  return node;
}

function nodeAt(node, path) {
  let current = node;
  for (const index of path) {
    if (!current || current.type !== 'split' || !Number.isInteger(index)) return null;
    current = current.children[index];
  }
  return current ?? null;
}

function nextStackId(layout) {
  let highest = 0;
  const visit = (id) => {
    const match = /^s(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  };
  findNode(layout.tree, (node) => {
    if (node.type === 'stack') visit(node.id);
    return false;
  });
  for (const entry of Object.values(layout.closed)) visit(entry.stackId);
  return `s${highest + 1}`;
}

function controlledChild(node, index) {
  return index < node.sizes.indexOf(null) ? index : index + 1;
}

function containsViewport(node) {
  return findViewport(node) !== null;
}

function split(dir, children, sizes) {
  return { type: 'split', dir, children, sizes };
}

function stack(id, panels) {
  return { type: 'stack', id, panels, active: panels[0] };
}

function assertPanel(id) {
  if (!Object.hasOwn(PANELS, id)) throw new Error(`Unknown panel id: ${id}`);
}

function axisDir(side) {
  return side === 'left' || side === 'right' ? 'row' : 'column';
}

function axisKey(dir) {
  return dir === 'row' ? 'width' : 'height';
}

function inside(point, rect) {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

function samePath(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function grow(size, amount) {
  return typeof size === 'number' ? size + amount : size;
}

function isPositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function deepFreeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
