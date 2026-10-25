import { inspectorPage } from '../inspector/page.js';
import { MIXED, editCommand } from '../inspector/rows.js';
import { actionTitle } from '../header.js';
import { attachTooltip } from '../tooltip.js';

/**
 * @typedef {object} Inspector
 * @property {() => void} destroy Removes listeners, tooltips, the pending frame callback and the panel content.
 */

const NOT_BUILT = 'Properties: not available yet';
const MIXED_TEXT = '—';
const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

const SHAPE_ICONS = Object.freeze({
  circle: '<circle cx="12" cy="12" r="7"/>',
  box: '<rect x="5" y="7" width="14" height="10"/>',
  polygon: '<path d="M12 4l7.6 5.5-2.9 9H7.3l-2.9-9z"/>',
  shape: '<path d="M5 18 12 5l7 13z"/>',
});

function svgIcon(doc, markup) {
  const icon = doc.createElement('span');
  icon.className = 'inspector-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${markup}</svg>`;
  return icon;
}

function rangeText(row) {
  const unit = row.unit === '' ? '' : ` ${row.unit}`;
  if (row.min !== undefined && row.max !== undefined) return `${row.min}–${row.max}${unit}`;
  if (row.min !== undefined) return `${row.exclusiveMin ? '>' : '≥'} ${row.min}${unit}`;
  if (row.max !== undefined) return `≤ ${row.max}${unit}`;
  return 'a number';
}

function parseNumber(text, row) {
  const normalized = text.trim().replace(',', '.');
  if (!NUMBER_PATTERN.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  if (row.min !== undefined && (row.exclusiveMin ? value <= row.min : value < row.min)) return null;
  if (row.max !== undefined && value > row.max) return null;
  return value;
}

function fieldName(row) {
  return row.unit === '' ? row.label : `${row.label} (${row.unit})`;
}

function domId(rowId, component) {
  const base = `inspector-${rowId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  return component === undefined ? base : `${base}-${component}`;
}

/**
 * Mounts the Inspector panel into a dock panel element, replacing its content. It shows the page of the selection
 * (`DESIGN.md` §5.7), redraws at most once per animation frame after selection, model, mode, playhead and history
 * events, and commits edits as one undo step each through `editCommand` and `history.execute`, `editor.setRootBody`
 * and `editor.actions.run`; a shape of the list is selected with `selection.set`. Never mutates the model itself.
 * @param {HTMLElement} element Panel element given by the dock.
 * @param {import('../editor.js').Editor} editor Editor core.
 * @returns {Inspector}
 */
export function createInspector(element, editor) {
  const { model, selection, modes, history, actions } = editor;
  const doc = element.ownerDocument;
  const view = doc.defaultView;

  const title = doc.createElement('h2');
  title.className = 'inspector-title';
  const summary = doc.createElement('p');
  summary.className = 'inspector-summary';
  const content = doc.createElement('div');
  content.className = 'inspector-content';
  element.classList.add('inspector-panel');
  element.replaceChildren(title, summary, content);

  let page = null;
  let rendered = null;
  let bindings = new Map();
  let tooltips = [];
  let frame = 0;
  let rebuilding = false;
  const inputs = new WeakMap();

  function refuse(row) {
    if (row.reason) editor.status(`${row.label}: ${row.reason}`);
  }

  function tooltip(target, text) {
    tooltips.push(attachTooltip(target, text, { placement: 'below' }));
  }

  function guarded(run, label) {
    try {
      run();
    } catch (error) {
      editor.status(`${label}: ${error?.message ?? error}`);
    }
  }

  function textField(row, component) {
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'field-input';
    input.id = domId(row.id, component);
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.row = row.id;
    if (component !== undefined) input.dataset.component = String(component);
    const numeric = row.control !== 'text';
    if (numeric) input.inputMode = 'decimal';
    const state = { row, displayed: '', captured: null, ppm: null, invalid: false, reselect: false };
    inputs.set(input, state);
    const textOf = (current) => (component === undefined ? current.text : current.text[component]);
    const valueOf = (current) => (component === undefined ? current.value : current.value?.[component]);
    const parse = (text) => (numeric ? parseNumber(text, state.row) : text);
    const setInvalid = (invalid) => {
      state.invalid = invalid;
      if (invalid) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      handle.update();
    };
    const revert = () => {
      input.value = state.displayed;
      setInvalid(false);
    };
    const commit = (announceRejection = false) => {
      const text = input.value;
      if (state.row.readOnly) {
        revert();
        return false;
      }
      if (text === state.displayed) return true;
      const value = parse(text);
      if (value === null) {
        if (announceRejection) editor.status(`${state.row.label}: ${rangeText(state.row)}`);
        return false;
      }
      const edit = state.captured ?? state.row.edit;
      if (edit === null) return false;
      state.displayed = text;
      guarded(() => {
        const command = editCommand(model, edit, value, { component, pixelsPerMeter: state.ppm ?? page.pixelsPerMeter });
        if (command !== null) history.execute(command);
      }, edit.label ?? state.row.label);
      schedule();
      return true;
    };
    const update = (current) => {
      state.row = current;
      const text = textOf(current);
      const draft = doc.activeElement === input && input.value !== state.displayed;
      state.displayed = text;
      if (!draft || current.readOnly) {
        input.value = text;
        if (state.invalid) setInvalid(false);
        if (state.reselect && doc.activeElement === input) input.select();
      }
      state.reselect = false;
      input.placeholder = valueOf(current) === MIXED ? MIXED_TEXT : '';
      input.readOnly = current.readOnly;
      input.classList.toggle('is-readonly', current.readOnly);
    };
    input.addEventListener('focus', () => {
      state.captured = state.row.edit;
      state.ppm = page.pixelsPerMeter;
    });
    input.addEventListener('input', () => {
      if (!numeric) return;
      setInvalid(input.value !== state.displayed && parse(input.value) === null);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (commit(true)) {
          state.reselect = true;
          input.select();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        revert();
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      if (rebuilding || !input.isConnected) return;
      if (!commit()) revert();
      state.captured = null;
      state.ppm = null;
    });
    const handle = attachTooltip(input, () => {
      const current = state.row;
      const name = component === undefined ? fieldName(current) : `${fieldName(current)} ${component === 0 ? 'x' : 'y'}`;
      if (current.readOnly && current.reason) return `${name} (${current.reason})`;
      if (state.invalid) return `${name} (${rangeText(current)})`;
      return name;
    }, { placement: 'below' });
    tooltips.push(handle);
    update(row);
    return { element: input, update };
  }

  function vecField(row) {
    const wrapper = doc.createElement('div');
    wrapper.className = 'inspector-vec2';
    const parts = [0, 1].map((component) => {
      const field = textField(row, component);
      field.element.setAttribute('aria-label', `${row.label} ${component === 0 ? 'x' : 'y'}`);
      const cell = doc.createElement('span');
      cell.className = 'inspector-component';
      const prefix = doc.createElement('span');
      prefix.className = 'inspector-prefix';
      prefix.setAttribute('aria-hidden', 'true');
      prefix.textContent = component === 0 ? 'x' : 'y';
      cell.append(prefix, field.element);
      wrapper.append(cell);
      return field;
    });
    return { element: wrapper, update: (current) => parts.forEach((part) => part.update(current)) };
  }

  function checkboxField(row) {
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.className = 'inspector-checkbox';
    input.id = domId(row.id);
    input.dataset.row = row.id;
    const state = { row };
    const update = (current) => {
      state.row = current;
      input.checked = current.value === true;
      input.indeterminate = current.value === MIXED;
      input.setAttribute('aria-disabled', String(current.readOnly));
    };
    input.addEventListener('click', (event) => {
      if (!state.row.readOnly) return;
      event.preventDefault();
      refuse(state.row);
    });
    input.addEventListener('change', () => {
      const { edit } = state.row;
      if (state.row.readOnly || edit === null) return;
      guarded(() => {
        const command = editCommand(model, edit, input.checked, { pixelsPerMeter: page.pixelsPerMeter });
        if (command !== null) history.execute(command);
      }, edit.label);
      schedule();
    });
    tooltip(input, () => (state.row.readOnly && state.row.reason ? `${state.row.label} (${state.row.reason})` : state.row.label));
    update(row);
    return { element: input, update };
  }

  function selectField(row) {
    const select = doc.createElement('select');
    select.className = 'field-input inspector-select';
    select.id = domId(row.id);
    select.dataset.row = row.id;
    const state = { row, signature: '' };
    const update = (current) => {
      state.row = current;
      const signature = JSON.stringify([current.value === null, current.options]);
      if (signature !== state.signature) {
        state.signature = signature;
        const options = [];
        if (current.value === null) {
          const none = doc.createElement('option');
          none.value = '';
          none.textContent = '(none)';
          none.disabled = true;
          options.push(none);
        }
        for (const option of current.options ?? []) {
          const element = doc.createElement('option');
          element.value = String(option.value);
          element.textContent = option.label;
          options.push(element);
        }
        select.replaceChildren(...options);
      }
      select.value = current.value === null ? '' : String(current.value);
      select.setAttribute('aria-disabled', String(current.readOnly));
    };
    select.addEventListener('mousedown', (event) => {
      if (!state.row.readOnly) return;
      event.preventDefault();
      refuse(state.row);
    });
    select.addEventListener('keydown', (event) => {
      if (!state.row.readOnly || event.key === 'Tab') return;
      event.preventDefault();
      refuse(state.row);
    });
    select.addEventListener('change', () => {
      const chosen = Number(select.value);
      const applied = !state.row.readOnly && select.value !== '' && editor.setRootBody(chosen);
      if (!applied) update(state.row);
      schedule();
    });
    tooltip(select, () => (state.row.readOnly && state.row.reason ? `${state.row.label} (${state.row.reason})` : state.row.label));
    update(row);
    return { element: select, update };
  }

  function listField(row) {
    const list = doc.createElement('ul');
    list.className = 'inspector-list';
    list.setAttribute('aria-label', row.label);
    const state = { signature: null };
    const update = (current) => {
      const signature = JSON.stringify([current.value === MIXED, current.items]);
      if (signature === state.signature) return;
      state.signature = signature;
      if (current.value === MIXED) {
        const item = doc.createElement('li');
        item.className = 'inspector-list-mixed';
        item.textContent = MIXED_TEXT;
        list.replaceChildren(item);
        return;
      }
      list.replaceChildren(...(current.items ?? []).map((entry) => {
        const item = doc.createElement('li');
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'inspector-list-item';
        button.dataset.row = current.id;
        button.dataset.uid = String(entry.uid);
        const label = doc.createElement('span');
        label.className = entry.muted ? 'inspector-list-label is-muted' : 'inspector-list-label';
        label.textContent = entry.label;
        button.append(svgIcon(doc, SHAPE_ICONS[entry.icon] ?? SHAPE_ICONS.shape), label);
        button.addEventListener('click', () => {
          if (model.get(entry.uid)) selection.set([entry.uid]);
        });
        item.append(button);
        return item;
      }));
    };
    update(row);
    return { element: list, update };
  }

  function buttonField(row) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'hierarchy-button inspector-action';
    button.dataset.row = row.id;
    const state = { row };
    const enabled = () => actions.isEnabled(state.row.edit.action);
    const update = (current) => {
      state.row = current;
      button.textContent = current.label;
      button.setAttribute('aria-disabled', String(!enabled()));
      handle.update();
    };
    button.addEventListener('click', () => {
      const { edit } = state.row;
      actions.run(edit.action, { label: edit.label });
      schedule();
    });
    const handle = attachTooltip(button, () => {
      const on = enabled();
      return actionTitle({ id: state.row.edit.action, label: state.row.label }, on, on ? null : actions.reason(state.row.edit.action));
    }, { placement: 'below' });
    tooltips.push(handle);
    update(row);
    return { element: button, update };
  }

  function readoutField(row) {
    const output = doc.createElement('span');
    output.className = 'inspector-readout';
    output.tabIndex = 0;
    output.dataset.row = row.id;
    const state = { row };
    const update = (current) => {
      state.row = current;
      output.textContent = current.value === MIXED ? MIXED_TEXT : String(current.value ?? '');
    };
    tooltip(output, () => {
      const name = fieldName(state.row);
      return state.row.reason ? `${name} (${state.row.reason})` : name;
    });
    update(row);
    return { element: output, update };
  }

  const FIELD_BUILDERS = Object.freeze({
    text: (row) => textField(row),
    number: (row) => textField(row),
    vec2: vecField,
    checkbox: checkboxField,
    select: selectField,
    list: listField,
    button: buttonField,
    readout: readoutField,
  });

  function rowElement(row) {
    const field = FIELD_BUILDERS[row.control](row);
    const line = doc.createElement('div');
    line.className = `inspector-row is-${row.control}`;
    line.dataset.row = row.id;
    if (row.control === 'button') {
      line.append(field.element);
      return { line, field };
    }
    const label = doc.createElement(row.control === 'vec2' || row.control === 'list' || row.control === 'readout' ? 'span' : 'label');
    label.className = 'inspector-label';
    label.textContent = row.label;
    if (label.tagName === 'LABEL') label.htmlFor = domId(row.id);
    const cell = doc.createElement('div');
    cell.className = 'inspector-field';
    cell.append(field.element);
    const unit = doc.createElement('span');
    unit.className = 'inspector-unit';
    unit.textContent = row.unit;
    const key = doc.createElement('span');
    key.className = 'inspector-key';
    key.setAttribute('aria-hidden', 'true');
    line.append(label, cell, unit, key);
    return { line, field };
  }

  function focusTarget() {
    const active = doc.activeElement;
    if (!active || !content.contains(active) || !active.dataset?.row) return null;
    const state = inputs.get(active);
    return {
      row: active.dataset.row,
      component: active.dataset.component ?? null,
      uid: active.dataset.uid ?? null,
      draft: state && active.value !== state.displayed ? active.value : null,
    };
  }

  function sameObjects(a, b) {
    return a !== null && a.kind === b.kind && a.type === b.type && JSON.stringify(a.uids) === JSON.stringify(b.uids);
  }

  function rebuild(next, previous) {
    const focus = focusTarget();
    const keepDraft = sameObjects(previous, next);
    rebuilding = true;
    try {
      for (const handle of tooltips) handle.detach();
      tooltips = [];
      bindings = new Map();
      const sections = next.sections.map((section) => {
        const block = doc.createElement('section');
        block.className = 'inspector-section';
        if (section.label !== null) {
          const heading = doc.createElement('h3');
          heading.className = 'inspector-section-title';
          heading.textContent = section.label;
          block.append(heading);
        }
        for (const row of section.rows) {
          const { line, field } = rowElement(row);
          bindings.set(row.id, field);
          block.append(line);
        }
        return block;
      });
      content.replaceChildren(...sections);
    } finally {
      rebuilding = false;
    }
    rendered = next.structure;
    if (focus === null) return;
    let selector = `[data-row="${view.CSS.escape(focus.row)}"]`;
    if (focus.component !== null) selector += `[data-component="${focus.component}"]`;
    if (focus.uid !== null) selector += `[data-uid="${view.CSS.escape(focus.uid)}"]`;
    const target = content.querySelector(selector);
    if (!target) return;
    target.focus({ preventScroll: true });
    const state = inputs.get(target);
    if (state && keepDraft && focus.draft !== null && !state.row.readOnly) target.value = focus.draft;
  }

  function flush() {
    if (frame !== 0) view.cancelAnimationFrame(frame);
    frame = 0;
    const next = inspectorPage(editor);
    const previous = page;
    page = next;
    title.textContent = next.title;
    summary.textContent = next.kind === 'mixed' ? next.summary : next.kind === 'unbuilt' ? NOT_BUILT : '';
    summary.hidden = next.kind === 'object';
    if (next.structure !== rendered) {
      rebuild(next, previous);
    } else {
      for (const section of next.sections) {
        for (const row of section.rows) bindings.get(row.id)?.update(row);
      }
    }
  }

  function schedule() {
    if (frame === 0) frame = view.requestAnimationFrame(flush);
  }

  const unsubscribe = [
    model.on('change', schedule),
    model.on('reset', schedule),
    selection.on('selection', schedule),
    modes.on('mode', schedule),
    modes.on('playhead', schedule),
    history.on('history', schedule),
  ];

  page = inspectorPage(editor);
  flush();

  return {
    destroy() {
      for (const off of unsubscribe) off();
      if (frame !== 0) view.cancelAnimationFrame(frame);
      frame = 0;
      for (const handle of tooltips) handle.detach();
      tooltips = [];
      element.classList.remove('inspector-panel');
      element.replaceChildren();
    },
  };
}
