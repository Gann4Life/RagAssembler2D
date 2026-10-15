const MIN_GAP = 8;
const FULL_GAP = 32;

/**
 * @typedef {object} GridLine
 * @property {'vertical'|'horizontal'} orientation A vertical line has a constant world `x`, a horizontal one a constant `y`.
 * @property {number} world World coordinate of the line, meters.
 * @property {number} screen Screen coordinate of the line, CSS px.
 * @property {'fine'|'coarse'} level Grid level.
 * @property {number} alpha Opacity factor, 0–1; always 1 for the coarse level.
 */

/**
 * @typedef {object} GridLines
 * @property {GridLine[]} lines Visible lines, fine before coarse; fine lines that fall on coarse ones are left out.
 * @property {{ vertical: number|null, horizontal: number|null }} axes Screen px of the Y axis (`x = 0`, vertical)
 *   and the X axis (`y = 0`, horizontal), `null` when outside the viewport.
 */

function levelSpacings(size, subdivisions, index) {
  const spacings = [];
  const minor = size / subdivisions;
  if (minor !== size) spacings.push(minor);
  spacings.push(size);
  return index < spacings.length ? spacings[index] : size * 10 ** (index - spacings.length + 1);
}

/**
 * Picks the drawn grid levels for a scale. Levels are the minor spacing (`size / subdivisions`), the major
 * spacing (`size`), then `size × 10ⁿ` for n ≥ 1, equal spacings counted once. The fine level is the finest
 * whose lines are at least 8 px apart; its opacity ramps from 0 at 8 px to 1 at 32 px. The coarse level is
 * the next one.
 * @param {number} scale Camera scale, CSS px per meter, above 0.
 * @param {number} size Major spacing, meters, above 0.
 * @param {number} subdivisions Minor lines per major spacing, integer ≥ 1.
 * @returns {{ fine: { spacing: number, alpha: number }, coarse: { spacing: number } }} Spacings in meters.
 * @throws {RangeError} When an argument is out of range.
 */
export function gridLevels(scale, size, subdivisions) {
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError(`scale must be a finite number above 0, got ${scale}`);
  if (!Number.isFinite(size) || size <= 0) throw new RangeError(`size must be a finite number above 0, got ${size}`);
  if (!Number.isInteger(subdivisions) || subdivisions < 1) throw new RangeError(`subdivisions must be an integer ≥ 1, got ${subdivisions}`);
  let index = 0;
  while (levelSpacings(size, subdivisions, index) * scale < MIN_GAP) index += 1;
  const fine = levelSpacings(size, subdivisions, index);
  const gap = fine * scale;
  const alpha = Math.min(1, Math.max(0, (gap - MIN_GAP) / (FULL_GAP - MIN_GAP)));
  return { fine: { spacing: fine, alpha }, coarse: { spacing: levelSpacings(size, subdivisions, index + 1) } };
}

function indexRange(min, max, spacing) {
  return { first: Math.ceil(min / spacing), last: Math.floor(max / spacing) };
}

function axisLines(orientation, min, max, toScreen, level, spacing, alpha, skipEvery) {
  const lines = [];
  const { first, last } = indexRange(min, max, spacing);
  for (let k = first; k <= last; k += 1) {
    if (skipEvery > 0 && k % skipEvery === 0) continue;
    const world = k * spacing + 0;
    lines.push({ orientation, world, screen: toScreen(world), level, alpha });
  }
  return lines;
}

/**
 * Lists the grid lines and axes visible through a camera.
 * @param {import('./camera.js').Camera} camera Camera giving the view.
 * @param {{ size: number, subdivisions: number }} grid Major spacing (meters) and subdivisions.
 * @returns {GridLines} Lines and axes in screen px.
 * @throws {RangeError} When the grid settings are out of range.
 */
export function gridLines(camera, { size, subdivisions }) {
  const { fine, coarse } = gridLevels(camera.scale, size, subdivisions);
  const view = camera.visibleBounds();
  const toScreenX = (x) => camera.worldToScreen({ x, y: 0 }).x;
  const toScreenY = (y) => camera.worldToScreen({ x: 0, y }).y;
  const ratio = Math.round(coarse.spacing / fine.spacing);
  const lines = [];
  if (fine.alpha > 0) {
    lines.push(...axisLines('vertical', view.minX, view.maxX, toScreenX, 'fine', fine.spacing, fine.alpha, ratio));
    lines.push(...axisLines('horizontal', view.minY, view.maxY, toScreenY, 'fine', fine.spacing, fine.alpha, ratio));
  }
  lines.push(...axisLines('vertical', view.minX, view.maxX, toScreenX, 'coarse', coarse.spacing, 1, 0));
  lines.push(...axisLines('horizontal', view.minY, view.maxY, toScreenY, 'coarse', coarse.spacing, 1, 0));
  const inside = (value, min, max) => value >= min && value <= max;
  return {
    lines,
    axes: {
      vertical: inside(0, view.minX, view.maxX) ? toScreenX(0) : null,
      horizontal: inside(0, view.minY, view.maxY) ? toScreenY(0) : null,
    },
  };
}
