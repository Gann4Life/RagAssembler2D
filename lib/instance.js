import { Emitter } from './emitter.js';
import { resolveChannels } from './evaluate.js';

/**
 * @typedef {object} MotorBase
 * @property {number} maxTorque Base torque, N·m.
 * @property {number} gain Base gain, 1/s.
 * @property {number} damping Base damping, unitless.
 * @property {number} maxSpeed Speed limit, rad/s.
 */

/**
 * Writes one joint motor from a resolved pose with the PD-over-motor model of DESIGN.md §3.
 * Internal: used by `RagInstance.update` and tests.
 * @param {*} joint `b2RevoluteJoint`, or any object with its angle, speed and motor methods.
 * @param {import('./evaluate.js').JointPose} pose Resolved pose; `angle` in radians in the joint's frame.
 * @param {MotorBase} motor Base motor values of the joint.
 * @param {number} [target] Angle the motor pulls toward, radians in the joint's frame: the look-ahead target of
 *   DESIGN.md §3; default `pose.angle`.
 * @returns {void}
 */
export function driveMotor(joint, pose, motor, target = pose.angle) {
  const error = target - joint.GetJointAngle();
  const speed = pose.G * error - pose.D * joint.GetJointSpeed();
  joint.SetMotorSpeed(Math.min(Math.max(speed, -motor.maxSpeed), motor.maxSpeed));
  joint.SetMaxMotorTorque(pose.S * motor.maxTorque);
  joint.EnableMotor(pose.S > 0);
}

/**
 * @typedef {object} BalanceBase
 * @property {number} maxTorque Base torque, N·m.
 * @property {number} gain Base gain, 1/s.
 * @property {number} damping Base damping, unitless.
 * @property {number} maxSpeed Speed limit, rad/s.
 */

/**
 * @typedef {object} BalanceLink
 * @property {*} body `b2Body`, or any object with `GetWorldCenter`, `GetLinearVelocity`, `GetAngularVelocity`,
 *   `ApplyTorque` and `ApplyForce`.
 * @property {number} mass Body mass, kg.
 * @property {number} inertia Rotational inertia about the body's own center of mass, kg·m².
 */

const TURN = 2 * Math.PI;

function wrapToPi(angle) {
  return angle - TURN * Math.ceil((angle - Math.PI) / TURN);
}

/**
 * Applies the balance wrench of DESIGN.md §3.2, when `S > 0` and `dt > 0`: the torque that turns the bodies connected
 * to `rootBody` as one rigid piece about their common center of mass, spread over them as a torque and a force per
 * body (no net force). Internal: used by `RagInstance.update` and tests.
 * @param {*} root `rootBody`: any object with `GetAngle`.
 * @param {ReadonlyArray<BalanceLink>} links The bodies connected to `rootBody` with mass, `rootBody` included.
 * @param {number} target World angle of `rootBody` to track, radians (`θ₀ + bodyAngle`).
 * @param {{ S: number, G: number, D: number }} drive `S` (0-1), `G` (1/s) and `D` with the balance base values applied.
 * @param {BalanceBase} balance Base balance values.
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
  const wanted = Math.min(Math.max(drive.G * error - drive.D * omega, -balance.maxSpeed), balance.maxSpeed);
  const limit = drive.S * balance.maxTorque;
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
   *   clips: ReadonlyArray<object> }} parts.data Frozen definition data: root channels, balance with `parts` (the
   *   bodies connected to `rootBody` with mass: `{ id, mass, inertia }`), bodies, joints with `motor`, clips.
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
   * Sets the runtime strength multiplier, clamped to 0-1 (default 1). Scales every joint's motor torque.
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
   * Resolves the pose, writes every joint motor (DESIGN.md §3) and applies the balance torque to `rootBody`
   * (DESIGN.md §3.2). Call once per physics step, before `world.Step`, with that step's `dt`. Does nothing after
   * `destroy`.
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
    const top = this.#topLayer();
    const resolvedAt = new Map();
    const at = (seconds) => {
      if (!resolvedAt.has(seconds)) {
        const layers = top.map(({ clip, time, rate }) => ({ clip, time: time + seconds * rate, weight: 1 }));
        resolvedAt.set(seconds, resolveChannels(this.#poseSource, layers, this.#runtime));
      }
      return resolvedAt.get(seconds);
    };
    const ahead = (gain, damping) => at(top.length > 0 && gain > 0 ? Math.max(0, (1 + damping) / gain - dt) : 0);
    const resolved = at(0);
    this.#driveMotors(resolved, ahead);
    this.#driveBalance(resolved.root, ahead, dt);
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
    return [{ clip, time, rate: clip.speed * speed }];
  }

  #driveMotors(resolved, ahead) {
    const sign = this.#flipX ? -1 : 1;
    for (const joint of this.#poseSource.joints) {
      const pose = resolved.joints.get(joint.id);
      const target = sign * ahead(pose.G, pose.D).joints.get(joint.id).angle;
      driveMotor(this.#joints.get(joint.id), { ...pose, angle: sign * pose.angle }, joint.motor, target);
    }
  }

  #driveBalance(root, ahead, dt) {
    const balance = this.#balance;
    if (!balance.enabled || !this.#balanceOn) return;
    const runtime = this.#runtime;
    const drive = {
      S: root.strength * runtime.strength,
      G: root.gain * runtime.gain * balance.gain,
      D: root.damping * runtime.damping * balance.damping,
    };
    const bodyAngle = ahead(drive.G, drive.D).root.bodyAngle;
    const target = this.#restAngle + (this.#flipX ? -bodyAngle : bodyAngle);
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
   * Destroys joints, then bodies, removes and destroys the view (textures kept) and clears listeners. A second call does nothing.
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
    const view = this.#view;
    view.parent?.removeChild(view);
    view.destroy({ children: true });
    this.#view = null;
    this.#root = null;
    this.#emitter.clear();
    this.#destroyed = true;
  }
}
