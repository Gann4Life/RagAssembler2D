import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUT_VERSION,
  PANELS,
  VIEWPORT_MIN,
  defaultLayout,
  normalize,
  validateLayout,
  restoreLayout,
  activatePanel,
  closePanel,
  openPanel,
  movePanel,
  canDrop,
  resizeSplit,
  computeRects,
  dropAt,
} from '../js/panels/layout.js';

const WS = Object.freeze({ width: 1280, height: 680 });

const stack = (id, panels, active = panels[0]) => ({ type: 'stack', id, panels, active });
const split = (dir, children, sizes) => ({ type: 'split', dir, children, sizes });
const viewport = () => ({ type: 'viewport' });
const layoutOf = (tree, closed = {}) => ({ version: 1, tree, closed });
const plain = (value) => JSON.parse(JSON.stringify(value));

function stacksOf(node, out = []) {
  if (node.type === 'stack') out.push(node);
  if (node.type === 'split') node.children.forEach((child) => stacksOf(child, out));
  return out;
}

function stackWith(layout, panelId) {
  return stacksOf(layout.tree).find((candidate) => candidate.panels.includes(panelId)) ?? null;
}

function isDeepFrozen(value) {
  if (typeof value !== 'object' || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

test('PANELS matches the DESIGN.md §5.2 table in Window menu order', () => {
  assert.deepEqual(Object.keys(PANELS), ['tools', 'hierarchy', 'assets', 'problems', 'inspector', 'timeline']);
  assert.deepEqual(plain(PANELS.tools), { title: 'Tools', group: 'tools', edge: 'left', size: 72, min: { width: 56, height: 120 } });
  for (const id of ['hierarchy', 'assets', 'problems']) {
    assert.equal(PANELS[id].group, 'hap');
    assert.equal(PANELS[id].edge, 'right');
    assert.equal(PANELS[id].size, 300);
    assert.deepEqual(plain(PANELS[id].min), { width: 200, height: 96 });
  }
  assert.deepEqual(plain(PANELS.inspector), { title: 'Inspector', group: 'inspector', edge: 'right', size: 300, min: { width: 200, height: 96 } });
  assert.deepEqual(plain(PANELS.timeline), { title: 'Timeline', group: 'timeline', edge: 'bottom', size: 220, min: { width: 320, height: 120 } });
  assert.deepEqual(plain(VIEWPORT_MIN), { width: 240, height: 160 });
  assert.equal(LAYOUT_VERSION, 1);
  assert.ok(isDeepFrozen(PANELS));
});

test('defaultLayout builds the §5.2 tree with the Hierarchy stack at half the right column', () => {
  const layout = defaultLayout(WS);
  const hapHeight = Math.floor((WS.height - 220 - 4 - 4) / 2);
  assert.deepEqual(plain(layout), {
    version: 1,
    tree: split('column', [
      split('row', [
        stack('s1', ['tools']),
        viewport(),
        split('column', [stack('s2', ['hierarchy', 'assets', 'problems']), stack('s3', ['inspector'])], [hapHeight, null]),
      ], [72, null, 300]),
      stack('s4', ['timeline']),
    ], [null, 220]),
    closed: {},
  });
  assert.ok(isDeepFrozen(layout));
  assert.equal(validateLayout(plain(layout)), null);
});

test('defaultLayout keeps the Hierarchy stack at its minimum height in a short workspace', () => {
  const layout = defaultLayout({ width: 800, height: 300 });
  assert.equal(layout.tree.children[0].children[2].sizes[0], 96);
});

test('computeRects lays out the default layout without overlap', () => {
  const rects = computeRects(defaultLayout(WS), WS);
  const top = WS.height - 220 - 4;
  const hapHeight = Math.floor((top - 4) / 2);
  assert.equal(rects.width, 1280);
  assert.equal(rects.height, 680);
  assert.deepEqual(rects.stacks.get('s1'), { x: 0, y: 0, width: 72, height: top });
  assert.deepEqual(rects.viewport, { x: 76, y: 0, width: 1280 - 72 - 300 - 8, height: top });
  assert.deepEqual(rects.stacks.get('s2'), { x: 980, y: 0, width: 300, height: hapHeight });
  assert.deepEqual(rects.stacks.get('s3'), { x: 980, y: hapHeight + 4, width: 300, height: top - hapHeight - 4 });
  assert.deepEqual(rects.stacks.get('s4'), { x: 0, y: top + 4, width: 1280, height: 220 });
  assert.equal(rects.gutters.length, 4);
});

test('computeRects reports gutters with the controlled size and its bounds', () => {
  const rects = computeRects(defaultLayout(WS), WS);
  const byKey = new Map(rects.gutters.map((gutter) => [`${gutter.path.join('.')}:${gutter.index}`, gutter]));
  const viewportWidth = 1280 - 72 - 300 - 8;
  const top = WS.height - 224;
  assert.deepEqual(plain(byKey.get('0:0')), {
    path: [0], index: 0, dir: 'row', rect: { x: 72, y: 0, width: 4, height: top },
    value: 72, min: 56, max: 72 + viewportWidth - 240,
  });
  assert.deepEqual(plain(byKey.get('0:1')), {
    path: [0], index: 1, dir: 'row', rect: { x: 76 + viewportWidth, y: 0, width: 4, height: top },
    value: 300, min: 200, max: 300 + viewportWidth - 240,
  });
  const inner = byKey.get('0.2:0');
  assert.equal(inner.dir, 'column');
  assert.equal(inner.min, 96);
  assert.equal(inner.max, inner.value + (top - inner.value - 4) - 96);
  const root = byKey.get(':0');
  assert.deepEqual(plain(root.rect), { x: 0, y: top, width: 1280, height: 4 });
  assert.equal(root.value, 220);
  assert.equal(root.min, 120);
  assert.equal(root.max, 220 + top - (96 + 4 + 96));
});

test('computeRects shrinks fixed children in proportion to their slack above the minimum', () => {
  const rects = computeRects(defaultLayout({ width: 600, height: 680 }), { width: 600, height: 680 });
  assert.equal(rects.stacks.get('s1').width, 69);
  assert.equal(rects.stacks.get('s2').width, 282);
  assert.ok(rects.viewport.width >= VIEWPORT_MIN.width);
  assert.equal(rects.width, 600);
});

test('computeRects grows the content past the workspace when the minimums do not fit', () => {
  const rects = computeRects(defaultLayout({ width: 300, height: 200 }), { width: 300, height: 200 });
  assert.equal(rects.width, 56 + 240 + 200 + 8);
  assert.equal(rects.height, 96 + 4 + 96 + 4 + 120);
  assert.equal(rects.stacks.get('s1').width, 56);
  assert.equal(rects.viewport.width, 240);
  assert.equal(rects.viewport.height, 196);
  assert.equal(rects.stacks.get('s4').height, 120);
});

test('normalize drops empty stacks and gives the freed space to the previous sibling', () => {
  const result = normalize(layoutOf(split('row', [stack('a', ['tools']), stack('b', []), viewport()], [100, 150, null])));
  assert.deepEqual(plain(result.tree), split('row', [stack('a', ['tools']), viewport()], [254, null]));
});

test('normalize gives freed space to the next sibling when there is no previous one', () => {
  const result = normalize(layoutOf(split('row', [stack('b', []), stack('a', ['tools']), viewport()], [150, 100, null])));
  assert.deepEqual(plain(result.tree), split('row', [stack('a', ['tools']), viewport()], [254, null]));
});

test('normalize collapses single-child splits and flattens same-direction splits', () => {
  const nested = split('row', [stack('a', ['tools']), split('row', [viewport(), stack('b', ['inspector'])], [null, 300])], [72, null]);
  assert.deepEqual(
    plain(normalize(layoutOf(nested)).tree),
    split('row', [stack('a', ['tools']), viewport(), stack('b', ['inspector'])], [72, null, 300]),
  );
  const fixedSlot = split('row', [viewport(), split('row', [stack('a', ['tools']), stack('b', ['inspector'])], [100, null])], [null, 400]);
  assert.deepEqual(
    plain(normalize(layoutOf(fixedSlot)).tree),
    split('row', [viewport(), stack('a', ['tools']), stack('b', ['inspector'])], [null, 100, 296]),
  );
  const single = split('column', [split('row', [viewport()], [null])], [null]);
  assert.deepEqual(plain(normalize(layoutOf(single)).tree), viewport());
});

test('normalize re-derives the fill child and repairs active', () => {
  const result = normalize(layoutOf(split('row', [viewport(), stack('a', ['inspector', 'tools'], 'timeline')], [500, null])));
  assert.deepEqual(plain(result.tree), split('row', [viewport(), stack('a', ['inspector', 'tools'], 'inspector')], [null, 200]));
  const noViewport = normalize(layoutOf(split('row', [
    viewport(),
    split('column', [stack('a', ['tools']), stack('b', ['timeline'])], [null, 220]),
  ], [null, 300])));
  assert.deepEqual(plain(noViewport.tree.children[1].sizes), [120, null]);
  assert.ok(isDeepFrozen(result));
});

test('validateLayout accepts the default layout and rejects invalid values with a reason', () => {
  const valid = () => plain(defaultLayout(WS));
  assert.equal(validateLayout(valid()), null);
  const cases = [
    [null, /not an object/],
    [[], /not an object/],
    ['layout', /not an object/],
    [{ ...valid(), version: 2 }, /unsupported version 2/],
    [{ tree: viewport(), closed: {} }, /unsupported version/],
    [{ ...valid(), tree: undefined }, /malformed node/],
    [{ ...valid(), tree: { type: 'panel' } }, /malformed node/],
    [layoutOf(split('diagonal', [viewport()], [null])), /dir/],
    [layoutOf(split('row', [], [])), /no children/],
    [layoutOf(split('row', [viewport(), stack('a', ['tools'])], [null])), /sizes do not match/],
    [layoutOf(split('row', [viewport(), stack('a', ['tools'])], [null, null])), /exactly one null/],
    [layoutOf(split('row', [viewport(), stack('a', ['tools'])], [300, 72])), /exactly one null/],
    [layoutOf(split('row', [viewport(), stack('a', ['tools'])], [null, 0])), /finite number > 0/],
    [layoutOf(split('row', [viewport(), stack('a', ['tools'])], [null, -5])), /finite number > 0/],
    [layoutOf(split('row', [viewport(), stack('a', ['tools'])], [null, '72'])), /finite number > 0/],
    [{ ...layoutOf(split('row', [viewport(), stack('a', ['tools'])], [null, 1])), tree: { ...split('row', [viewport(), stack('a', ['tools'])], [null, 1]), sizes: [null, Infinity] } }, /finite/],
    [layoutOf(split('row', [viewport(), stack('a', ['console'])], [null, 72])), /unknown panel id "console"/],
    [layoutOf(split('row', [viewport(), stack('a', ['toString'])], [null, 72])), /unknown panel id/],
    [layoutOf(split('row', [viewport(), stack('a', ['tools', 'tools'])], [null, 72])), /repeated panel id "tools"/],
    [layoutOf(split('row', [viewport(), stack('a', ['tools']), stack('b', ['tools'])], [null, 72, 72])), /repeated panel id/],
    [layoutOf(split('row', [viewport(), stack('a', ['tools'])], [null, 72]), { tools: { stackId: 'a', index: 0 } }), /repeated panel id "tools"/],
    [layoutOf(split('row', [viewport(), viewport()], [null, 72])), /viewport must appear exactly once/],
    [layoutOf(stack('a', ['tools'])), /viewport must appear exactly once/],
    [layoutOf(split('row', [viewport(), stack('a', [])], [null, 72])), /empty stack/],
    [layoutOf(split('row', [viewport(), stack('a', ['tools'], 'timeline')], [null, 72])), /active panel not in its stack/],
    [layoutOf(split('row', [viewport(), stack('a', ['tools']), stack('a', ['timeline'])], [null, 72, 72])), /repeated stack id "a"/],
    [layoutOf(split('row', [viewport(), stack('viewport', ['tools'])], [null, 72])), /malformed stack id/],
    [layoutOf(split('row', [viewport(), { type: 'stack', id: 3, panels: ['tools'], active: 'tools' }], [null, 72])), /malformed stack id/],
    [layoutOf(split('row', [viewport(), { type: 'stack', id: 'a', panels: 'tools', active: 'tools' }], [null, 72])), /panels must be an array/],
    [{ ...layoutOf(viewport()), closed: [] }, /closed is not an object/],
    [layoutOf(viewport(), { tools: { stackId: 's1', index: -1 } }), /malformed closed entry for "tools"/],
    [layoutOf(viewport(), { tools: { index: 0 } }), /malformed closed entry/],
    [layoutOf(viewport(), { console: { stackId: 's1', index: 0 } }), /unknown panel id "console"/],
  ];
  for (const [value, reason] of cases) {
    const result = validateLayout(value);
    assert.equal(typeof result, 'string', `expected a reason for ${JSON.stringify(value)}`);
    assert.match(result, reason);
  }
});

test('restoreLayout restores a valid stored layout unchanged', () => {
  const stored = closePanel(defaultLayout(WS), 'assets');
  const { layout, warning } = restoreLayout(plain(stored), WS);
  assert.equal(warning, null);
  assert.deepEqual(plain(layout), plain(stored));
  assert.ok(isDeepFrozen(layout));
});

test('restoreLayout falls back to the default with a warning when the value is invalid', () => {
  const { layout, warning } = restoreLayout({ version: 7 }, WS);
  assert.equal(warning, 'Stored layout ignored: unsupported version 7');
  assert.deepEqual(plain(layout), plain(defaultLayout(WS)));
});

test('restoreLayout adds panels missing from tree and closed by the reopen rule', () => {
  const stored = plain(defaultLayout(WS));
  stored.tree.children[0].children[2].children[0].panels = ['hierarchy', 'problems'];
  stored.tree = stored.tree.children[0];
  const { layout, warning } = restoreLayout(stored, WS);
  assert.equal(warning, null);
  assert.deepEqual(plain(stackWith(layout, 'assets').panels), ['hierarchy', 'problems', 'assets']);
  assert.equal(layout.tree.type, 'split');
  assert.equal(layout.tree.dir, 'column');
  assert.deepEqual(plain(layout.tree.sizes), [null, 220]);
  assert.deepEqual(plain(layout.tree.children[1]), stack('s4', ['timeline']));
  assert.deepEqual(plain(layout.closed), {});
});

test('activatePanel switches the active tab and refuses closed or unknown panels', () => {
  const layout = activatePanel(defaultLayout(WS), 'problems');
  assert.equal(stackWith(layout, 'problems').active, 'problems');
  assert.throws(() => activatePanel(closePanel(layout, 'tools'), 'tools'), /not open/);
  assert.throws(() => activatePanel(layout, 'console'), /Unknown panel id/);
});

test('closePanel records the stack and index and activates the neighbour tab', () => {
  const base = activatePanel(defaultLayout(WS), 'assets');
  const layout = closePanel(base, 'assets');
  assert.deepEqual(plain(layout.closed), { assets: { stackId: 's2', index: 1 } });
  assert.deepEqual(plain(stackWith(layout, 'hierarchy')), stack('s2', ['hierarchy', 'problems'], 'problems'));
  const last = closePanel(activatePanel(defaultLayout(WS), 'problems'), 'problems');
  assert.equal(stackWith(last, 'hierarchy').active, 'assets');
  assert.throws(() => closePanel(layout, 'assets'), /not open/);
  assert.throws(() => closePanel(layout, 'viewport'), /Unknown panel id/);
});

test('closing the last panel of a stack removes the stack and collapses its split', () => {
  const layout = closePanel(defaultLayout(WS), 'inspector');
  assert.deepEqual(plain(layout.tree.children[0]), split('row', [
    stack('s1', ['tools']),
    viewport(),
    stack('s2', ['hierarchy', 'assets', 'problems']),
  ], [72, null, 300]));
  const onlyViewport = ['tools', 'hierarchy', 'assets', 'problems', 'inspector', 'timeline'].reduce(closePanel, defaultLayout(WS));
  assert.deepEqual(plain(onlyViewport.tree), viewport());
  assert.equal(computeRects(onlyViewport, WS).viewport.width, WS.width);
});

test('openPanel returns a panel to its previous stack and index and activates it', () => {
  const layout = openPanel(closePanel(defaultLayout(WS), 'assets'), 'assets', WS);
  assert.deepEqual(plain(stackWith(layout, 'assets')), stack('s2', ['hierarchy', 'assets', 'problems'], 'assets'));
  assert.deepEqual(plain(layout.closed), {});
  assert.throws(() => openPanel(layout, 'assets', WS), /already open/);
  assert.throws(() => openPanel(layout, 'console', WS), /Unknown panel id/);
});

test('openPanel clamps the stored index to the current stack length', () => {
  let layout = closePanel(defaultLayout(WS), 'problems');
  layout = closePanel(layout, 'assets');
  layout = openPanel(layout, 'problems', WS);
  assert.deepEqual(plain(stackWith(layout, 'problems').panels), ['hierarchy', 'problems']);
});

test('openPanel joins a stack of its default group when its stack is gone', () => {
  let layout = closePanel(defaultLayout(WS), 'assets');
  layout = movePanel(layout, 'hierarchy', { kind: 'tab', stackId: 's3', index: 1 }, WS);
  layout = movePanel(layout, 'problems', { kind: 'tab', stackId: 's4', index: 1 }, WS);
  assert.equal(stacksOf(layout.tree).some((candidate) => candidate.id === 's2'), false);
  layout = openPanel(layout, 'assets', WS);
  assert.deepEqual(plain(stackWith(layout, 'assets')), stack('s3', ['inspector', 'hierarchy', 'assets'], 'assets'));
});

test('openPanel docks to the default edge when no stack of its group exists', () => {
  let layout = ['hierarchy', 'assets', 'problems', 'inspector'].reduce(closePanel, defaultLayout(WS));
  layout = openPanel(layout, 'inspector', WS);
  assert.equal(layout.tree.type, 'split');
  assert.equal(layout.tree.dir, 'row');
  assert.deepEqual(plain(layout.tree.sizes), [null, 300]);
  assert.deepEqual(plain(layout.tree.children[1]), stack('s5', ['inspector']));
  layout = openPanel(layout, 'hierarchy', WS);
  assert.deepEqual(plain(stackWith(layout, 'hierarchy')), stack('s6', ['hierarchy']));
  assert.equal(stackWith(layout, 'hierarchy') === stackWith(layout, 'inspector'), false);
  layout = openPanel(layout, 'assets', WS);
  assert.deepEqual(plain(stackWith(layout, 'assets').panels), ['hierarchy', 'assets']);
});

test('openPanel docks Timeline at the bottom and Tools at the left with their default sizes', () => {
  let layout = closePanel(closePanel(defaultLayout(WS), 'timeline'), 'tools');
  layout = openPanel(layout, 'timeline', WS);
  assert.equal(layout.tree.dir, 'column');
  assert.deepEqual(plain(layout.tree.sizes), [null, 220]);
  layout = openPanel(layout, 'tools', WS);
  assert.equal(layout.tree.dir, 'row');
  assert.deepEqual(plain(layout.tree.sizes), [72, null]);
  assert.deepEqual(plain(layout.tree.children[0]), stack('s5', ['tools']));
  assert.equal(layout.tree.children[1].dir, 'column');
});

test('movePanel adds a tab at the drop index and removes the emptied stack', () => {
  const layout = movePanel(defaultLayout(WS), 'inspector', { kind: 'tab', stackId: 's2', index: 0 }, WS);
  assert.deepEqual(plain(layout.tree.children[0]), split('row', [
    stack('s1', ['tools']),
    viewport(),
    stack('s2', ['inspector', 'hierarchy', 'assets', 'problems'], 'inspector'),
  ], [72, null, 300]));
});

test('movePanel reorders tabs inside the same stack', () => {
  const toEnd = movePanel(defaultLayout(WS), 'hierarchy', { kind: 'tab', stackId: 's2', index: 3 }, WS);
  assert.deepEqual(plain(stackWith(toEnd, 'hierarchy').panels), ['assets', 'problems', 'hierarchy']);
  const toStart = movePanel(defaultLayout(WS), 'problems', { kind: 'tab', stackId: 's2', index: 0 }, WS);
  assert.deepEqual(plain(stackWith(toStart, 'problems')), stack('s2', ['problems', 'hierarchy', 'assets'], 'problems'));
});

test('movePanel splits the viewport and gives the moved panel half of it', () => {
  const layout = movePanel(defaultLayout(WS), 'timeline', { kind: 'split', stackId: 'viewport', side: 'left' }, WS);
  assert.deepEqual(plain(layout.tree), split('row', [
    stack('s1', ['tools']),
    stack('s5', ['timeline']),
    viewport(),
    split('column', [stack('s2', ['hierarchy', 'assets', 'problems']), stack('s3', ['inspector'])], [226, null]),
  ], [72, 448, null, 300]));
});

test('movePanel splits a stack edge, respecting minimums', () => {
  const layout = movePanel(defaultLayout(WS), 'assets', { kind: 'split', stackId: 's2', side: 'bottom' }, WS);
  assert.deepEqual(plain(layout.tree.children[0].children[2]), split('column', [
    stack('s2', ['hierarchy', 'problems']),
    stack('s5', ['assets']),
    stack('s3', ['inspector']),
  ], [111, 111, null]));
  const wide = movePanel(defaultLayout(WS), 'inspector', { kind: 'split', stackId: 's2', side: 'left' }, WS);
  assert.deepEqual(plain(wide.tree.children[0]), split('row', [
    stack('s1', ['tools']),
    viewport(),
    stack('s5', ['inspector']),
    stack('s2', ['hierarchy', 'assets', 'problems']),
  ], [72, null, 200, 200]));
});

test('movePanel docks at a workspace edge with the default size capped at a third', () => {
  const tools = movePanel(defaultLayout(WS), 'tools', { kind: 'edge', side: 'right' }, WS);
  assert.equal(tools.tree.dir, 'row');
  assert.deepEqual(plain(tools.tree.sizes), [null, 72]);
  assert.deepEqual(plain(tools.tree.children[1]), stack('s5', ['tools']));
  assert.deepEqual(plain(tools.tree.children[0].children[0].sizes), [null, 300]);
  const short = { width: 1280, height: 600 };
  const timeline = movePanel(defaultLayout(short), 'timeline', { kind: 'edge', side: 'top' }, short);
  assert.equal(timeline.tree.dir, 'column');
  assert.deepEqual(plain(timeline.tree.sizes), [200, null]);
  assert.deepEqual(plain(timeline.tree.children[0]), stack('s5', ['timeline']));
  const narrow = { width: 600, height: 680 };
  const left = movePanel(defaultLayout(narrow), 'timeline', { kind: 'edge', side: 'left' }, narrow);
  assert.equal(left.tree.sizes[0], 320);
});

test('canDrop refuses the viewport center, the sole tab of its own stack and malformed drops', () => {
  const layout = defaultLayout(WS);
  assert.equal(canDrop(layout, 'tools', { kind: 'tab', stackId: 'viewport', index: 0 }), false);
  assert.equal(canDrop(layout, 'tools', { kind: 'tab', stackId: 's1', index: 0 }), false);
  assert.equal(canDrop(layout, 'tools', { kind: 'split', stackId: 's1', side: 'top' }), false);
  assert.equal(canDrop(layout, 'tools', { kind: 'tab', stackId: 's9', index: 0 }), false);
  assert.equal(canDrop(layout, 'tools', { kind: 'tab', stackId: 's2', index: 4 }), false);
  assert.equal(canDrop(layout, 'tools', { kind: 'tab', stackId: 's2', index: 1.5 }), false);
  assert.equal(canDrop(layout, 'tools', { kind: 'split', stackId: 's2', side: 'middle' }), false);
  assert.equal(canDrop(layout, 'tools', { kind: 'edge', side: 'center' }), false);
  assert.equal(canDrop(layout, 'tools', { kind: 'float' }), false);
  assert.equal(canDrop(layout, 'tools', null), false);
  assert.equal(canDrop(layout, 'console', { kind: 'edge', side: 'left' }), false);
  assert.equal(canDrop(closePanel(layout, 'tools'), 'tools', { kind: 'edge', side: 'left' }), false);
  assert.throws(() => movePanel(layout, 'tools', { kind: 'tab', stackId: 's1', index: 0 }, WS), /not allowed/);
});

test('canDrop accepts tabs, splits of the viewport and of a multi-tab own stack, and edges', () => {
  const layout = defaultLayout(WS);
  assert.equal(canDrop(layout, 'tools', { kind: 'tab', stackId: 's2', index: 3 }), true);
  assert.equal(canDrop(layout, 'tools', { kind: 'split', stackId: 'viewport', side: 'right' }), true);
  assert.equal(canDrop(layout, 'assets', { kind: 'split', stackId: 's2', side: 'left' }), true);
  assert.equal(canDrop(layout, 'assets', { kind: 'tab', stackId: 's2', index: 0 }), true);
  assert.equal(canDrop(layout, 'tools', { kind: 'edge', side: 'left' }), true);
});

test('resizeSplit sets the controlled child and clamps to the gutter bounds', () => {
  const layout = defaultLayout(WS);
  const viewportWidth = 1280 - 72 - 300 - 8;
  assert.deepEqual(plain(resizeSplit(layout, [0], 0, 100, WS).tree.children[0].sizes), [100, null, 300]);
  assert.deepEqual(plain(resizeSplit(layout, [0], 0, 10, WS).tree.children[0].sizes), [56, null, 300]);
  assert.deepEqual(plain(resizeSplit(layout, [0], 0, 5000, WS).tree.children[0].sizes), [72 + viewportWidth - 240, null, 300]);
  assert.deepEqual(plain(resizeSplit(layout, [0], 1, 400.4, WS).tree.children[0].sizes), [72, null, 400]);
  assert.deepEqual(plain(resizeSplit(layout, [], 0, 300, WS).tree.sizes), [null, 300]);
  assert.equal(resizeSplit(layout, [0, 2], 0, 150, WS).tree.children[0].children[2].sizes[0], 150);
  assert.ok(isDeepFrozen(resizeSplit(layout, [], 0, 300, WS)));
});

test('resizeSplit throws on an invalid path, index or value', () => {
  const layout = defaultLayout(WS);
  assert.throws(() => resizeSplit(layout, [1], 0, 100, WS), /No split/);
  assert.throws(() => resizeSplit(layout, [5], 0, 100, WS), /No split/);
  assert.throws(() => resizeSplit(layout, [0], 2, 100, WS), /No gutter/);
  assert.throws(() => resizeSplit(layout, [0], -1, 100, WS), /No gutter/);
  assert.throws(() => resizeSplit(layout, [0], 0, Number.NaN, WS), /finite/);
});

test('operations never mutate their input', () => {
  const layout = defaultLayout(WS);
  const snapshot = plain(layout);
  closePanel(layout, 'tools');
  movePanel(layout, 'inspector', { kind: 'tab', stackId: 's2', index: 0 }, WS);
  resizeSplit(layout, [0], 0, 100, WS);
  activatePanel(layout, 'assets');
  assert.deepEqual(plain(layout), snapshot);
});

test('stored layouts survive a JSON round trip', () => {
  let layout = movePanel(defaultLayout(WS), 'timeline', { kind: 'split', stackId: 'viewport', side: 'bottom' }, WS);
  layout = closePanel(layout, 'problems');
  layout = resizeSplit(layout, [], 0, 90, WS);
  const { layout: restored, warning } = restoreLayout(JSON.parse(JSON.stringify(layout)), WS);
  assert.equal(warning, null);
  assert.deepEqual(plain(restored), plain(layout));
});

test('dropAt picks the nearest workspace edge strip first', () => {
  const layout = defaultLayout(WS);
  const rects = computeRects(layout, WS);
  assert.deepEqual(dropAt(layout, rects, { x: 5, y: 300 }, 'inspector'), {
    drop: { kind: 'edge', side: 'left' },
    preview: { x: 0, y: 0, width: 300, height: 680 },
  });
  assert.deepEqual(dropAt(layout, rects, { x: 600, y: 675 }, 'tools'), {
    drop: { kind: 'edge', side: 'bottom' },
    preview: { x: 0, y: 680 - 120, width: 1280, height: 120 },
  });
  assert.equal(dropAt(layout, rects, { x: 1278, y: 10 }, 'tools').drop.side, 'right');
});

test('dropAt over a tab bar inserts at the measured index', () => {
  const layout = defaultLayout(WS);
  const rects = computeRects(layout, WS);
  rects.tabs = new Map([['s2', [
    { x: 980, y: 0, width: 80, height: 28 },
    { x: 1060, y: 0, width: 70, height: 28 },
    { x: 1130, y: 0, width: 80, height: 28 },
  ]]]);
  assert.deepEqual(dropAt(layout, rects, { x: 1070, y: 20 }, 'inspector'), {
    drop: { kind: 'tab', stackId: 's2', index: 1 },
    preview: { x: 1059, y: 0, width: 2, height: 28 },
  });
  assert.deepEqual(dropAt(layout, rects, { x: 1250, y: 20 }, 'inspector').drop, { kind: 'tab', stackId: 's2', index: 3 });
  assert.deepEqual(dropAt(layout, rects, { x: 1250, y: 20 }, 'inspector').preview, { x: 1209, y: 0, width: 2, height: 28 });
  rects.tabs = undefined;
  assert.deepEqual(dropAt(layout, rects, { x: 1070, y: 20 }, 'inspector'), {
    drop: { kind: 'tab', stackId: 's2', index: 3 },
    preview: { x: 980, y: 0, width: 300, height: 28 },
  });
});

test('dropAt uses stack edge zones, then the stack center', () => {
  const layout = defaultLayout(WS);
  const rects = computeRects(layout, WS);
  const s2 = rects.stacks.get('s2');
  assert.deepEqual(dropAt(layout, rects, { x: 990, y: 120 }, 'inspector'), {
    drop: { kind: 'split', stackId: 's2', side: 'left' },
    preview: { x: 980, y: 0, width: 200, height: s2.height },
  });
  const bottom = dropAt(layout, rects, { x: 1130, y: s2.height - 5 }, 'tools');
  assert.deepEqual(bottom.drop, { kind: 'split', stackId: 's2', side: 'bottom' });
  assert.deepEqual(bottom.preview, { x: 980, y: s2.height - 120, width: 300, height: 120 });
  assert.deepEqual(dropAt(layout, rects, { x: 1130, y: 120 }, 'tools'), {
    drop: { kind: 'tab', stackId: 's2', index: 3 },
    preview: { ...s2 },
  });
});

test('dropAt accepts viewport edges and refuses its center, own sole stack, gutters and outside points', () => {
  const layout = defaultLayout(WS);
  const rects = computeRects(layout, WS);
  const view = rects.viewport;
  const left = dropAt(layout, rects, { x: view.x + 10, y: 200 }, 'timeline');
  assert.deepEqual(left.drop, { kind: 'split', stackId: 'viewport', side: 'left' });
  assert.deepEqual(left.preview, { x: view.x, y: 0, width: 448, height: view.height });
  assert.equal(dropAt(layout, rects, { x: view.x + view.width / 2, y: view.height / 2 }, 'timeline'), null);
  assert.equal(dropAt(layout, rects, { x: 36, y: 200 }, 'tools'), null);
  assert.equal(dropAt(layout, rects, { x: 36, y: 10 + 16 }, 'tools'), null);
  assert.equal(dropAt(layout, rects, { x: 74, y: 200 }, 'inspector'), null);
  assert.equal(dropAt(layout, rects, { x: -1, y: 200 }, 'inspector'), null);
  assert.equal(dropAt(layout, rects, { x: 300, y: 700 }, 'inspector'), null);
});
