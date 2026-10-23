import { Emitter } from '../lib/emitter.js';
import { toJson } from './model/io.js';

/**
 * @typedef {object} PlayerClock
 * @property {(callback: (timestamp: number) => void) => number} request Schedules one frame; the callback gets a
 *   timestamp in milliseconds.
 * @property {(handle: number) => void} cancel Cancels a scheduled frame.
 */

/**
 * Live physics run of the document, owned by the player while in Simulate mode.
 * @typedef {object} SimulationSession
 * @property {(dt: number) => void} step Advances the clips and the world by `dt` seconds.
 * @property {() => Map<string, import('../lib/geometry.js').Transform>} pose Body id → root-local transform,
 *   meters and radians.
 * @property {() => void} destroy Releases every native object; idempotent.
 */

/**
 * Starts a simulation of a `.rag.json` document playing the clip with key `clip` (none when `null`).
 * @typedef {(json: object, options: { clip: string|null }) => SimulationSession} Simulator
 */

/**
 * Fixed physics step of Simulate mode, seconds.
 * @type {number}
 */
export const SIMULATE_STEP = 1 / 60;

/**
 * Most physics steps run in one frame; the rest of a long frame is dropped.
 * @type {number}
 */
export const SIMULATE_MAX_STEPS = 4;

const PREVIEW_VERSION = 'preview';
const STEP_EPSILON = 1e-9;

/**
 * Play, Pause, Next frame and Stop (`DESIGN.md` §5.1, §5.3). Play enters Simulate mode and runs the document
 * through a {@link Simulator} at a fixed step, playing the open clip from 0; the playhead follows the simulated
 * clip time. Stop destroys the simulation and restores the mode, clip and playhead active before Play. Never
 * changes the model. Events: `playing` with the new `boolean`; `pose` with the simulated pose by body uid
 * (root-local), or `null` when the simulation ends.
 */
export class TimelinePlayer {
  #model;
  #modes;
  #clock;
  #simulator;
  #emitter = new Emitter();
  #session = null;
  #clip = null;
  #playing = false;
  #handle = null;
  #last = null;
  #accumulated = 0;
  #steps = 0;

  /**
   * @param {import('./model/model.js').Model} model Document model, read only.
   * @param {import('./modes.js').Modes} modes Editor modes holding the open clip and the playhead.
   * @param {PlayerClock} clock Frame scheduler, `requestAnimationFrame` in the browser.
   * @param {Simulator|null} [simulator] Starts a simulation; without one nothing can play.
   */
  constructor(model, modes, clock, simulator = null) {
    this.#model = model;
    this.#modes = modes;
    this.#clock = clock;
    this.#simulator = simulator;
    modes.on('mode', ({ mode }) => {
      if (this.#session !== null && mode !== 'simulate') this.#teardown();
    });
  }

  /** @returns {boolean} Whether the simulation is advancing. */
  get playing() {
    return this.#playing;
  }

  /** @returns {boolean} Whether a simulation exists (Simulate mode, playing or paused). */
  get simulating() {
    return this.#session !== null;
  }

  /** @returns {boolean} Whether Play/Pause can toggle: a simulation exists, or the mode allows Play. */
  canPlay() {
    return this.#session !== null || (this.#simulator !== null && this.#modes.can('play'));
  }

  /**
   * Resumes a paused simulation, or starts one: builds it from the document, enters Simulate mode and plays the
   * open clip from 0.
   * @returns {boolean} `false` when nothing can play.
   * @throws {Error} When the simulator fails (for example on a document with validation errors); the mode is
   *   unchanged.
   */
  play() {
    if (this.#session === null) {
      if (!this.canPlay()) return false;
      this.#start();
    }
    if (this.#playing) return true;
    this.#playing = true;
    this.#last = null;
    this.#schedule();
    this.#emitter.emit('playing', true);
    return true;
  }

  /** Stops advancing the simulation; it stays in Simulate mode. */
  pause() {
    if (!this.#playing) return;
    this.#playing = false;
    this.#cancel();
    this.#emitter.emit('playing', false);
  }

  /**
   * Plays when paused or idle, pauses when playing.
   * @returns {boolean} `false` when it would start but nothing can play.
   */
  toggle() {
    if (this.#playing) {
      this.pause();
      return true;
    }
    return this.play();
  }

  /**
   * Pauses and advances the simulation by one fixed step.
   * @returns {boolean} `false` outside Simulate mode.
   */
  nextFrame() {
    if (this.#session === null) return false;
    this.pause();
    this.#advance(1);
    return true;
  }

  /**
   * Ends the simulation and restores the mode, clip and playhead active before Play.
   * @returns {boolean} `false` outside Simulate mode.
   */
  stop() {
    if (this.#session === null) return false;
    this.#teardown();
    this.#modes.stopSimulate();
    return true;
  }

  /**
   * @param {'playing'|'pose'} type Event name.
   * @param {(payload: *) => void} fn Listener.
   * @returns {() => void} Unsubscribe function.
   */
  on(type, fn) {
    return this.#emitter.on(type, fn);
  }

  #start() {
    const clip = this.#modes.clip;
    const key = clip === null ? null : this.#model.prop(clip, 'key');
    const session = this.#simulator(toJson(this.#model, PREVIEW_VERSION), { clip: key });
    this.#clip = clip;
    this.#steps = 0;
    this.#accumulated = 0;
    try {
      this.#modes.startSimulate();
      this.#session = session;
      if (clip !== null) this.#modes.setPlayhead(0);
    } catch (error) {
      session.destroy();
      throw error;
    }
    this.#emitPose();
  }

  #teardown() {
    const session = this.#session;
    this.#session = null;
    this.#clip = null;
    this.pause();
    session.destroy();
    this.#emitter.emit('pose', null);
  }

  #schedule() {
    this.#handle = this.#clock.request((timestamp) => this.#frame(timestamp));
  }

  #cancel() {
    if (this.#handle !== null) this.#clock.cancel(this.#handle);
    this.#handle = null;
  }

  #frame(timestamp) {
    this.#handle = null;
    if (!this.#playing || this.#session === null) return;
    const elapsed = this.#last === null ? 0 : Math.max(0, (timestamp - this.#last) / 1000);
    this.#last = timestamp;
    this.#accumulated = Math.min(this.#accumulated + elapsed, SIMULATE_MAX_STEPS * SIMULATE_STEP);
    const steps = Math.floor(this.#accumulated / SIMULATE_STEP + STEP_EPSILON);
    this.#accumulated = Math.max(0, this.#accumulated - steps * SIMULATE_STEP);
    if (steps > 0) this.#advance(steps);
    if (this.#playing) this.#schedule();
  }

  #advance(steps) {
    for (let i = 0; i < steps; i++) this.#session.step(SIMULATE_STEP);
    this.#steps += steps;
    if (this.#clip !== null && this.#modes.clip === this.#clip) this.#modes.setPlayhead(this.#clipTime());
    this.#emitPose();
  }

  #clipTime() {
    const length = this.#model.prop(this.#clip, 'length');
    const speed = this.#model.prop(this.#clip, 'speed') ?? 1;
    const time = this.#steps * SIMULATE_STEP * speed;
    if (!(length > 0)) return 0;
    return this.#model.prop(this.#clip, 'loop') === true ? time % length : Math.min(time, length);
  }

  #emitPose() {
    const pose = new Map();
    for (const [id, transform] of this.#session.pose()) {
      const uid = this.#model.uidOf(id);
      if (uid !== null) pose.set(uid, transform);
    }
    this.#emitter.emit('pose', pose);
  }
}
