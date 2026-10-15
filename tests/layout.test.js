import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUT_VERSION,
  PANELS,
  VIEWPORT_MIN,
  TAB_BAR_HEIGHT,
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
  timelineFold,
  setTimelineFolded,
  computeRects,
  dropAt,
} from '../js/panels/layout.js';

const WS = Object.freeze({ width: 1280, height: 680 });
const TOP = 680 - 28 - 4;
const HAP = Math.floor((TOP - 4) / 2);
const VIEW_WIDTH = 1280 - 300 - 4;

const stack = (id, panels, active = panels[0]) => ({ type: 'stack', id, panels, active });
const split = (dir, children, sizes) => ({ type: 'split', dir, children, sizes });
const viewport = () => ({ type: 'viewport' });
const layoutOf = (tree, closed = {}, timelineFolded = false) => ({ version: 2, tree, closed, timelineFolded });
const plain = (value) => JSON.parse(JSON.stringify(value));
const expanded = () => setTimelineFolded(defaultLayout(WS), false);
const gutterKey = (gutter) => `${gutter.path.join('.')}:${gutter.index}`;
const S1_TABS = [
  { x: 980, y: 0, width: 80, height: 28 },
  { x: 1060, y: 0, width: 70, height: 28 },
  { x: 1130, y: 0, width: 80, height: 28 },
];

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
  assert.deepEqual(Object.keys(PANELS), ['hierarchy', 'assets', 'problems', 'inspector', 'timeline']);
  for (const id of ['hierarchy', 'assets', 'problems']) {
    assert.equal(PANELS[id].group, 'hap');
    assert.equal(PANELS[id].edge, 'right');
    assert.equal(PANELS[id].size, 300);
    assert.deepEqual(plain(PANELS[id].min), { width: 200, height: 96 });
  }
  assert.deepEqual(plain(PANELS.inspector), { title: 'Inspector', group: 'inspector', edge: 'right', size: 300, min: { width: 200, height: 96 } });
  assert.deepEqual(plain(PANELS.timeline), { title: 'Timeline', group: 'timeline', edge: 'bottom', size: 220, min: { width: 320, height: 120 } });
  assert.deepEqual(plain(VIEWPORT_MIN), { width: 240, height: 168 });
  assert.equal(LAYOUT_VERSION, 2);
  assert.equal(TAB_BAR_HEIGHT, 28);
  assert.ok(isDeepFrozen(PANELS));
});

test('defaultLayout builds the §5.2 tree with the Timeline folded and Hierarchy at half the right column', () => {
  const layout = defaultLayout(WS);
  assert.deepEqual(plain(layout), {
    version: 2,
    tree: split('column', [
      split('row', [
        viewport(),
        split('column', [stack('s1', ['hierarchy', 'assets', 'problems']), stack('s2', ['inspector'])], [HAP, null]),
      ], [null, 300]),
      stack('s3', ['timeline']),
    ], [null, 220]),
    closed: {},
    timelineFolded: true,
  });
  assert.ok(isDeepFrozen(layout));
  assert.equal(validateLayout(plain(layout)), null);
});

test('defaultLayout keeps the Hierarchy stack at its minimum height in a short workspace', () => {
  const layout = defaultLayout({ width: 800, height: 200 });
  assert.equal(layout.tree.children[0].children[1].sizes[0], 96);
});

test('computeRects lays out the default layout without overlap, with the folded Timeline as a tab bar', () => {
  const rects = computeRects(defaultLayout(WS), WS);
  assert.equal(rects.width, 1280);
  assert.equal(rects.height, 680);
  assert.deepEqual(rects.viewport, { x: 0, y: 0, width: VIEW_WIDTH, height: TOP });
  assert.deepEqual(rects.stacks.get('s1'), { x: 980, y: 0, width: 300, height: HAP });
  assert.deepEqual(rects.stacks.get('s2'), { x: 980, y: HAP + 4, width: 300, height: TOP - HAP - 4 });
  assert.deepEqual(rects.stacks.get('s3'), { x: 0, y: TOP + 4, width: 1280, height: 28 });
  assert.equal(rects.gutters.length, 2);
});

test('computeRects reports gutters with the controlled child, its size and its bounds', () => {
  const byKey = new Map(computeRects(defaultLayout(WS), WS).gutters.map((gutter) => [gutterKey(gutter), gutter]));
  assert.deepEqual(plain(byKey.get('0:0')), {
    path: [0], index: 0, controlled: 1, dir: 'row', rect: { x: VIEW_WIDTH, y: 0, width: 4, height: TOP },
    value: 300, min: 200, max: 300 + VIEW_WIDTH - 240,
  });
  assert.deepEqual(plain(byKey.get('0.1:0')), {
    path: [0, 1], index: 0, controlled: 0, dir: 'column', rect: { x: 980, y: HAP, width: 300, height: 4 },
    value: HAP, min: 96, max: HAP + (TOP - HAP - 4) - 96,
  });
  assert.equal(byKey.has(':0'), false);
  const root = computeRects(expanded(), WS).gutters.find((gutter) => gutter.path.length === 0);
  const top = 680 - 220 - 4;
  assert.deepEqual(plain(root), {
    path: [], index: 0, controlled: 1, dir: 'column', rect: { x: 0, y: top, width: 1280, height: 4 },
    value: 220, min: 120, max: 220 + top - (96 + 4 + 96),
  });
});

test('computeRects gives an expanded Timeline its stored size', () => {
  const rects = computeRects(expanded(), WS);
  assert.deepEqual(rects.stacks.get('s3'), { x: 0, y: 680 - 220, width: 1280, height: 220 });
  assert.equal(rects.viewport.height, 680 - 224);
  assert.equal(rects.gutters.length, 3);
});

test('computeRects shrinks fixed children in proportion to their slack above the minimum', () => {
  const narrow = { width: 500, height: 680 };
  const rects = computeRects(defaultLayout(narrow), narrow);
  assert.equal(rects.stacks.get('s1').width, 256);
  assert.equal(rects.viewport.width, VIEWPORT_MIN.width);
  assert.equal(rects.width, 500);
  const layout = normalize(layoutOf(split('row', [
    stack('a', ['hierarchy']),
    viewport(),
    stack('b', ['inspector']),
  ], [300, null, 400])));
  const proportional = computeRects(layout, { width: 900, height: 400 });
  assert.equal(proportional.stacks.get('a').width, 284);
  assert.equal(proportional.stacks.get('b').width, 368);
  assert.equal(proportional.viewport.width, 240);
});

test('computeRects grows the content past the workspace when the minimums do not fit', () => {
  const small = { width: 300, height: 200 };
  const rects = computeRects(defaultLayout(small), small);
  assert.equal(rects.width, 240 + 4 + 200);
  assert.equal(rects.height, 196 + 4 + 28);
  assert.equal(rects.viewport.width, 240);
  assert.equal(rects.viewport.height, 196);
  assert.equal(rects.stacks.get('s3').height, 28);
});

test('normalize drops empty stacks and gives the freed space to the previous sibling', () => {
  const result = normalize(layoutOf(split('row', [stack('a', ['assets']), stack('b', []), viewport()], [100, 150, null])));
  assert.deepEqual(plain(result.tree), split('row', [stack('a', ['assets']), viewport()], [254, null]));
});

test('normalize gives freed space to the next sibling when there is no previous one', () => {
  const result = normalize(layoutOf(split('row', [stack('b', []), stack('a', ['assets']), viewport()], [150, 100, null])));
  assert.deepEqual(plain(result.tree), split('row', [stack('a', ['assets']), viewport()], [254, null]));
});

test('normalize collapses single-child splits and flattens same-direction splits', () => {
  const nested = split('row', [stack('a', ['assets']), split('row', [viewport(), stack('b', ['inspector'])], [null, 300])], [72, null]);
  assert.deepEqual(
    plain(normalize(layoutOf(nested)).tree),
    split('row', [stack('a', ['assets']), viewport(), stack('b', ['inspector'])], [72, null, 300]),
  );
  const fixedSlot = split('row', [viewport(), split('row', [stack('a', ['assets']), stack('b', ['inspector'])], [100, null])], [null, 400]);
  assert.deepEqual(
    plain(normalize(layoutOf(fixedSlot)).tree),
    split('row', [viewport(), stack('a', ['assets']), stack('b', ['inspector'])], [null, 100, 296]),
  );
  const single = split('column', [split('row', [viewport()], [null])], [null]);
  assert.deepEqual(plain(normalize(layoutOf(single)).tree), viewport());
});

test('normalize re-derives the fill child, repairs active and keeps timelineFolded', () => {
  const result = normalize(layoutOf(split('row', [viewport(), stack('a', ['inspector', 'assets'], 'timeline')], [500, null]), {}, true));
  assert.deepEqual(plain(result.tree), split('row', [viewport(), stack('a', ['inspector', 'assets'], 'inspector')], [null, 200]));
  assert.equal(result.timelineFolded, true);
  const noViewport = normalize(layoutOf(split('row', [
    viewport(),
    split('column', [stack('a', ['assets']), stack('b', ['timeline'])], [null, 220]),
  ], [null, 300])));
  assert.deepEqual(plain(noViewport.tree.children[1].sizes), [96, null]);
  assert.equal(noViewport.timelineFolded, false);
  assert.ok(isDeepFrozen(result));
});

test('validateLayout accepts the default layout and rejects invalid values with a reason', () => {
  const valid = () => plain(defaultLayout(WS));
  assert.equal(validateLayout(valid()), null);
  const withoutFlag = valid();
  delete withoutFlag.timelineFolded;
  const cases = [
    [null, /not an object/],
    [[], /not an object/],
    ['layout', /not an object/],
    [{ ...valid(), version: 1 }, /^unsupported version 1$/],
    [{ ...valid(), version: 3 }, /unsupported version 3/],
    [{ tree: viewport(), closed: {}, timelineFolded: false }, /unsupported version/],
    [withoutFlag, /timelineFolded is not a boolean/],
    [{ ...valid(), timelineFolded: 'true' }, /timelineFolded is not a boolean/],
    [{ ...valid(), timelineFolded: 1 }, /timelineFolded is not a boolean/],
    [{ ...valid(), tree: undefined }, /malformed node/],
    [{ ...valid(), tree: { type: 'panel' } }, /malformed node/],
    [layoutOf(split('diagonal', [viewport()], [null])), /dir/],
    [layoutOf(split('row', [], [])), /no children/],
    [layoutOf(split('row', [viewport(), stack('a', ['assets'])], [null])), /sizes do not match/],
    [layoutOf(split('row', [viewport(), stack('a', ['assets'])], [null, null])), /exactly one null/],
    [layoutOf(split('row', [viewport(), stack('a', ['assets'])], [300, 72])), /exactly one null/],
    [layoutOf(split('row', [viewport(), stack('a', ['assets'])], [null, 0])), /finite number > 0/],
    [layoutOf(split('row', [viewport(), stack('a', ['assets'])], [null, -5])), /finite number > 0/],
    [layoutOf(split('row', [viewport(), stack('a', ['assets'])], [null, '72'])), /finite number > 0/],
    [layoutOf(split('row', [viewport(), stack('a', ['assets'])], [null, Infinity])), /finite/],
    [layoutOf(split('row', [viewport(), stack('a', ['console'])], [null, 72])), /unknown panel id "console"/],
    [layoutOf(split('row', [viewport(), stack('a', ['tools'])], [null, 72])), /unknown panel id "tools"/],
    [layoutOf(split('row', [viewport(), stack('a', ['toString'])], [null, 72])), /unknown panel id/],
    [layoutOf(split('row', [viewport(), stack('a', ['assets', 'assets'])], [null, 72])), /repeated panel id "assets"/],
    [layoutOf(split('row', [viewport(), stack('a', ['assets']), stack('b', ['assets'])], [null, 72, 72])), /repeated panel id/],
    [layoutOf(split('row', [viewport(), stack('a', ['assets'])], [null, 72]), { assets: { stackId: 'a', index: 0 } }), /repeated panel id "assets"/],
    [layoutOf(split('row', [viewport(), viewport()], [null, 72])), /viewport must appear exactly once/],
    [layoutOf(stack('a', ['assets'])), /viewport must appear exactly once/],
    [layoutOf(split('row', [viewport(), stack('a', [])], [null, 72])), /empty stack/],
    [layoutOf(split('row', [viewport(), stack('a', ['assets'], 'timeline')], [null, 72])), /active panel not in its stack/],
    [layoutOf(split('row', [viewport(), stack('a', ['assets']), stack('a', ['timeline'])], [null, 72, 72])), /repeated stack id "a"/],
    [layoutOf(split('row', [viewport(), stack('viewport', ['assets'])], [null, 72])), /malformed stack id/],
    [layoutOf(split('row', [viewport(), { type: 'stack', id: 3, panels: ['assets'], active: 'assets' }], [null, 72])), /malformed stack id/],
    [layoutOf(split('row', [viewport(), { type: 'stack', id: 'a', panels: 'assets', active: 'assets' }], [null, 72])), /panels must be an array/],
    [{ ...layoutOf(viewport()), closed: [] }, /closed is not an object/],
    [layoutOf(viewport(), { assets: { stackId: 's1', index: -1 } }), /malformed closed entry for "assets"/],
    [layoutOf(viewport(), { assets: { index: 0 } }), /malformed closed entry/],
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

test('restoreLayout ignores version 1 records without migrating them', () => {
  const v1 = {
    version: 1,
    tree: split('column', [
      split('row', [stack('s1', ['tools']), viewport(), stack('s2', ['inspector'])], [72, null, 300]),
      stack('s4', ['timeline']),
    ], [null, 220]),
    closed: {},
  };
  const { layout, warning } = restoreLayout(v1, WS);
  assert.equal(warning, 'Stored layout ignored: unsupported version 1');
  assert.deepEqual(plain(layout), plain(defaultLayout(WS)));
});

test('restoreLayout ignores a version 2 record that still names the removed tools panel', () => {
  const stored = layoutOf(
    split('row', [stack('s1', ['tools']), viewport(), stack('s2', ['inspector'])], [72, null, 300]),
  );
  let result;
  assert.doesNotThrow(() => {
    result = restoreLayout(stored, WS);
  });
  assert.match(result.warning, /unknown panel id "tools"/);
  assert.deepEqual(plain(result.layout), plain(defaultLayout(WS)));
});

test('restoreLayout ignores a closed entry naming the removed tools panel', () => {
  const stored = plain(defaultLayout(WS));
  stored.closed.tools = { stackId: 's1', index: 0 };
  const { layout, warning } = restoreLayout(stored, WS);
  assert.match(warning, /unknown panel id "tools"/);
  assert.deepEqual(plain(layout), plain(defaultLayout(WS)));
});

test('the default layout and Window menu panels never include tools', () => {
  assert.equal(Object.hasOwn(PANELS, 'tools'), false);
  assert.equal(stackWith(defaultLayout(WS), 'tools'), null);
});

test('restoreLayout adds panels missing from tree and closed by the reopen rule', () => {
  const stored = plain(defaultLayout(WS));
  stored.tree.children[0].children[1].children[0].panels = ['hierarchy', 'problems'];
  stored.tree = stored.tree.children[0];
  const { layout, warning } = restoreLayout(stored, WS);
  assert.equal(warning, null);
  assert.deepEqual(plain(stackWith(layout, 'assets').panels), ['hierarchy', 'problems', 'assets']);
  assert.equal(layout.tree.type, 'split');
  assert.equal(layout.tree.dir, 'column');
  assert.deepEqual(plain(layout.tree.sizes), [null, 220]);
  assert.deepEqual(plain(layout.tree.children[1]), stack('s3', ['timeline']));
  assert.deepEqual(plain(layout.closed), {});
  assert.equal(layout.timelineFolded, false);
});

test('activatePanel switches the active tab and refuses closed or unknown panels', () => {
  const layout = activatePanel(defaultLayout(WS), 'problems');
  assert.equal(stackWith(layout, 'problems').active, 'problems');
  assert.throws(() => activatePanel(closePanel(layout, 'assets'), 'assets'), /not open/);
  assert.throws(() => activatePanel(layout, 'console'), /Unknown panel id/);
  assert.throws(() => activatePanel(layout, 'tools'), /Unknown panel id/);
});

test('closePanel records the stack and index and activates the neighbour tab', () => {
  const base = activatePanel(defaultLayout(WS), 'assets');
  const layout = closePanel(base, 'assets');
  assert.deepEqual(plain(layout.closed), { assets: { stackId: 's1', index: 1 } });
  assert.deepEqual(plain(stackWith(layout, 'hierarchy')), stack('s1', ['hierarchy', 'problems'], 'problems'));
  const last = closePanel(activatePanel(defaultLayout(WS), 'problems'), 'problems');
  assert.equal(stackWith(last, 'hierarchy').active, 'assets');
  assert.throws(() => closePanel(layout, 'assets'), /not open/);
  assert.throws(() => closePanel(layout, 'viewport'), /Unknown panel id/);
});

test('closing the last panel of a stack removes the stack and collapses its split', () => {
  const layout = closePanel(defaultLayout(WS), 'inspector');
  assert.deepEqual(plain(layout.tree.children[0]), split('row', [
    viewport(),
    stack('s1', ['hierarchy', 'assets', 'problems']),
  ], [null, 300]));
  const onlyViewport = Object.keys(PANELS).reduce(closePanel, defaultLayout(WS));
  assert.deepEqual(plain(onlyViewport.tree), viewport());
  assert.equal(computeRects(onlyViewport, WS).viewport.width, WS.width);
});

test('openPanel returns a panel to its previous stack and index and activates it', () => {
  const layout = openPanel(closePanel(defaultLayout(WS), 'assets'), 'assets', WS);
  assert.deepEqual(plain(stackWith(layout, 'assets')), stack('s1', ['hierarchy', 'assets', 'problems'], 'assets'));
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
  layout = movePanel(layout, 'hierarchy', { kind: 'tab', stackId: 's2', index: 1 }, WS);
  layout = movePanel(layout, 'problems', { kind: 'tab', stackId: 's3', index: 1 }, WS);
  assert.equal(stacksOf(layout.tree).some((candidate) => candidate.id === 's1'), false);
  layout = openPanel(layout, 'assets', WS);
  assert.deepEqual(plain(stackWith(layout, 'assets')), stack('s2', ['inspector', 'hierarchy', 'assets'], 'assets'));
});

test('openPanel docks to the default edge when no stack of its group exists', () => {
  let layout = ['hierarchy', 'assets', 'problems', 'inspector'].reduce(closePanel, defaultLayout(WS));
  layout = openPanel(layout, 'inspector', WS);
  assert.equal(layout.tree.type, 'split');
  assert.equal(layout.tree.dir, 'row');
  assert.deepEqual(plain(layout.tree.sizes), [null, 300]);
  assert.deepEqual(plain(layout.tree.children[1]), stack('s4', ['inspector']));
  layout = openPanel(layout, 'hierarchy', WS);
  assert.deepEqual(plain(stackWith(layout, 'hierarchy')), stack('s5', ['hierarchy']));
  assert.equal(stackWith(layout, 'hierarchy') === stackWith(layout, 'inspector'), false);
  layout = openPanel(layout, 'assets', WS);
  assert.deepEqual(plain(stackWith(layout, 'assets').panels), ['hierarchy', 'assets']);
});

test('openPanel docks the Timeline at the bottom with its default size', () => {
  let layout = closePanel(defaultLayout(WS), 'timeline');
  assert.equal(layout.tree.dir, 'row');
  layout = openPanel(layout, 'timeline', WS);
  assert.equal(layout.tree.dir, 'column');
  assert.deepEqual(plain(layout.tree.sizes), [null, 220]);
  assert.deepEqual(plain(layout.tree.children[1].panels), ['timeline']);
});

test('movePanel adds a tab at the drop index and removes the emptied stack', () => {
  const layout = movePanel(defaultLayout(WS), 'inspector', { kind: 'tab', stackId: 's1', index: 0 }, WS);
  assert.deepEqual(plain(layout.tree.children[0]), split('row', [
    viewport(),
    stack('s1', ['inspector', 'hierarchy', 'assets', 'problems'], 'inspector'),
  ], [null, 300]));
});

test('movePanel reorders tabs inside the same stack', () => {
  const toEnd = movePanel(defaultLayout(WS), 'hierarchy', { kind: 'tab', stackId: 's1', index: 3 }, WS);
  assert.deepEqual(plain(stackWith(toEnd, 'hierarchy').panels), ['assets', 'problems', 'hierarchy']);
  const toStart = movePanel(defaultLayout(WS), 'problems', { kind: 'tab', stackId: 's1', index: 0 }, WS);
  assert.deepEqual(plain(stackWith(toStart, 'problems')), stack('s1', ['problems', 'hierarchy', 'assets'], 'problems'));
});

test('movePanel splits the viewport and gives the moved panel half of it', () => {
  const layout = movePanel(defaultLayout(WS), 'timeline', { kind: 'split', stackId: 'viewport', side: 'left' }, WS);
  assert.deepEqual(plain(layout.tree), split('row', [
    stack('s4', ['timeline']),
    viewport(),
    split('column', [stack('s1', ['hierarchy', 'assets', 'problems']), stack('s2', ['inspector'])], [HAP, null]),
  ], [486, null, 300]));
});

test('movePanel splits a stack edge, respecting minimums', () => {
  const layout = movePanel(defaultLayout(WS), 'assets', { kind: 'split', stackId: 's1', side: 'bottom' }, WS);
  assert.deepEqual(plain(layout.tree.children[0].children[1]), split('column', [
    stack('s1', ['hierarchy', 'problems']),
    stack('s4', ['assets']),
    stack('s2', ['inspector']),
  ], [159, 159, null]));
  const wide = movePanel(defaultLayout(WS), 'inspector', { kind: 'split', stackId: 's1', side: 'left' }, WS);
  assert.deepEqual(plain(wide.tree.children[0]), split('row', [
    viewport(),
    stack('s4', ['inspector']),
    stack('s1', ['hierarchy', 'assets', 'problems']),
  ], [null, 200, 200]));
});

test('movePanel docks at a workspace edge with the default size capped at a third', () => {
  const inspector = movePanel(defaultLayout(WS), 'inspector', { kind: 'edge', side: 'right' }, WS);
  assert.equal(inspector.tree.dir, 'row');
  assert.deepEqual(plain(inspector.tree.sizes), [null, 300]);
  assert.deepEqual(plain(inspector.tree.children[1]), stack('s4', ['inspector']));
  assert.deepEqual(plain(inspector.tree.children[0].children[0].sizes), [null, 300]);
  const short = { width: 1280, height: 600 };
  const timeline = movePanel(defaultLayout(short), 'timeline', { kind: 'edge', side: 'top' }, short);
  assert.equal(timeline.tree.dir, 'column');
  assert.deepEqual(plain(timeline.tree.sizes), [200, null]);
  assert.deepEqual(plain(timeline.tree.children[0]), stack('s4', ['timeline']));
  const narrow = { width: 600, height: 680 };
  const left = movePanel(defaultLayout(narrow), 'timeline', { kind: 'edge', side: 'left' }, narrow);
  assert.equal(left.tree.sizes[0], 320);
});

test('canDrop refuses the viewport center, the sole tab of its own stack and malformed drops', () => {
  const layout = defaultLayout(WS);
  assert.equal(canDrop(layout, 'inspector', { kind: 'tab', stackId: 'viewport', index: 0 }), false);
  assert.equal(canDrop(layout, 'inspector', { kind: 'tab', stackId: 's2', index: 0 }), false);
  assert.equal(canDrop(layout, 'inspector', { kind: 'split', stackId: 's2', side: 'top' }), false);
  assert.equal(canDrop(layout, 'timeline', { kind: 'tab', stackId: 's3', index: 0 }), false);
  assert.equal(canDrop(layout, 'inspector', { kind: 'tab', stackId: 's9', index: 0 }), false);
  assert.equal(canDrop(layout, 'inspector', { kind: 'tab', stackId: 's1', index: 4 }), false);
  assert.equal(canDrop(layout, 'inspector', { kind: 'tab', stackId: 's1', index: 1.5 }), false);
  assert.equal(canDrop(layout, 'inspector', { kind: 'split', stackId: 's1', side: 'middle' }), false);
  assert.equal(canDrop(layout, 'inspector', { kind: 'edge', side: 'center' }), false);
  assert.equal(canDrop(layout, 'inspector', { kind: 'float' }), false);
  assert.equal(canDrop(layout, 'inspector', null), false);
  assert.equal(canDrop(layout, 'console', { kind: 'edge', side: 'left' }), false);
  assert.equal(canDrop(layout, 'tools', { kind: 'edge', side: 'left' }), false);
  assert.equal(canDrop(closePanel(layout, 'inspector'), 'inspector', { kind: 'edge', side: 'left' }), false);
  assert.throws(() => movePanel(layout, 'inspector', { kind: 'tab', stackId: 's2', index: 0 }, WS), /not allowed/);
});

test('canDrop accepts tabs, splits of the viewport and of a multi-tab own stack, and edges', () => {
  const layout = defaultLayout(WS);
  assert.equal(canDrop(layout, 'inspector', { kind: 'tab', stackId: 's1', index: 3 }), true);
  assert.equal(canDrop(layout, 'inspector', { kind: 'split', stackId: 'viewport', side: 'right' }), true);
  assert.equal(canDrop(layout, 'assets', { kind: 'split', stackId: 's1', side: 'left' }), true);
  assert.equal(canDrop(layout, 'assets', { kind: 'tab', stackId: 's1', index: 0 }), true);
  assert.equal(canDrop(layout, 'inspector', { kind: 'edge', side: 'left' }), true);
});

test('resizeSplit sets the controlled child and clamps to the gutter bounds', () => {
  const layout = defaultLayout(WS);
  assert.deepEqual(plain(resizeSplit(layout, [0], 0, 400.4, WS).tree.children[0].sizes), [null, 400]);
  assert.deepEqual(plain(resizeSplit(layout, [0], 0, 10, WS).tree.children[0].sizes), [null, 200]);
  assert.deepEqual(plain(resizeSplit(layout, [0], 0, 5000, WS).tree.children[0].sizes), [null, 300 + VIEW_WIDTH - 240]);
  assert.equal(resizeSplit(layout, [0, 1], 0, 150, WS).tree.children[0].children[1].sizes[0], 150);
  assert.deepEqual(plain(resizeSplit(expanded(), [], 0, 300, WS).tree.sizes), [null, 300]);
  assert.ok(isDeepFrozen(resizeSplit(layout, [0], 0, 250, WS)));
});

test('resizeSplit throws on an invalid path, index or value', () => {
  const layout = defaultLayout(WS);
  assert.throws(() => resizeSplit(layout, [1], 0, 100, WS), /No split/);
  assert.throws(() => resizeSplit(layout, [5], 0, 100, WS), /No split/);
  assert.throws(() => resizeSplit(layout, [0], 1, 100, WS), /No gutter/);
  assert.throws(() => resizeSplit(layout, [0], -1, 100, WS), /No gutter/);
  assert.throws(() => resizeSplit(layout, [0], 0, Number.NaN, WS), /finite/);
});

test('timelineFold reports the foldable Timeline stack and its state', () => {
  assert.deepEqual(timelineFold(defaultLayout(WS)), { stackId: 's3', folded: true });
  assert.deepEqual(timelineFold(expanded()), { stackId: 's3', folded: false });
});

test('timelineFold is null when the Timeline is closed, not active, the fill child or in a row split', () => {
  const closed = closePanel(defaultLayout(WS), 'timeline');
  assert.equal(timelineFold(closed), null);
  assert.equal(closed.timelineFolded, true);
  const sharing = normalize({ ...plain(movePanel(defaultLayout(WS), 'assets', { kind: 'tab', stackId: 's3', index: 1 }, WS)), timelineFolded: true });
  assert.equal(stackWith(sharing, 'timeline').active, 'assets');
  assert.equal(timelineFold(sharing), null);
  assert.equal(computeRects(sharing, WS).stacks.get('s3').height, 220);
  const fill = normalize(layoutOf(split('row', [
    viewport(),
    split('column', [stack('a', ['inspector']), stack('b', ['timeline'])], [200, null]),
  ], [null, 320]), {}, true));
  assert.equal(timelineFold(fill), null);
  const row = movePanel(defaultLayout(WS), 'timeline', { kind: 'split', stackId: 'viewport', side: 'left' }, WS);
  assert.equal(timelineFold(normalize({ ...plain(row), timelineFolded: true })), null);
});

test('setTimelineFolded sets the flag and throws when the Timeline is not foldable', () => {
  const layout = setTimelineFolded(defaultLayout(WS), false);
  assert.equal(layout.timelineFolded, false);
  assert.equal(setTimelineFolded(layout, true).timelineFolded, true);
  assert.ok(isDeepFrozen(layout));
  assert.throws(() => setTimelineFolded(closePanel(layout, 'timeline'), true), /not foldable/);
  const row = movePanel(defaultLayout(WS), 'timeline', { kind: 'split', stackId: 'viewport', side: 'left' }, WS);
  assert.throws(() => setTimelineFolded(row, true), /not foldable/);
});

test('a folded Timeline is one tab bar high, keeps its stored size and has no resize gutter', () => {
  const layout = defaultLayout(WS);
  const rects = computeRects(layout, WS);
  assert.equal(rects.stacks.get('s3').height, TAB_BAR_HEIGHT);
  assert.equal(rects.stacks.get('s3').y, TOP + 4);
  assert.equal(layout.tree.sizes[1], 220);
  assert.equal(rects.gutters.some((gutter) => gutter.path.length === 0), false);
  assert.throws(() => resizeSplit(layout, [], 0, 300, WS), /folded Timeline/);
  const tall = resizeSplit(layout, [0, 1], 0, 5000, WS);
  assert.equal(computeRects(tall, WS).stacks.get('s3').height, TAB_BAR_HEIGHT);
});

test('activating a panel of the Timeline stack expands it; other activations keep the flag', () => {
  assert.equal(activatePanel(defaultLayout(WS), 'timeline').timelineFolded, false);
  assert.equal(activatePanel(defaultLayout(WS), 'assets').timelineFolded, true);
  const sharing = normalize({ ...plain(movePanel(defaultLayout(WS), 'assets', { kind: 'tab', stackId: 's3', index: 1 }, WS)), timelineFolded: true });
  assert.equal(activatePanel(sharing, 'assets').timelineFolded, false);
});

test('reopening the Timeline or a panel into its stack expands it', () => {
  const closed = closePanel(defaultLayout(WS), 'timeline');
  assert.equal(openPanel(closed, 'timeline', WS).timelineFolded, false);
  const sharing = normalize({ ...plain(movePanel(defaultLayout(WS), 'assets', { kind: 'tab', stackId: 's3', index: 1 }, WS)), timelineFolded: true });
  const withoutAssets = closePanel(sharing, 'assets');
  assert.deepEqual(timelineFold(withoutAssets), { stackId: 's3', folded: true });
  assert.equal(openPanel(withoutAssets, 'assets', WS).timelineFolded, false);
  const inspector = closePanel(defaultLayout(WS), 'inspector');
  assert.equal(openPanel(inspector, 'inspector', WS).timelineFolded, true);
});

test('moving the Timeline or dropping a tab into its stack expands it; other moves keep the flag', () => {
  const layout = defaultLayout(WS);
  assert.equal(movePanel(layout, 'timeline', { kind: 'edge', side: 'top' }, WS).timelineFolded, false);
  assert.equal(movePanel(layout, 'assets', { kind: 'tab', stackId: 's3', index: 0 }, WS).timelineFolded, false);
  assert.equal(movePanel(layout, 'assets', { kind: 'split', stackId: 'viewport', side: 'left' }, WS).timelineFolded, true);
  assert.equal(movePanel(layout, 'inspector', { kind: 'tab', stackId: 's1', index: 0 }, WS).timelineFolded, true);
});

test('closing panels and resizing keep the flag', () => {
  const layout = defaultLayout(WS);
  assert.equal(closePanel(layout, 'assets').timelineFolded, true);
  assert.equal(closePanel(layout, 'timeline').timelineFolded, true);
  assert.equal(resizeSplit(layout, [0], 0, 250, WS).timelineFolded, true);
});

test('operations never mutate their input', () => {
  const layout = defaultLayout(WS);
  const snapshot = plain(layout);
  closePanel(layout, 'inspector');
  movePanel(layout, 'inspector', { kind: 'tab', stackId: 's1', index: 0 }, WS);
  resizeSplit(layout, [0], 0, 250, WS);
  activatePanel(layout, 'timeline');
  setTimelineFolded(layout, false);
  assert.deepEqual(plain(layout), snapshot);
});

test('stored layouts survive a JSON round trip', () => {
  let layout = movePanel(defaultLayout(WS), 'timeline', { kind: 'split', stackId: 'viewport', side: 'bottom' }, WS);
  layout = closePanel(layout, 'problems');
  layout = resizeSplit(layout, [0], 0, 150, WS);
  layout = setTimelineFolded(layout, true);
  const { layout: restored, warning } = restoreLayout(JSON.parse(JSON.stringify(layout)), WS);
  assert.equal(warning, null);
  assert.deepEqual(plain(restored), plain(layout));
});

test('dropAt gives tab bars priority over workspace edge strips', () => {
  const layout = defaultLayout(WS);
  const rects = computeRects(layout, WS);
  assert.deepEqual(dropAt(layout, rects, { x: 1100, y: 5 }, 'inspector', WS), {
    drop: { kind: 'tab', stackId: 's1', index: 3 },
    preview: { x: 980, y: 0, width: 300, height: 28 },
  });
  assert.deepEqual(dropAt(layout, rects, { x: 600, y: 675 }, 'inspector', WS), {
    drop: { kind: 'tab', stackId: 's3', index: 1 },
    preview: { x: 0, y: TOP + 4, width: 1280, height: 28 },
  });
  assert.deepEqual(dropAt(layout, rects, { x: 1275, y: 660 }, 'assets', WS).drop, { kind: 'tab', stackId: 's3', index: 1 });
  assert.equal(dropAt(layout, rects, { x: 600, y: 660 }, 'timeline', WS), null);
});

test('dropAt over a tab bar inserts at the measured index with a caret preview', () => {
  const layout = defaultLayout(WS);
  const rects = { ...computeRects(layout, WS), tabs: new Map([['s1', S1_TABS]]) };
  assert.deepEqual(dropAt(layout, rects, { x: 1070, y: 20 }, 'inspector', WS), {
    drop: { kind: 'tab', stackId: 's1', index: 1 },
    preview: { x: 1059, y: 0, width: 2, height: 28 },
  });
  assert.deepEqual(dropAt(layout, rects, { x: 1250, y: 20 }, 'inspector', WS), {
    drop: { kind: 'tab', stackId: 's1', index: 3 },
    preview: { x: 1209, y: 0, width: 2, height: 28 },
  });
});

test('dropAt picks the nearest workspace edge strip outside tab bars', () => {
  const layout = defaultLayout(WS);
  const rects = computeRects(layout, WS);
  assert.deepEqual(dropAt(layout, rects, { x: 5, y: 300 }, 'inspector', WS), {
    drop: { kind: 'edge', side: 'left' },
    preview: { x: 0, y: 0, width: 300, height: 680 },
  });
  assert.deepEqual(dropAt(layout, rects, { x: 500, y: 5 }, 'inspector', WS), {
    drop: { kind: 'edge', side: 'top' },
    preview: { x: 0, y: 0, width: 1280, height: 226 },
  });
  assert.equal(dropAt(layout, rects, { x: 1278, y: 400 }, 'assets', WS).drop.side, 'right');
});

test('dropAt sizes the edge preview from the workspace when the content is larger', () => {
  const layout = normalize(layoutOf(split('column', [
    viewport(),
    stack('s1', ['hierarchy']),
    stack('s2', ['assets']),
    stack('s3', ['problems']),
    stack('s4', ['inspector']),
  ], [null, 96, 96, 96, 96])));
  const workspace = { width: 1280, height: 300 };
  const rects = computeRects(layout, workspace);
  assert.equal(rects.height, VIEWPORT_MIN.height + 4 * 96 + 16);
  const result = dropAt(layout, rects, { x: 600, y: 5 }, 'inspector', workspace);
  assert.deepEqual(result, {
    drop: { kind: 'edge', side: 'top' },
    preview: { x: 0, y: 0, width: 1280, height: 100 },
  });
  assert.equal(movePanel(layout, 'inspector', result.drop, workspace).tree.sizes[0], 100);
});

test('dropAt uses stack edge zones, then the stack center with an insertion caret', () => {
  const layout = defaultLayout(WS);
  const rects = computeRects(layout, WS);
  assert.deepEqual(dropAt(layout, rects, { x: 990, y: 120 }, 'inspector', WS), {
    drop: { kind: 'split', stackId: 's1', side: 'left' },
    preview: { x: 980, y: 0, width: 200, height: HAP },
  });
  const bottom = dropAt(layout, rects, { x: 1130, y: HAP - 5 }, 'timeline', WS);
  assert.deepEqual(bottom.drop, { kind: 'split', stackId: 's1', side: 'bottom' });
  assert.deepEqual(bottom.preview, { x: 980, y: HAP - 159, width: 300, height: 159 });
  assert.deepEqual(dropAt(layout, rects, { x: 1130, y: 160 }, 'timeline', WS), {
    drop: { kind: 'tab', stackId: 's1', index: 3 },
    preview: { x: 980, y: 0, width: 300, height: HAP },
  });
  const measured = { ...rects, tabs: new Map([['s1', S1_TABS]]) };
  assert.deepEqual(dropAt(layout, measured, { x: 1130, y: 160 }, 'timeline', WS), {
    drop: { kind: 'tab', stackId: 's1', index: 3 },
    preview: { x: 980, y: 0, width: 300, height: HAP },
    caret: { x: 1209, y: 0, width: 2, height: 28 },
  });
});

test('dropAt accepts viewport edges and refuses its center, own sole stack, gutters and outside points', () => {
  const layout = defaultLayout(WS);
  const rects = computeRects(layout, WS);
  const left = dropAt(layout, rects, { x: 30, y: 300 }, 'timeline', WS);
  assert.deepEqual(left, {
    drop: { kind: 'split', stackId: 'viewport', side: 'left' },
    preview: { x: 0, y: 0, width: 486, height: TOP },
  });
  assert.equal(dropAt(layout, rects, { x: VIEW_WIDTH / 2, y: TOP / 2 }, 'timeline', WS), null);
  assert.equal(dropAt(layout, rects, { x: 1130, y: 480 }, 'inspector', WS), null);
  assert.equal(dropAt(layout, rects, { x: 1100, y: HAP + 10 }, 'inspector', WS), null);
  assert.equal(dropAt(layout, rects, { x: VIEW_WIDTH + 2, y: 300 }, 'inspector', WS), null);
  assert.equal(dropAt(layout, rects, { x: -1, y: 200 }, 'inspector', WS), null);
  assert.equal(dropAt(layout, rects, { x: 300, y: 700 }, 'inspector', WS), null);
});

test('resizeSplit keeps shrunk siblings on screen so the dragged edge follows the request', () => {
  const ws = { width: 1070, height: 430 };
  let layout = setTimelineFolded(defaultLayout(ws), false);
  layout = movePanel(layout, 'problems', { kind: 'edge', side: 'bottom' }, ws);
  const before = computeRects(layout, ws);
  const gutter = before.gutters.find((candidate) => candidate.path.length === 0 && candidate.index === 0);
  assert.equal(gutter.value < 220, true);
  const resized = resizeSplit(layout, gutter.path, gutter.index, gutter.value + 10, ws);
  const after = computeRects(resized, ws);
  const timeline = stackWith(resized, 'timeline').id;
  const problems = stackWith(resized, 'problems').id;
  assert.equal(after.stacks.get(timeline).height, gutter.max);
  assert.equal(after.stacks.get(timeline).height >= gutter.value, true);
  assert.equal(after.stacks.get(problems).height, before.stacks.get(problems).height);
  assert.equal(resized.tree.sizes[2], before.stacks.get(problems).height);
});

test('resizeSplit leaves a folded sibling stored size untouched', () => {
  const layout = resizeSplit(defaultLayout(WS), [0], 0, 250, WS);
  assert.equal(layout.tree.sizes[1], 220);
});

test('validateLayout rejects trees deeper than 32 levels and sizes above 100000 px', () => {
  let deep = viewport();
  for (let level = 0; level < 20000; level += 1) deep = split(level % 2 ? 'row' : 'column', [deep], [null]);
  assert.match(validateLayout(layoutOf(deep)), /deeper than 32/);
  const { layout, warning } = restoreLayout(layoutOf(deep), WS);
  assert.match(warning, /deeper than 32/);
  assert.deepEqual(plain(layout), plain(defaultLayout(WS)));
  let shallow = viewport();
  for (let level = 0; level < 32; level += 1) shallow = split('row', [shallow], [null]);
  assert.equal(validateLayout(layoutOf(shallow)), null);
  const huge = layoutOf(split('row', [viewport(), stack('a', ['assets'])], [null, 1e308]));
  assert.match(validateLayout(huge), /must not exceed 100000 px/);
  assert.equal(validateLayout(layoutOf(split('row', [viewport(), stack('a', ['assets'])], [null, 100000]))), null);
});

test('dropAt keeps the tab caret inside the stack', () => {
  const layout = defaultLayout(WS);
  const rects = { ...computeRects(layout, WS), tabs: new Map([['s1', [
    { x: 980, y: 0, width: 150, height: 28 },
    { x: 1130, y: 0, width: 150, height: 28 },
    { x: 1280, y: 0, width: 0, height: 28 },
  ]]]) };
  const result = dropAt(layout, rects, { x: 1275, y: 10 }, 'inspector', WS);
  assert.deepEqual(result.preview, { x: 1278, y: 0, width: 2, height: 28 });
  const center = dropAt(layout, rects, { x: 1130, y: 160 }, 'inspector', WS);
  assert.deepEqual(center.caret, { x: 1278, y: 0, width: 2, height: 28 });
});
