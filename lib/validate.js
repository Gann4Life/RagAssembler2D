import { CHANNELS, FORMAT, FORMAT_VERSION, fieldsOf } from './schema.js';
import { bodyMass, pointInShape, polygonProblems } from './geometry.js';
import { MOTOR_TORQUE, motorTorqueSuggestions } from './motor.js';

/**
 * @typedef {object} ProblemTarget
 * @property {string} type `root`, `spriteAsset`, `body`, `shape`, `joint` or `clip`.
 * @property {string|null} id The object's `id` (a clip's `key`).
 */

/**
 * @typedef {object} Problem
 * @property {'error'|'warning'} severity Fixed per code.
 * @property {string} code Stable identifier, a key of `PROBLEM_CODES`.
 * @property {string} message English sentence for people, without a trailing period. Wording is not stable.
 * @property {string} path RFC 6901 JSON Pointer to the offending value in the validated JSON; `""` for the document.
 * @property {ProblemTarget|null} target Innermost selectable object on `path`; `null` for document-level paths.
 */

/**
 * @typedef {object} ValidationResult
 * @property {Problem[]} errors Problems that block save and parse.
 * @property {Problem[]} warnings Problems that never block.
 */

/**
 * @typedef {object} ValidateOptions
 * @property {(asset: string) => boolean} [hasImage] Editor only: whether the sprite asset with this id has an
 *   image. Enables `W_SPRITE_IMAGE_MISSING`; exceptions it throws propagate.
 */

/**
 * File format versions `validate` accepts after its gate.
 * @type {ReadonlyArray<number>}
 */
export const SUPPORTED_VERSIONS = Object.freeze([FORMAT_VERSION]);

/**
 * Severity of every problem code of the validation contract.
 * @type {Readonly<Record<string, 'error'|'warning'>>}
 */
export const PROBLEM_CODES = Object.freeze({
  E_FORMAT: 'error',
  E_VERSION_UNSUPPORTED: 'error',
  E_FIELD_MISSING: 'error',
  E_FIELD_TYPE: 'error',
  E_FIELD_RANGE: 'error',
  E_FIELD_ENUM: 'error',
  E_ID_EMPTY: 'error',
  E_ID_DUPLICATE: 'error',
  E_ID_RESERVED: 'error',
  E_ROOT_BODY_MISSING: 'error',
  E_ROOT_BODY_UNKNOWN: 'error',
  E_BODY_NO_FIXTURES: 'error',
  E_POLYGON_VERTEX_COUNT: 'error',
  E_POLYGON_DEGENERATE: 'error',
  E_POLYGON_NOT_CCW: 'error',
  E_POLYGON_NOT_CONVEX: 'error',
  E_SPRITE_ASSET_UNKNOWN: 'error',
  E_SPRITE_SCALE_ZERO: 'error',
  E_JOINT_BODY_MISSING: 'error',
  E_JOINT_BODY_UNKNOWN: 'error',
  E_JOINT_SAME_BODY: 'error',
  E_CLIP_KEY_INVALID: 'error',
  E_CLIP_KEY_DUPLICATE: 'error',
  E_TRACK_TARGET_UNKNOWN: 'error',
  E_TRACK_CHANNEL: 'error',
  E_TRACK_DUPLICATE: 'error',
  E_KEYS_UNSORTED: 'error',
  E_KEY_TIME_DUPLICATE: 'error',
  E_KEY_TIME_RANGE: 'error',
  E_KEY_VALUE: 'error',
  E_KEY_INTERP_SPRITE: 'error',
  E_EVENT_NAME_EMPTY: 'error',
  E_EVENT_TIME_RANGE: 'error',
  W_UNKNOWN_FIELD: 'warning',
  W_BODY_UNLINKED: 'warning',
  W_JOINT_LOOP: 'warning',
  W_ANCHOR_OUTSIDE: 'warning',
  W_BODY_ZERO_MASS: 'warning',
  W_MOTOR_OVERPOWERED: 'warning',
  W_CLIP_EMPTY: 'warning',
  W_SPRITE_UNUSED: 'warning',
  W_SPRITE_IMAGE_MISSING: 'warning',
  W_DUPLICATE_NAME: 'warning',
});

const ANCHOR_TOLERANCE = 0.001;
const KEY_PATTERN = /^[a-z0-9_]+$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const SHAPE_TYPES = fieldsOf('shape').find((spec) => spec.path === 'shape.type').enum;
const POLYGON_CODES = {
  count: 'E_POLYGON_VERTEX_COUNT',
  degenerate: 'E_POLYGON_DEGENERATE',
  notCcw: 'E_POLYGON_NOT_CCW',
  notConvex: 'E_POLYGON_NOT_CONVEX',
};
const PLURALS = { body: 'bodies', shape: 'shapes', joint: 'joints' };

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVec2(value) {
  return Array.isArray(value) && value.length === 2 && isNumber(value[0]) && isNumber(value[1]);
}

function join(path, ...segments) {
  return segments.reduce((result, segment) => `${result}/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`, path);
}

function createContext(options) {
  const errors = [];
  const warnings = [];
  const reported = new Set();
  const errorPaths = new Set();
  return {
    errors,
    warnings,
    hasImage: typeof options?.hasImage === 'function' ? options.hasImage : null,
    report(code, path, subject, text) {
      const key = `${path}\u0000${code}`;
      if (reported.has(key)) return;
      reported.add(key);
      const severity = PROBLEM_CODES[code];
      const problem = { severity, code, message: `${subject.label}: ${text}`, path, target: subject.target };
      if (severity === 'error') {
        errors.push(problem);
        errorPaths.add(path);
      } else {
        warnings.push(problem);
      }
    },
    hasError(path) {
      return errorPaths.has(path);
    },
    hasErrorUnder(path) {
      for (const errorPath of errorPaths) {
        if (errorPath === path || errorPath.startsWith(`${path}/`)) return true;
      }
      return false;
    },
  };
}

function subjectOf(kind, type, record, idKey = 'id') {
  const id = record[idKey];
  let name = null;
  if (typeof record.name === 'string' && record.name !== '') name = record.name;
  else if (typeof id === 'string' && id !== '') name = id;
  return {
    label: name === null ? kind : `${kind} "${name}"`,
    target: { type, id: typeof id === 'string' ? id : null },
  };
}

const DOCUMENT_SUBJECT = { label: 'Document', target: null };

function describeType(type) {
  if (type === 'string') return 'a string';
  if (type === 'number') return 'a finite number';
  if (type === 'integer') return 'an integer';
  if (type === 'boolean') return 'true or false';
  if (type === 'vec2') return 'a pair of finite numbers';
  if (type === 'vec2[]') return 'a list of pairs of finite numbers';
  if (type === 'color') return 'a #rrggbb color';
  if (type.startsWith('ref:')) return 'an id or null';
  if (type === 'ref') return 'an id';
  if (type.startsWith('list:')) return 'a list';
  return 'an object';
}

function describeRange(spec) {
  const { min, max, exclusiveMin } = spec;
  if (min !== undefined && max !== undefined) return `be between ${min} and ${max}`;
  if (min !== undefined) {
    if (exclusiveMin) return min === 0 ? 'be positive' : `be greater than ${min}`;
    return min === 0 ? 'not be negative' : `be at least ${min}`;
  }
  return max === 0 ? 'not be positive' : `be at most ${max}`;
}

function outOfRange(spec, value) {
  if (spec.min !== undefined && (spec.exclusiveMin ? value <= spec.min : value < spec.min)) return true;
  return spec.max !== undefined && value > spec.max;
}

function scalarTypeOk(type, value) {
  switch (type) {
    case 'string':
    case 'ref':
      return typeof value === 'string';
    case 'number':
      return isNumber(value);
    case 'integer':
      return isNumber(value) && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'vec2':
      return isVec2(value);
    case 'color':
      return typeof value === 'string' && COLOR_PATTERN.test(value);
    default:
      return type.startsWith('ref:') ? value === null || typeof value === 'string' : true;
  }
}

function checkField(ctx, spec, holder, key, path, subject) {
  const value = holder[key];
  if (value === undefined) {
    if (!spec.optional) ctx.report('E_FIELD_MISSING', path, subject, `${spec.path} is missing`);
    return;
  }
  const { type } = spec;
  if (value === null && spec.optional) return;
  if (type === 'json' || type === 'channel') return;
  if (type.startsWith('list:')) {
    if (!Array.isArray(value)) ctx.report('E_FIELD_TYPE', path, subject, `${spec.path} must be ${describeType(type)}`);
    return;
  }
  if (type === 'root' || type === 'sprite') {
    if (!isObject(value)) ctx.report('E_FIELD_TYPE', path, subject, `${spec.path} must be ${describeType(type)}`);
    return;
  }
  if (type === 'enum') {
    if (!spec.enum.includes(value)) ctx.report('E_FIELD_ENUM', path, subject, `${spec.path} is not a supported value`);
    return;
  }
  if (type === 'vec2[]') {
    if (!Array.isArray(value)) {
      ctx.report('E_FIELD_TYPE', path, subject, `${spec.path} must be ${describeType(type)}`);
      return;
    }
    value.forEach((item, index) => {
      if (!isVec2(item)) ctx.report('E_FIELD_TYPE', join(path, index), subject, `${spec.path}[${index}] must be ${describeType('vec2')}`);
    });
    return;
  }
  if (!scalarTypeOk(type, value)) {
    ctx.report('E_FIELD_TYPE', path, subject, `${spec.path} must be ${describeType(type)}`);
    return;
  }
  if ((type === 'number' || type === 'integer') && outOfRange(spec, value)) {
    ctx.report('E_FIELD_RANGE', path, subject, `${spec.path} must ${describeRange(spec)}`);
  }
}

function checkFields(ctx, specs, record, path, subject) {
  for (const spec of specs) {
    const segments = spec.path.split('.');
    let holder = record;
    let holderPath = path;
    let blocked = false;
    for (let index = 0; index < segments.length - 1; index++) {
      const next = holder[segments[index]];
      holderPath = join(holderPath, segments[index]);
      const walked = segments.slice(0, index + 1).join('.');
      if (next === undefined) {
        ctx.report('E_FIELD_MISSING', holderPath, subject, `${walked} is missing`);
        blocked = true;
        break;
      }
      if (!isObject(next)) {
        ctx.report('E_FIELD_TYPE', holderPath, subject, `${walked} must be an object`);
        blocked = true;
        break;
      }
      holder = next;
    }
    if (blocked) continue;
    const last = segments[segments.length - 1];
    checkField(ctx, spec, holder, last, join(holderPath, last), subject);
  }
}

function knownKeys(specs) {
  const tree = new Map();
  for (const spec of specs) {
    const segments = spec.path.split('.');
    let node = tree;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) {
        node.set(segment, true);
      } else {
        if (!(node.get(segment) instanceof Map)) node.set(segment, new Map());
        node = node.get(segment);
      }
    });
  }
  return tree;
}

function checkUnknown(ctx, tree, record, path, subject, prefix = '') {
  for (const key of Object.keys(record)) {
    const branch = tree.get(key);
    if (branch === undefined) {
      ctx.report('W_UNKNOWN_FIELD', join(path, key), subject, `unknown field "${prefix}${key}"`);
    } else if (branch instanceof Map && isObject(record[key])) {
      checkUnknown(ctx, branch, record[key], join(path, key), subject, `${prefix}${key}.`);
    }
  }
}

function checkRecord(ctx, type, record, path, subject, variant) {
  const known = fieldsOf(type, variant);
  const checked = type === 'shape' && variant === undefined ? known.filter((spec) => !spec.variants) : known;
  checkFields(ctx, checked, record, path, subject);
  checkUnknown(ctx, knownKeys(known), record, path, subject);
}

function eachItem(ctx, list, path, subject, visit) {
  if (!Array.isArray(list)) return;
  for (let index = 0; index < list.length; index++) {
    const itemPath = join(path, index);
    if (isObject(list[index])) visit(list[index], itemPath, index);
    else ctx.report('E_FIELD_TYPE', itemPath, subject, `${path.split('/').pop()}[${index}] must be an object`);
  }
}

function objectsOf(list) {
  return Array.isArray(list) ? list.filter(isObject) : [];
}

function stringIds(records, key = 'id') {
  return new Set(records.map((record) => record[key]).filter((id) => typeof id === 'string'));
}

function collectRefs(json) {
  const bodies = objectsOf(json.bodies);
  const fixtures = bodies.flatMap((body) => objectsOf(body.fixtures));
  const clips = objectsOf(json.clips);
  const used = new Set();
  for (const fixture of fixtures) {
    if (isObject(fixture.sprite) && typeof fixture.sprite.asset === 'string') used.add(fixture.sprite.asset);
  }
  for (const clip of clips) {
    for (const track of objectsOf(clip.tracks)) {
      if (track.channel !== 'sprite') continue;
      for (const key of objectsOf(track.keys)) if (typeof key.v === 'string') used.add(key.v);
    }
  }
  const bodyById = new Map();
  for (const body of bodies) if (typeof body.id === 'string' && !bodyById.has(body.id)) bodyById.set(body.id, body);
  return {
    bodyIds: stringIds(bodies),
    shapeIds: stringIds(fixtures),
    jointIds: stringIds(objectsOf(json.joints)),
    spriteIds: stringIds(objectsOf(json.sprites)),
    usedSprites: used,
    bodyById,
    bodyPaths: new Map(),
    seenIds: new Set(),
    names: { body: [], shape: [], joint: [] },
  };
}

function checkId(ctx, record, path, subject, refs) {
  const idPath = join(path, 'id');
  const { id } = record;
  if (typeof id !== 'string' || ctx.hasError(idPath)) return;
  if (id === '') ctx.report('E_ID_EMPTY', idPath, subject, 'id is empty');
  else if (id === 'root') ctx.report('E_ID_RESERVED', idPath, subject, 'id "root" is reserved for the ragdoll root');
  else if (refs.seenIds.has(id)) ctx.report('E_ID_DUPLICATE', idPath, subject, `id "${id}" is already used`);
  else refs.seenIds.add(id);
}

function noteName(ctx, kind, record, path, subject, refs) {
  const namePath = join(path, 'name');
  if (typeof record.name !== 'string' || ctx.hasError(namePath)) return;
  const id = typeof record.id === 'string' ? record.id : path;
  refs.names[kind].push({ name: record.name, id, path: namePath, subject });
}

function checkRoot(ctx, root, refs) {
  const path = '/ragdoll';
  const subject = subjectOf('Ragdoll', 'root', root);
  checkRecord(ctx, 'root', root, path, subject);
  const idPath = join(path, 'id');
  if (typeof root.id === 'string' && !ctx.hasError(idPath) && root.id !== 'root') {
    ctx.report('E_FIELD_RANGE', idPath, subject, 'id must be "root"');
  }
  const bodyPath = join(path, 'rootBody');
  if (ctx.hasError(bodyPath)) return;
  if (root.rootBody === null) ctx.report('E_ROOT_BODY_MISSING', bodyPath, subject, 'rootBody is not set');
  else if (typeof root.rootBody === 'string' && !refs.bodyIds.has(root.rootBody)) {
    ctx.report('E_ROOT_BODY_UNKNOWN', bodyPath, subject, `rootBody "${root.rootBody}" is not a body id`);
  }
}

function checkSprites(ctx, json, refs) {
  eachItem(ctx, json.sprites, '/sprites', DOCUMENT_SUBJECT, (asset, path) => {
    const subject = subjectOf('Sprite asset', 'spriteAsset', asset);
    checkRecord(ctx, 'spriteAsset', asset, path, subject);
    checkId(ctx, asset, path, subject, refs);
    if (typeof asset.id !== 'string') return;
    if (!refs.usedSprites.has(asset.id)) ctx.report('W_SPRITE_UNUSED', path, subject, 'sprite asset is not used');
    if (ctx.hasImage && !ctx.hasError(join(path, 'id')) && ctx.hasImage(asset.id) === false) {
      ctx.report('W_SPRITE_IMAGE_MISSING', join(path, 'src'), subject, 'image of the sprite asset is missing');
    }
  });
}

function checkSprite(ctx, sprite, path, subject, refs) {
  checkRecord(ctx, 'sprite', sprite, path, subject);
  const assetPath = join(path, 'asset');
  if (typeof sprite.asset === 'string' && !ctx.hasError(assetPath) && !refs.spriteIds.has(sprite.asset)) {
    ctx.report('E_SPRITE_ASSET_UNKNOWN', assetPath, subject, `sprite.asset "${sprite.asset}" is not a sprite asset id`);
  }
  const scalePath = join(path, 'scale');
  if (isVec2(sprite.scale) && !ctx.hasErrorUnder(scalePath) && sprite.scale.some((component) => component === 0)) {
    ctx.report('E_SPRITE_SCALE_ZERO', scalePath, subject, 'sprite.scale must not have a zero component');
  }
}

function checkShape(ctx, fixture, path, refs) {
  const subject = subjectOf('Shape', 'shape', fixture);
  const type = isObject(fixture.shape) && SHAPE_TYPES.includes(fixture.shape.type) ? fixture.shape.type : undefined;
  checkRecord(ctx, 'shape', fixture, path, subject, type);
  checkId(ctx, fixture, path, subject, refs);
  noteName(ctx, 'shape', fixture, path, subject, refs);
  const verticesPath = join(path, 'shape', 'vertices');
  if (type === 'polygon' && !ctx.hasErrorUnder(verticesPath)) {
    const problem = polygonProblems(fixture.shape.vertices);
    if (problem) ctx.report(POLYGON_CODES[problem], verticesPath, subject, `shape.vertices ${polygonText(problem)}`);
  }
  if (isObject(fixture.sprite)) checkSprite(ctx, fixture.sprite, join(path, 'sprite'), subject, refs);
}

function polygonText(problem) {
  switch (problem) {
    case 'count':
      return 'must have 3 to 8 vertices';
    case 'degenerate':
      return 'has coincident vertices or collinear edges';
    case 'notCcw':
      return 'must be counter-clockwise';
    default:
      return 'must form a convex polygon';
  }
}

function checkBody(ctx, body, path, refs) {
  const subject = subjectOf('Body', 'body', body);
  checkRecord(ctx, 'body', body, path, subject);
  checkId(ctx, body, path, subject, refs);
  noteName(ctx, 'body', body, path, subject, refs);
  if (typeof body.id === 'string' && !refs.bodyPaths.has(body.id)) refs.bodyPaths.set(body.id, path);
  const fixturesPath = join(path, 'fixtures');
  if (!Array.isArray(body.fixtures)) return;
  if (body.fixtures.length === 0) {
    if (!ctx.hasError(fixturesPath)) ctx.report('E_BODY_NO_FIXTURES', fixturesPath, subject, 'fixtures is empty');
    return;
  }
  eachItem(ctx, body.fixtures, fixturesPath, subject, (fixture, fixturePath) => checkShape(ctx, fixture, fixturePath, refs));
  if (!ctx.hasErrorUnder(fixturesPath) && bodyMass(body.fixtures).mass === 0) {
    ctx.report('W_BODY_ZERO_MASS', path, subject, 'total mass of the shapes is zero');
  }
}

function checkBodies(ctx, json, refs) {
  eachItem(ctx, json.bodies, '/bodies', DOCUMENT_SUBJECT, (body, path) => checkBody(ctx, body, path, refs));
}

function checkJointBody(ctx, joint, key, path, subject, refs) {
  const bodyPath = join(path, key);
  if (ctx.hasError(bodyPath)) return;
  const value = joint[key];
  if (value === null) ctx.report('E_JOINT_BODY_MISSING', bodyPath, subject, `${key} is not set`);
  else if (typeof value === 'string' && !refs.bodyIds.has(value)) {
    ctx.report('E_JOINT_BODY_UNKNOWN', bodyPath, subject, `${key} "${value}" is not a body id`);
  }
}

function anchorOutside(ctx, joint, refs) {
  const bodies = [joint.bodyA, joint.bodyB].map((id) => refs.bodyById.get(id));
  let measured = false;
  for (const body of new Set(bodies)) {
    const bodyPath = refs.bodyPaths.get(body.id);
    if (ctx.hasErrorUnder(join(bodyPath, 'position')) || ctx.hasErrorUnder(join(bodyPath, 'angle'))) continue;
    const frame = { x: body.position[0], y: body.position[1], angle: body.angle };
    const point = { x: joint.anchor[0], y: joint.anchor[1] };
    const fixtures = Array.isArray(body.fixtures) ? body.fixtures : [];
    for (let index = 0; index < fixtures.length; index++) {
      const shape = fixtures[index]?.shape;
      if (!isObject(fixtures[index]) || ctx.hasErrorUnder(join(bodyPath, 'fixtures', index, 'shape'))) continue;
      measured = true;
      if (pointInShape(shape, frame, point, ANCHOR_TOLERANCE)) return false;
    }
  }
  return measured;
}

function checkJoint(ctx, joint, path, refs) {
  const subject = subjectOf('Joint', 'joint', joint);
  checkRecord(ctx, 'joint', joint, path, subject);
  checkId(ctx, joint, path, subject, refs);
  noteName(ctx, 'joint', joint, path, subject, refs);
  checkJointBody(ctx, joint, 'bodyA', path, subject, refs);
  checkJointBody(ctx, joint, 'bodyB', path, subject, refs);
  const bodyBPath = join(path, 'bodyB');
  if (typeof joint.bodyA === 'string' && joint.bodyA === joint.bodyB && !ctx.hasError(bodyBPath)) {
    ctx.report('E_JOINT_SAME_BODY', bodyBPath, subject, 'bodyA and bodyB are the same body');
  }
  const anchorPath = join(path, 'anchor');
  const resolved = [joint.bodyA, joint.bodyB].every((id) => typeof id === 'string' && refs.bodyById.has(id));
  if (resolved && joint.bodyA !== joint.bodyB && isVec2(joint.anchor) && !ctx.hasErrorUnder(anchorPath) && !ctx.hasError(join(path, 'bodyA')) && !ctx.hasError(bodyBPath)) {
    const bodies = [joint.bodyA, joint.bodyB].map((id) => refs.bodyById.get(id));
    if (bodies.every((body) => isVec2(body.position) && isNumber(body.angle)) && anchorOutside(ctx, joint, refs)) {
      ctx.report('W_ANCHOR_OUTSIDE', anchorPath, subject, 'anchor is outside the shapes of both bodies');
    }
  }
}

function checkJoints(ctx, json, refs) {
  eachItem(ctx, json.joints, '/joints', DOCUMENT_SUBJECT, (joint, path) => checkJoint(ctx, joint, path, refs));
}

function checkMotorTorque(ctx, json) {
  if (!Array.isArray(json.joints) || ctx.hasErrorUnder('/bodies')) return;
  const suggestions = motorTorqueSuggestions(json);
  json.joints.forEach((joint, index) => {
    const path = join('/joints', index);
    if (!isObject(joint) || typeof joint.id !== 'string' || ctx.hasErrorUnder(path)) return;
    const suggestion = suggestions.get(joint.id);
    const torque = isObject(joint.motor) ? joint.motor.maxTorque : undefined;
    if (!isNumber(suggestion) || !isNumber(torque) || torque <= MOTOR_TORQUE.overpoweredFactor * suggestion) return;
    ctx.report(
      'W_MOTOR_OVERPOWERED',
      join(path, 'motor', 'maxTorque'),
      subjectOf('Joint', 'joint', joint),
      'motor maxTorque is far above what its bodies need, which can make them gain energy on contact; use Fit motor torque',
    );
  });
}

function checkJointGraph(ctx, json, refs) {
  const rootBody = isObject(json.ragdoll) ? json.ragdoll.rootBody : undefined;
  if (typeof rootBody !== 'string' || !refs.bodyIds.has(rootBody)) return;
  const edges = [];
  if (Array.isArray(json.joints)) {
    json.joints.forEach((joint, index) => {
      if (!isObject(joint)) return;
      const { bodyA, bodyB } = joint;
      if (refs.bodyIds.has(bodyA) && refs.bodyIds.has(bodyB) && bodyA !== bodyB) edges.push({ index, joint, a: bodyA, b: bodyB });
    });
  }
  const depth = new Map([[rootBody, 0]]);
  const treeEdges = new Set();
  const queue = [rootBody];
  for (let head = 0; head < queue.length; head++) {
    for (const edge of edges) {
      if (edge.a !== queue[head] && edge.b !== queue[head]) continue;
      const other = edge.a === queue[head] ? edge.b : edge.a;
      if (depth.has(other)) continue;
      depth.set(other, depth.get(queue[head]) + 1);
      treeEdges.add(edge);
      queue.push(other);
    }
  }
  for (const edge of edges) {
    if (!treeEdges.has(edge) && depth.has(edge.a) && depth.has(edge.b)) {
      ctx.report('W_JOINT_LOOP', join('/joints', edge.index), subjectOf('Joint', 'joint', edge.joint), 'joint closes a loop in the joint graph');
    }
  }
  json.bodies.forEach((body, index) => {
    if (!isObject(body) || typeof body.id !== 'string' || depth.has(body.id)) return;
    ctx.report('W_BODY_UNLINKED', join('/bodies', index), subjectOf('Body', 'body', body), 'body is not connected to rootBody through joints');
  });
}

function checkDuplicateNames(ctx, refs) {
  for (const kind of ['body', 'shape', 'joint']) {
    const groups = new Map();
    for (const entry of refs.names[kind]) {
      if (!groups.has(entry.name)) groups.set(entry.name, []);
      groups.get(entry.name).push(entry);
    }
    for (const [name, entries] of groups) {
      if (entries.length < 2) continue;
      const ids = entries.map((entry) => `"${entry.id}"`).join(', ');
      const later = entries[1];
      ctx.report('W_DUPLICATE_NAME', later.path, later.subject, `name "${name}" is shared by ${PLURALS[kind]} ${ids}`);
    }
  }
}

function targetKind(target, refs) {
  if (target === 'root') return 'root';
  if (refs.jointIds.has(target)) return 'joint';
  if (refs.shapeIds.has(target)) return 'shape';
  return null;
}

function keyValueFits(spec, value, refs) {
  if (spec.kind === 'multiplier') return isNumber(value) && value >= spec.min && value <= spec.max;
  if (spec.kind === 'angle') return isNumber(value);
  return value === null || (typeof value === 'string' && refs.spriteIds.has(value));
}

function checkKey(ctx, key, path, subject, track, clip, refs, state) {
  checkRecord(ctx, 'key', key, path, subject);
  const timePath = join(path, 't');
  if (isNumber(key.t) && !ctx.hasError(timePath)) {
    if (state.previous !== null && key.t < state.previous) ctx.report('E_KEYS_UNSORTED', timePath, subject, 'key time is before the previous key');
    else if (state.previous !== null && key.t === state.previous) {
      ctx.report('E_KEY_TIME_DUPLICATE', timePath, subject, 'key time equals the previous key');
    }
    state.previous = key.t;
    if (clip.length !== null && key.t > clip.length) ctx.report('E_KEY_TIME_RANGE', timePath, subject, 'key time is outside the clip length');
  }
  const valuePath = join(path, 'v');
  if (track.spec && key.v !== undefined && !keyValueFits(track.spec, key.v, refs)) {
    ctx.report('E_KEY_VALUE', valuePath, subject, `key value does not fit channel "${track.channel}"`);
  }
  const interpPath = join(path, 'interp');
  if (track.channel === 'sprite' && typeof key.interp === 'string' && !ctx.hasError(interpPath) && key.interp !== 'step') {
    ctx.report('E_KEY_INTERP_SPRITE', interpPath, subject, 'sprite keys must use step interpolation');
  }
}

function checkTrack(ctx, track, path, subject, clip, refs, seenTracks) {
  checkRecord(ctx, 'track', track, path, subject);
  const targetPath = join(path, 'target');
  const channelPath = join(path, 'channel');
  const target = typeof track.target === 'string' && !ctx.hasError(targetPath) ? track.target : null;
  const kind = target === null ? null : targetKind(target, refs);
  if (target !== null && kind === null) {
    ctx.report('E_TRACK_TARGET_UNKNOWN', targetPath, subject, `track target "${target}" is not root, a joint id or a shape id`);
  }
  const channel = typeof track.channel === 'string' && !ctx.hasError(channelPath) ? track.channel : null;
  const spec = kind !== null && channel !== null ? CHANNELS[kind][channel] : undefined;
  if (kind !== null && channel !== null && spec === undefined) {
    ctx.report('E_TRACK_CHANNEL', channelPath, subject, `channel "${channel}" is not valid for target "${target}"`);
  }
  if (target !== null && channel !== null && !ctx.hasError(targetPath) && !ctx.hasError(channelPath)) {
    const pair = `${target}\u0000${channel}`;
    if (seenTracks.has(pair)) ctx.report('E_TRACK_DUPLICATE', path, subject, `an earlier track already targets "${target}" channel "${channel}"`);
    seenTracks.add(pair);
  }
  const state = { previous: null };
  eachItem(ctx, track.keys, join(path, 'keys'), subject, (key, keyPath) =>
    checkKey(ctx, key, keyPath, subject, { spec, channel }, clip, refs, state),
  );
}

function checkEvent(ctx, event, path, subject, clip) {
  checkRecord(ctx, 'event', event, path, subject);
  const namePath = join(path, 'name');
  if (event.name === '' && !ctx.hasError(namePath)) ctx.report('E_EVENT_NAME_EMPTY', namePath, subject, 'event name is empty');
  const timePath = join(path, 't');
  if (!isNumber(event.t) || ctx.hasError(timePath) || clip.length === null || clip.loop === null) return;
  const outside = event.t < 0 || (clip.loop ? event.t >= clip.length : event.t > clip.length);
  if (outside) ctx.report('E_EVENT_TIME_RANGE', timePath, subject, 'event time is outside the clip length');
}

function checkClip(ctx, clip, path, refs, seenKeys) {
  const subject = subjectOf('Clip', 'clip', clip, 'key');
  checkRecord(ctx, 'clip', clip, path, subject);
  const keyPath = join(path, 'key');
  if (typeof clip.key === 'string' && !ctx.hasError(keyPath)) {
    if (!KEY_PATTERN.test(clip.key)) ctx.report('E_CLIP_KEY_INVALID', keyPath, subject, 'key must match [a-z0-9_]+');
    else if (seenKeys.has(clip.key)) ctx.report('E_CLIP_KEY_DUPLICATE', keyPath, subject, `key "${clip.key}" is already used`);
    else seenKeys.add(clip.key);
  }
  const timing = {
    length: isNumber(clip.length) && clip.length > 0 && !ctx.hasError(join(path, 'length')) ? clip.length : null,
    loop: typeof clip.loop === 'boolean' ? clip.loop : null,
  };
  const seenTracks = new Set();
  eachItem(ctx, clip.tracks, join(path, 'tracks'), subject, (track, trackPath) =>
    checkTrack(ctx, track, trackPath, subject, timing, refs, seenTracks),
  );
  eachItem(ctx, clip.events, join(path, 'events'), subject, (event, eventPath) => checkEvent(ctx, event, eventPath, subject, timing));
  if (Array.isArray(clip.tracks) && clip.tracks.length === 0 && Array.isArray(clip.events) && clip.events.length === 0) {
    ctx.report('W_CLIP_EMPTY', path, subject, 'clip has no tracks and no events');
  }
}

function checkClips(ctx, json, refs) {
  const seenKeys = new Set();
  eachItem(ctx, json.clips, '/clips', DOCUMENT_SUBJECT, (clip, path) => checkClip(ctx, clip, path, refs, seenKeys));
}

function gate(ctx, json) {
  if (!isObject(json)) {
    ctx.report('E_FORMAT', '', DOCUMENT_SUBJECT, 'input is not an object');
    return false;
  }
  if (json.format !== FORMAT) ctx.report('E_FORMAT', '/format', DOCUMENT_SUBJECT, `format must be "${FORMAT}"`);
  if (!SUPPORTED_VERSIONS.includes(json.version)) {
    ctx.report('E_VERSION_UNSUPPORTED', '/version', DOCUMENT_SUBJECT, 'version is missing or not supported');
  }
  return ctx.errors.length === 0;
}

/**
 * Checks a parsed `.rag.json` document against the format contract. Pure: needs neither liquidfun.js nor
 * PIXI.js, and never throws for any input value.
 * @param {*} json Any value, normally the result of `JSON.parse`.
 * @param {ValidateOptions} [options] Editor-only extras.
 * @returns {ValidationResult} Errors and warnings in a deterministic order; only the gate errors when the
 *   input is not an object, `format` is wrong or `version` is unsupported.
 */
export function validate(json, options) {
  const ctx = createContext(options);
  if (gate(ctx, json)) {
    const refs = collectRefs(json);
    checkRecord(ctx, 'document', json, '', DOCUMENT_SUBJECT);
    if (isObject(json.ragdoll)) checkRoot(ctx, json.ragdoll, refs);
    checkSprites(ctx, json, refs);
    checkBodies(ctx, json, refs);
    checkJoints(ctx, json, refs);
    checkMotorTorque(ctx, json);
    checkJointGraph(ctx, json, refs);
    checkClips(ctx, json, refs);
    checkDuplicateNames(ctx, refs);
  }
  return { errors: ctx.errors, warnings: ctx.warnings };
}
