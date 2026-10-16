import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawGizmo, formatMove, formatRotation, gizmoHandleAt, gizmoLayout, rotationSlice } from '../js/tools/transform-gizmo.js';
import { COLORS, GIZMO_SIZE, HIT_RADIUS, LINE_WIDTH } from '../js/viewport/style.js';

const PIVOT = { x: 200, y: 150 };
const DEG = Math.PI / 180;

function at(dx, dy) {
  return { x: PIVOT.x + dx, y: PIVOT.y + dy };
}

function fakeGraphics() {
  const calls = [];
  const g = { calls };
  for (const method of ['moveTo', 'lineTo', 'poly', 'rect', 'circle', 'fill', 'stroke']) {
    g[method] = (...args) => {
      calls.push([method, ...args]);
      return g;
    };
  }
  return g;
}

test('gizmoLayout places arrows, square and ring from GIZMO_SIZE around the pivot', () => {
  const layout = gizmoLayout(PIVOT, { ring: true });
  assert.ok(Object.isFrozen(layout));
  assert.deepEqual(layout.pivot, PIVOT);
  assert.deepEqual(layout.x.start, at(16, 0));
  assert.deepEqual(layout.x.base, at(46, 0));
  assert.deepEqual(layout.x.tip, at(56, 0));
  assert.deepEqual(layout.x.head, [at(56, 0), at(46, 4), at(46, -4)]);
  assert.deepEqual(layout.y.start, at(0, -16));
  assert.deepEqual(layout.y.base, at(0, -46));
  assert.deepEqual(layout.y.tip, at(0, -56));
  assert.deepEqual(layout.y.head.map(({ x, y }) => [x - PIVOT.x, y - PIVOT.y]).sort(), [[-4, -46], [0, -56], [4, -46]].sort());
  assert.deepEqual(layout.square, { x: PIVOT.x + 16, y: PIVOT.y - 28, size: 12 });
  assert.equal(layout.ring, GIZMO_SIZE.rotateRing);
  assert.equal(gizmoLayout(PIVOT, { ring: false }).ring, null);
});

test('gizmoHandleAt: nothing within 12 px of the pivot', () => {
  const layout = gizmoLayout(PIVOT, { ring: true });
  for (const [dx, dy] of [[0, 0], [12, 0], [0, -12], [8, -8], [-12, 0]]) {
    assert.equal(gizmoHandleAt(layout, at(dx, dy)), null, `${dx},${dy}`);
  }
  assert.equal(gizmoHandleAt(layout, at(12.5, 0)), 'x');
  assert.equal(gizmoHandleAt(layout, at(0, -12.5)), 'y');
});

test('gizmoHandleAt: the square grown by 2 px, first', () => {
  const layout = gizmoLayout(PIVOT, { ring: true });
  assert.equal(gizmoHandleAt(layout, at(22, -22)), 'square');
  assert.equal(gizmoHandleAt(layout, at(14, -30)), 'square');
  assert.equal(gizmoHandleAt(layout, at(30, -14)), 'square');
  assert.equal(gizmoHandleAt(layout, at(13.9, -22)), null);
  assert.equal(gizmoHandleAt(layout, at(22, -30.1)), null);
  assert.equal(gizmoHandleAt(layout, at(30.1, -22)), null);
  assert.equal(gizmoHandleAt(layout, at(22, -13.9)), null);
});

test('gizmoHandleAt: arrows within 6 px of their segment, to the tip', () => {
  const layout = gizmoLayout(PIVOT, { ring: true });
  assert.equal(gizmoHandleAt(layout, at(30, 6)), 'x');
  assert.equal(gizmoHandleAt(layout, at(30, -6)), 'x');
  assert.equal(gizmoHandleAt(layout, at(30, 6.1)), null);
  assert.equal(gizmoHandleAt(layout, at(56, 0)), 'x');
  assert.equal(gizmoHandleAt(layout, at(62, 0)), 'x');
  assert.equal(gizmoHandleAt(layout, at(62.1, 0)), null);
  assert.equal(gizmoHandleAt(layout, at(6, -40)), 'y');
  assert.equal(gizmoHandleAt(layout, at(-6.1, -40)), null);
  assert.equal(gizmoHandleAt(layout, at(0, -62)), 'y');
  assert.equal(gizmoHandleAt(layout, at(0, 30)), null);
  assert.equal(gizmoHandleAt(layout, at(-30, 0)), null);
});

test('gizmoHandleAt: the ring within 6 px of its circle, only when present', () => {
  const layout = gizmoLayout(PIVOT, { ring: true });
  const ring = (radius, angle) => at(radius * Math.cos(angle), -radius * Math.sin(angle));
  for (const angle of [0, 90 * DEG, 180 * DEG, 270 * DEG]) {
    assert.equal(gizmoHandleAt(layout, ring(66, angle)), 'ring');
    assert.equal(gizmoHandleAt(layout, ring(78, angle)), 'ring');
    assert.equal(gizmoHandleAt(layout, ring(65, angle)), null);
    assert.equal(gizmoHandleAt(layout, ring(79, angle)), null);
  }
  const plain = gizmoLayout(PIVOT, { ring: false });
  assert.equal(gizmoHandleAt(plain, ring(72, 200 * DEG)), null);
  assert.equal(gizmoHandleAt(plain, at(30, 0)), 'x');
  assert.equal(HIT_RADIUS.gizmo, 6);
});

test('formatMove converts to document pixels with one decimal', () => {
  assert.equal(formatMove({ x: 0.375, y: -0.109375 }, 32), 'Δx: 12.0 px  Δy: -3.5 px');
  assert.equal(formatMove({ x: 0, y: 0 }, 32), 'Δx: 0.0 px  Δy: 0.0 px');
  assert.equal(formatMove({ x: -0.0004, y: 0.0004 }, 100), 'Δx: 0.0 px  Δy: 0.0 px');
  assert.equal(formatMove({ x: 1.23456, y: -2 }, 100), 'Δx: 123.5 px  Δy: -200.0 px');
  assert.throws(() => formatMove({ x: 1, y: 1 }, 0), RangeError);
});

test('formatRotation shows degrees, counter-clockwise positive, one decimal', () => {
  assert.equal(formatRotation(15 * DEG), 'Δθ: 15.0°');
  assert.equal(formatRotation(-90 * DEG), 'Δθ: -90.0°');
  assert.equal(formatRotation(-0.04 * DEG), 'Δθ: 0.0°');
  assert.equal(formatRotation(0), 'Δθ: 0.0°');
  assert.equal(formatRotation(2 * Math.PI + 0.5 * DEG), 'Δθ: 360.5°');
});

test('drawGizmo draws ring, arrows, square, then the center mark, in their colors', () => {
  const g = fakeGraphics();
  const layout = gizmoLayout(PIVOT, { ring: true });
  drawGizmo(g, layout, { hover: null, active: null, mode: 'center' });
  const arm = GIZMO_SIZE.pivot;
  const dashes = g.calls.slice(0, 96);
  assert.equal(dashes.filter(([method]) => method === 'moveTo').length, 32);
  assert.equal(dashes.filter(([method]) => method === 'lineTo').length, 64);
  assert.deepEqual(dashes[0], ['moveTo', PIVOT.x + 72, PIVOT.y]);
  for (const [, x, y] of dashes) assert.ok(Math.abs(Math.hypot(x - PIVOT.x, y - PIVOT.y) - 72) < 1e-9);
  assert.notEqual(COLORS.gizmoZ, COLORS.highlight);
  assert.deepEqual(g.calls.slice(96), [
    ['stroke', { width: LINE_WIDTH.gizmo, color: COLORS.gizmoZ }],
    ['moveTo', PIVOT.x + 16, PIVOT.y],
    ['lineTo', PIVOT.x + 46, PIVOT.y],
    ['stroke', { width: LINE_WIDTH.gizmo, color: COLORS.gizmoX }],
    ['poly', [PIVOT.x + 56, PIVOT.y, PIVOT.x + 46, PIVOT.y + 4, PIVOT.x + 46, PIVOT.y - 4]],
    ['fill', { color: COLORS.gizmoX }],
    ['moveTo', PIVOT.x, PIVOT.y - 16],
    ['lineTo', PIVOT.x, PIVOT.y - 46],
    ['stroke', { width: LINE_WIDTH.gizmo, color: COLORS.gizmoY }],
    ['poly', [PIVOT.x, PIVOT.y - 56, PIVOT.x + 4, PIVOT.y - 46, PIVOT.x - 4, PIVOT.y - 46]],
    ['fill', { color: COLORS.gizmoY }],
    ['rect', PIVOT.x + 16, PIVOT.y - 28, 12, 12],
    ['fill', { color: COLORS.gizmoFree, alpha: 0.4 }],
    ['stroke', { width: LINE_WIDTH.outline, color: COLORS.gizmoFree }],
    ['moveTo', PIVOT.x - arm, PIVOT.y],
    ['lineTo', PIVOT.x + arm, PIVOT.y],
    ['moveTo', PIVOT.x, PIVOT.y - arm],
    ['lineTo', PIVOT.x, PIVOT.y + arm],
    ['stroke', { width: LINE_WIDTH.outline, color: COLORS.gizmo }],
  ]);
});

test('drawGizmo: hover and active handles are white and 1 px wider; no ring without one; last-selected mark', () => {
  const g = fakeGraphics();
  drawGizmo(g, gizmoLayout(PIVOT, { ring: true }), { hover: 'ring', active: 'x', mode: 'last' });
  const strokes = g.calls.filter(([method]) => method === 'stroke').map(([, style]) => style);
  assert.deepEqual(strokes[0], { width: LINE_WIDTH.gizmo + 1, color: 0xffffff });
  assert.deepEqual(strokes[1], { width: LINE_WIDTH.gizmo + 1, color: 0xffffff });
  assert.deepEqual(strokes[2], { width: LINE_WIDTH.gizmo, color: COLORS.gizmoY });
  assert.deepEqual(g.calls.slice(-4), [
    ['circle', PIVOT.x, PIVOT.y, GIZMO_SIZE.pivot],
    ['stroke', { width: LINE_WIDTH.outline, color: COLORS.gizmo }],
    ['circle', PIVOT.x, PIVOT.y, 1.5],
    ['fill', { color: COLORS.gizmo }],
  ]);
  const square = fakeGraphics();
  drawGizmo(square, gizmoLayout(PIVOT, { ring: false }), { hover: 'square', active: null, mode: 'center' });
  assert.equal(square.calls.some(([method, , , radius]) => method === 'circle' && radius === 72), false);
  assert.deepEqual(square.calls[0], ['moveTo', PIVOT.x + 16, PIVOT.y]);
  const rect = square.calls.findIndex(([method]) => method === 'rect');
  assert.deepEqual(square.calls[rect + 1], ['fill', { color: 0xffffff, alpha: 0.4 }]);
  assert.deepEqual(square.calls[rect + 2], ['stroke', { width: LINE_WIDTH.outline + 1, color: 0xffffff }]);
});

test('drawGizmo calls points after the arrows and before the square', () => {
  const g = fakeGraphics();
  drawGizmo(g, gizmoLayout(PIVOT, { ring: true }), {
    hover: null,
    active: null,
    mode: 'center',
    points: (graphics) => {
      assert.equal(graphics, g);
      graphics.circle(0, 0, 1);
    },
  });
  const methods = g.calls.map(([method]) => method);
  const marker = g.calls.findIndex(([method, x, y, r]) => method === 'circle' && x === 0 && y === 0 && r === 1);
  assert.ok(marker > methods.lastIndexOf('poly'));
  assert.ok(marker < methods.indexOf('rect'));
});

test('drawGizmo calls under first, before the slice and the ring', () => {
  const g = fakeGraphics();
  drawGizmo(g, gizmoLayout(PIVOT, { ring: true }), {
    hover: null,
    active: null,
    mode: 'center',
    sweep: { start: 0, angle: Math.PI / 4 },
    under: (graphics) => {
      assert.equal(graphics, g);
      assert.equal(g.calls.length, 0);
      graphics.circle(0, 0, 1);
    },
  });
  assert.deepEqual(g.calls[0], ['circle', 0, 0, 1]);
  assert.equal(g.calls[1][0], 'poly');
});

test('rotationSlice: counter-clockwise sweep turns counter-clockwise on screen', () => {
  const slice = rotationSlice({ x: 100, y: 100 }, 72, 0, Math.PI / 2);
  assert.equal(slice.full, false);
  assert.equal(slice.anticlockwise, true);
  assert.equal(slice.start, -0);
  assert.ok(Math.abs(slice.end + Math.PI / 2) < 1e-12);
  assert.deepEqual(slice.points[0], { x: 100, y: 100 });
  const last = slice.points.at(-1);
  assert.ok(Math.abs(last.x - 100) < 1e-9 && Math.abs(last.y - 28) < 1e-9);
});

test('rotationSlice: negative sweep is clockwise and ends below the press on screen', () => {
  const slice = rotationSlice({ x: 0, y: 0 }, 10, 0, -Math.PI / 3);
  assert.equal(slice.anticlockwise, false);
  const last = slice.points.at(-1);
  assert.ok(last.y > 0 && Math.abs(last.x - 5) < 1e-9);
});

test('rotationSlice: 360 degrees or more is the full disc without the pivot', () => {
  const full = rotationSlice({ x: 0, y: 0 }, 10, 1, 3 * Math.PI);
  assert.equal(full.full, true);
  assert.notDeepEqual(full.points[0], { x: 0, y: 0 });
  assert.equal(full.points.length, 72);
  assert.equal(rotationSlice({ x: 0, y: 0 }, 10, 0, -2 * Math.PI).full, true);
  assert.equal(rotationSlice({ x: 0, y: 0 }, 10, 0, 2 * Math.PI - 0.01).full, false);
});

test('rotationSlice: a SHIFT-snapped 15 degree sweep ends exactly 15 degrees from the press', () => {
  const sweep = (15 * Math.PI) / 180;
  const slice = rotationSlice({ x: 0, y: 0 }, 72, 0.3, sweep);
  assert.ok(Math.abs(slice.start - slice.end - sweep) < 1e-12);
  const last = slice.points.at(-1);
  assert.ok(Math.abs(Math.atan2(last.y, last.x) - slice.end) < 1e-9);
});
