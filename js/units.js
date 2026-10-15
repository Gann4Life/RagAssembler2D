const DEGREES_PER_RADIAN = 180 / Math.PI;

const DISPLAY_UNITS = Object.freeze({ m: 'px', rad: '°', mult: '%' });

function requirePixelsPerMeter(pixelsPerMeter) {
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) {
    throw new RangeError(`pixelsPerMeter must be a finite number above 0, got ${pixelsPerMeter}`);
  }
  return pixelsPerMeter;
}

/**
 * Converts a data value to its UI value: `m` → px, `rad` → degrees, `mult` (0–1) → %; other units unchanged.
 * @param {number} value Value in the data unit.
 * @param {string} unit Data unit from the schema.
 * @param {number} [pixelsPerMeter] Document `units.pixelsPerMeter`; required for `m`.
 * @returns {number} Value in the display unit.
 * @throws {RangeError} When `unit` is `m` and `pixelsPerMeter` is not a finite number above 0.
 */
export function toDisplay(value, unit, pixelsPerMeter) {
  switch (unit) {
    case 'm':
      return value * requirePixelsPerMeter(pixelsPerMeter);
    case 'rad':
      return value * DEGREES_PER_RADIAN;
    case 'mult':
      return value * 100;
    default:
      return value;
  }
}

/**
 * Converts a UI value back to its data unit; inverse of `toDisplay`.
 * @param {number} value Value in the display unit.
 * @param {string} unit Data unit from the schema.
 * @param {number} [pixelsPerMeter] Document `units.pixelsPerMeter`; required for `m`.
 * @returns {number} Value in the data unit.
 * @throws {RangeError} When `unit` is `m` and `pixelsPerMeter` is not a finite number above 0.
 */
export function fromDisplay(value, unit, pixelsPerMeter) {
  switch (unit) {
    case 'm':
      return value / requirePixelsPerMeter(pixelsPerMeter);
    case 'rad':
      return value / DEGREES_PER_RADIAN;
    case 'mult':
      return value / 100;
    default:
      return value;
  }
}

/**
 * Names the UI unit of a data unit.
 * @param {string} unit Data unit from the schema.
 * @returns {string} `'px'` for `m`, `'°'` for `rad`, `'%'` for `mult`, else `unit` itself.
 */
export function displayUnit(unit) {
  return Object.hasOwn(DISPLAY_UNITS, unit) ? DISPLAY_UNITS[unit] : unit;
}
