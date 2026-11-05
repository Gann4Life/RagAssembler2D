import { fieldsOf } from '../../lib/schema.js';
import { setProps } from '../commands/props.js';
import { setRestAngles } from '../commands/transform.js';
import { setChannelKey } from '../commands/keys.js';
import { channelValueAt, findTrack, keyAt } from '../model/clip-channels.js';
import { displayUnit, fromDisplay, toDisplay } from '../units.js';

/**
 * What a page builder reads.
 * @typedef {object} PageContext
 * @property {import('../model/model.js').Model} model Document model.
 * @property {string} type Node type of the page (`root`, `body`, …).
 * @property {ReadonlyArray<number>} uids Objects shown, in selection order.
 * @property {boolean} editable `modes.can('edit.rest')` and no gesture open.
 * @property {string|null} reason Mode reason of `edit.rest`; `null` in Edit mode and during a gesture.
 * @property {{ clip: number, time: number, editable: boolean }|null} animate Open clip, playhead (s) and whether
 *   animation edits are allowed (`edit.animation`, no gesture) in Animate mode, else `null`.
 * @property {number} pixelsPerMeter Document scale, px/m, finite and > 0.
 */

/**
 * One titled group of rows.
 * @typedef {object} InspectorSection
 * @property {string} id Stable id within the page.
 * @property {string|null} label Section heading, or `null` for none.
 * @property {ReadonlyArray<InspectorRow>} rows Rows, top to bottom.
 */

/**
 * What a committed row does.
 * @typedef {{ kind: 'props', uids: ReadonlyArray<number>, path: string, unit: string, label: string }
 * *   | { kind: 'root-body' }
 *   | { kind: 'rest-angle', uids: ReadonlyArray<number>, label: string }
 *   | { kind: 'action', action: string, label: string }
 *   | { kind: 'channel-key', clip: number, target: number, channel: string, time: number, label: string }
 *   | { kind: 'select' }} InspectorEdit
 *   `props`: `setProps` of the value in the data `unit`; `root-body`: `editor.setRootBody`; `rest-angle`: `setRestAngles` of the joints with the value in degrees; `action`: `editor.actions.run` with `label`; `channel-key`:
 *   `setChannelKey` of the value in % at `time`; `select`: a list item selects its uid. `label` is the undo step or
 *   the refused-action label.
 */

/**
 * Key button ◇ of a channel row.
 * @typedef {object} InspectorKey
 * @property {'empty'|'outlined'|'filled'} state No track; a track without a key at the playhead; a key at the playhead.
 * @property {boolean} disabled Whether a click is refused.
 * @property {string|null} reason Why it is disabled.
 * @property {string} label Tooltip and accessible name, e.g. `Key strength at 0.40 s (not animated)`.
 * @property {number|null} value Value a click keys, in the channel unit (0-1); `null` when disabled.
 * @property {InspectorEdit|null} edit The `channel-key` edit of a click; `null` when disabled.
 */

/**
 * One inspector field.
 * @typedef {object} InspectorRow
 * @property {string} id Schema path or derived name, stable within the page.
 * @property {string} label Field label.
 * @property {'text'|'number'|'vec2'|'checkbox'|'select'|'list'|'button'|'readout'} control Control kind.
 * @property {*} value Display units; `MIXED` when the objects differ; `[x, y]` for vec2, each component may be
 *   `MIXED`; the formatted text for a readout.
 * @property {string|ReadonlyArray<string>|null} text Displayed text of text, number and readout rows (`''` when
 *   mixed, `—` for a mixed readout), `[x, y]` texts for vec2, else `null`.
 * @property {string} unit Display unit, or `''`.
 * @property {number} [min] Lower bound, display units.
 * @property {number} [max] Upper bound, display units.
 * @property {boolean} [exclusiveMin] Whether `min` itself is invalid.
 * @property {ReadonlyArray<{ value: number, label: string }>} [options] Select options: body uids and labels.
 * @property {ReadonlyArray<{ uid: number, label: string, muted: boolean, icon: string }>} [items] List items; `muted`
 *   when the label is the id; `icon` names the shape type.
 * @property {string|null} [hint] Short help shown in the field's tooltip.
 * @property {boolean} readOnly Whether the field refuses edits.
 * @property {string|null} reason Why it is read-only; `null` when editable or during a gesture.
 * @property {boolean} animated Base or evaluated value of an animation channel.
 * @property {InspectorEdit|null} edit What a commit does; `null` when the field can never be edited.
 * @property {InspectorKey} [key] Key button ◇ of a multiplier channel row.
 */

/**
 * Value of a field that differs between the objects shown.
 * @type {Readonly<object>}
 */
export const MIXED = Object.freeze({ mixed: true });

const PLAYHEAD_REASON = 'the value at the playhead';
const SCHEMA_REASONS = Object.freeze({ id: 'ids never change' });
const LABELS = Object.freeze({ id: 'ID' });
const COMMIT_LABELS = Object.freeze({ name: 'Rename', 'units.pixelsPerMeter': 'Pixels per meter' });
const DECIMALS = Object.freeze({ px: 1, '°': 1, '%': 1, 'px/m': 1, 'm/s²': 2, '1/s': 2, 'rad/s': 2 });
const SIGNIFICANT = Object.freeze({ 'N·m': 3, kg: 3 });
const DEFAULT_DECIMALS = 2;
const MIXED_TEXT = '—';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPair(value) {
  return Array.isArray(value) && value.length === 2;
}

function jsonEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  return keysA.length === Object.keys(b).length && keysA.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
}

/**
 * The value of a prop shared by every object, `MIXED` when they differ. A vec2 that differs is a frozen `[x, y]`
 * with `MIXED` in each differing component. Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {ReadonlyArray<number>} uids Objects, at least one.
 * @param {string} path Dotted prop path.
 * @returns {*} The shared value (data units) or `MIXED`.
 * @throws {Error} When a uid is unknown.
 */
export function sharedValue(model, uids, path) {
  const values = uids.map((uid) => model.prop(uid, path));
  const [first] = values;
  if (values.every((value) => jsonEqual(value, first))) return first;
  if (values.every(isPair)) {
    return Object.freeze([0, 1].map((index) => (values.every((value) => Object.is(value[index], first[index])) ? first[index] : MIXED)));
  }
  return MIXED;
}

function specOf(type, path) {
  const own = fieldsOf(type).find((spec) => spec.path === path);
  if (own) return own;
  if (type !== 'root') return null;
  return fieldsOf('document').find((spec) => spec.path === path) ?? null;
}

function controlOf(spec) {
  if (spec.type === 'string') return 'text';
  if (spec.type === 'number' || spec.type === 'integer') return 'number';
  if (spec.type === 'vec2') return 'vec2';
  if (spec.type === 'boolean') return 'checkbox';
  if (spec.type.startsWith('ref:')) return 'select';
  return 'readout';
}

function humanize(path) {
  const last = path.split('.').pop();
  if (Object.hasOwn(LABELS, last)) return LABELS[last];
  const words = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function commitLabel(path, label) {
  return Object.hasOwn(COMMIT_LABELS, path) ? COMMIT_LABELS[path] : `Edit ${label.toLowerCase()}`;
}

function formatNumber(value, unit) {
  const rounded = Object.hasOwn(SIGNIFICANT, unit)
    ? Number(value.toPrecision(SIGNIFICANT[unit]))
    : Number(value.toFixed(DECIMALS[unit] ?? DEFAULT_DECIMALS));
  return String(rounded + 0);
}

function displayValue(value, dataUnit, pixelsPerMeter) {
  if (value === MIXED) return MIXED;
  if (isFiniteNumber(value)) return toDisplay(value, dataUnit, pixelsPerMeter) + 0;
  if (isPair(value)) return Object.freeze(value.map((item) => displayValue(item, dataUnit, pixelsPerMeter)));
  return value;
}

function textOf(control, value, unit) {
  const one = (item) => {
    if (item === MIXED) return '';
    if (isFiniteNumber(item)) return formatNumber(item, unit);
    return typeof item === 'string' ? item : '';
  };
  if (control === 'vec2') return Object.freeze(isPair(value) ? value.map(one) : ['', '']);
  if (control === 'text' || control === 'number') return one(value);
  return null;
}

function bound(value, dataUnit, pixelsPerMeter) {
  return toDisplay(value, dataUnit, pixelsPerMeter) + 0;
}

/**
 * Overrides of {@link fieldRow} for what the schema cannot say.
 * @typedef {object} RowOverrides
 * @property {string} [label] Field label; default from the path (`linearDamping` → `Linear damping`).
 * @property {string} [commitLabel] Undo label of a props edit; default `Rename`, `Pixels per meter` or `Edit <label>`.
 * @property {InspectorRow['control']} [control] Control kind; required for paths outside the schema.
 * @property {*} [value] Value in data units, instead of the shared prop value.
 * @property {string} [dataUnit] Data unit, instead of the schema unit.
 * @property {string} [unit] Display unit, instead of the one derived from the data unit.
 * @property {string} [reason] Makes the row read-only for this reason in every mode (derived values).
 * @property {(text: string) => string} [textFormat] Wraps a readout's formatted number, e.g. `auto (…)`.
 * @property {string} [hint] Short help shown in the field's tooltip.
 * @property {boolean} [animated] Whether it is a channel value; default from the schema.
 * @property {boolean} [modeFree] Not made read-only by the mode or a gesture (lists that only select).
 * @property {InspectorEdit|null} [edit] Commit, instead of a props edit of the path.
 * @property {ReadonlyArray<{ value: number, label: string }>} [options] Select options.
 * @property {ReadonlyArray<{ uid: number, label: string, muted: boolean, icon: string }>} [items] List items.
 * @property {number} [min] Lower bound in data units, instead of the schema one.
 * @property {number} [max] Upper bound in data units, instead of the schema one.
 * @property {InspectorKey} [key] Key button ◇ of the row.
 */

/**
 * Builds a row from the schema field at `path` of the page type (the document fields for `root`), or from the
 * overrides for a derived row: label, display value and text, unit, range, read-only state and reason, commit.
 * Read-only when the field is `R` or derived, when the context is not editable, and in Animate for `animated` rows
 * (they show the given evaluated value). Pure.
 * @param {PageContext} ctx Page context.
 * @param {string} path Schema path or derived row id.
 * @param {RowOverrides} [overrides] What the schema cannot say.
 * @returns {Readonly<InspectorRow>} The frozen row.
 * @throws {Error} When `path` is not a field of the type and no `control` is given.
 */
export function fieldRow(ctx, path, overrides = {}) {
  const spec = specOf(ctx.type, path);
  if (spec === null && overrides.control === undefined) throw new Error(`Unknown field "${path}" of a ${ctx.type}`);
  const label = overrides.label ?? humanize(path);
  const control = overrides.control ?? controlOf(spec);
  const dataUnit = overrides.dataUnit ?? spec?.unit ?? '';
  const unit = overrides.unit ?? displayUnit(dataUnit);
  const animated = overrides.animated ?? spec?.channel !== undefined;
  const derived = overrides.reason ?? (spec?.readOnly ? (SCHEMA_REASONS[path] ?? 'read-only') : null);
  const atPlayhead = ctx.animate !== null && animated;
  let reason = null;
  let readOnly = false;
  if (derived !== null) {
    readOnly = true;
    reason = derived;
  } else if (!overrides.modeFree && (atPlayhead || !ctx.editable)) {
    readOnly = true;
    reason = ctx.reason === null ? null : atPlayhead ? PLAYHEAD_REASON : ctx.reason;
  }
  const raw = Object.hasOwn(overrides, 'value') ? overrides.value : sharedValue(ctx.model, ctx.uids, path);
  let value = displayValue(raw, dataUnit, ctx.pixelsPerMeter);
  let text = textOf(control, value, unit);
  if (control === 'readout') {
    const plain = isFiniteNumber(value) ? formatNumber(value, dataUnit === '' ? unit : displayUnit(dataUnit)) : String(value ?? '');
    text = value === MIXED ? MIXED_TEXT : (overrides.textFormat ?? ((item) => item))(plain);
    value = value === MIXED ? MIXED : text;
  }
  let edit = null;
  if (Object.hasOwn(overrides, 'edit')) edit = overrides.edit;
  else if (derived === null) {
    edit = Object.freeze({ kind: 'props', uids: Object.freeze([...ctx.uids]), path, unit: dataUnit, label: overrides.commitLabel ?? commitLabel(path, label) });
  }
  const row = { id: path, label, control, value, text, unit, readOnly, reason, animated, edit };
  if (overrides.hint !== undefined) row.hint = overrides.hint;
  const min = overrides.min ?? spec?.min;
  const max = overrides.max ?? spec?.max;
  if (min !== undefined) row.min = bound(min, dataUnit, ctx.pixelsPerMeter);
  if (max !== undefined) row.max = bound(max, dataUnit, ctx.pixelsPerMeter);
  if (spec?.exclusiveMin) row.exclusiveMin = true;
  if (overrides.key) row.key = Object.freeze({ ...overrides.key });
  if (overrides.options) row.options = Object.freeze(overrides.options.map((option) => Object.freeze({ ...option })));
  if (overrides.items) row.items = Object.freeze(overrides.items.map((item) => Object.freeze({ ...item })));
  return Object.freeze(row);
}

const KEY_STATE_TEXT = Object.freeze({ empty: 'not animated', outlined: 'no key here', filled: 'keyed' });
const ANIMATE_ONLY = 'only in Animate mode';
const SEVERAL = 'select one joint';
const NOT_ANIMATED = 'click ◇ to animate this channel';
const CHANNEL_HINTS = Object.freeze({
  strength: 'How firmly the motors hold the pose: 100 % firm, lower values sag under the body weight, 0 % limp. On the ragdoll it scales every joint',
  balance: 'How firmly the root body is held upright toward its keyed angle: 0 % lets it fall freely',
  gain: 'How hard the motor corrects toward the keyed angle',
  damping: 'How much the motor resists motion: low swings and bounces, high moves smoothly',
});
const GESTURE = 'finish the current gesture first';

function keyStateOf(model, clip, targets, channel, time) {
  const tracks = targets.map((target) => findTrack(model, clip, target, channel));
  if (tracks.some((track) => track === null)) return tracks.every((track) => track === null) ? 'empty' : 'outlined';
  return tracks.every((track) => keyAt(model, track, time) !== null) ? 'filled' : 'outlined';
}

/**
 * Row of a multiplier channel (`strength`, `balance`, `gain`, `damping`) of the root or of joints, with its key button ◇
 * (`DESIGN.md` §5.7, Animation). Outside Animate it is the schema field `id` (the root's base value) with ◇ disabled
 * "only in Animate mode". In Animate it shows the open clip's own value at the playhead (the neutral value without a
 * track) as a % field: editable and keyed at the playhead when the channel has a track, else read-only "click ◇ to
 * animate this channel"; with several targets read-only and ◇ disabled "select one joint". Pure.
 * @param {PageContext} ctx Page context; `uids` are the targets (the root, or joints).
 * @param {{ id: string, label: string, channel: 'strength'|'balance'|'gain'|'damping' }} options Row id (the schema path for
 *   the root), label and channel.
 * @returns {Readonly<InspectorRow>} The frozen row with `key`.
 */
export function channelRow(ctx, { id, label, channel }) {
  const { model, uids } = ctx;
  const hint = CHANNEL_HINTS[channel];
  if (ctx.animate === null || model.get(ctx.animate.clip)?.type !== 'clip') {
    const key ={ state: 'empty', disabled: true, reason: ANIMATE_ONLY, label: `Key ${channel}`, value: null, edit: null };
    return fieldRow(ctx, id, { label, hint, key });
  }
  const { clip, time, editable } = ctx.animate;
  const values = uids.map((target) => channelValueAt(model, clip, target, channel, time));
  const value = values.every((item) => Object.is(item, values[0])) ? values[0] : MIXED;
  const state = keyStateOf(model, clip, uids, channel, time);
  const several = uids.length > 1;
  let reason = null;
  if (several) reason = SEVERAL;
  else if (findTrack(model, clip, uids[0], channel) === null) reason = NOT_ANIMATED;
  else if (!editable) reason = GESTURE;
  const keyReason = several ? SEVERAL : editable ? null : GESTURE;
  const edit = several ? null : Object.freeze({ kind: 'channel-key', clip, target: uids[0], channel, time, label: `Key ${channel}` });
  const key = {
    state,
    disabled: keyReason !== null,
    reason: keyReason,
    label: `Key ${channel} at ${time.toFixed(2)} s (${KEY_STATE_TEXT[state]})`,
    value: keyReason === null ? value : null,
    edit: keyReason === null ? edit : null,
  };
  return fieldRow(ctx, id, {
    label,
    hint,
    control: 'number',
    dataUnit: 'mult',
    value,
    min: 0,
    max: 1,
    animated: true,
    key,
    edit: reason === null ? edit : null,
    ...(reason === null ? { modeFree: true } : { reason }),
  });
}

/**
 * The command of a key button ◇ click: `setChannelKey` of the key's value at the edit's time.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {InspectorKey} key Key button of the row.
 * @returns {import('../commands/history.js').Command|null} The command, or `null` when the button is disabled or the
 *   key at that time already holds the value.
 */
export function keyCommand(model, key) {
  if (key.disabled || key.edit === null || typeof key.value !== 'number') return null;
  return channelKeyCommand(model, key.edit, key.value);
}

function channelKeyCommand(model, edit, value) {
  const track = findTrack(model, edit.clip, edit.target, edit.channel);
  const existing = track === null ? null : keyAt(model, track, edit.time);
  if (existing !== null && Object.is(model.prop(existing, 'v'), value)) return null;
  return setChannelKey(edit.clip, edit.target, edit.channel, edit.time, value, edit.label, { snap: false });
}

function compositeCommand(label, commands) {
  return Object.freeze({
    label,
    run(tx) {
      for (const command of commands) command.run(tx);
    },
  });
}

function propsCommand(model, edit, displayed, component, pixelsPerMeter) {
  const value = isFiniteNumber(displayed) ? fromDisplay(displayed, edit.unit, pixelsPerMeter) + 0 : displayed;
  if (component === undefined) {
    if (edit.uids.every((uid) => jsonEqual(model.prop(uid, edit.path), value))) return null;
    return setProps([...edit.uids], { [edit.path]: value }, edit.label);
  }
  const commands = [];
  for (const uid of edit.uids) {
    const current = model.prop(uid, edit.path);
    const next = isPair(current) ? [...current] : [0, 0];
    next[component] = value;
    if (!jsonEqual(current, next)) commands.push(setProps([uid], { [edit.path]: next }, edit.label));
  }
  if (commands.length === 0) return null;
  return commands.length === 1 ? commands[0] : compositeCommand(edit.label, commands);
}

/**
 * The command of a committed value: `setProps` for a props edit (one per object for a vec2 component, each keeping
 * its other component), with the value converted to data units. Pure.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {InspectorEdit} edit Edit of the row, as captured when the field got focus.
 * @param {*} displayValue Committed value in display units (number, string or boolean).
 * @param {{ component?: 0|1, pixelsPerMeter: number }} options Vec2 component, and the document scale, px/m.
 * @returns {import('../commands/history.js').Command|null} The command, or `null` when every object already
 *   holds the value.
 * @throws {Error} When the edit is neither a props nor a rest-angle edit.
 */
export function editCommand(model, edit, displayValue, { component, pixelsPerMeter } = {}) {
  if (edit?.kind === 'props') return propsCommand(model, edit, displayValue, component, pixelsPerMeter);
  if (edit?.kind === 'rest-angle') return setRestAngles(model, [...edit.uids], fromDisplay(displayValue, 'rad') + 0, edit.label);
  if (edit?.kind === 'channel-key') return channelKeyCommand(model, edit, fromDisplay(displayValue, 'mult') + 0);
  throw new Error(`An inspector edit of kind "${edit?.kind}" is not a command`);
}
