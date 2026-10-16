import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { createJoint, createShapeBody } from '../js/commands/create.js';
import { Model } from '../js/model/model.js';
import { loadJson, newDocument, toJson, uidAtPath } from '../js/model/io.js';
import { serialize } from '../lib/serialize.js';
import { ragFile } from './helpers/rag-file.js';
import { FORMAT, FORMAT_VERSION, defaultsOf } from '../lib/schema.js';
import { validate } from '../lib/validate.js';

function hasKey(value, key) {
  if (value === null || typeof value !== 'object') return false;
  if (Object.hasOwn(value, key)) return true;
  return Object.values(value).some((item) => hasKey(item, key));
}

function sampleEditor() {
  const editor = createEditor();
  const { history, model } = editor;
  const box = history.execute(
    createShapeBody({ position: { x: 0, y: 1 }, angle: 0, shape: { type: 'box', width: 0.4, height: 0.6 } }),
  );
  const circle = history.execute(
    createShapeBody({ position: { x: 0, y: 1.5 }, angle: 0, shape: { type: 'circle', radius: 0.15 } }),
  );
  const joint = history.execute(
    createJoint({ bodyA: model.get(box).parent, bodyB: model.get(circle).parent, anchor: { x: 0, y: 1.3 } }),
  );
  const { tracks, events, ...clipProps } = defaultsOf('clip');
  history.execute({
    label: 'Add clip',
    run: (tx) => {
      tx.add(ROOT_UID, 'clips', undefined, {
        type: 'clip',
        props: { ...clipProps, key: 'idle', length: 1 },
        children: { tracks: [], events: [] },
      });
    },
  });
  return { ...editor, box, circle, joint };
}

test('toJson gives the file shape with file ids, references and collection order, without uids', () => {
  const { model, box, circle, joint } = sampleEditor();
  const json = toJson(model, '1.2.3');
  assert.equal(json.format, FORMAT);
  assert.equal(json.version, FORMAT_VERSION);
  assert.deepEqual(Object.keys(json), [
    'format', 'version', 'meta', 'units', 'preview', 'ragdoll', 'sprites', 'bodies', 'joints', 'clips',
  ]);
  assert.deepEqual(json.meta, { name: model.get(ROOT_UID).props.name, editorVersion: '1.2.3' });
  for (const key of ['meta', 'units', 'preview']) {
    if (key !== 'meta') assert.deepEqual(json[key], model.get(ROOT_UID).props[key]);
    assert.equal(Object.hasOwn(json.ragdoll, key), false, key);
  }
  assert.equal(json.ragdoll.id, 'root');
  const bodyIds = model.children(ROOT_UID, 'bodies').map((uid) => model.get(uid).props.id);
  assert.deepEqual(json.bodies.map((body) => body.id), bodyIds);
  assert.deepEqual(json.bodies[0].fixtures.map((shape) => shape.id), [model.get(box).props.id]);
  assert.deepEqual(json.bodies[1].fixtures.map((shape) => shape.id), [model.get(circle).props.id]);
  assert.deepEqual(json.joints.map((item) => item.id), [model.get(joint).props.id]);
  assert.equal(json.joints[0].bodyA, bodyIds[0]);
  assert.equal(json.joints[0].bodyB, bodyIds[1]);
  assert.equal(json.ragdoll.rootBody, model.get(ROOT_UID).props.rootBody);
  assert.equal(json.clips.length, 1);
  assert.deepEqual(json.clips[0].tracks, []);
  assert.deepEqual(json.clips[0].events, []);
  assert.deepEqual(json.sprites, []);
  assert.equal(hasKey(json, 'uid'), false);
  assert.equal(Object.isFrozen(json.bodies[0]), false);
});

test('toJson derives meta on every call and ignores the loaded meta', () => {
  const { model } = sampleEditor();
  assert.deepEqual(validate(toJson(model, 'dev')).errors, []);
  assert.equal(toJson(model, '0.4.0').meta.editorVersion, '0.4.0');
  assert.throws(() => toJson(model), TypeError);
  assert.throws(() => toJson(model, ''), TypeError);
});
test('toJson leaves the model unchanged and shares nothing with it', () => {
  const { model, history } = sampleEditor();
  const changes = [];
  model.on('change', (event) => changes.push(event));
  const before = JSON.stringify(toJson(model, 'dev'));
  const json = toJson(model, 'dev');
  json.bodies[0].fixtures[0].density = 99;
  json.ragdoll.position[0] = 42;
  json.meta.name = 'changed';
  assert.equal(JSON.stringify(toJson(model, 'dev')), before);
  assert.deepEqual(changes, []);
  assert.equal(history.canRedo, false);
});

function resets(model) {
  const events = [];
  model.on('reset', (event) => events.push(event));
  return events;
}

test('loadJson then toJson then serialize is byte-identical for a canonical file', () => {
  const text = serialize(ragFile());
  const model = new Model();
  const result = loadJson(model, text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(serialize(toJson(model, '0.1.0')), text);
  assert.notEqual(serialize(toJson(model, '0.2.0')), text);
  const again = loadJson(model, serialize(toJson(model, '0.1.0')));
  assert.equal(again.ok, true);
});

test('loadJson resets the model with cause load, in file order, with fresh uids', () => {
  const model = new Model();
  const events = resets(model);
  loadJson(model, serialize(ragFile()));
  assert.deepEqual(events, [{ cause: 'load' }]);
  assert.deepEqual(
    model.children(ROOT_UID, 'bodies').map((uid) => model.get(uid).props.id),
    ['b_torso', 'b_head', 'b_arm', 'b_arm2'],
  );
  assert.equal(model.get(ROOT_UID).props.rootBody, 'b_torso');
  assert.equal(model.get(model.uidOf('f_arm')).props.shape.type, 'polygon');
  assert.equal(model.children(model.clipByKey('walk'), 'tracks').length, 1);
});

test('loadJson rejects non-JSON with E_FORMAT and a non-string with TypeError, leaving the model untouched', () => {
  const model = new Model();
  const events = resets(model);
  const result = loadJson(model, '{ nope');
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map(({ code, path, target }) => ({ code, path, target })), [
    { code: 'E_FORMAT', path: '', target: null },
  ]);
  assert.throws(() => loadJson(model, {}), TypeError);
  assert.deepEqual(events, []);
});

test('loadJson rejects a wrong version and a file with errors with the error list, without reset', () => {
  const model = new Model();
  const events = resets(model);
  const wrong = ragFile();
  wrong.version = 99;
  const versionResult = loadJson(model, JSON.stringify(wrong));
  assert.deepEqual(versionResult.errors.map((error) => error.code), ['E_VERSION_UNSUPPORTED']);
  const broken = ragFile();
  broken.bodies[0].fixtures[0].shape.width = -1;
  const result = loadJson(model, JSON.stringify(broken));
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map(({ code, path }) => ({ code, path })), [
    { code: 'E_FIELD_RANGE', path: '/bodies/0/fixtures/0/shape/width' },
  ]);
  assert.equal(Object.isFrozen(result.errors), true);
  assert.deepEqual(events, []);
  assert.equal(model.children(ROOT_UID, 'bodies').length, 0);
});

test('loadJson drops unknown fields with their warnings and fills an absent sprite with null', () => {
  const json = ragFile();
  json.extra = 1;
  json.bodies[0].mystery = true;
  json.bodies[0].fixtures[0].shape.other = 2;
  delete json.bodies[3].fixtures[0].sprite;
  const model = new Model();
  const result = loadJson(model, JSON.stringify(json));
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.warnings.filter((warning) => warning.code === 'W_UNKNOWN_FIELD').map((warning) => warning.path).sort(),
    ['/bodies/0/fixtures/0/shape/other', '/bodies/0/mystery', '/extra'],
  );
  assert.equal(Object.hasOwn(model.get(model.children(ROOT_UID, 'bodies')[0]).props, 'mystery'), false);
  assert.equal(Object.hasOwn(model.get(model.uidOf('f_torso')).props.shape, 'other'), false);
  assert.equal(model.get(model.uidOf('f_arm2')).props.sprite, null);
  assert.equal(serialize(toJson(model, '0.1.0')), serialize(ragFile()));
});

test('newDocument resets to the empty document with cause new', () => {
  const model = new Model();
  loadJson(model, serialize(ragFile()));
  const events = resets(model);
  newDocument(model);
  assert.deepEqual(events, [{ cause: 'new' }]);
  assert.equal(model.children(ROOT_UID, 'bodies').length, 0);
  assert.deepEqual(model.get(ROOT_UID).props, new Model().get(ROOT_UID).props);
});

test('uidAtPath maps problem paths to model nodes and gives null otherwise', () => {
  const model = new Model();
  loadJson(model, serialize(ragFile()));
  const bodies = model.children(ROOT_UID, 'bodies');
  const shapeUid = model.children(bodies[2], 'fixtures')[0];
  const table = [
    ['/ragdoll', ROOT_UID],
    ['/ragdoll/rootBody', ROOT_UID],
    ['/sprites/1/src', model.children(ROOT_UID, 'sprites')[1]],
    ['/bodies/2', bodies[2]],
    ['/bodies/2/position', bodies[2]],
    ['/bodies/2/fixtures', bodies[2]],
    ['/bodies/2/fixtures/0', shapeUid],
    ['/bodies/2/fixtures/0/shape/vertices', shapeUid],
    ['/joints/1/bodyB', model.children(ROOT_UID, 'joints')[1]],
    ['/clips/0/tracks/0/keys/0/t', model.children(ROOT_UID, 'clips')[0]],
    ['/clips/0/events/0/name', model.children(ROOT_UID, 'clips')[0]],
    ['', null],
    ['/format', null],
    ['/version', null],
    ['/meta/name', null],
    ['/units/pixelsPerMeter', null],
    ['/preview/gravity', null],
    ['/bodies/4', null],
    ['/bodies/01', null],
    ['/bodies/-1', null],
    ['/bodies/x', null],
    ['/bodies/2/fixtures/1', null],
    ['/bodies', null],
    ['/unknown/0', null],
    ['bodies/0', null],
  ];
  for (const [pointer, uid] of table) assert.equal(uidAtPath(model, pointer), uid, pointer);
});