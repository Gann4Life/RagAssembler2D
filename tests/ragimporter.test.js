import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RagFormatError, RagImporter } from '../lib/ragimporter.js';
import { ragFile } from './helpers/rag-file.js';

afterEach(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function stubWorld(overrides = {}) {
  const calls = [];
  const world = {
    CreateBody: () => calls.push('CreateBody'),
    IsLocked: () => {
      calls.push('IsLocked');
      return 0;
    },
    ...overrides,
  };
  return { world, calls };
}

test('RagImporter is frozen and exposes configure, parse, validate and supportedVersions', () => {
  assert.ok(Object.isFrozen(RagImporter));
  assert.deepEqual(Object.keys(RagImporter).sort(), ['configure', 'parse', 'supportedVersions', 'validate']);
  assert.deepEqual([...RagImporter.supportedVersions], [1]);
  assert.ok(Object.isFrozen(RagImporter.supportedVersions));
});

test('parse returns a frozen definition with name, pixelsPerMeter and clips', () => {
  const def = RagImporter.parse(ragFile());
  assert.equal(def.name, 'sample');
  assert.equal(def.pixelsPerMeter, 40);
  assert.deepEqual(def.clips, [{ key: 'walk', name: 'Walk', loop: true, layer: 1, length: 2 }]);
  assert.ok(Object.isFrozen(def));
  assert.ok(Object.isFrozen(def.clips));
  assert.ok(Object.isFrozen(def.clips[0]));
  assert.throws(() => {
    def.name = 'other';
  }, TypeError);
});

test('parse accepts warnings without throwing', () => {
  const json = ragFile();
  assert.ok(RagImporter.validate(json).warnings.length > 0);
  assert.doesNotThrow(() => RagImporter.parse(json));
});

test('changes to the source json after parse do not reach the definition', () => {
  const json = ragFile();
  const def = RagImporter.parse(json);
  json.ragdoll.name = 'changed';
  json.units.pixelsPerMeter = 1;
  json.clips[0].key = 'run';
  json.sprites[0].src = 'other.png';
  json.sprites.push({ id: 's_x', name: 'x', src: 'x.png' });
  assert.equal(def.name, 'sample');
  assert.equal(def.pixelsPerMeter, 40);
  assert.equal(def.clips[0].key, 'walk');
  assert.deepEqual(def.spriteUrls(), ['parts/a.png', 'parts/b.png']);
});

test('spriteUrls prefixes baseUrl, keeps file order, removes duplicates and returns a new array', () => {
  const def = RagImporter.parse(ragFile());
  assert.deepEqual(def.spriteUrls('assets/'), ['assets/parts/a.png', 'assets/parts/b.png']);
  const first = def.spriteUrls();
  first.push('mutated');
  assert.deepEqual(def.spriteUrls(), ['parts/a.png', 'parts/b.png']);
});

test('parse throws RagFormatError with frozen errors and warnings and the first error in the message', () => {
  const json = ragFile();
  json.bodies[0].linearDamping = -1;
  json.joints[0].bodyB = 'missing';
  const expected = RagImporter.validate(json);
  let error;
  try {
    RagImporter.parse(json);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof RagFormatError);
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'RagFormatError');
  assert.deepEqual(error.errors, expected.errors);
  assert.deepEqual(error.warnings, expected.warnings);
  assert.ok(Object.isFrozen(error.errors));
  assert.ok(Object.isFrozen(error.warnings));
  const [first] = expected.errors;
  assert.equal(error.message, `Invalid .rag.json: ${expected.errors.length} error(s); first: ${first.code} at ${first.path}`);
});

test('parse reports an unsupported version with the supported list', () => {
  const json = ragFile();
  json.version = 7;
  assert.throws(() => RagImporter.parse(json), {
    name: 'RagFormatError',
    message: 'Unsupported .rag.json version 7; supported: 1',
  });
});

test('parse rejects non-object input', () => {
  assert.throws(() => RagImporter.parse(null), RagFormatError);
  assert.throws(() => RagImporter.parse('text'), RagFormatError);
});

test('spawn names liquidfun.js when no Box2D is configured or global', () => {
  const def = RagImporter.parse(ragFile());
  const { world, calls } = stubWorld();
  RagImporter.configure({ PIXI: {} });
  assert.throws(() => def.spawn(world), { message: /liquidfun\.js \(Box2D\)/ });
  assert.deepEqual(calls, []);
});

test('spawn names PIXI.js when no PIXI is configured or global', () => {
  const def = RagImporter.parse(ragFile());
  const { world, calls } = stubWorld();
  RagImporter.configure({ Box2D: {} });
  assert.throws(() => def.spawn(world), { message: /PIXI\.js \(PIXI\)/ });
  assert.deepEqual(calls, []);
});

test('configure rejects non-library values at spawn and null returns to the global', () => {
  const def = RagImporter.parse(ragFile());
  const { world } = stubWorld();
  RagImporter.configure({ Box2D: 5, PIXI: {} });
  assert.throws(() => def.spawn(world), { message: /liquidfun\.js \(Box2D\)/ });
  RagImporter.configure({ Box2D: () => {} });
  RagImporter.configure({ Box2D: undefined, unknown: 1 });
  assert.throws(() => def.spawn({}), TypeError);
  RagImporter.configure({ Box2D: null });
  globalThis.Box2D = {};
  try {
    assert.throws(() => def.spawn({}), TypeError);
  } finally {
    delete globalThis.Box2D;
  }
  assert.throws(() => def.spawn({}), { message: /liquidfun\.js \(Box2D\)/ });
  assert.equal(RagImporter.configure(), undefined);
  assert.equal(RagImporter.configure(null), undefined);
});

test('spawn checks world and options before calling into the world', () => {
  const def = RagImporter.parse(ragFile());
  RagImporter.configure({ Box2D: {}, PIXI: {} });
  for (const world of [null, undefined, {}, { CreateBody: 1 }]) {
    assert.throws(() => def.spawn(world), TypeError);
  }
  const bad = [5, null, { x: '1' }, { y: NaN }, { angle: Infinity }, { flipX: 1 }, { baseUrl: 3 }, { textures: 'x' }, { debug: 'yes' }, { parent: {} }];
  for (const opts of bad) {
    const { world, calls } = stubWorld();
    assert.throws(() => def.spawn(world, opts), TypeError, JSON.stringify(opts));
    assert.deepEqual(calls, []);
  }
});

test('spawn throws on a locked world before creating anything', () => {
  const def = RagImporter.parse(ragFile());
  RagImporter.configure({ Box2D: {}, PIXI: {} });
  const { world, calls } = stubWorld({ IsLocked: () => 1 });
  assert.throws(() => def.spawn(world), { message: /locked/ });
  assert.deepEqual(calls, []);
});
