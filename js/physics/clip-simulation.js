import { Emitter } from '../../lib/emitter.js';
import { STEP_SETTINGS } from '../../lib/ragimporter.js';

/**
 * Clip simulation constants: `step` in s (RagImporter's `STEP_SETTINGS.dt`), `budget` and `debounce` in ms, `maxStepsPerFrame` in steps, `cycleLimit`
 * in cycles.
 * @type {Readonly<{ step: number, budget: number, maxStepsPerFrame: number, debounce: number, cycleLimit: number }>}
 */
export const CLIP_SIMULATION = Object.freeze({
  step: STEP_SETTINGS.dt,
  budget: 8,
  maxStepsPerFrame: 240,
  debounce: 250,
  cycleLimit: 8,
});

/**
 * What a run simulates: the document and its open clip.
 * @typedef {object} ClipRunSpec
 * @property {object} json A `.rag.json` document.
 * @property {string} clip Key of the open clip.
 * @property {number} length Clip length, seconds.
 * @property {number} speed Clip speed, positive.
 * @property {boolean} loop Whether the clip loops.
 */

/**
 * A pose read from a run.
 * @typedef {object} RunPose
 * @property {Map<string, import('../../lib/geometry.js').Transform>} pose Root-local transforms by body id.
 * @property {number} run Id of the run it comes from; a new run has a new id.
 * @property {number} step Step of that run, 0 being the spawn.
 * @property {boolean} exact Whether it is the step asked for (`false`: the latest step the run reached).
 */

/**
 * Simulation progress, as run time reached in clip seconds counted from the start of cycle 1.
 * @typedef {object} RunProgress
 * @property {number|null} current Clip time the current run reached, or `null` without one.
 * @property {number|null} previous Clip time the previous run reached, or `null` without one.
 * @property {boolean} pending Whether a restart after a change is waiting or the current run is still computing
 *   toward its horizon.
 */

class Run {
  constructor(id, spec, session, target) {
    this.id = id;
    this.spec = spec;
    this.session = session;
    this.target = target;
    this.ids = [];
    this.frames = [];
    this.record();
  }

  record() {
    const pose = this.session.pose();
    if (this.ids.length === 0) this.ids = [...pose.keys()];
    const frame = new Float64Array(this.ids.length * 3);
    this.ids.forEach((id, index) => {
      const transform = pose.get(id);
      frame[index * 3] = transform?.x ?? 0;
      frame[index * 3 + 1] = transform?.y ?? 0;
      frame[index * 3 + 2] = transform?.angle ?? 0;
    });
    this.frames.push(frame);
  }

  get reached() {
    return this.frames.length - 1;
  }

  get done() {
    return this.reached >= this.target;
  }

  advance(step) {
    this.session.step(step);
    this.record();
  }

  poseAt(step) {
    const frame = this.frames[step];
    const pose = new Map();
    this.ids.forEach((id, index) => {
      pose.set(id, { x: frame[index * 3], y: frame[index * 3 + 1], angle: frame[index * 3 + 2] });
    });
    return pose;
  }

  release() {
    if (this.session === null) return;
    const session = this.session;
    this.session = null;
    session.destroy();
  }
}

function stepSeconds(spec) {
  return CLIP_SIMULATION.step * spec.speed;
}

function cycleSteps(spec) {
  return Math.round(spec.length / stepSeconds(spec));
}

/**
 * Deterministic background physics run of the open clip (`DESIGN.md` §5.1, Clip simulation), stepped at the fixed
 * 60 Hz step within a per-frame time budget and stored per step. Every clip is spawned in its own pose at time 0
 * (`pose` option of the simulator; a clip without keys starts at rest). A non-looping clip is run to `length`; a
 * looping clip is run continuously through its cycles up to the horizon: the later of cycle 2 and the cycle after the playhead's, never
 * past the cycle limit. Ghosts read the same run as the main figure, in the playhead cycle, so a ghost and the main
 * figure at the same time are the same simulation state. After a committed change the run restarts
 * `debounce` ms later; the previous run is kept until the new one reaches its horizon. Never changes the document.
 * Emits `update` (no payload) after every frame that computed something, and when runs start, fail or are dropped.
 */
export class ClipSimulation {
  #simulator;
  #clock;
  #options;
  #emitter = new Emitter();
  #spec = null;
  #current = null;
  #previous = null;
  #failed = false;
  #restartAt = null;
  #cycle = 1;
  #nextId = 1;
  #handle = null;

  /**
   * @param {(json: object, options: { clip: string, pose: string|null }) => import('../timeline-player.js').SimulationSession} simulator
   *   Starts a physics run of a document playing the clip `clip` from 0, spawned in the pose of clip `pose` at time 0
   *   (the rest pose for `null`); throws when the document cannot be simulated.
   * @param {import('../timeline-player.js').PlayerClock} clock Frame scheduler and `now()` in milliseconds.
   * @param {Partial<typeof CLIP_SIMULATION>} [options] Overrides of {@link CLIP_SIMULATION}.
   */
  constructor(simulator, clock, options = {}) {
    this.#simulator = simulator;
    this.#clock = clock;
    this.#options = Object.freeze({ ...CLIP_SIMULATION, ...options });
  }

  /** @returns {number} Most cycles a looping clip is run. */
  get cycleLimit() {
    return this.#options.cycleLimit;
  }

  /** @returns {boolean} Whether a clip is open and its document could be simulated. */
  get available() {
    return this.#spec !== null && !this.#failed;
  }

  /**
   * Starts a run of a clip now, dropping every run of the clip open before.
   * @param {ClipRunSpec} spec Document and clip.
   * @returns {void}
   */
  open(spec) {
    this.#dropAll();
    this.#spec = spec;
    this.#cycle = 1;
    this.#restartAt = null;
    this.#start();
    this.#emit();
  }

  /**
   * Reports a committed document change: the run restarts `debounce` ms after the last such call, keeping the
   * current run as the previous one meanwhile.
   * @param {ClipRunSpec} spec Document and clip after the change.
   * @returns {void}
   */
  change(spec) {
    if (this.#spec === null) return;
    this.#spec = spec;
    if (!spec.loop) this.#cycle = 1;
    this.#restartAt = this.#now() + this.#options.debounce;
    this.#schedule();
    this.#emit();
  }

  /** Drops every run and forgets the clip. */
  close() {
    const had = this.#spec !== null;
    this.#dropAll();
    this.#spec = null;
    this.#restartAt = null;
    this.#failed = false;
    this.#cancel();
    if (had) this.#emit();
  }

  /**
   * Moves the horizon of a looping clip's run to the later of cycle 2 and `cycle + 1`, within the cycle limit.
   * @param {number} cycle Playhead cycle, 1 or more.
   * @returns {void}
   */
  setCycle(cycle) {
    this.#cycle = Math.min(Math.max(1, Math.round(cycle)), this.cycleLimit);
    const run = this.#current;
    if (run === null || !run.spec.loop) return;
    const target = this.#mainTarget(run.spec);
    if (target > run.target) {
      run.target = target;
      this.#schedule();
    }
  }

  /**
   * Run step of a playhead time: clip time `t` in cycle `cycle` (cycle ignored for a non-looping clip).
   * @param {number} cycle Playhead cycle.
   * @param {number} t Clip time, seconds.
   * @returns {number} Step index, or 0 without an open clip.
   */
  stepOf(cycle, t) {
    const spec = this.#spec;
    if (spec === null) return 0;
    const runTime = spec.loop ? (Math.max(1, cycle) - 1) * spec.length + t : Math.min(t, spec.length);
    return Math.max(0, Math.round(runTime / stepSeconds(spec)));
  }

  /**
   * Pose of the main figure at a playhead time: the current run's step once reached, else the previous run's step
   * when it reached it, else the latest step the current run reached.
   * @param {number} cycle Playhead cycle.
   * @param {number} t Clip time, seconds.
   * @returns {RunPose|null} `null` when not available.
   */
  pose(cycle, t) {
    if (!this.available) return null;
    const step = this.stepOf(cycle, t);
    return this.#read([this.#current, this.#previous], step, true);
  }

  /**
   * Pose of a ghost at a playhead time: the same step as {@link ClipSimulation#pose}, from the current run once it
   * reached it, else from the previous run, else none.
   * @param {number} cycle Playhead cycle.
   * @param {number} t Clip time, seconds.
   * @returns {RunPose|null}
   */
  ghostPose(cycle, t) {
    if (!this.available) return null;
    return this.#read([this.#current, this.#previous], this.stepOf(cycle, t), false);
  }

  /**
   * Whether the main figure at a playhead time is up to date: no restart is waiting and the current run, started
   * after the last committed change, reached that step.
   * @param {number} cycle Playhead cycle.
   * @param {number} t Clip time, seconds.
   * @returns {boolean}
   */
  upToDate(cycle, t) {
    if (!this.available || this.#restartAt !== null || this.#current === null) return false;
    return this.#current.reached >= this.stepOf(cycle, t);
  }

  /** @returns {RunProgress} How far the runs got. */
  progress() {
    const reach = (run) => (run === null ? null : Math.min(run.reached * stepSeconds(run.spec), this.#horizonTime(run)));
    return Object.freeze({
      current: this.available ? reach(this.#current) : null,
      previous: this.available ? reach(this.#previous) : null,
      pending: this.available && (this.#restartAt !== null || (this.#current !== null && !this.#current.done)),
    });
  }

  /**
   * @param {'update'} type Event name.
   * @param {() => void} fn Listener.
   * @returns {() => void} Unsubscribe function.
   */
  on(type, fn) {
    return this.#emitter.on(type, fn);
  }

  #horizonTime(run) {
    return run.target * stepSeconds(run.spec);
  }

  #read(runs, step, latest) {
    for (const run of runs) {
      if (run !== null && run.reached >= step) return Object.freeze({ pose: run.poseAt(step), run: run.id, step, exact: true });
    }
    const current = runs[0];
    if (!latest || current === null) return null;
    return Object.freeze({ pose: current.poseAt(current.reached), run: current.id, step: current.reached, exact: false });
  }

  #mainTarget(spec) {
    if (!spec.loop) return cycleSteps(spec);
    const horizon = Math.min(Math.max(2, this.#cycle + 1), this.cycleLimit);
    return horizon * cycleSteps(spec);
  }

  #start() {
    const spec = this.#spec;
    try {
      this.#current = new Run(this.#nextId++, spec, this.#simulator(spec.json, { clip: spec.clip, pose: spec.clip }), this.#mainTarget(spec));
      this.#failed = false;
    } catch {
      this.#failed = true;
      this.#dropAll();
      return;
    }
    this.#schedule();
  }

  #restart() {
    this.#restartAt = null;
    this.#previous = this.#keepFurther(this.#previous, this.#current);
    this.#current = null;
    this.#start();
  }

  #keepFurther(older, newer) {
    if (newer === null) return older;
    newer.release();
    if (older !== null && older.reached > newer.reached) return older;
    if (older !== null) older.release();
    return newer;
  }

  #dropAll() {
    for (const run of [this.#current, this.#previous]) run?.release();
    this.#current = null;
    this.#previous = null;
  }

  #now() {
    return typeof this.#clock.now === 'function' ? this.#clock.now() : 0;
  }

  #schedule() {
    if (this.#handle === null) this.#handle = this.#clock.request(() => this.#frame());
  }

  #cancel() {
    if (this.#handle !== null) this.#clock.cancel(this.#handle);
    this.#handle = null;
  }

  #frame() {
    this.#handle = null;
    if (this.#spec === null) return;
    const started = this.#now();
    let changed = false;
    if (this.#restartAt !== null && started >= this.#restartAt) {
      this.#restart();
      changed = true;
    }
    const run = this.#current;
    for (let budget = this.#options.maxStepsPerFrame; run !== null && run.session !== null && !run.done && budget > 0; budget--) {
      if (budget < this.#options.maxStepsPerFrame && this.#now() - started >= this.#options.budget) break;
      try {
        run.advance(stepSeconds(run.spec));
      } catch {
        this.#failed = true;
        this.#dropAll();
        this.#emit();
        return;
      }
      changed = true;
    }
    if (run !== null && run.done && !(run.spec.loop && run.target < this.cycleLimit * cycleSteps(run.spec))) run.release();
    if (run?.done && this.#previous !== null) {
      this.#previous.release();
      this.#previous = null;
    }
    if (this.#hasWork()) this.#schedule();
    if (changed) this.#emit();
  }

  #hasWork() {
    if (this.#restartAt !== null) return true;
    const run = this.#current;
    return run !== null && run.session !== null && !run.done;
  }

  #emit() {
    this.#emitter.emit('update');
  }
}
