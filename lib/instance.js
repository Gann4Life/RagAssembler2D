import { Emitter } from './emitter.js';
import { aimAngle, clampToLimits, resolveChannels, wrapToPi } from './evaluate.js';

/**
 * @typedef {object} MotorBase
 * @property {number} maxTorque Base torque, N·m.
 * @property {number} gain Base gain, 1/s.
 * @property {number} damping Base damping, unitless.
 * @property {number} maxSpeed Speed limit, rad/s.
 * @property {number} load Gravity load of the joint, N·m (`DESIGN.md` §3.4).
 */

const clampAbs = (value, limit) => Math.min(Math.max(value, -limit), limit);

const STRENGTH_STIFFNESS = 3.5;

function torqueLimit(S, maxTorque, G, slip, load) {
  const limit = S * maxTorque;
  if (!(S < 1) || !(G > 0)) return limit;
  const ratio = S / (1 - S);
  return Math.min(limit, (STRENGTH_STIFFNESS * ratio * ratio * load * slip) / G);
}

/**
 * Writes one joint motor from a resolved pose with the velocity feed-forward model of DESIGN.md §3:
 * `motorSpeed = rate + clamp(G · error − D · (jointSpeed − rate), ±maxSpeed)`, torque limit `S · maxTorque`, and below
 * `S = 1` at most `k_S / G · |motorSpeed − jointSpeed|` with `k_S = 3.5 · (S / (1 − S))² · load` (§3.4). Internal: used
 * by `RagInstance.update` and tests.
 * @param {*} joint `b2RevoluteJoint`, or any object with its angle, speed and motor methods.
 * @param {import('./evaluate.js').JointPose} pose Resolved pose in the joint's frame: `angle` in radians and
 *   `angleRate` in rad/s (absent counts as 0).
 * @param {MotorBase} motor Base motor values of the joint; `maxSpeed` limits the correction only.
 * @returns {void}
 */
export function driveMotor(joint, pose, motor) {
  const rate = pose.angleRate ?? 0;
  const error = pose.angle - joint.GetJointAngle();
  const jointSpeed = joint.GetJointSpeed();
  const speed = rate + clampAbs(pose.G * error - pose.D * (jointSpeed - rate), motor.maxSpeed);
  joint.SetMotorSpeed(speed);
  joint.SetMaxMotorTorque(torqueLimit(pose.S, motor.maxTorque, pose.G, Math.abs(speed - jointSpeed), motor.load));
  joint.EnableMotor(pose.S > 0);
}

/**
 * @typedef {object} BalanceBase
 * @property {number} maxTorque Base torque, N·m.
 * @property {number} gain Base gain, 1/s.
 * @property {number} damping Base damping, unitless.
 * @property {number} maxSpeed Speed limit, rad/s.
 * @property {number} load Gravity load of the balance, N·m (`DESIGN.md` §3.4).
 */

/**
 * @typedef {object} BalanceLink
 * @property {*} body `b2Body`, or any object with `GetWorldCenter`, `GetLinearVelocity`, `GetAngularVelocity`,
 *   `ApplyTorque` and `ApplyForce`.
 * @property {number} mass Body mass, kg.
 * @property {number} inertia Rotational inertia about the body's own center of mass, kg·m².
 */

/**
 * Applies the balance wrench of DESIGN.md §3.2, when `S > 0` and `dt > 0`: the torque that turns the bodies connected
 * to `rootBody` as one rigid piece about their common center of mass, spread over them as a torque and a force per
 * body (no net force), with the torque limit of `driveMotor` over the balance `load` (§3.4). Internal: used by
 * `RagInstance.update` and tests.
 * @param {*} root `rootBody`: any object with `GetAngle`.
 * @param {ReadonlyArray<BalanceLink>} links The bodies connected to `rootBody` with mass, `rootBody` included.
 * @param {number} target World angle of `rootBody` to track, radians (`θ₀ + bodyAngle`).
 * @param {{ S: number, G: number, D: number, rate?: number }} drive `S` (0-1), `G` (1/s) and `D` with the balance base
 *   values applied, and `rate`, the target's rate in rad/s (absent counts as 0).
 * @param {BalanceBase} balance Base balance values; `maxSpeed` limits the correction only.
 * @param {number} dt Step duration, seconds.
 * @param {*} force Scratch `b2Vec2` (any object with `set_x` and `set_y`), overwritten.
 * @returns {number} The applied total torque, N·m; 0 when nothing is applied.
 */
export function driveBalance(root, links, target, drive, balance, dt, force) {
  if (!(drive.S > 0) || !(dt > 0)) return 0;
  let mass = 0;
  let cx = 0;
  let cy = 0;
  let vx = 0;
  let vy = 0;
  for (const link of links) {
    const center = link.body.GetWorldCenter();
    const velocity = link.body.GetLinearVelocity();
    mass += link.mass;
    cx += link.mass * center.get_x();
    cy += link.mass * center.get_y();
    vx += link.mass * velocity.get_x();
    vy += link.mass * velocity.get_y();
  }
  if (!(mass > 0)) return 0;
  cx /= mass;
  cy /= mass;
  vx /= mass;
  vy /= mass;
  let inertia = 0;
  let momentum = 0;
  for (const link of links) {
    const center = link.body.GetWorldCenter();
    const velocity = link.body.GetLinearVelocity();
    const rx = center.get_x() - cx;
    const ry = center.get_y() - cy;
    inertia += link.inertia + link.mass * (rx * rx + ry * ry);
    momentum += link.inertia * link.body.GetAngularVelocity() + link.mass * (rx * (velocity.get_y() - vy) - ry * (velocity.get_x() - vx));
  }
  if (!(inertia > 0)) return 0;
  const omega = momentum / inertia;
  const error = wrapToPi(target - root.GetAngle());
  const rate = drive.rate ?? 0;
  const wanted = rate + clampAbs(drive.G * error - drive.D * (omega - rate), balance.maxSpeed);
  const limit = torqueLimit(drive.S, balance.maxTorque, drive.G, Math.abs(wanted - omega), balance.load);
  const torque = Math.min(Math.max((inertia * (wanted - omega)) / dt, -limit), limit);
  const alpha = torque / inertia;
  for (const link of links) {
    const center = link.body.GetWorldCenter();
    force.set_x(-link.mass * alpha * (center.get_y() - cy));
    force.set_y(link.mass * alpha * (center.get_x() - cx));
    link.body.ApplyTorque(link.inertia * alpha, true);
    link.body.ApplyForce(force, center, true);
  }
  return torque;
}

function multiplier(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`RagInstance.${name}: value must be a finite number`);
  }
  return Math.min(Math.max(value, 0), 1);
}

const clamp01 = (value) => Math.min(Math.max(value, 0), 1);

function optionsObject(method, opts) {
  if (opts === undefined) return {};
  if (opts === null || typeof opts !== 'object') throw new TypeError(`RagInstance.${method}: options must be an object`);
  return opts;
}

function finiteOption(method, opts, key, fallback) {
  const value = opts[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`RagInstance.${method}: ${key} must be a finite number`);
  }
  return value;
}

function durationOption(method, opts, key) {
  const value = finiteOption(method, opts, key, 0);
  if (value < 0) throw new TypeError(`RagInstance.${method}: ${key} must be >= 0`);
  return value;
}

function overrideOptions(method, opts) {
  const options = optionsObject(method, opts);
  const strength = options.strength ?? null;
  return {
    weight: clamp01(finiteOption(method, options, 'weight', 1)),
    strength: strength === null ? null : clamp01(finiteOption(method, options, 'strength', 0)),
    fadeIn: durationOption(method, options, 'fadeIn'),
  };
}

function pointArgument(method, name, point) {
  if (point === null || typeof point !== 'object' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`RagInstance.${method}: ${name} must be an object with finite x and y`);
  }
  return point;
}

/**
 * @typedef {object} OverrideOptions
 * @property {number} [weight] Share of the override against the clips, 0-1, default 1 (clamped).
 * @property {(number|null)} [strength] Motor strength while overriding, 0-1, default `null` (the clip strength); still
 *   scaled by root and runtime strength.
 * @property {number} [fadeIn] Seconds to ramp the weight in, ≥ 0, default 0.
 */

/**
 * @typedef {object} ClearOverrideOptions
 * @property {number} [fadeOut] Seconds to fade the weight out, ≥ 0, default 0 (at once).
 */

/**
 * @typedef {object} JointControl
 * @property {string} name The joint's name. Read-only: the handle is frozen.
 * @property {(angle: number, opts?: OverrideOptions) => void} setAngle Same as `RagInstance.setJointAngle` for this
 *   joint: a direct angle, radians relative to rest. Throws a `TypeError` for a non-finite angle or a bad option.
 * @property {(worldPoint: { x: number, y: number }, opts?: OverrideOptions) => void} lookAt Same as
 *   `RagInstance.lookAt` for this joint: aims its `aimAxis` at a world point, meters. Throws a `TypeError` for a bad
 *   point or option.
 * @property {(opts?: ClearOverrideOptions) => void} clearOverride Same as `RagInstance.clearJointOverride` for this
 *   joint. Throws a `TypeError` for a bad `fadeOut`.
 */

/**
 * Destroys native joints, then bodies, then clears both maps. Internal: used by `RagInstance.destroy` and spawn rollback.
 * @param {*} world `Box2D.b2World` that owns the objects.
 * @param {Map<string, *>} joints Id → joint; emptied.
 * @param {Map<string, *>} bodies Id → body; emptied.
 * @returns {void}
 */
export function destroyNatives(world, joints, bodies) {
  for (const joint of joints.values()) world.DestroyJoint(joint);
  joints.clear();
  for (const body of bodies.values()) world.DestroyBody(body);
  bodies.clear();
}

/**
 * One spawned ragdoll. Constructed by `RagDef.spawn` only.
 */
export class RagInstance {
  #world;
  #bodies;
  #joints;
  #byName;
  #root;
  #view;
  #flipX;
  #aimAxes;
  #emitter = new Emitter();
  #destroyed = false;
  #poseSource;
  #runtime = { strength: 1, gain: 1, damping: 1 };
  #clips;
  #layers = new Map();
  #release;
  #balance;
  #balanceOn = true;
  #balanceLinks;
  #force;
  #restAngle;
  #jointsByName = new Map();
  #overrides = new Map();
  #controls = new Map();
  #pixelsPerMeter;

  /**
   * @param {object} parts Spawn results.
   * @param {*} parts.world `Box2D.b2World` the instance lives in.
   * @param {Map<string, *>} parts.bodies Id → `b2Body`, file order.
   * @param {Map<string, *>} parts.joints Id → `b2RevoluteJoint`, file order.
   * @param {{ body: Map<string, *>, joint: Map<string, *>, shape: Map<string, *> }} parts.byName Name → native object, first in file order.
   * @param {*} parts.root The `rootBody` body.
   * @param {*} parts.view The instance's `PIXI.Container`.
   * @param {boolean} parts.flipX Whether the instance is mirrored.
   * @param {Map<string, number>} parts.aimAxes Joint id → aim axis, radians, mirrored with `flipX`.
   * @param {{ channels: object, balance: object, bodies: ReadonlyArray<object>, joints: ReadonlyArray<object>,
   *   clips: ReadonlyArray<object>, pixelsPerMeter?: number }} parts.data Frozen definition data: root channels,
   *   balance with `parts` (the bodies connected to `rootBody` with mass: `{ id, mass, inertia }`), bodies, joints with
   *   `name`, `bodyA`, `limits` and `motor`, clips, and `pixelsPerMeter` (default 1).
   * @param {*} parts.force Scratch `b2Vec2` of the balance controller, owned by the instance and freed by `release`.
   * @param {number} [parts.restAngle] World angle of `rootBody` as spawned, radians: the balance reference `θ₀`; default 0.
   * @param {() => void} [parts.release] Frees the instance's collision group id and `force`; called once by destroy.
   */
  constructor({ world, bodies, joints, byName, root, view, flipX, aimAxes, data, restAngle, force, release }) {
    this.#release = release;
    this.#poseSource = { ragdoll: { channels: data.channels }, bodies: data.bodies, joints: data.joints };
    this.#clips = new Map(data.clips.map((clip) => [clip.key, clip]));
    this.#world = world;
    this.#bodies = bodies;
    this.#joints = joints;
    this.#byName = byName;
    this.#root = root;
    this.#view = view;
    this.#flipX = flipX;
    this.#aimAxes = aimAxes;
    this.#balance = data.balance;
    this.#balanceLinks = data.balance.parts
      .filter((part) => bodies.has(part.id))
      .map((part) => ({ body: bodies.get(part.id), mass: part.mass, inertia: part.inertia }));
    this.#force = force;
    this.#restAngle = restAngle ?? 0;
    this.#pixelsPerMeter = data.pixelsPerMeter ?? 1;
    for (const joint of data.joints) {
      if (!this.#jointsByName.has(joint.name)) this.#jointsByName.set(joint.name, joint);
    }
  }

  /**
   * Id → `b2Body`, in file order. Read-only by contract; empty after `destroy`.
   * @returns {Map<string, *>}
   */
  get bodies() {
    return this.#bodies;
  }

  /**
   * Id → `b2RevoluteJoint`, in file order. Read-only by contract; empty after `destroy`.
   * @returns {Map<string, *>}
   */
  get joints() {
    return this.#joints;
  }

  /**
   * The instance's `PIXI.Container`; `null` after `destroy`.
   * @returns {*}
   */
  get view() {
    return this.#view;
  }

  /**
   * Whether `destroy` was called.
   * @returns {boolean}
   */
  get destroyed() {
    return this.#destroyed;
  }

  /**
   * Origin of `rootBody` in the world frame, meters, as a new object; `null` after `destroy`.
   * @returns {{ x: number, y: number } | null}
   */
  get position() {
    if (this.#destroyed) return null;
    const position = this.#root.GetPosition();
    return { x: position.get_x(), y: position.get_y() };
  }

  /**
   * Angle of `rootBody`, radians; `null` after `destroy`.
   * @returns {number | null}
   */
  get angle() {
    return this.#destroyed ? null : this.#root.GetAngle();
  }

  /**
   * Looks up a body by name, first in file order.
   * @param {string} name Body name.
   * @returns {*} `b2Body`, or `undefined`.
   */
  body(name) {
    return this.#byName.body.get(name);
  }

  /**
   * Looks up a joint by name, first in file order.
   * @param {string} name Joint name.
   * @returns {*} `b2RevoluteJoint`, or `undefined`.
   */
  joint(name) {
    return this.#byName.joint.get(name);
  }

  /**
   * Looks up a shape by name, first in file order.
   * @param {string} name Shape name.
   * @returns {*} `b2Fixture`, or `undefined`.
   */
  shape(name) {
    return this.#byName.shape.get(name);
  }

  /**
   * Sets the runtime strength multiplier, clamped to 0-1 (default 1). Scales every joint's and the balance's strength `S` (`DESIGN.md` §3.4).
   * @param {number} value Multiplier.
   * @returns {void}
   * @throws {TypeError} When `value` is not a finite number.
   */
  setStrength(value) {
    this.#runtime.strength = multiplier('setStrength', value);
  }

  /**
   * Sets the runtime gain multiplier, clamped to 0-1 (default 1).
   * @param {number} value Multiplier.
   * @returns {void}
   * @throws {TypeError} When `value` is not a finite number.
   */
  setGain(value) {
    this.#runtime.gain = multiplier('setGain', value);
  }

  /**
   * Sets the runtime damping multiplier, clamped to 0-1 (default 1).
   * @param {number} value Multiplier.
   * @returns {void}
   * @throws {TypeError} When `value` is not a finite number.
   */
  setDamping(value) {
    this.#runtime.damping = multiplier('setDamping', value);
  }

  /**
   * Turns this instance's balance controller on or off (default on). It runs only while this switch and the file's
   * `balance.enabled` are both on (DESIGN.md §3.2).
   * @param {boolean} enabled Switch value.
   * @returns {void}
   * @throws {TypeError} When `enabled` is not a boolean.
   */
  setBalance(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('RagInstance.setBalance: enabled must be a boolean');
    this.#balanceOn = enabled;
  }

  /**
   * Advances clips and override fades, resolves the pose with the procedural overrides on top (DESIGN.md §4.4, §4.8),
   * writes every joint motor (DESIGN.md §3) and applies the balance torque to `rootBody` (DESIGN.md §3.2). Call once
   * per physics step, before `world.Step`, with that step's `dt`. Does nothing after `destroy`.
   * @param {number} dt Step duration, seconds, finite and ≥ 0.
   * @returns {void}
   * @throws {TypeError} When `dt` is not a finite number ≥ 0.
   */
  update(dt) {
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) {
      throw new TypeError('RagInstance.update: dt must be a finite number >= 0');
    }
    if (this.#destroyed) return;
    this.#advanceClips(dt);
    this.#advanceOverrides(dt);
    const resolved = resolveChannels(this.#poseSource, this.#topLayer(), this.#runtime, this.#overrideTargets());
    this.#driveMotors(resolved);
    this.#driveBalance(resolved.root, dt);
  }

  /**
   * Starts a clip on its layer, replacing the layer's active clip at once. Playing the active key is a
   * no-op unless `restart`, but still updates `speed`. Limitation: `fadeIn` and `weight` are not
   * supported yet (clips enter at full weight), and only the highest active layer drives the pose.
   * @param {string} key Clip key.
   * @param {{ speed?: number, restart?: boolean }} [opts] `speed` (> 0, default 1) multiplies the clip
   *   speed; `restart` (default false) restarts the active key from time 0.
   * @returns {void}
   * @throws {Error} When no clip has this key.
   * @throws {TypeError} When `speed` is not a finite number > 0.
   */
  play(key, opts = {}) {
    const clip = this.#clipOf('play', key);
    const speed = opts.speed ?? 1;
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) {
      throw new TypeError('RagInstance.play: speed must be a finite number > 0');
    }
    const active = this.#layers.get(clip.layer);
    if (active?.clip === clip && opts.restart !== true) {
      active.speed = speed;
      return;
    }
    this.#layers.set(clip.layer, { clip, time: 0, speed });
  }

  /**
   * Stops a clip when it is active on its layer; otherwise does nothing. Limitation: the stop is
   * immediate, `fadeOut` is not supported yet.
   * @param {string} key Clip key.
   * @returns {void}
   * @throws {Error} When no clip has this key.
   */
  stop(key) {
    const clip = this.#clipOf('stop', key);
    if (this.#layers.get(clip.layer)?.clip === clip) this.#layers.delete(clip.layer);
  }

  /**
   * Whether the clip is active on its layer; `false` for an unknown key.
   * @param {string} key Clip key.
   * @returns {boolean}
   */
  isPlaying(key) {
    const clip = this.#clips.get(key);
    return clip !== undefined && this.#layers.get(clip.layer)?.clip === clip;
  }

  /**
   * Key of the clip active on a layer.
   * @param {number} layer Layer index.
   * @returns {string | null} The key, or `null` when the layer is empty.
   */
  activeClip(layer) {
    return this.#layers.get(layer)?.clip.key ?? null;
  }

  /**
   * Aims a joint's `aimAxis` (bodyB-local) at a world point (DESIGN.md §4.8). The angle is recomputed from the current
   * physics state on every `update`, clamped to the joint's limits when enabled, and reached through the motor. Calling
   * it again for the same joint replaces the target, mode and options; a fade in progress continues and an override
   * fading out fades back in.
   * @param {string} jointName Joint name, first in file order.
   * @param {{ x: number, y: number }} worldPoint Point to aim at, world meters.
   * @param {OverrideOptions} [opts] Weight, strength and fade-in.
   * @returns {void}
   * @throws {Error} When no joint has this name.
   * @throws {TypeError} When `worldPoint` has no finite `x` and `y`, or an option has the wrong type or range.
   */
  lookAt(jointName, worldPoint, opts) {
    this.#overrideAim('lookAt', this.#jointOf('lookAt', jointName), worldPoint, opts);
  }

  /**
   * Overrides a joint's target with a direct angle relative to rest (DESIGN.md §4.8), in the file's frame: negated
   * with `flipX`, so the same value works for both facings. Not clamped to the limits. Calling it again replaces the
   * target, mode and options as in `lookAt`.
   * @param {string} jointName Joint name, first in file order.
   * @param {number} angle Target angle, radians relative to rest.
   * @param {OverrideOptions} [opts] Weight, strength and fade-in.
   * @returns {void}
   * @throws {Error} When no joint has this name.
   * @throws {TypeError} When `angle` is not a finite number, or an option has the wrong type or range.
   */
  setJointAngle(jointName, angle, opts) {
    this.#overrideAngle('setJointAngle', this.#jointOf('setJointAngle', jointName), angle, opts);
  }

  /**
   * Removes a joint's procedural override, at once or fading its weight to 0 over `fadeOut` seconds. Does nothing when
   * the joint has no override.
   * @param {string} jointName Joint name, first in file order.
   * @param {ClearOverrideOptions} [opts] Fade-out.
   * @returns {void}
   * @throws {Error} When no joint has this name.
   * @throws {TypeError} When `fadeOut` is not a finite number ≥ 0.
   */
  clearJointOverride(jointName, opts) {
    this.#clearOverride('clearJointOverride', this.#jointOf('clearJointOverride', jointName), opts);
  }

  /**
   * Returns the control handle of a joint: an object reference for procedural overrides that skips the name lookup on
   * every call. The same handle is returned for the same joint; it stays valid for the instance's life, and its calls
   * do nothing after `destroy`, like the name-based methods.
   * @param {string} jointName Joint name, first in file order.
   * @returns {JointControl} The joint's handle.
   * @throws {Error} When no joint has this name.
   */
  jointControl(jointName) {
    const joint = this.#jointOf('jointControl', jointName);
    let control = this.#controls.get(joint.id);
    if (control === undefined) {
      const label = `jointControl("${joint.name}")`;
      control = Object.freeze({
        name: joint.name,
        setAngle: (angle, opts) => this.#overrideAngle(`${label}.setAngle`, joint, angle, opts),
        lookAt: (worldPoint, opts) => this.#overrideAim(`${label}.lookAt`, joint, worldPoint, opts),
        clearOverride: (opts) => this.#clearOverride(`${label}.clearOverride`, joint, opts),
      });
      this.#controls.set(joint.id, control);
    }
    return control;
  }

  #overrideAim(method, joint, worldPoint, opts) {
    const point = pointArgument(method, 'worldPoint', worldPoint);
    this.#setOverride(joint, { aim: true, x: point.x, y: point.y, angle: 0 }, overrideOptions(method, opts));
  }

  #overrideAngle(method, joint, angle, opts) {
    if (typeof angle !== 'number' || !Number.isFinite(angle)) {
      throw new TypeError(`RagInstance.${method}: angle must be a finite number`);
    }
    this.#setOverride(joint, { aim: false, x: 0, y: 0, angle }, overrideOptions(method, opts));
  }

  #clearOverride(method, joint, opts) {
    const fadeOut = durationOption(method, optionsObject(method, opts), 'fadeOut');
    const entry = this.#overrides.get(joint.id);
    if (entry === undefined) return;
    if (fadeOut > 0 && entry.level > 0) {
      entry.goal = 0;
      entry.rate = entry.level / fadeOut;
    } else {
      this.#overrides.delete(joint.id);
    }
  }

  /**
   * Removes every procedural override at once.
   * @returns {void}
   */
  clearAllOverrides() {
    this.#overrides.clear();
  }

  /**
   * Converts a PIXI point to world meters through the view's parent transform and `pixelsPerMeter`, Y flipped
   * (DESIGN.md §1). Without a parent the point is taken in the view's frame.
   * @param {{ x: number, y: number }} pixiPoint Global PIXI point, e.g. `event.global`, pixels.
   * @returns {{ x: number, y: number }} A new world point, meters.
   * @throws {TypeError} When `pixiPoint` has no finite `x` and `y`.
   */
  toWorld(pixiPoint) {
    const point = pointArgument('toWorld', 'pixiPoint', pixiPoint);
    const parent = this.#view?.parent;
    const local = parent ? parent.toLocal(point) : point;
    return { x: local.x / this.#pixelsPerMeter, y: -local.y / this.#pixelsPerMeter };
  }

  /**
   * Converts a world point to global PIXI coordinates through `pixelsPerMeter` and the view's parent transform, Y
   * flipped (DESIGN.md §1). Without a parent the point is given in the view's frame.
   * @param {{ x: number, y: number }} worldPoint World point, meters.
   * @returns {{ x: number, y: number }} A new PIXI point, pixels.
   * @throws {TypeError} When `worldPoint` has no finite `x` and `y`.
   */
  toPixi(worldPoint) {
    const point = pointArgument('toPixi', 'worldPoint', worldPoint);
    const local = { x: point.x * this.#pixelsPerMeter, y: -point.y * this.#pixelsPerMeter };
    const parent = this.#view?.parent;
    if (!parent) return local;
    const global = parent.toGlobal(local);
    return { x: global.x, y: global.y };
  }

  #jointOf(method, name) {
    const joint = this.#jointsByName.get(name);
    if (joint === undefined) throw new Error(`RagInstance.${method}: unknown joint "${name}"`);
    return joint;
  }

  #setOverride(joint, target, options) {
    if (this.#destroyed) return;
    const previous = this.#overrides.get(joint.id);
    const entry = { joint, ...target, weight: options.weight, strength: options.strength, level: 0, goal: 1, rate: 0 };
    if (previous !== undefined) {
      entry.level = previous.level;
      entry.rate = previous.rate;
    }
    if (options.fadeIn === 0) entry.level = 1;
    else if (previous === undefined || previous.goal !== 1) entry.rate = (1 - entry.level) / options.fadeIn;
    this.#overrides.set(joint.id, entry);
  }

  #advanceOverrides(dt) {
    for (const [id, entry] of this.#overrides) {
      if (entry.goal === 1) entry.level = Math.min(entry.level + entry.rate * dt, 1);
      else entry.level = Math.max(entry.level - entry.rate * dt, 0);
      if (entry.goal === 0 && entry.level === 0) this.#overrides.delete(id);
    }
  }

  #overrideTargets() {
    if (this.#overrides.size === 0) return null;
    const targets = new Map();
    for (const [id, entry] of this.#overrides) {
      const angle = entry.aim ? this.#aimTarget(entry) : entry.angle;
      targets.set(id, { angle, weight: entry.weight * entry.level, strength: entry.strength });
    }
    return targets;
  }

  #aimTarget(entry) {
    const { joint } = entry;
    const native = this.#joints.get(joint.id);
    const anchor = native.GetAnchorB();
    const anchorX = anchor.get_x();
    const anchorY = anchor.get_y();
    const physical = aimAngle(
      { x: anchorX, y: anchorY },
      entry,
      this.#bodies.get(joint.bodyA).GetAngle(),
      native.GetReferenceAngle(),
      this.#aimAxes.get(joint.id),
    );
    return clampToLimits(this.#flipX ? -physical : physical, joint.limits);
  }

  #clipOf(method, key) {
    const clip = this.#clips.get(key);
    if (clip === undefined) throw new Error(`RagInstance.${method}: unknown clip "${key}"`);
    return clip;
  }

  #advanceClips(dt) {
    for (const [layer, entry] of this.#layers) {
      const { clip } = entry;
      entry.time += dt * clip.speed * entry.speed;
      if (entry.time < clip.length) continue;
      if (clip.loop) entry.time %= clip.length;
      else if (clip.hold) entry.time = clip.length;
      else this.#layers.delete(layer);
    }
  }

  #topLayer() {
    let top = null;
    for (const [layer, entry] of this.#layers) {
      if (top === null || layer > top.layer) top = { layer, entry };
    }
    if (top === null) return [];
    const { clip, time, speed } = top.entry;
    return [{ clip, time, weight: 1, speed: clip.speed * speed }];
  }

  #driveMotors(resolved) {
    const sign = this.#flipX ? -1 : 1;
    for (const joint of this.#poseSource.joints) {
      const pose = resolved.joints.get(joint.id);
      const mirrored = { ...pose, angle: sign * pose.angle, angleRate: sign * pose.angleRate };
      driveMotor(this.#joints.get(joint.id), mirrored, joint.motor);
    }
  }

  #driveBalance(root, dt) {
    const balance = this.#balance;
    if (!balance.enabled || !this.#balanceOn) return;
    const runtime = this.#runtime;
    const drive = {
      S: root.balance * runtime.strength,
      G: root.gain * runtime.gain * balance.gain,
      D: root.damping * runtime.damping * balance.damping,
      rate: this.#flipX ? -root.bodyAngleRate : root.bodyAngleRate,
    };
    const target = this.#restAngle + (this.#flipX ? -root.bodyAngle : root.bodyAngle);
    driveBalance(this.#root, this.#balanceLinks, target, drive, balance, dt, this.#force);
  }

  /**
   * Subscribes a listener.
   * @param {string} type `event`, `start`, `loop`, `complete` or `stop`.
   * @param {(payload: *) => void} fn Listener.
   * @returns {() => void} Function that removes the listener.
   * @throws {TypeError} When `fn` is not a function.
   */
  on(type, fn) {
    return this.#emitter.on(type, fn);
  }

  /**
   * Removes a listener. Does nothing when it is not registered.
   * @param {string} type Event type.
   * @param {(payload: *) => void} fn Listener.
   * @returns {void}
   */
  off(type, fn) {
    this.#emitter.off(type, fn);
  }

  /**
   * Destroys joints, then bodies, removes and destroys the view (textures kept) and clears listeners and overrides. A
   * second call does nothing.
   * @returns {void}
   * @throws {Error} When the world is locked; nothing changes.
   */
  destroy() {
    if (this.#destroyed) return;
    if (this.#world.IsLocked()) throw new Error('RagInstance.destroy: the world is locked (called during world.Step)');
    try {
      destroyNatives(this.#world, this.#joints, this.#bodies);
    } finally {
      this.#release?.();
    }
    for (const map of Object.values(this.#byName)) map.clear();
    this.#aimAxes.clear();
    this.#layers.clear();
    this.#overrides.clear();
    const view = this.#view;
    view.parent?.removeChild(view);
    view.destroy({ children: true });
    this.#view = null;
    this.#root = null;
    this.#emitter.clear();
    this.#destroyed = true;
  }
}
