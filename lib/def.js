import { composeTransforms, transformPoint } from './geometry.js';
import { RagInstance, destroyNatives } from './instance.js';

/**
 * @typedef {object} Libraries
 * @property {*} Box2D The liquidfun.js namespace.
 * @property {*} PIXI The PIXI.js module.
 */

/**
 * @typedef {object} SpawnOptions
 * @property {*} [parent] PIXI container the view is added to.
 * @property {number} [x] Spawn x, meters, default 0.
 * @property {number} [y] Spawn y, meters, Y up, default 0.
 * @property {number} [angle] Spawn angle, radians, default 0.
 * @property {boolean} [flipX] Mirror horizontally, default false.
 * @property {string} [baseUrl] Prefix of sprite `src` for the default texture resolver, default `''`.
 * @property {(src: string, asset: object) => *} [textures] Texture resolver.
 * @property {boolean} [debug] Draw shapes and joint gizmos.
 */

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function copyJson(value) {
  if (Array.isArray(value)) return value.map(copyJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyJson(child)]));
  }
  return value;
}

function vec([x, y]) {
  return [x, y];
}

function copyGeometry(shape) {
  switch (shape.type) {
    case 'circle':
      return { type: 'circle', center: vec(shape.center), radius: shape.radius };
    case 'box':
      return { type: 'box', center: vec(shape.center), width: shape.width, height: shape.height, angle: shape.angle };
    default:
      return { type: 'polygon', vertices: shape.vertices.map(vec) };
  }
}

function copySprite(sprite) {
  if (sprite === undefined || sprite === null) return null;
  return {
    asset: sprite.asset,
    offset: vec(sprite.offset),
    angle: sprite.angle,
    scale: vec(sprite.scale),
    z: sprite.z,
    visible: sprite.visible,
  };
}

function copyFixture(fixture) {
  return {
    id: fixture.id,
    name: fixture.name,
    shape: copyGeometry(fixture.shape),
    density: fixture.density,
    friction: fixture.friction,
    restitution: fixture.restitution,
    isSensor: fixture.isSensor,
    selfCollide: fixture.selfCollide,
    filter: { categoryBits: fixture.filter.categoryBits, maskBits: fixture.filter.maskBits },
    sprite: copySprite(fixture.sprite),
    color: fixture.editor?.color ?? null,
  };
}

function copyBody(body) {
  return {
    id: body.id,
    name: body.name,
    position: vec(body.position),
    angle: body.angle,
    linearDamping: body.linearDamping,
    angularDamping: body.angularDamping,
    fixedRotation: body.fixedRotation,
    bullet: body.bullet,
    fixtures: body.fixtures.map(copyFixture),
  };
}

function copyJoint(joint) {
  return {
    id: joint.id,
    name: joint.name,
    bodyA: joint.bodyA,
    bodyB: joint.bodyB,
    anchor: vec(joint.anchor),
    collideConnected: joint.collideConnected,
    limits: { enabled: joint.limits.enabled, lower: joint.limits.lower, upper: joint.limits.upper },
    motor: {
      maxTorque: joint.motor.maxTorque,
      gain: joint.motor.gain,
      damping: joint.motor.damping,
      maxSpeed: joint.motor.maxSpeed,
    },
    aimAxis: joint.aimAxis,
  };
}

function copyClip(clip) {
  return {
    key: clip.key,
    name: clip.name,
    loop: clip.loop,
    hold: clip.hold,
    layer: clip.layer,
    blend: clip.blend,
    length: clip.length,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    speed: clip.speed,
    tracks: clip.tracks.map((track) => ({
      target: track.target,
      channel: track.channel,
      keys: track.keys.map((key) => ({ t: key.t, v: key.v, interp: key.interp })),
    })),
    events: clip.events.map((event) => ({ t: event.t, name: event.name, data: copyJson(event.data) })),
  };
}

function copyDocument(json) {
  const { ragdoll } = json;
  return deepFreeze({
    name: ragdoll.name,
    pixelsPerMeter: json.units.pixelsPerMeter,
    rootBody: ragdoll.rootBody,
    channels: { strength: ragdoll.channels.strength, gain: ragdoll.channels.gain, damping: ragdoll.channels.damping },
    sprites: json.sprites.map((asset) => ({ id: asset.id, name: asset.name, src: asset.src })),
    bodies: json.bodies.map(copyBody),
    joints: json.joints.map(copyJoint),
    clips: json.clips.map(copyClip),
  });
}

function finiteOption(opts, key) {
  const value = opts[key];
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`spawn: option ${key} must be a finite number`);
  return value;
}

function typedOption(opts, key, type, fallback) {
  const value = opts[key];
  if (value === undefined) return fallback;
  if (typeof value !== type) throw new TypeError(`spawn: option ${key} must be a ${type}`);
  return value;
}

function readOptions(opts) {
  if (opts === undefined) opts = {};
  if (opts === null || typeof opts !== 'object') throw new TypeError('spawn: options must be an object');
  const parent = opts.parent ?? null;
  if (parent !== null && (typeof parent !== 'object' || typeof parent.addChild !== 'function')) {
    throw new TypeError('spawn: option parent must be a PIXI container');
  }
  return {
    parent,
    x: finiteOption(opts, 'x'),
    y: finiteOption(opts, 'y'),
    angle: finiteOption(opts, 'angle'),
    flipX: typedOption(opts, 'flipX', 'boolean', false),
    baseUrl: typedOption(opts, 'baseUrl', 'string', ''),
    textures: typedOption(opts, 'textures', 'function', null),
    debug: typedOption(opts, 'debug', 'boolean', false),
  };
}

function rememberName(map, name, value) {
  if (!map.has(name)) map.set(name, value);
}

function buildShape(Box2D, scratch, shape, flipX) {
  const sign = flipX ? -1 : 1;
  if (shape.type === 'circle') {
    const circle = new Box2D.b2CircleShape();
    circle.set_m_radius(shape.radius);
    scratch.set_x(sign * shape.center[0]);
    scratch.set_y(shape.center[1]);
    circle.set_m_p(scratch);
    return circle;
  }
  const polygon = new Box2D.b2PolygonShape();
  if (shape.type === 'box') {
    scratch.set_x(sign * shape.center[0]);
    scratch.set_y(shape.center[1]);
    polygon.SetAsBox(shape.width / 2, shape.height / 2, scratch, sign * shape.angle);
    return polygon;
  }
  const vertices = flipX ? shape.vertices.map(([x, y]) => [-x, y]).reverse() : shape.vertices;
  const pointer = Box2D._malloc(8 * vertices.length);
  try {
    const base = pointer >> 2;
    vertices.forEach(([x, y], i) => {
      Box2D.HEAPF32[base + 2 * i] = x;
      Box2D.HEAPF32[base + 2 * i + 1] = y;
    });
    polygon.Set(Box2D.wrapPointer(pointer, Box2D.b2Vec2), vertices.length);
  } finally {
    Box2D._free(pointer);
  }
  return polygon;
}

function createFixture(Box2D, scratch, body, fixture, flipX) {
  const shape = buildShape(Box2D, scratch, fixture.shape, flipX);
  const fixtureDef = new Box2D.b2FixtureDef();
  let created;
  try {
    fixtureDef.set_shape(shape);
    fixtureDef.set_density(fixture.density);
    fixtureDef.set_friction(fixture.friction);
    fixtureDef.set_restitution(fixture.restitution);
    fixtureDef.set_isSensor(fixture.isSensor);
    created = body.CreateFixture(fixtureDef);
  } finally {
    Box2D.destroy(fixtureDef);
    Box2D.destroy(shape);
  }
  const filter = created.GetFilterData();
  filter.set_categoryBits(fixture.filter.categoryBits);
  filter.set_maskBits(fixture.filter.maskBits);
  filter.set_groupIndex(0);
  created.SetFilterData(filter);
  return created;
}

function createBody(Box2D, world, scratch, spawn, body, flipX) {
  const local = flipX
    ? { x: -body.position[0], y: body.position[1], angle: -body.angle }
    : { x: body.position[0], y: body.position[1], angle: body.angle };
  const transform = composeTransforms(spawn, local);
  const bodyDef = new Box2D.b2BodyDef();
  try {
    bodyDef.set_type(Box2D.b2_dynamicBody);
    scratch.set_x(transform.x);
    scratch.set_y(transform.y);
    bodyDef.set_position(scratch);
    bodyDef.set_angle(transform.angle);
    bodyDef.set_linearDamping(body.linearDamping);
    bodyDef.set_angularDamping(body.angularDamping);
    bodyDef.set_fixedRotation(body.fixedRotation);
    bodyDef.set_bullet(body.bullet);
    return world.CreateBody(bodyDef);
  } finally {
    Box2D.destroy(bodyDef);
  }
}

function createJoint(Box2D, world, scratch, spawn, joint, bodies, flipX) {
  const anchor = transformPoint(spawn, { x: flipX ? -joint.anchor[0] : joint.anchor[0], y: joint.anchor[1] });
  const jointDef = new Box2D.b2RevoluteJointDef();
  try {
    scratch.set_x(anchor.x);
    scratch.set_y(anchor.y);
    jointDef.Initialize(bodies.get(joint.bodyA), bodies.get(joint.bodyB), scratch);
    jointDef.set_collideConnected(joint.collideConnected);
    jointDef.set_enableLimit(joint.limits.enabled);
    jointDef.set_lowerAngle(flipX ? -joint.limits.upper : joint.limits.lower);
    jointDef.set_upperAngle(flipX ? -joint.limits.lower : joint.limits.upper);
    jointDef.set_enableMotor(false);
    return world.CreateJoint(jointDef);
  } finally {
    Box2D.destroy(jointDef);
  }
}

/**
 * Immutable ragdoll definition built by `RagImporter.parse`; spawns any number of instances.
 */
export class RagDef {
  #data;
  #resolveLibraries;

  /**
   * Internal: hosts get a `RagDef` from `RagImporter.parse` only.
   * @param {object} json A `.rag.json` document that passed validation; copied, never retained.
   * @param {() => Libraries} resolveLibraries Returns the libraries to use; throws when one is missing.
   */
  constructor(json, resolveLibraries) {
    this.#data = copyDocument(json);
    this.#resolveLibraries = resolveLibraries;
    /** @type {string} */
    this.name = this.#data.name;
    /** @type {number} */
    this.pixelsPerMeter = this.#data.pixelsPerMeter;
    /** @type {ReadonlyArray<Readonly<{ key: string, name: string, loop: boolean, layer: number, length: number }>>} */
    this.clips = Object.freeze(
      this.#data.clips.map(({ key, name, loop, layer, length }) => Object.freeze({ key, name, loop, layer, length })),
    );
    Object.freeze(this);
  }

  /**
   * Image URLs to preload: `baseUrl + src` per sprite asset, file order, duplicates removed.
   * @param {string} [baseUrl] Prefix, ending with `/` for a folder.
   * @returns {string[]} A new array.
   */
  spriteUrls(baseUrl = '') {
    return [...new Set(this.#data.sprites.map((asset) => baseUrl + asset.src))];
  }

  /**
   * Creates bodies, fixtures and joints at the spawn transform in rest pose, motors off, plus the view container.
   * @param {*} world `Box2D.b2World`.
   * @param {SpawnOptions} [opts] Spawn options.
   * @returns {RagInstance} The new instance.
   * @throws {Error} When liquidfun.js or PIXI.js is missing, or the world is locked.
   * @throws {TypeError} When `world` has no `CreateBody` function or an option has the wrong type.
   */
  spawn(world, opts) {
    const { Box2D, PIXI } = this.#resolveLibraries();
    if (world === null || typeof world !== 'object' || typeof world.CreateBody !== 'function') {
      throw new TypeError('spawn: world must be a Box2D.b2World');
    }
    const options = readOptions(opts);
    if (world.IsLocked()) throw new Error('spawn: the world is locked (called during world.Step)');

    const data = this.#data;
    const spawn = { x: options.x, y: options.y, angle: options.angle };
    const flipX = options.flipX;
    const bodies = new Map();
    const joints = new Map();
    const byName = { body: new Map(), joint: new Map(), shape: new Map() };
    const aimAxes = new Map();
    const scratch = new Box2D.b2Vec2(0, 0);
    let view = null;
    try {
      for (const body of data.bodies) {
        const created = createBody(Box2D, world, scratch, spawn, body, flipX);
        bodies.set(body.id, created);
        rememberName(byName.body, body.name, created);
        for (const fixture of body.fixtures) {
          rememberName(byName.shape, fixture.name, createFixture(Box2D, scratch, created, fixture, flipX));
        }
      }
      for (const joint of data.joints) {
        const base = createJoint(Box2D, world, scratch, spawn, joint, bodies, flipX);
        joints.set(joint.id, base);
        const revolute = Box2D.castObject(base, Box2D.b2RevoluteJoint);
        joints.set(joint.id, revolute);
        rememberName(byName.joint, joint.name, revolute);
        aimAxes.set(joint.id, flipX ? Math.PI - joint.aimAxis : joint.aimAxis);
      }
      view = new PIXI.Container();
      view.sortableChildren = true;
      if (options.parent) options.parent.addChild(view);
    } catch (error) {
      destroyNatives(world, joints, bodies);
      if (view) {
        view.parent?.removeChild(view);
        view.destroy({ children: true });
      }
      throw error;
    } finally {
      Box2D.destroy(scratch);
    }
    return new RagInstance({ world, bodies, joints, byName, root: bodies.get(data.rootBody), view, flipX, aimAxes });
  }
}
