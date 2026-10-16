import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { createJoint, createShapeBody } from '../js/commands/create.js';
import { toJson } from '../js/model/io.js';
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
  const json = toJson(model);
  assert.equal(json.format, FORMAT);
  assert.equal(json.version, FORMAT_VERSION);
  assert.deepEqual(Object.keys(json), [
    'format', 'version', 'meta', 'units', 'preview', 'ragdoll', 'sprites', 'bodies', 'joints', 'clips',
  ]);
  for (const key of ['meta', 'units', 'preview']) {
    assert.deepEqual(json[key], model.get(ROOT_UID).props[key]);
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

test('toJson of a document built by commands validates without errors besides the unset editor version', () => {
  const { model } = sampleEditor();
  const errors = validate(toJson(model)).errors.map(({ code, path }) => ({ code, path }));
  assert.deepEqual(errors, [{ code: 'E_FIELD_MISSING', path: '/meta/editorVersion' }]);
  const json = toJson(model);
  json.meta.editorVersion = '0.1.0';
  assert.deepEqual(validate(json).errors, []);
});

test('toJson leaves the model unchanged and shares nothing with it', () => {
  const { model, history } = sampleEditor();
  const changes = [];
  model.on('change', (event) => changes.push(event));
  const before = JSON.stringify(toJson(model));
  const json = toJson(model);
  json.bodies[0].fixtures[0].density = 99;
  json.ragdoll.position[0] = 42;
  json.meta.name = 'changed';
  assert.equal(JSON.stringify(toJson(model)), before);
  assert.deepEqual(changes, []);
  assert.equal(history.canRedo, false);
});
