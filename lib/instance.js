import { Emitter } from './emitter.js';

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
   */
  constructor({ world, bodies, joints, byName, root, view, flipX, aimAxes }) {
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
    const view = this.#view;
    view.parent?.removeChild(view);
    view.destroy({ children: true });
    this.#view = null;
    this.#root = null;
    this.#emitter.clear();
    this.#destroyed = true;
  }
}
