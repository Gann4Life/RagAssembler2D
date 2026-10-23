import { Emitter } from '../lib/emitter.js';
import { toJson } from './model/io.js';

/**
 * @typedef {object} PlayerClock
 * @property {(callback: (timestamp: number) => void) => number} request Schedules one frame; the callback gets a
 *   timestamp in milliseconds.
 * @property {(handle: number) => void} cancel Cancels a scheduled frame.
 * @property {() => number} [now] Current time in milliseconds, `performance.now` in the browser; without it the scrub
 *   preview is limited by {@link SCRUB_MAX_STEPS} alone.
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

/**
 * Time the scrub preview may spend stepping in one frame, milliseconds.
 * @type {number}
 */
export const SCRUB_FRAME_BUDGET = 8;

/**
 * Most physics steps the scrub preview runs in one frame.
 * @type {number}
 */
export const SCRUB_MAX_STEPS = 240;

const PREVIEW_VERSION = 'preview';
const STEP_EPSILON = 1e-9;

/**
 * Play, Pause, Next frame, Stop and scrub (`DESIGN.md` §5.1, §5.3, §5.8). Play enters Simulate mode and runs the
 * document through a {@link Simulator} at a fixed step, playing the open clip; the playhead follows the simulated
 * clip time. Stop destroys the simulation and restores the mode, clip and playhead active before Play. Scrubbing in
 * Animate mode keeps a scrub simulation of the open clip and steps it at the same fixed step up to the playhead,
 * within a per-frame budget, rebuilding it from 0 to go back; a model change, a mode change or another open clip
 * drops it. Play continues from the scrub simulation when there is one. Never changes the model. Events: `playing`
 * with the new `boolean`; `pose` with the simulated pose by body uid (root-local), or `null` when no simulation is
 * shown any more.
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
  #preview = null;
  #previewing = false;
  #previewFailed = false;
  #previewHandle = null;

  /**
   * @param {import('./model/model.js').Model} model Document model, read only.
   * @param {import('./modes.js').Modes} modes Editor modes holding the open clip and the playhead.
   * @param {PlayerClock} clock Frame scheduler, `requestAnimationFrame` in the browser.
   * @param {Simulator|null} [simulator] Starts a simulation; without one nothing can play and scrubbing shows no
   *   physics.
   */
  constructor(model, modes, clock, simulator = null) {
    this.#model = model;
    this.#modes = modes;
    this.#clock = clock;
    this.#simulator = simulator;
    modes.on('mode', ({ mode }) => {
      if (this.#session !== null && mode !== 'simulate') this.#teardown();
      this.#dropPreview();
    });
    model.on('change', () => this.#dropPreview());
    model.on('reset', () => this.#dropPreview());
  }

  /** @returns {boolean} Whether the viewport is shown the scrub simulation (Animate mode, after a scrub). */
  get previewing() {
    return this.#previewing;
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
   * Resumes a paused simulation, or starts one and enters Simulate mode: it continues the scrub simulation of the
   * open clip when there is one, with the playhead at the time it reached, otherwise it builds one from the
   * document and plays the open clip from 0.
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
   * Moves the playhead from the ruler and shows the physics at that time: the scrub simulation steps toward it on
   * the following frames, emitting `pose` with the latest state reached. While a Simulate run exists it leaves
   * Simulate mode first, as Stop does, and its simulation becomes the scrub simulation; with no clip to scrub it
   * just ends.
   * @param {number} t Time in seconds, clamped to the open clip.
   * @returns {boolean} `false` when nothing could be scrubbed.
   */
  scrub(t) {
    const taken = this.#session === null ? null : this.#takeSimulation();
    const scrubbable = this.#modes.clip !== null && this.#modes.can('timeline.scrub');
    if (taken !== null) {
      if (scrubbable && taken.clip === this.#modes.clip) {
        this.#preview = taken;
        this.#previewing = true;
      } else {
        taken.session.destroy();
        this.#emitter.emit('pose', null);
      }
    }
    if (!scrubbable) return false;
    this.#modes.setPlayhead(t);
    if (this.#simulator !== null) {
      this.#previewing = true;
      this.#requestPreview();
    }
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
    const adopted = this.#adoptPreview(clip);
    const session = adopted?.session ?? this.#create(clip);
    this.#clip = clip;
    this.#steps = adopted?.steps ?? 0;
    this.#accumulated = 0;
    try {
      this.#modes.startSimulate();
      this.#session = session;
      if (clip !== null) this.#modes.setPlayhead(this.#clipTime());
    } catch (error) {
      this.#session = null;
      session.destroy();
      throw error;
    }
    this.#emitPose(session);
  }

  #create(clip) {
    const key = clip === null ? null : this.#model.prop(clip, 'key');
    return this.#simulator(toJson(this.#model, PREVIEW_VERSION), { clip: key });
  }

  #adoptPreview(clip) {
    const preview = this.#preview;
    if (preview === null || clip === null || preview.clip !== clip) {
      this.#dropPreview();
      return null;
    }
    this.#preview = null;
    this.#previewing = false;
    this.#cancelPreview();
    return preview;
  }

  #takeSimulation() {
    const taken = { session: this.#session, clip: this.#clip, steps: this.#steps };
    this.#session = null;
    this.#clip = null;
    this.pause();
    try {
      this.#modes.stopSimulate();
    } catch (error) {
      taken.session.destroy();
      this.#emitter.emit('pose', null);
      throw error;
    }
    return taken;
  }

  #dropPreview() {
    const shown = this.#previewing;
    const preview = this.#preview;
    this.#preview = null;
    this.#previewing = false;
    this.#previewFailed = false;
    this.#cancelPreview();
    preview?.session.destroy();
    if (shown) this.#emitter.emit('pose', null);
  }

  #requestPreview() {
    if (this.#previewHandle === null) this.#previewHandle = this.#clock.request(() => this.#previewFrame());
  }

  #cancelPreview() {
    if (this.#previewHandle !== null) this.#clock.cancel(this.#previewHandle);
    this.#previewHandle = null;
  }

  #previewFrame() {
    this.#previewHandle = null;
    const clip = this.#modes.clip;
    if (!this.#previewing || this.#previewFailed || clip === null) return;
    const started = this.#now();
    const target = this.#stepsAt(clip, this.#modes.playhead);
    if (this.#preview !== null && this.#preview.steps > target) {
      this.#preview.session.destroy();
      this.#preview = null;
    }
    if (this.#preview === null) {
      try {
        this.#preview = { session: this.#create(clip), clip, steps: 0 };
      } catch {
        this.#previewFailed = true;
        this.#emitter.emit('pose', null);
        return;
      }
    }
    const preview = this.#preview;
    for (let run = 0; preview.steps < target && run < SCRUB_MAX_STEPS; run++) {
      if (run > 0 && this.#now() - started >= SCRUB_FRAME_BUDGET) break;
      preview.session.step(SIMULATE_STEP);
      preview.steps++;
    }
    this.#emitPose(preview.session);
    if (preview.steps < target) this.#requestPreview();
  }

  #now() {
    return typeof this.#clock.now === 'function' ? this.#clock.now() : 0;
  }

  #stepsAt(clip, time) {
    const speed = this.#model.prop(clip, 'speed') ?? 1;
    if (!(speed > 0)) return 0;
    return Math.round(time / (SIMULATE_STEP * speed));
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
    this.#emitPose(this.#session);
  }

  #clipTime() {
    const length = this.#model.prop(this.#clip, 'length');
    const speed = this.#model.prop(this.#clip, 'speed') ?? 1;
    const time = this.#steps * SIMULATE_STEP * speed;
    if (!(length > 0)) return 0;
    return this.#model.prop(this.#clip, 'loop') === true ? time % length : Math.min(time, length);
  }

  #emitPose(session) {
    const pose = new Map();
    for (const [id, transform] of session.pose()) {
      const uid = this.#model.uidOf(id);
      if (uid !== null) pose.set(uid, transform);
    }
    this.#emitter.emit('pose', pose);
  }
}
