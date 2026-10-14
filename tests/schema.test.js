import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FORMAT,
  FORMAT_VERSION,
  SCHEMA,
  CHANNELS,
  fieldsOf,
  defaultsOf,
  autoClipKey,
} from '../lib/schema.js';

const OBJECT_TYPES = ['document', 'root', 'spriteAsset', 'body', 'shape', 'sprite', 'joint', 'clip', 'track', 'key', 'event'];

async function documentedTables() {
  const markdown = await readFile(join(import.meta.dirname, '..', 'docs', 'schema.md'), 'utf8');
  const tables = {};
  let current = null;
  for (const line of markdown.split('\n')) {
    const heading = /^## (\w+)/.exec(line);
    if (heading) current = SCHEMA[heading[1]] ? heading[1] : null;
    const row = /^\| `([^`]+)` \|/.exec(line);
    if (current && row) {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      (tables[current] ??= []).push({ path: row[1], unit: cells[4], flags: cells[5] });
    }
  }
  return tables;
}

test('schema declares the format constants', () => {
  assert.equal(FORMAT, 'ragassembler');
  assert.equal(FORMAT_VERSION, 1);
});

test('schema covers every object type and is frozen', () => {
  assert.deepEqual(Object.keys(SCHEMA), OBJECT_TYPES);
  assert.ok(Object.isFrozen(SCHEMA));
  for (const type of OBJECT_TYPES) {
    assert.ok(Object.isFrozen(SCHEMA[type]));
    assert.ok(SCHEMA[type].every((spec) => Object.isFrozen(spec)));
  }
  assert.ok(Object.isFrozen(CHANNELS));
});

test('schema fields match docs/schema.md: paths, order, units and E/R flags', async () => {
  const tables = await documentedTables();
  assert.deepEqual(Object.keys(tables), OBJECT_TYPES);
  for (const type of OBJECT_TYPES) {
    const documented = tables[type];
    assert.deepEqual(SCHEMA[type].map((spec) => spec.path), documented.map((row) => row.path), type);
    for (const [index, spec] of SCHEMA[type].entries()) {
      const row = documented[index];
      const label = `${type}.${spec.path}`;
      if (row.unit !== 'by channel') assert.equal(spec.unit, row.unit === '—' ? '' : row.unit, label);
      assert.equal(spec.editorOnly, /\bE\b/.test(row.flags), `${label} editorOnly`);
      assert.equal(spec.readOnly, /\bR\b/.test(row.flags), `${label} readOnly`);
    }
  }
});

test('body positions and angles and joint anchors are meters and radians', () => {
  const unit = (type, path) => SCHEMA[type].find((spec) => spec.path === path).unit;
  assert.equal(unit('body', 'position'), 'm');
  assert.equal(unit('body', 'angle'), 'rad');
  assert.equal(unit('joint', 'anchor'), 'm');
  assert.equal(unit('root', 'position'), 'm');
  assert.equal(unit('root', 'angle'), 'rad');
});

test('every object type with an id also has a name field', () => {
  for (const type of OBJECT_TYPES) {
    const paths = SCHEMA[type].map((spec) => spec.path);
    if (paths.includes('id')) assert.ok(paths.includes('name'), type);
  }
  assert.ok(SCHEMA.clip.some((spec) => spec.path === 'name'));
});

test('fieldsOf filters shape variants and keeps canonical order', () => {
  const shapePaths = (variant) =>
    fieldsOf('shape', variant).map((spec) => spec.path).filter((path) => path.startsWith('shape.'));
  assert.deepEqual(shapePaths('box'), ['shape.type', 'shape.center', 'shape.width', 'shape.height', 'shape.angle']);
  assert.deepEqual(shapePaths('circle'), ['shape.type', 'shape.center', 'shape.radius']);
  assert.deepEqual(shapePaths('polygon'), ['shape.type', 'shape.vertices']);
  assert.equal(fieldsOf('shape'), SCHEMA.shape);
  assert.throws(() => fieldsOf('shape', 'capsule'));
  assert.throws(() => fieldsOf('body', 'box'));
  assert.throws(() => fieldsOf('weld'));
});

test('defaultsOf returns the documented defaults per type', () => {
  assert.deepEqual(defaultsOf('document'), {
    format: 'ragassembler',
    version: 1,
    meta: { name: 'ragdoll' },
    units: { pixelsPerMeter: 32 },
    preview: { gravity: [0, -10] },
    sprites: [],
    bodies: [],
    joints: [],
    clips: [],
  });
  assert.deepEqual(defaultsOf('root'), {
    id: 'root',
    name: 'ragdoll',
    position: [0, 0],
    angle: 0,
    rootBody: null,
    channels: { strength: 1, gain: 1, damping: 1 },
  });
  assert.deepEqual(defaultsOf('spriteAsset'), {});
  assert.deepEqual(defaultsOf('body'), {
    position: [0, 0],
    angle: 0,
    linearDamping: 0,
    angularDamping: 0,
    fixedRotation: false,
    bullet: false,
    fixtures: [],
  });
  const shapeCommon = {
    density: 1,
    friction: 0.6,
    restitution: 0,
    isSensor: false,
    selfCollide: false,
    filter: { categoryBits: 1, maskBits: 65535 },
    sprite: null,
    editor: { color: '#8c9eb5' },
  };
  assert.deepEqual(defaultsOf('shape', 'box'), {
    shape: { type: 'box', center: [0, 0], width: 0.5, height: 0.5, angle: 0 },
    ...shapeCommon,
  });
  assert.deepEqual(defaultsOf('shape', 'circle'), { shape: { type: 'circle', center: [0, 0], radius: 0.25 }, ...shapeCommon });
  assert.deepEqual(defaultsOf('shape', 'polygon'), { shape: { type: 'polygon' }, ...shapeCommon });
  assert.deepEqual(defaultsOf('sprite'), { asset: null, offset: [0, 0], angle: 0, scale: [1, 1], z: 0, visible: true });
  assert.deepEqual(defaultsOf('joint'), {
    type: 'revolute',
    bodyA: null,
    bodyB: null,
    anchor: [0, 0],
    collideConnected: false,
    limits: { enabled: false, lower: 0, upper: 0 },
    motor: { maxTorque: 80, gain: 10, damping: 0.5, maxSpeed: 20 },
    aimAxis: 0,
  });
  assert.deepEqual(defaultsOf('clip'), {
    key: 'new_clip',
    name: 'New Clip',
    loop: true,
    hold: true,
    layer: 0,
    blend: 'override',
    length: 1,
    fadeIn: 0,
    fadeOut: 0,
    speed: 1,
    tracks: [],
    events: [],
  });
  assert.deepEqual(defaultsOf('track'), { keys: [] });
  assert.deepEqual(defaultsOf('key'), { interp: 'linear' });
  assert.deepEqual(defaultsOf('event'), { name: 'event', data: null });
});

test('defaultsOf returns fresh mutable objects', () => {
  const first = defaultsOf('body');
  first.position[0] = 5;
  first.fixtures.push('x');
  const second = defaultsOf('body');
  assert.deepEqual(second.position, [0, 0]);
  assert.deepEqual(second.fixtures, []);
  assert.ok(!Object.isFrozen(second));
});

test('defaultsOf keeps canonical key order', () => {
  assert.deepEqual(Object.keys(defaultsOf('joint')), [
    'type', 'bodyA', 'bodyB', 'anchor', 'collideConnected', 'limits', 'motor', 'aimAxis',
  ]);
  assert.deepEqual(Object.keys(defaultsOf('shape', 'box').shape), ['type', 'center', 'width', 'height', 'angle']);
});

test('CHANNELS matches the DESIGN.md §4.2 table', () => {
  assert.deepEqual(Object.keys(CHANNELS), ['root', 'joint', 'shape']);
  assert.deepEqual(Object.keys(CHANNELS.root), ['strength', 'gain', 'damping']);
  assert.deepEqual(Object.keys(CHANNELS.joint), ['angle', 'strength', 'gain', 'damping']);
  assert.deepEqual(Object.keys(CHANNELS.shape), ['sprite']);
  assert.equal(CHANNELS.root.gain.basePath, 'channels.gain');
  assert.equal(CHANNELS.joint.angle.kind, 'angle');
  assert.equal(CHANNELS.joint.angle.unit, 'rad');
  assert.equal(CHANNELS.joint.angle.default, 0);
  assert.equal(CHANNELS.joint.strength.default, 1);
  assert.equal(CHANNELS.joint.damping.max, 1);
  assert.equal(CHANNELS.shape.sprite.kind, 'discrete');
  assert.equal(CHANNELS.shape.sprite.basePath, 'sprite.asset');
});

test('autoClipKey slugs names', () => {
  assert.equal(autoClipKey('New Clip'), 'new_clip');
  assert.equal(autoClipKey('  Run -- Fast!! '), 'run_fast');
  assert.equal(autoClipKey('Walk2Run'), 'walk2run');
  assert.equal(autoClipKey('already_snake'), 'already_snake');
  assert.equal(autoClipKey('Ñandú'), 'and');
  assert.equal(autoClipKey(''), 'clip');
  assert.equal(autoClipKey('!!!'), 'clip');
});

test('autoClipKey appends _2, _3, … until the key is free', () => {
  assert.equal(autoClipKey('New Clip', ['new_clip']), 'new_clip_2');
  assert.equal(autoClipKey('New Clip', new Set(['new_clip', 'new_clip_2'])), 'new_clip_3');
  assert.equal(autoClipKey('', ['clip']), 'clip_2');
  assert.equal(autoClipKey('Idle', ['new_clip']), 'idle');
});

test('a clip key follows its name only while it equals the generated slug', () => {
  const others = ['idle'];
  const follows = (clip) => clip.key === autoClipKey(clip.name, others);
  const generated = { name: 'Run Fast', key: autoClipKey('Run Fast', others) };
  assert.ok(follows(generated));
  assert.equal(autoClipKey('Run Faster', others), 'run_faster');
  const handEdited = { name: 'Run Fast', key: 'sprint' };
  assert.ok(!follows(handEdited));
  const collided = { name: 'Idle', key: autoClipKey('Idle', others) };
  assert.equal(collided.key, 'idle_2');
  assert.ok(follows(collided));
});
