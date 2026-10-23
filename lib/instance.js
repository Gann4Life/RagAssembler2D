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
 * @returns {void}
 */
export function driveMotor(joint, pose, motor) {
  const error = pose.angle - joint.GetJointAngle();
  const speed = pose.G * error - pose.D * joint.GetJointSpeed();
  joint.SetMotorSpeed(Math.min(Math.max(speed, -motor.maxSpeed), motor.maxSpeed));
  joint.SetMaxMotorTorque(pose.S * motor.maxTorque);
  joint.EnableMotor(pose.S > 0);
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
   * @param {{ channels: object, bodies: ReadonlyArray<object>, joints: ReadonlyArray<object>,
   *   clips: ReadonlyArray<object> }} parts.data Frozen definition data: root channels, bodies, joints with `motor`, clips.
   */
  constructor({ world, bodies, joints, byName, root, view, flipX, aimAxes, data }) {
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
   * Resolves the pose and writes every joint motor (DESIGN.md §3). Call once per physics step, before
   * `world.Step`. Does nothing after `destroy`.
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
    this.#driveMotors(resolveChannels(this.#poseSource, this.#topLayer(), this.#runtime));
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
    return top === null ? [] : [{ clip: top.entry.clip, time: top.entry.time, weight: 1 }];
  }

  #driveMotors(resolved) {
    const sign = this.#flipX ? -1 : 1;
    for (const joint of this.#poseSource.joints) {
      const pose = resolved.joints.get(joint.id);
      pose.angle *= sign;
      driveMotor(this.#joints.get(joint.id), pose, joint.motor);
    }
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
    destroyNatives(this.#world, this.#joints, this.#bodies);
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
