import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_VERSION, SETTING_SPECS, Settings } from '../js/settings.js';

const DEFAULTS = {
  version: 1,
  grid: { visible: true, size: 1, subdivisions: 10 },
  snap: { grid: false },
  display: { mode: 'both', ghosts: true },
  overlay: { names: false, centers: false, contacts: false },
  gizmo: { pivot: 'center' },
};

test('defaults follow DESIGN §5.3', () => {
  assert.equal(SETTINGS_VERSION, 1);
  assert.deepEqual(Object.keys(SETTING_SPECS), [
    'grid.visible',
    'grid.size',
    'grid.subdivisions',
    'snap.grid',
    'display.mode',
    'display.ghosts',
    'overlay.names',
    'overlay.centers',
    'overlay.contacts',
    'gizmo.pivot',
  ]);
  assert.deepEqual(new Settings().toJSON(), DEFAULTS);
});

test('overlay settings are booleans, off by default', () => {
  const settings = new Settings();
  for (const key of ['overlay.names', 'overlay.centers', 'overlay.contacts']) {
    assert.equal(settings.get(key), false);
    assert.throws(() => settings.set(key, 1), RangeError);
    settings.set(key, true);
    assert.equal(settings.get(key), true);
  }
});

test('a version 1 record without overlays restores them to their defaults without warnings', () => {
  const { settings, warnings } = Settings.restore({
    version: 1,
    grid: { visible: false, size: 1, subdivisions: 10 },
    snap: { grid: true },
    display: { mode: 'shapes' },
  });
  assert.deepEqual(warnings, []);
  assert.equal(settings.get('grid.visible'), false);
  assert.deepEqual(settings.toJSON().overlay, { names: false, centers: false, contacts: false });
});

test('onion skins are on by default and a record stored without them restores them on', () => {
  const settings = new Settings();
  assert.equal(settings.get('display.ghosts'), true);
  assert.throws(() => settings.set('display.ghosts', 'off'), RangeError);
  settings.set('display.ghosts', false);
  const { settings: restored, warnings } = Settings.restore(JSON.parse(JSON.stringify(settings.toJSON())));
  assert.deepEqual(warnings, []);
  assert.equal(restored.get('display.ghosts'), false);
  const old = Settings.restore({ version: 1, display: { mode: 'shapes' } });
  assert.deepEqual(old.warnings, []);
  assert.equal(old.settings.get('display.ghosts'), true);
});

test('get and set unknown keys throw', () => {
  const settings = new Settings();
  assert.throws(() => settings.get('grid.color'), /Unknown setting/);
  assert.throws(() => settings.set('pixelsPerMeter', 32), /Unknown setting/);
});

test('set validates types and ranges', () => {
  const settings = new Settings();
  assert.throws(() => settings.set('grid.visible', 1), RangeError);
  assert.throws(() => settings.set('grid.size', 0.001), RangeError);
  assert.throws(() => settings.set('grid.size', 101), RangeError);
  assert.throws(() => settings.set('grid.size', Number.NaN), RangeError);
  assert.throws(() => settings.set('grid.size', '1'), RangeError);
  assert.throws(() => settings.set('grid.subdivisions', 2.5), RangeError);
  assert.throws(() => settings.set('grid.subdivisions', 0), RangeError);
  assert.throws(() => settings.set('grid.subdivisions', 21), RangeError);
  assert.throws(() => settings.set('display.mode', 'wireframe'), RangeError);
  settings.set('grid.size', 0.01);
  settings.set('grid.size', 100);
  settings.set('grid.subdivisions', 1);
  settings.set('grid.subdivisions', 20);
  assert.equal(settings.get('grid.size'), 100);
  assert.equal(settings.get('grid.subdivisions'), 20);
});

test('set emits settings only when the value changes', () => {
  const settings = new Settings();
  const events = [];
  settings.on('settings', (payload) => events.push(payload));
  settings.set('snap.grid', true);
  settings.set('snap.grid', true);
  settings.set('display.mode', 'shapes');
  assert.deepEqual(events, [
    { key: 'snap.grid', value: true, previous: false },
    { key: 'display.mode', value: 'shapes', previous: 'both' },
  ]);
  assert.ok(Object.isFrozen(events[0]));
});

test('off stops notifications', () => {
  const settings = new Settings();
  const events = [];
  const listener = (payload) => events.push(payload);
  settings.on('settings', listener);
  settings.off('settings', listener);
  settings.set('grid.visible', false);
  assert.deepEqual(events, []);
});

test('toJSON round trips through restore', () => {
  const settings = new Settings();
  settings.set('grid.visible', false);
  settings.set('grid.size', 0.5);
  settings.set('grid.subdivisions', 4);
  settings.set('snap.grid', true);
  settings.set('display.mode', 'sprites');
  settings.set('overlay.names', true);
  settings.set('overlay.contacts', true);
  settings.set('gizmo.pivot', 'last');
  const record = JSON.parse(JSON.stringify(settings.toJSON()));
  const { settings: restored, warnings } = Settings.restore(record);
  assert.deepEqual(warnings, []);
  assert.deepEqual(restored.toJSON(), settings.toJSON());
});

test('restore(undefined) gives the defaults without warnings', () => {
  const { settings, warnings } = Settings.restore(undefined);
  assert.deepEqual(warnings, []);
  assert.deepEqual(settings.toJSON(), DEFAULTS);
});

test('restore fills missing fields with defaults silently', () => {
  const { settings, warnings } = Settings.restore({ version: 1, grid: { size: 2 }, display: 'none' });
  assert.deepEqual(warnings, []);
  assert.equal(settings.get('grid.size'), 2);
  assert.equal(settings.get('grid.visible'), true);
  assert.equal(settings.get('grid.subdivisions'), 10);
  assert.equal(settings.get('display.mode'), 'both');
});

test('restore replaces invalid fields with defaults and warns per field', () => {
  const { settings, warnings } = Settings.restore({
    version: 1,
    grid: { visible: 'yes', size: 0.5, subdivisions: 50 },
    snap: { grid: true },
    display: { mode: 'wireframe' },
    extra: 1,
  });
  assert.equal(settings.get('grid.visible'), true);
  assert.equal(settings.get('grid.size'), 0.5);
  assert.equal(settings.get('grid.subdivisions'), 10);
  assert.equal(settings.get('snap.grid'), true);
  assert.equal(settings.get('display.mode'), 'both');
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /"grid\.visible"/);
  assert.match(warnings[1], /"grid\.subdivisions"/);
  assert.match(warnings[2], /"display\.mode"/);
});

test('restore ignores records that are not objects or have another version', () => {
  for (const record of [null, 3, 'text', [], { grid: { size: 2 } }, { version: 2, grid: { size: 2 } }]) {
    const { settings, warnings } = Settings.restore(record);
    assert.equal(warnings.length, 1, JSON.stringify(record));
    assert.deepEqual(settings.toJSON(), DEFAULTS);
  }
});

test('gizmo.pivot is center or last, center by default', () => {
  const settings = new Settings();
  assert.equal(settings.get('gizmo.pivot'), 'center');
  assert.throws(() => settings.set('gizmo.pivot', 'average'), RangeError);
  assert.throws(() => settings.set('gizmo.pivot', true), RangeError);
  settings.set('gizmo.pivot', 'last');
  assert.equal(settings.get('gizmo.pivot'), 'last');
  assert.deepEqual(settings.toJSON().gizmo, { pivot: 'last' });
});

test('a version 1 record without gizmo restores the pivot mode to center without warnings', () => {
  const { gizmo, ...record } = { ...DEFAULTS, display: { mode: 'shapes' } };
  const { settings, warnings } = Settings.restore(record);
  assert.deepEqual(warnings, []);
  assert.equal(settings.get('gizmo.pivot'), 'center');
  assert.equal(settings.get('display.mode'), 'shapes');
  const invalid = Settings.restore({ ...DEFAULTS, gizmo: { pivot: 'first' } });
  assert.equal(invalid.settings.get('gizmo.pivot'), 'center');
  assert.equal(invalid.warnings.length, 1);
  assert.match(invalid.warnings[0], /"gizmo\.pivot"/);
});