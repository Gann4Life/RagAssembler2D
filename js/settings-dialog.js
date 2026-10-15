import { SETTING_SPECS } from './settings.js';
import { displayUnit, fromDisplay, toDisplay } from './units.js';

/**
 * Document data shown in the Settings popover, backed by the editor core.
 * @typedef {object} SettingsDocument
 * @property {() => number} pixelsPerMeter Reads the root's `units.pixelsPerMeter`.
 * @property {(value: number) => void} setPixelsPerMeter Commits a new value as one undo step.
 * @property {() => boolean} editable Whether the document may be edited now.
 */

/**
 * @typedef {object} SettingsPopover
 * @property {() => void} close Closes the popover without moving focus; pending valid number edits are committed.
 *   Idempotent.
 * @property {() => void} refresh Re-reads every value and the document's editability.
 */

const DISPLAY_MODES = Object.freeze([
  Object.freeze({ value: 'shapes', label: 'Shapes' }),
  Object.freeze({ value: 'sprites', label: 'Sprites' }),
  Object.freeze({ value: 'both', label: 'Both' }),
]);
const DISPLAY_DECIMALS = 4;
const CONVERSION_PRECISION = 12;

let popoverCount = 0;

function formatNumber(value) {
  return Number.isFinite(value) ? String(Number(value.toFixed(DISPLAY_DECIMALS))) : '';
}

function parseNumber(text) {
  const trimmed = text.trim();
  if (trimmed === '') return Number.NaN;
  return Number(trimmed);
}

function roundConversion(value) {
  return Number.isFinite(value) ? Number(value.toPrecision(CONVERSION_PRECISION)) : value;
}

function inRange(spec, value) {
  if (!Number.isFinite(value)) return false;
  if (spec.type === 'integer' && !Number.isInteger(value)) return false;
  return value >= spec.min && value <= spec.max;
}

/**
 * Opens the Settings popover below a button, aligned to its right edge: a non-modal `role="dialog"` labelled
 * "Settings" with Grid, Snapping, Display and Document controls (`DESIGN.md` §5.3). Focus moves to its first
 * control and Tab wraps inside it. Esc closes it and returns focus to the button; a press outside closes it
 * without moving focus. Checkboxes and radios apply at once through `settings.set`; number fields apply on Enter
 * or blur, are marked `aria-invalid` while invalid, and revert on blur. Grid size is shown in px at the
 * document's pixels per meter. Pixels per meter is read-only while `document.editable()` is false.
 * Sets `aria-expanded` and `aria-controls` on the button while open.
 * @param {HTMLElement} button The Settings button.
 * @param {{ settings: import('./settings.js').Settings, document: SettingsDocument }} options
 * @returns {SettingsPopover}
 */
export function openSettings(button, { settings, document: documentData }) {
  const doc = button.ownerDocument;
  const dialog = doc.createElement('div');
  dialog.className = 'popover settings-popover';
  dialog.id = `settings-${++popoverCount}`;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Settings');

  const element = (tag, props = {}, children = []) => {
    const node = doc.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  };
  const fieldId = (name) => `${dialog.id}-${name}`;
  const group = (legend, rows) => element('fieldset', { className: 'settings-group' }, [element('legend', { textContent: legend }), ...rows]);
  const checkbox = (name, label) => {
    const input = element('input', { type: 'checkbox', id: fieldId(name) });
    return { input, row: element('label', { className: 'settings-check' }, [input, label]) };
  };
  const numberField = (name, label, unit, attributes) => {
    const input = element('input', { type: 'number', id: fieldId(name), step: 'any', ...attributes });
    const unitLabel = element('span', { className: 'settings-unit', textContent: unit });
    unitLabel.setAttribute('aria-hidden', 'true');
    const fullLabel = unit ? `${label} (${unit})` : label;
    const row = element('div', { className: 'settings-row' }, [element('label', { htmlFor: input.id, textContent: label }), input, unitLabel]);
    input.setAttribute('aria-label', fullLabel);
    return { input, row };
  };

  const showGrid = checkbox('grid-visible', 'Show grid');
  const gridSize = numberField('grid-size', 'Grid size', displayUnit('m'), { min: '0' });
  const subdivisions = numberField('grid-subdivisions', 'Subdivisions', '', {
    min: String(SETTING_SPECS['grid.subdivisions'].min),
    max: String(SETTING_SPECS['grid.subdivisions'].max),
    step: '1',
  });
  const snapGrid = checkbox('snap-grid', 'Snap to grid');
  const radios = DISPLAY_MODES.map((mode) => {
    const input = element('input', { type: 'radio', name: fieldId('display'), value: mode.value, id: fieldId(`display-${mode.value}`) });
    return { input, row: element('label', { className: 'settings-check' }, [input, mode.label]) };
  });
  const displayGroup = group('Display', radios.map((radio) => radio.row));
  displayGroup.setAttribute('role', 'radiogroup');
  const pixelsPerMeter = numberField('pixels-per-meter', 'Pixels per meter', 'px/m', { min: '0' });

  dialog.append(
    group('Grid', [showGrid.row, gridSize.row, subdivisions.row]),
    group('Snapping', [snapGrid.row]),
    displayGroup,
    group('Document', [pixelsPerMeter.row]),
  );

  const ppm = () => documentData.pixelsPerMeter();

  const numbers = [
    {
      input: gridSize.input,
      current: () => formatNumber(toDisplay(settings.get('grid.size'), 'm', ppm())),
      parse: (value) => roundConversion(fromDisplay(value, 'm', ppm())),
      valid: (value) => inRange(SETTING_SPECS['grid.size'], value),
      apply: (value) => settings.set('grid.size', value),
      editable: () => true,
    },
    {
      input: subdivisions.input,
      current: () => formatNumber(settings.get('grid.subdivisions')),
      parse: (value) => value,
      valid: (value) => inRange(SETTING_SPECS['grid.subdivisions'], value),
      apply: (value) => settings.set('grid.subdivisions', value),
      editable: () => true,
    },
    {
      input: pixelsPerMeter.input,
      current: () => formatNumber(ppm()),
      parse: (value) => value,
      valid: (value) => Number.isFinite(value) && value > 0,
      apply: (value) => {
        if (value !== ppm()) documentData.setPixelsPerMeter(value);
      },
      editable: () => documentData.editable(),
    },
  ];

  const pending = (field) => field.input.value !== field.current();

  const markInvalid = (field, invalid) => {
    if (invalid) field.input.setAttribute('aria-invalid', 'true');
    else field.input.removeAttribute('aria-invalid');
  };

  const revert = (field) => {
    field.input.value = field.current();
    markInvalid(field, false);
  };

  const commit = (field) => {
    if (!pending(field) || !field.editable()) {
      revert(field);
      return true;
    }
    const value = field.parse(parseNumber(field.input.value));
    if (!field.valid(value)) {
      markInvalid(field, true);
      return false;
    }
    field.apply(value);
    revert(field);
    return true;
  };

  const refresh = () => {
    showGrid.input.checked = settings.get('grid.visible');
    snapGrid.input.checked = settings.get('snap.grid');
    for (const radio of radios) radio.input.checked = radio.input.value === settings.get('display.mode');
    const editable = documentData.editable();
    pixelsPerMeter.input.readOnly = !editable;
    pixelsPerMeter.input.title = editable ? '' : 'Pixels per meter is read-only outside Edit mode';
    for (const field of numbers) if (doc.activeElement !== field.input || !field.editable()) revert(field);
  };

  showGrid.input.addEventListener('change', () => settings.set('grid.visible', showGrid.input.checked));
  snapGrid.input.addEventListener('change', () => settings.set('snap.grid', snapGrid.input.checked));
  for (const radio of radios) {
    radio.input.addEventListener('change', () => {
      if (radio.input.checked) settings.set('display.mode', radio.input.value);
    });
  }
  for (const field of numbers) {
    field.input.addEventListener('input', () => {
      if (!field.editable()) return;
      markInvalid(field, !field.valid(field.parse(parseNumber(field.input.value))));
    });
    field.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commit(field);
    });
    field.input.addEventListener('blur', () => {
      if (open && !commit(field)) revert(field);
    });
  }

  const focusables = () =>
    [...dialog.querySelectorAll('input')].filter((input) => !input.disabled && (input.type !== 'radio' || input.checked));

  let open = true;
  const commitPending = () => {
    for (const field of numbers) if (!commit(field)) revert(field);
  };

  const close = () => {
    if (!open) return;
    commitPending();
    open = false;
    unsubscribe();
    doc.removeEventListener('pointerdown', onOutsidePointer, true);
    dialog.remove();
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-controls');
  };

  const onOutsidePointer = (event) => {
    if (dialog.contains(event.target) || button.contains(event.target)) return;
    close();
  };

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      const field = numbers.find((candidate) => candidate.input === event.target);
      if (field) revert(field);
      close();
      button.focus();
      return;
    }
    if (event.key !== 'Tab') return;
    const list = focusables();
    const index = list.indexOf(event.target);
    const target = event.shiftKey ? (index <= 0 ? list[list.length - 1] : null) : index === list.length - 1 ? list[0] : null;
    if (!target) return;
    event.preventDefault();
    target.focus();
  });

  const unsubscribe = settings.on('settings', refresh);

  const anchor = button.getBoundingClientRect();
  dialog.style.top = `${Math.round(anchor.bottom + 2)}px`;
  dialog.style.right = `${Math.round(doc.documentElement.clientWidth - anchor.right)}px`;
  refresh();
  doc.body.append(dialog);
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-controls', dialog.id);
  doc.addEventListener('pointerdown', onOutsidePointer, true);
  focusables()[0]?.focus();

  return { close, refresh };
}
