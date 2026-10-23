import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROBLEM_CODES, SUPPORTED_VERSIONS, validate } from '../lib/validate.js';
import { RagImporter } from '../lib/ragimporter.js';
import { shapeGeometryValid } from '../lib/geometry.js';
import { defaultsOf } from '../lib/schema.js';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { jointTree } from '../js/model/queries.js';

function box(id, name, width, height) {
  return {
    id,
    name,
    shape: { type: 'box', center: [0, 0], width, height, angle: 0 },
    density: 1,
    friction: 0.6,
    restitution: 0,
    isSensor: false,
    selfCollide: false,
    filter: { categoryBits: 1, maskBits: 65535 },
    sprite: { asset: null, offset: [0, 0], angle: 0, scale: [1, 1], z: 0, visible: true },
    editor: { color: '#c8a07a' },
  };
}

function body(id, name, position, fixture) {
  return {
    id,
    name,
    position,
    angle: 0,
    linearDamping: 0,
    angularDamping: 0.1,
    fixedRotation: false,
    bullet: false,
    fixtures: [fixture],
  };
}

function joint(id, name, bodyA, bodyB, anchor, limits) {
  return {
    id,
    name,
    type: 'revolute',
    bodyA,
    bodyB,
    anchor,
    collideConnected: false,
    limits,
    motor: { maxTorque: 80, gain: 10, damping: 0.5, maxSpeed: 20 },
    aimAxis: 0,
  };
}

function validFile() {
  const torso = box('f_torso', 'torso', 0.4, 0.7);
  torso.sprite.asset = 's_torso';
  const thigh = box('f_thigh', 'thigh', 0.2, 0.5);
  thigh.sprite.asset = 's_torso';
  const head = box('f_head', 'head', 0.3, 0.3);
  head.sprite.asset = 's_face_normal';
  return {
    format: 'ragassembler',
    version: 1,
    meta: { name: 'humanoid', editorVersion: '0.1.0' },
    units: { pixelsPerMeter: 32 },
    preview: { gravity: [0, -10] },
    ragdoll: {
      id: 'root',
      name: 'humanoid',
      position: [0, 0],
      angle: 0,
      rootBody: 'b_torso',
      channels: { strength: 1, gain: 1, damping: 1 },
    },
    sprites: [
      { id: 's_torso', name: 'torso', src: 'humanoid/torso.png' },
      { id: 's_face_normal', name: 'face_normal', src: 'humanoid/face_normal.png' },
      { id: 's_face_dead', name: 'face_dead', src: 'humanoid/face_dead.png' },
    ],
    bodies: [
      body('b_torso', 'torso', [0, 1.2], torso),
      body('b_thigh_l', 'thigh_l', [0, 0.6], thigh),
      body('b_shin_l', 'shin_l', [0, 0.1], box('f_shin', 'shin', 0.2, 0.5)),
      body('b_head', 'head', [0, 1.8], head),
    ],
    joints: [
      joint('j_hip_l', 'hip_l', 'b_torso', 'b_thigh_l', [0, 0.85], { enabled: false, lower: 0, upper: 0 }),
      joint('j_knee_l', 'knee_l', 'b_thigh_l', 'b_shin_l', [0, 0.35], { enabled: true, lower: -2.4, upper: 0 }),
      joint('j_neck', 'neck', 'b_torso', 'b_head', [0, 1.65], { enabled: false, lower: 0, upper: 0 }),
    ],
    clips: [
      {
        key: 'dead',
        name: 'Dead',
        loop: false,
        hold: true,
        layer: 200,
        blend: 'override',
        length: 5,
        fadeIn: 0,
        fadeOut: 0,
        speed: 1,
        tracks: [
          {
            target: 'root',
            channel: 'strength',
            keys: [
              { t: 0, v: 1, interp: 'linear' },
              { t: 5, v: 0, interp: 'linear' },
            ],
          },
          { target: 'f_head', channel: 'sprite', keys: [{ t: 0, v: 's_face_dead', interp: 'step' }] },
        ],
        events: [{ t: 5, name: 'fully_dead', data: null }],
      },
    ],
  };
}

function polygonFile(vertices) {
  const json = validFile();
  json.bodies[1].fixtures[0].shape = { type: 'polygon', vertices };
  return json;
}

function problemsOf(json, options) {
  const { errors, warnings } = validate(json, options);
  return [...errors, ...warnings];
}

function summary(problems) {
  return problems.map(({ code, path }) => ({ code, path }));
}

const cases = [
  { code: 'E_FORMAT', mutate: () => 42, path: '' },
  { code: 'E_VERSION_UNSUPPORTED', mutate: (j) => void (j.version = 2), path: '/version' },
  { code: 'E_FIELD_MISSING', mutate: (j) => void delete j.bodies[0].linearDamping, path: '/bodies/0/linearDamping' },
  { code: 'E_FIELD_TYPE', mutate: (j) => void (j.bodies[0].fixtures[0].shape.width = 'x'), path: '/bodies/0/fixtures/0/shape/width' },
  { code: 'E_FIELD_RANGE', mutate: (j) => void (j.bodies[0].fixtures[0].shape.width = 0), path: '/bodies/0/fixtures/0/shape/width' },
  { code: 'E_FIELD_ENUM', mutate: (j) => void (j.clips[0].blend = 'x'), path: '/clips/0/blend' },
  { code: 'E_ID_EMPTY', mutate: (j) => void (j.joints[0].id = ''), path: '/joints/0/id' },
  { code: 'E_ID_DUPLICATE', mutate: (j) => void (j.joints[1].id = 'j_hip_l'), path: '/joints/1/id' },
  { code: 'E_ID_RESERVED', mutate: (j) => void (j.joints[0].id = 'root'), path: '/joints/0/id' },
  { code: 'E_ROOT_BODY_MISSING', mutate: (j) => void (j.ragdoll.rootBody = null), path: '/ragdoll/rootBody' },
  { code: 'E_ROOT_BODY_UNKNOWN', mutate: (j) => void (j.ragdoll.rootBody = 'b_nope'), path: '/ragdoll/rootBody' },
  { code: 'E_BODY_NO_FIXTURES', mutate: (j) => void (j.bodies[1].fixtures = []), path: '/bodies/1/fixtures' },
  { code: 'E_POLYGON_VERTEX_COUNT', json: () => polygonFile([[0, 0], [1, 0]]), path: '/bodies/1/fixtures/0/shape/vertices' },
  { code: 'E_POLYGON_DEGENERATE', json: () => polygonFile([[0, 0], [0, 0], [1, 0], [0, 1]]), path: '/bodies/1/fixtures/0/shape/vertices' },
  { code: 'E_POLYGON_NOT_CCW', json: () => polygonFile([[0, 0], [0, 1], [1, 0]]), path: '/bodies/1/fixtures/0/shape/vertices' },
  { code: 'E_POLYGON_NOT_CONVEX', json: () => polygonFile([[0, 0], [2, 0], [1, 0.5], [2, 2], [0, 2]]), path: '/bodies/1/fixtures/0/shape/vertices' },
  { code: 'E_SPRITE_ASSET_UNKNOWN', mutate: (j) => void (j.bodies[0].fixtures[0].sprite.asset = 's_nope'), path: '/bodies/0/fixtures/0/sprite/asset' },
  { code: 'E_SPRITE_SCALE_ZERO', mutate: (j) => void (j.bodies[0].fixtures[0].sprite.scale = [0, 1]), path: '/bodies/0/fixtures/0/sprite/scale' },
  {
    code: 'E_JOINT_BODY_MISSING',
    mutate: (j) => void (j.joints[2].bodyA = null),
    path: '/joints/2/bodyA',
    also: [{ code: 'W_BODY_UNLINKED', path: '/bodies/3' }],
  },
  {
    code: 'E_JOINT_BODY_UNKNOWN',
    mutate: (j) => void (j.joints[2].bodyB = 'b_nope'),
    path: '/joints/2/bodyB',
    also: [{ code: 'W_BODY_UNLINKED', path: '/bodies/3' }],
  },
  {
    code: 'E_JOINT_SAME_BODY',
    mutate: (j) => void (j.joints[2].bodyB = 'b_torso'),
    path: '/joints/2/bodyB',
    also: [{ code: 'W_BODY_UNLINKED', path: '/bodies/3' }],
  },
  { code: 'E_CLIP_KEY_INVALID', mutate: (j) => void (j.clips[0].key = 'Dead'), path: '/clips/0/key' },
  { code: 'E_CLIP_KEY_DUPLICATE', mutate: (j) => void j.clips.push(structuredClone(j.clips[0])), path: '/clips/1/key' },
  { code: 'E_TRACK_TARGET_UNKNOWN', mutate: (j) => void (j.clips[0].tracks[0].target = 'j_nope'), path: '/clips/0/tracks/0/target' },
  { code: 'E_TRACK_CHANNEL', mutate: (j) => void (j.clips[0].tracks[0].channel = 'angle'), path: '/clips/0/tracks/0/channel' },
  { code: 'E_TRACK_DUPLICATE', mutate: (j) => void j.clips[0].tracks.push(structuredClone(j.clips[0].tracks[0])), path: '/clips/0/tracks/2' },
  {
    code: 'E_KEYS_UNSORTED',
    mutate: (j) => void (j.clips[0].tracks[0].keys = [{ t: 3, v: 1, interp: 'linear' }, { t: 1, v: 1, interp: 'linear' }]),
    path: '/clips/0/tracks/0/keys/1/t',
  },
  {
    code: 'E_KEY_TIME_DUPLICATE',
    mutate: (j) => void (j.clips[0].tracks[0].keys = [{ t: 5, v: 1, interp: 'linear' }, { t: 5, v: 1, interp: 'linear' }]),
    path: '/clips/0/tracks/0/keys/1/t',
  },
  { code: 'E_KEY_TIME_RANGE', mutate: (j) => void (j.clips[0].tracks[0].keys[1].t = 6), path: '/clips/0/tracks/0/keys/1/t' },
  { code: 'E_KEY_VALUE', mutate: (j) => void (j.clips[0].tracks[0].keys[0].v = 2), path: '/clips/0/tracks/0/keys/0/v' },
  { code: 'E_KEY_INTERP_SPRITE', mutate: (j) => void (j.clips[0].tracks[1].keys[0].interp = 'linear'), path: '/clips/0/tracks/1/keys/0/interp' },
  { code: 'E_EVENT_NAME_EMPTY', mutate: (j) => void (j.clips[0].events[0].name = ''), path: '/clips/0/events/0/name' },
  { code: 'E_EVENT_TIME_RANGE', mutate: (j) => void (j.clips[0].events[0].t = 6), path: '/clips/0/events/0/t' },
  { code: 'W_UNKNOWN_FIELD', mutate: (j) => void (j.bodies[0].extra = 1), path: '/bodies/0/extra' },
  { code: 'W_BODY_UNLINKED', mutate: (j) => void j.joints.pop(), path: '/bodies/3' },
  {
    code: 'W_JOINT_LOOP',
    mutate: (j) => void j.joints.push(joint('j_loop', 'loop', 'b_torso', 'b_thigh_l', [0, 0.85], { enabled: false, lower: 0, upper: 0 })),
    path: '/joints/3',
  },
  { code: 'W_ANCHOR_OUTSIDE', mutate: (j) => void (j.joints[1].anchor = [5, 5]), path: '/joints/1/anchor' },
  { code: 'W_BODY_ZERO_MASS', mutate: (j) => void (j.bodies[1].fixtures[0].density = 0), path: '/bodies/1' },
  { code: 'W_MOTOR_OVERPOWERED', mutate: (j) => void (j.joints[2].motor.maxTorque = 1e6), path: '/joints/2/motor/maxTorque' },
  {
    code: 'W_CLIP_EMPTY',
    mutate: (j) => {
      j.clips[0].tracks = [];
      j.clips[0].events = [];
    },
    path: '/clips/0',
    also: [{ code: 'W_SPRITE_UNUSED', path: '/sprites/2' }],
  },
  { code: 'W_SPRITE_UNUSED', mutate: (j) => void j.sprites.push({ id: 's_extra', name: 'extra', src: 'extra.png' }), path: '/sprites/3' },
  {
    code: 'W_SPRITE_IMAGE_MISSING',
    mutate: () => undefined,
    options: { hasImage: (asset) => asset !== 's_torso' },
    path: '/sprites/0/src',
  },
  { code: 'W_DUPLICATE_NAME', mutate: (j) => void (j.bodies[1].name = 'torso'), path: '/bodies/1/name' },
];

test('a complete valid file has no problems', () => {
  const result = validate(validFile(), { hasImage: () => true });
  assert.deepEqual(result, { errors: [], warnings: [] });
});

test('PROBLEM_CODES lists exactly the contract codes, frozen, with severity from the prefix', () => {
  assert.ok(Object.isFrozen(PROBLEM_CODES));
  assert.equal(Object.keys(PROBLEM_CODES).length, 43);
  for (const [code, severity] of Object.entries(PROBLEM_CODES)) {
    assert.equal(severity, code.startsWith('E_') ? 'error' : 'warning', code);
  }
});

test('every code has a table case', () => {
  assert.deepEqual([...new Set(cases.map((c) => c.code))].sort(), Object.keys(PROBLEM_CODES).sort());
  assert.ok(cases.some((c) => c.code === 'E_FORMAT'));
});

for (const entry of cases) {
  test(`${entry.code} at ${entry.path || '(document)'}`, () => {
    const json = entry.json ? entry.json() : validFile();
    const mutated = entry.mutate ? entry.mutate(json) : undefined;
    const input = mutated === undefined ? json : mutated;
    const problems = problemsOf(input, entry.options);
    const expected = [{ code: entry.code, path: entry.path }, ...(entry.also ?? [])];
    assert.deepEqual(summary(problems).sort(byCodePath), expected.sort(byCodePath));
    const main = problems.find((problem) => problem.code === entry.code);
    assert.equal(main.severity, PROBLEM_CODES[entry.code]);
    assert.equal(typeof main.message, 'string');
    assert.ok(main.message.length > 0 && !main.message.endsWith('.'));
  });
}

function byCodePath(a, b) {
  return `${a.code}${a.path}`.localeCompare(`${b.code}${b.path}`);
}

test('E_FORMAT also reports a wrong format string at /format', () => {
  const json = validFile();
  json.format = 'other';
  assert.deepEqual(summary(problemsOf(json)), [{ code: 'E_FORMAT', path: '/format' }]);
});

test('problems carry severity lists, pointer paths and targets', () => {
  const json = validFile();
  json.bodies[0].fixtures[0].shape.width = 0;
  json.clips[0].events[0].t = 9;
  json.units.pixelsPerMeter = 0;
  const { errors } = validate(json);
  const byCode = Object.fromEntries(errors.map((error) => [error.path, error]));
  assert.deepEqual(byCode['/bodies/0/fixtures/0/shape/width'].target, { type: 'shape', id: 'f_torso' });
  assert.deepEqual(byCode['/clips/0/events/0/t'].target, { type: 'clip', id: 'dead' });
  assert.equal(byCode['/units/pixelsPerMeter'].target, null);
  assert.match(byCode['/bodies/0/fixtures/0/shape/width'].message, /^Shape "torso": /);
});

test('target is null when the object has no string id', () => {
  const json = validFile();
  json.bodies[0].id = 5;
  const error = validate(json).errors.find((entry) => entry.path === '/bodies/0/id');
  assert.equal(error.code, 'E_FIELD_TYPE');
  assert.deepEqual(error.target, { type: 'body', id: null });
});

test('pointer paths escape ~ and / in unknown keys', () => {
  const json = validFile();
  json.bodies[0]['a/b~c'] = 1;
  assert.equal(validate(json).warnings[0].path, '/bodies/0/a~1b~0c');
});

test('unknown fields are ignored inside json event data', () => {
  const json = validFile();
  json.clips[0].events[0].data = { anything: [1, 2], nested: { x: 1 } };
  assert.deepEqual(validate(json), { errors: [], warnings: [] });
});

test('the gate returns only the gate errors', () => {
  const json = validFile();
  json.format = 'x';
  json.version = 99;
  json.bodies[0].id = 5;
  assert.deepEqual(summary(problemsOf(json)), [
    { code: 'E_FORMAT', path: '/format' },
    { code: 'E_VERSION_UNSUPPORTED', path: '/version' },
  ]);
  const noVersion = validFile();
  delete noVersion.version;
  noVersion.joints[0].id = 7;
  assert.deepEqual(summary(problemsOf(noVersion)), [{ code: 'E_VERSION_UNSUPPORTED', path: '/version' }]);
});

test('inputs that are not objects give only E_FORMAT at the document', () => {
  for (const input of [null, undefined, 42, 'x', true, [], NaN]) {
    assert.deepEqual(summary(problemsOf(input)), [{ code: 'E_FORMAT', path: '' }]);
  }
  assert.deepEqual(summary(problemsOf({})), [
    { code: 'E_FORMAT', path: '/format' },
    { code: 'E_VERSION_UNSUPPORTED', path: '/version' },
  ]);
});

test('validate never throws on odd documents', () => {
  const header = { format: 'ragassembler', version: 1 };
  const odd = [
    { ...header },
    { ...header, ragdoll: null, sprites: null, bodies: 5, joints: 'x', clips: {} },
    { ...header, bodies: [null, 1, 'x', [], { fixtures: 5 }, { fixtures: [null, {}] }], joints: [null, {}, { limits: 3 }] },
    { ...header, clips: [null, {}, { tracks: [null, {}, { keys: [null, {}] }], events: [null, {}] }] },
    { ...header, sprites: [null, {}, { id: NaN }], ragdoll: { rootBody: 5, channels: 3 } },
    { ...header, meta: 1, units: [], preview: null },
  ];
  for (const input of odd) {
    const result = validate(input);
    assert.ok(Array.isArray(result.errors) && Array.isArray(result.warnings));
    assert.ok(result.errors.length > 0);
  }
});

function pointers(value, path = '') {
  const result = [];
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const child = `${path}/${key}`;
      result.push(child, ...pointers(value[key], child));
    }
  }
  return result;
}

function locate(root, pointer) {
  const segments = pointer.split('/').slice(1);
  const key = segments.pop();
  return [segments.reduce((node, segment) => node[segment], root), key];
}

test('replacing or deleting any single value of a valid file never throws and yields well-formed problems', () => {
  const replacements = [null, 42, 'x', [], {}, NaN, Infinity, -1, 0, '', true, undefined, [1], [NaN, 0], { a: 1 }];
  for (const pointer of pointers(validFile())) {
    for (const replacement of [...replacements, Symbol.for('delete')]) {
      const json = validFile();
      const [holder, key] = locate(json, pointer);
      if (replacement === Symbol.for('delete')) delete holder[key];
      else holder[key] = replacement;
      const { errors, warnings } = validate(json, { hasImage: () => false });
      const seen = new Set();
      for (const problem of [...errors, ...warnings]) {
        assert.equal(problem.severity, PROBLEM_CODES[problem.code], `${pointer} -> ${problem.code}`);
        assert.ok(problem.path === '' || problem.path.startsWith('/'));
        assert.equal(typeof problem.message, 'string');
        assert.ok(problem.target === null || typeof problem.target.type === 'string');
        const key2 = `${problem.path}|${problem.code}`;
        assert.ok(!seen.has(key2), `duplicate ${key2}`);
        seen.add(key2);
      }
    }
  }
});

test('no cascades: a field with an error is not read by other rules', () => {
  const radius = validFile();
  radius.bodies[0].fixtures[0].shape = { type: 'circle', center: [0, 0], radius: 'x' };
  assert.deepEqual(summary(problemsOf(radius)), [{ code: 'E_FIELD_TYPE', path: '/bodies/0/fixtures/0/shape/radius' }]);

  const negativeTime = validFile();
  negativeTime.clips[0].tracks[0].keys[1].t = -1;
  assert.deepEqual(summary(problemsOf(negativeTime)), [
    { code: 'E_FIELD_RANGE', path: '/clips/0/tracks/0/keys/1/t' },
  ]);

  const length = validFile();
  length.clips[0].length = 'x';
  assert.deepEqual(summary(problemsOf(length)), [{ code: 'E_FIELD_TYPE', path: '/clips/0/length' }]);

  const vertices = polygonFile([[0, 0], [1, 0], 'x']);
  assert.deepEqual(summary(problemsOf(vertices)), [{ code: 'E_FIELD_TYPE', path: '/bodies/1/fixtures/0/shape/vertices/2' }]);

  const missingLimits = validFile();
  delete missingLimits.joints[0].limits;
  assert.deepEqual(summary(problemsOf(missingLimits)), [{ code: 'E_FIELD_MISSING', path: '/joints/0/limits' }]);
});

test('joint limits must straddle zero whether or not they are enabled', () => {
  const json = validFile();
  json.joints[0].limits = { enabled: false, lower: 0.5, upper: -0.5 };
  assert.deepEqual(summary(problemsOf(json)), [
    { code: 'E_FIELD_RANGE', path: '/joints/0/limits/lower' },
    { code: 'E_FIELD_RANGE', path: '/joints/0/limits/upper' },
  ]);
});

test('ragdoll.id other than root is a range error', () => {
  const json = validFile();
  json.ragdoll.id = 'other';
  assert.deepEqual(summary(problemsOf(json)), [{ code: 'E_FIELD_RANGE', path: '/ragdoll/id' }]);
});

test('a duplicate id is reported once, at the later occurrence, across kinds', () => {
  const json = validFile();
  json.bodies[2].fixtures[0].id = 's_torso';
  json.joints[1].id = 'b_torso';
  assert.deepEqual(summary(problemsOf(json)), [
    { code: 'E_ID_DUPLICATE', path: '/bodies/2/fixtures/0/id' },
    { code: 'E_ID_DUPLICATE', path: '/joints/1/id' },
  ]);
});

test('output order is deterministic', () => {
  const json = validFile();
  json.bodies[0].extra = 1;
  json.joints[0].id = '';
  json.clips[0].events[0].t = 9;
  json.sprites.push({ id: 's_extra', name: 'e', src: 'e.png' });
  const first = validate(structuredClone(json));
  const second = validate(structuredClone(json));
  assert.deepEqual(first, second);
  assert.ok(first.errors.length > 0 && first.warnings.length > 0);
});

test('every shape rejected by shapeGeometryValid has at least one error', () => {
  const shapes = [
    undefined,
    null,
    5,
    {},
    { type: 'blob' },
    { type: 'circle', center: [0, 0], radius: 0 },
    { type: 'circle', center: [0, 0], radius: -1 },
    { type: 'circle', center: [0, 0], radius: NaN },
    { type: 'circle', center: [0], radius: 1 },
    { type: 'circle', radius: 1 },
    { type: 'box', center: [0, 0], width: 0, height: 1, angle: 0 },
    { type: 'box', center: [0, 0], width: 1, height: -1, angle: 0 },
    { type: 'box', center: [0, 0], width: 1, height: 1, angle: Infinity },
    { type: 'box', center: [0, 0], width: 1, height: 1 },
    { type: 'polygon', vertices: [[0, 0], [1, 0]] },
    { type: 'polygon', vertices: [[0, 0], [1, 0], [NaN, 1]] },
    { type: 'polygon', vertices: [[0, 0], [1, 0], 5] },
    { type: 'polygon', vertices: 'x' },
    { type: 'polygon' },
  ];
  for (const shape of shapes) {
    assert.equal(shapeGeometryValid(shape), false);
    const json = validFile();
    if (shape === undefined) delete json.bodies[0].fixtures[0].shape;
    else json.bodies[0].fixtures[0].shape = shape;
    const { errors } = validate(json);
    assert.ok(
      errors.some((error) => error.path.startsWith('/bodies/0/fixtures/0/shape')),
      JSON.stringify(shape),
    );
  }
});

test('ids reachable only through duplicate or unknown references leave the guard rails intact', () => {
  const json = validFile();
  json.ragdoll.rootBody = 'b_nope';
  json.joints[0].bodyA = 'b_nope';
  const codes = problemsOf(json).map((problem) => problem.code).sort();
  assert.deepEqual(codes, ['E_JOINT_BODY_UNKNOWN', 'E_ROOT_BODY_UNKNOWN']);
});

function jsonGraph({ bodies, joints, rootBody }) {
  const json = validFile();
  json.ragdoll.rootBody = rootBody;
  json.bodies = bodies.map((id, index) => body(id, `n_${id}`, [index * 3, 0], box(`f_${id}`, `s_${id}`, 1, 1)));
  json.bodies.forEach((entry) => {
    entry.fixtures[0].sprite = null;
  });
  json.joints = joints.map(([bodyA, bodyB], index) =>
    joint(`j_${index + 1}`, `joint_${index + 1}`, bodyA, bodyB, [0, 0], { enabled: false, lower: 0, upper: 0 }),
  );
  json.sprites = [];
  json.clips = [];
  return json;
}

function modelGraph({ bodies, joints, rootBody }) {
  const model = new Model();
  const history = new History(model);
  history.execute({
    label: 'Build',
    run(tx) {
      for (const id of bodies) {
        tx.add(ROOT_UID, 'bodies', undefined, { type: 'body', props: { id }, children: { fixtures: [] } });
      }
      joints.forEach(([bodyA, bodyB], index) => {
        tx.add(ROOT_UID, 'joints', undefined, {
          type: 'joint',
          props: { ...defaultsOf('joint'), id: `j_${index + 1}`, bodyA, bodyB },
        });
      });
      tx.set(ROOT_UID, 'rootBody', rootBody);
    },
  });
  return model;
}

const graphs = [
  { bodies: ['a', 'b', 'c'], joints: [['a', 'b'], ['b', 'c']], rootBody: 'a' },
  { bodies: ['a', 'b', 'c', 'd'], joints: [['a', 'b'], ['c', 'd']], rootBody: 'a' },
  { bodies: ['a', 'b', 'c'], joints: [['a', 'b'], ['b', 'c'], ['c', 'a']], rootBody: 'a' },
  { bodies: ['a', 'b', 'c'], joints: [['a', 'b'], ['b', 'c'], ['a', 'c']], rootBody: 'b' },
  { bodies: ['a', 'b'], joints: [['a', 'b'], ['b', 'a']], rootBody: 'a' },
  { bodies: ['a', 'b', 'c'], joints: [['a', 'a'], ['a', null], ['a', 'zzz'], ['b', 'c']], rootBody: 'a' },
  { bodies: ['a', 'b', 'c', 'd', 'e'], joints: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'b'], ['d', 'e']], rootBody: 'c' },
];

test('W_BODY_UNLINKED and W_JOINT_LOOP agree with jointTree on the same graphs', () => {
  for (const graph of graphs) {
    const tree = jointTree(modelGraph(graph));
    const model = modelGraph(graph);
    const bodyUids = model.children(ROOT_UID, 'bodies');
    const jointUids = model.children(ROOT_UID, 'joints');
    const expectedUnlinked = bodyUids.map((uid, index) => [uid, index]).filter(([uid]) => !tree.depth.has(uid)).map(([, index]) => `/bodies/${index}`);
    const expectedLoops = jointUids.map((uid, index) => [uid, index]).filter(([uid]) => jointTree(model).loops.has(uid)).map(([, index]) => `/joints/${index}`);
    const { warnings } = validate(jsonGraph(graph));
    const unlinked = warnings.filter((w) => w.code === 'W_BODY_UNLINKED').map((w) => w.path);
    const loops = warnings.filter((w) => w.code === 'W_JOINT_LOOP').map((w) => w.path);
    assert.deepEqual(unlinked.sort(), expectedUnlinked.sort(), JSON.stringify(graph));
    assert.deepEqual(loops.sort(), expectedLoops.sort(), JSON.stringify(graph));
  }
});

test('unlinked and loop checks are skipped when rootBody is not a body id', () => {
  for (const rootBody of [null, 'zzz']) {
    const { warnings } = validate(jsonGraph({ bodies: ['a', 'b'], joints: [], rootBody }));
    assert.deepEqual(warnings.filter((w) => w.code === 'W_BODY_UNLINKED' || w.code === 'W_JOINT_LOOP'), []);
  }
});

test('W_ANCHOR_OUTSIDE tolerates an anchor within 1 mm of a shape and rotates with the body', () => {
  const json = validFile();
  json.joints[1].anchor = [0.1005, 0.35];
  assert.deepEqual(validate(json).warnings, []);
  json.joints[1].anchor = [0.102, 0.35];
  assert.deepEqual(summary(validate(json).warnings), [{ code: 'W_ANCHOR_OUTSIDE', path: '/joints/1/anchor' }]);
  const rotated = validFile();
  rotated.bodies[1].angle = Math.PI / 2;
  rotated.joints[1].anchor = [0.2, 0.6];
  assert.deepEqual(validate(rotated).warnings, []);
});

test('W_BODY_ZERO_MASS is skipped when the body has errors in its shapes', () => {
  const json = validFile();
  json.bodies[1].fixtures[0].density = 0;
  json.bodies[1].fixtures[0].friction = -1;
  assert.deepEqual(summary(problemsOf(json)), [{ code: 'E_FIELD_RANGE', path: '/bodies/1/fixtures/0/friction' }]);
});

test('W_MOTOR_OVERPOWERED fires only above 1000 times the suggestion, without values in the message', () => {
  const json = validFile();
  json.joints[2].motor.maxTorque = 1000 * 0.47;
  assert.deepEqual(validate(json).warnings, []);
  json.joints[2].motor.maxTorque = 1000 * 0.47 + 1;
  const [warning] = validate(json).warnings;
  assert.equal(warning.code, 'W_MOTOR_OVERPOWERED');
  assert.deepEqual(warning.target, { type: 'joint', id: 'j_neck' });
  assert.match(warning.message, /Fit motor torque/);
  assert.doesNotMatch(warning.message, /\d/);
});

test('W_MOTOR_OVERPOWERED is skipped on errors in bodies or in the joint, and without a suggestion', () => {
  const bodyError = validFile();
  bodyError.joints[2].motor.maxTorque = 1e6;
  bodyError.bodies[1].fixtures[0].friction = -1;
  assert.ok(!problemsOf(bodyError).some((problem) => problem.code === 'W_MOTOR_OVERPOWERED'));
  const jointError = validFile();
  jointError.joints[2].motor.maxTorque = 1e6;
  jointError.joints[2].motor.gain = -1;
  assert.ok(!problemsOf(jointError).some((problem) => problem.code === 'W_MOTOR_OVERPOWERED'));
  const massless = validFile();
  massless.joints[2].motor.maxTorque = 1e6;
  massless.bodies[3].fixtures[0].density = 0;
  assert.ok(!problemsOf(massless).some((problem) => problem.code === 'W_MOTOR_OVERPOWERED'));
});

test('hasImage is optional, receives the asset id and only flags false', () => {
  const json = validFile();
  assert.deepEqual(validate(json).warnings, []);
  const asked = [];
  const { warnings } = validate(json, {
    hasImage(asset) {
      asked.push(asset);
      return asset === 's_torso';
    },
  });
  assert.deepEqual(asked, ['s_torso', 's_face_normal', 's_face_dead']);
  assert.deepEqual(summary(warnings), [
    { code: 'W_SPRITE_IMAGE_MISSING', path: '/sprites/1/src' },
    { code: 'W_SPRITE_IMAGE_MISSING', path: '/sprites/2/src' },
  ]);
});

test('a sprite referenced only by a sprite key value is used', () => {
  const json = validFile();
  assert.equal(validate(json).warnings.some((w) => w.code === 'W_SPRITE_UNUSED'), false);
  json.clips[0].tracks.pop();
  assert.deepEqual(summary(validate(json).warnings), [{ code: 'W_SPRITE_UNUSED', path: '/sprites/2' }]);
});

test('W_DUPLICATE_NAME: one warning per duplicated name within a kind, listing every id', () => {
  const json = validFile();
  json.bodies[1].name = 'torso';
  json.bodies[2].name = 'torso';
  json.bodies[3].name = 'head';
  json.bodies[0].fixtures[0].name = 'part';
  json.bodies[1].fixtures[0].name = 'part';
  json.joints[0].name = 'knee_l';
  const { warnings } = validate(json);
  assert.deepEqual(summary(warnings), [
    { code: 'W_DUPLICATE_NAME', path: '/bodies/1/name' },
    { code: 'W_DUPLICATE_NAME', path: '/bodies/1/fixtures/0/name' },
    { code: 'W_DUPLICATE_NAME', path: '/joints/1/name' },
  ]);
  const [bodies, shapes, joints] = warnings;
  for (const id of ['b_torso', 'b_thigh_l', 'b_shin_l']) assert.ok(bodies.message.includes(`"${id}"`), bodies.message);
  assert.ok(!bodies.message.includes('b_head'));
  for (const id of ['f_torso', 'f_thigh']) assert.ok(shapes.message.includes(`"${id}"`), shapes.message);
  for (const id of ['j_hip_l', 'j_knee_l']) assert.ok(joints.message.includes(`"${id}"`), joints.message);
  assert.deepEqual(bodies.target, { type: 'body', id: 'b_thigh_l' });
});

test('W_DUPLICATE_NAME: two distinct duplicated names in one kind give two warnings', () => {
  const json = validFile();
  json.bodies[1].name = 'torso';
  json.bodies[3].name = 'shin_l';
  const { warnings } = validate(json);
  assert.deepEqual(summary(warnings), [
    { code: 'W_DUPLICATE_NAME', path: '/bodies/1/name' },
    { code: 'W_DUPLICATE_NAME', path: '/bodies/3/name' },
  ]);
});

test('W_DUPLICATE_NAME: equal names across different kinds do not warn, and unique names do not warn', () => {
  const json = validFile();
  json.bodies[0].name = 'same';
  json.bodies[0].fixtures[0].name = 'same';
  json.joints[0].name = 'same';
  assert.deepEqual(validate(json), { errors: [], warnings: [] });
});

test('W_DUPLICATE_NAME: shapes of different bodies form one kind', () => {
  const json = validFile();
  json.bodies[2].fixtures[0].name = 'torso';
  assert.deepEqual(summary(validate(json).warnings), [{ code: 'W_DUPLICATE_NAME', path: '/bodies/2/fixtures/0/name' }]);
});

test('RagImporter.validate delegates to validate and supportedVersions is the frozen list', () => {
  const json = validFile();
  json.bodies[0].extra = 1;
  json.joints[0].id = '';
  assert.deepEqual(RagImporter.validate(json), validate(json));
  assert.deepEqual(RagImporter.validate(null), validate(null));
  assert.equal(RagImporter.supportedVersions, SUPPORTED_VERSIONS);
  assert.ok(Object.isFrozen(SUPPORTED_VERSIONS));
  assert.deepEqual([...SUPPORTED_VERSIONS], [1]);
  const calls = [];
  RagImporter.validate(validFile(), { hasImage: (asset) => calls.push(asset) });
  assert.deepEqual(calls, []);
});
