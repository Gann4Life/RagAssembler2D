import { Emitter } from '../lib/emitter.js';
import { toJson } from './model/io.js';
import { ghostTimes, keyTimes } from './model/key-times.js';

/**
 * @typedef {object} PlayerClock
 * @property {(callback: (timestamp: number) => void) => number} request Schedules one frame; the callback gets a
 *   timestamp in milliseconds.
 * @property {(handle: number) => void} cancel Cancels a scheduled frame.
 * @property {() => number} [now] Current time in milliseconds, `performance.now` in the browser.
 */

/**
 * Live physics run of a document.
 * @typedef {object} SimulationSession
 * @property {(dt: number) => void} step Advances the clips and the world by `dt` seconds.
 * @property {() => Map<string, import('../lib/geometry.js').Transform>} pose Body id → root-local transform,
 *   meters and radians.
 * @property {() => void} destroy Releases every native object; idempotent.
 */

/**
 * Starts a simulation of a `.rag.json` document playing the clip with key `clip` (none when `null`), spawned in the
 * pose of clip `pose` at time 0 (the rest pose when `null` or omitted).
 * @typedef {(json: object, options: { clip: string|null, pose?: string|null }) => SimulationSession} Simulator
 */

/**
 * A pose read from the clip simulation.
 * @typedef {object} ClipRunPose
 * @property {Map<string, import('../lib/geometry.js').Transform>} pose Root-local transforms by body id.
 * @property {number} run Id of the run.
 * @property {number} step Step of the run.
 * @property {boolean} exact Whether it is the step asked for.
 */

/**
 * The clip simulation the player drives in Animate mode; `js/physics/clip-simulation.js` conforms to it.
 * @typedef {object} ClipSimulationService
 * @property {number} cycleLimit Most cycles a looping clip is run.
 * @property {boolean} available Whether a clip is open and its document could be simulated.
 * @property {(spec: object) => void} open Starts a run of a clip now.
 * @property {(spec: object) => void} change Restarts the run after a committed change, debounced.
 * @property {() => void} close Drops every run.
 * @property {(cycle: number) => void} setCycle Moves the horizon with the playhead cycle.
 * @property {(cycle: number, t: number) => number} stepOf Run step of a playhead time.
 * @property {(cycle: number, t: number) => ClipRunPose|null} pose Main figure pose at a playhead time.
 * @property {(cycle: number, t: number) => ClipRunPose|null} ghostPose Ghost pose at a playhead time, from the same run.
 * @property {(cycle: number, t: number) => boolean} upToDate Whether a run started after the last change reached the
 *   playhead's step.
 * @property {() => { current: number|null, previous: number|null, pending: boolean }} progress Run time reached,
 *   clip seconds from the start of cycle 1.
 * @property {(type: 'update', fn: () => void) => () => void} on Subscribes to updates.
 */

/**
 * Main figure of the Animate view read from the clip simulation.
 * @typedef {object} FigurePose
 * @property {Map<number, import('../lib/geometry.js').Transform>} pose Root-local transforms by body uid.
 * @property {string} source Run and kind of step shown (`<run>:at` or `<run>:latest`); a change of source without a
 *   user move of the playhead is blended.
 */

/**
 * One ghost of the open clip.
 * @typedef {object} Ghost
 * @property {number} t Key time, seconds.
 * @property {'ahead'|'behind'} side After or before the playhead.
 * @property {Map<number, import('../lib/geometry.js').Transform>} pose Root-local transforms by body uid.
 * @property {string} key Changes whenever the drawing changes.
 */

/**
 * Clip simulation progress in the playhead cycle, clip seconds.
 * @typedef {object} PlayerProgress
 * @property {number|null} current Time the current run reached, within `[0, length]`.
 * @property {number|null} previous Time the previous run reached, within `[0, length]`.
 * @property {boolean} pending Whether a run is still computing or waiting to restart.
 * @property {number} cycle Playhead cycle.
 * @property {boolean} loop Whether the open clip loops.
 */

/**
 * Fixed physics step, seconds.
 * @type {number}
 */
export const SIMULATE_STEP = 1 / 60;

/**
 * Most physics steps Simulate mode runs in one frame; the rest of a long frame is dropped.
 * @type {number}
 */
export const SIMULATE_MAX_STEPS = 4;

/**
 * Longest frame Animate playback advances by, seconds; a longer frame advances by this much.
 * @type {number}
 */
export const ANIMATE_MAX_FRAME = 0.1;

/**
 * Cycle limit used without a clip simulation.
 * @type {number}
 */
export const CYCLE_LIMIT = 8;

const PREVIEW_VERSION = 'preview';
const STEP_EPSILON = 1e-9;
const UID_CACHE_SIZE = 64;
const ERRORS_STATUS = 'Clip simulation: fix the errors in Problems';

/**
 * Playback and the playhead cycle (`DESIGN.md` §5.1, §5.3, §5.8). In Animate mode Play moves the playhead in real
 * time at the clip's speed without leaving the mode; a looping clip wraps into the next cycle up to the cycle limit.
 * The player feeds the open clip to the {@link ClipSimulationService} (opened with the clip, restarted after every
 * committed document change, dropped on leaving Animate) and keeps the posed hold of a Pose release until the clip
 * simulation is up to date at the playhead. Simulate mode is a live run started by Play in Edit mode or by
 * `simulate()`; Stop ends it and restores the mode before it. Never changes the model. Events: `playing` (boolean),
 * `cycle` (number), `progress` (no payload), and `view` (`{ instant }`) whenever what the viewport shows may change,
 * `instant` being `true` when the user moved the playhead or the mode or clip changed.
 */
export class TimelinePlayer {
  #model;
  #modes;
  #history;
  #clock;
  #simulator;
  #clips;
  #status;
  #emitter = new Emitter();
  #session = null;
  #liveClip = null;
  #liveSteps = 0;
  #livePose = null;
  #accumulated = 0;
  #playing = false;
  #handle = null;
  #last = null;
  #cycle = 1;
  #origin = null;
  #hold = null;
  #open = null;
  #uncommitted = false;
  #moving = false;
  #available = false;
  #uidCache = new Map();

  /**
   * @param {object} options
   * @param {import('./model/model.js').Model} options.model Document model, read only.
   * @param {import('./modes.js').Modes} options.modes Editor modes holding the open clip and the playhead.
   * @param {PlayerClock} options.clock Frame scheduler, `requestAnimationFrame` in the browser.
   * @param {import('./commands/history.js').History|null} [options.history] Command stack; a change made during a
   *   gesture counts as committed when the gesture closes. Without it every change is committed at once.
   * @param {Simulator|null} [options.simulator] Starts Simulate runs; without one Simulate cannot start.
   * @param {ClipSimulationService|null} [options.clipSimulation] Clip simulation of Animate mode; without one Animate
   *   shows the FK pose.
   * @param {(text: string) => void} [options.status] Shows a status line message.
   */
  constructor({ model, modes, clock, history = null, simulator = null, clipSimulation = null, status = () => {} }) {
    this.#model = model;
    this.#modes = modes;
    this.#history = history;
    this.#clock = clock;
    this.#simulator = simulator;
    this.#clips = clipSimulation;
    this.#status = status;
    modes.on('mode', ({ mode, clip }) => this.#onMode(mode, clip));
    modes.on('playhead', () => {
      if (!this.#moving) this.#emitView(true);
    });
    model.on('change', () => this.#onChange());
    history?.on('history', (state) => {
      if (!state.gesture && this.#uncommitted) this.#commit();
    });
    clipSimulation?.on('update', () => this.#onSimulation());
    this.#onMode(modes.mode, modes.clip);
  }

  /** @returns {boolean} Whether the playhead or the live simulation is advancing. */
  get playing() {
    return this.#playing;
  }

  /** @returns {boolean} Whether a live simulation exists (Simulate mode, playing or paused). */
  get simulating() {
    return this.#session !== null;
  }

  /** @returns {number} Playhead cycle, 1 when a clip opens. */
  get cycle() {
    return this.#cycle;
  }

  /** @returns {number} Most cycles of a looping clip. */
  get cycleLimit() {
    return this.#clips?.cycleLimit ?? CYCLE_LIMIT;
  }

  /** @returns {boolean} Whether a posed hold is shown. */
  get holding() {
    return this.#hold !== null;
  }

  /** @returns {Map<number, import('../lib/geometry.js').Transform>|null} Released bodies of the posed hold, by uid. */
  get heldPose() {
    return this.#hold;
  }

  /** @returns {boolean} Whether Animate mode shows the clip simulation (a clip is open and it can be simulated). */
  get simulationAvailable() {
    return this.#open !== null && this.#clips !== null && this.#clips.available;
  }

  /** @returns {Map<number, import('../lib/geometry.js').Transform>|null} Live simulation pose by uid in Simulate mode. */
  get livePose() {
    return this.#session === null ? null : this.#livePose;
  }

  /** @returns {boolean} Whether Play/Pause can toggle. */
  canPlay() {
    if (this.#session !== null) return true;
    if (this.#modes.mode === 'edit') return this.#simulator !== null && this.#modes.can('play');
    return this.#modes.mode === 'animate' && this.#modes.clip !== null;
  }

  /** @returns {boolean} Whether Stop acts: in Simulate mode, or while playing in Animate mode. */
  canStop() {
    return this.#session !== null || (this.#animating() && this.#playing);
  }

  /** @returns {boolean} Whether Next frame acts. */
  canNextFrame() {
    if (this.#session !== null) return true;
    return this.#animating() && !this.#atEnd();
  }

  /**
   * Plays: resumes a paused Simulate run, starts Simulate from Edit mode, or plays the open clip in Animate mode from
   * the playhead (from the start when a non-looping clip is at `length`, or a looping clip at `length` of the cycle
   * limit).
   * @returns {boolean} `false` when nothing can play.
   * @throws {Error} When the simulator fails starting Simulate (for example on validation errors); the mode is
   *   unchanged.
   */
  play() {
    if (this.#session !== null) {
      this.#setPlaying(true);
      return true;
    }
    if (this.#modes.mode === 'edit') return this.simulate();
    if (!this.#animating()) return false;
    if (this.#playing) return true;
    if (this.#atEnd()) {
      this.#moveTo(1, 0);
      this.#emitView(true);
    }
    this.#origin = { cycle: this.#cycle, t: this.#modes.playhead };
    this.#setPlaying(true);
    return true;
  }

  /** Stops advancing; the playhead and the figure stay as shown, and the mode does not change. */
  pause() {
    this.#setPlaying(false);
  }

  /**
   * Pauses, and in Animate mode puts the playhead at the time of the clip simulation step shown there, so a key
   * written next matches the displayed bodies.
   * @returns {void}
   */
  pauseAtStep() {
    const wasPlaying = this.#playing;
    this.pause();
    if (!wasPlaying || !this.#animating() || !this.simulationAvailable) return;
    const shown = this.#clips.pose(this.#cycle, this.#modes.playhead);
    if (shown === null || !shown.exact) return;
    const t = shown.step * this.#stepSeconds() - this.#cycleOffset();
    this.#moveTo(this.#cycle, Math.min(Math.max(t, 0), this.#length()));
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
   * Pauses and advances one fixed step: the live run in Simulate mode, or the playhead in Animate mode (1/60 s ×
   * `speed`; a looping clip at `length` wraps to one step into the next cycle).
   * @returns {boolean} `false` when Next frame cannot act.
   */
  nextFrame() {
    if (this.#session !== null) {
      this.pause();
      this.#advanceLive(1);
      return true;
    }
    if (!this.canNextFrame()) return false;
    this.pause();
    this.#endHold(false);
    const length = this.#length();
    const step = this.#stepSeconds();
    const t = this.#modes.playhead;
    if (this.#loop() && t >= length - STEP_EPSILON) this.#moveTo(this.#cycle + 1, Math.min(step, length));
    else this.#moveTo(this.#cycle, Math.min(t + step, length));
    this.#emitView(true);
    return true;
  }

  /**
   * Ends the Simulate run and restores the mode, clip and playhead active before it; in Animate mode, stops playback
   * and puts the playhead back where the last Play started, cycle included.
   * @returns {boolean} `false` when Stop cannot act.
   */
  stop() {
    if (this.#session !== null) {
      this.#teardownLive();
      this.#modes.stopSimulate();
      return true;
    }
    if (!this.canStop()) return false;
    this.pause();
    this.#endHold(false);
    if (this.#origin !== null) this.#moveTo(this.#origin.cycle, this.#origin.t);
    this.#emitView(true);
    return true;
  }

  /**
   * Moves the playhead within its cycle from the ruler (Animate mode only), pausing playback and ending a posed
   * hold; the view shows the new time at once.
   * @param {number} t Time in seconds, clamped to the open clip.
   * @returns {boolean} `false` outside Animate mode or without an open clip.
   */
  scrub(t) {
    if (!this.#animating()) return false;
    this.pause();
    this.#endHold(false);
    this.#moveTo(this.#cycle, t);
    this.#emitView(true);
    return true;
  }

  /**
   * Moves the playhead to another cycle at the same clip time, as a scrub (looping clip in Animate mode only).
   * @param {number} cycle Target cycle, clamped to 1 and the cycle limit.
   * @returns {boolean} `false` when the open clip does not loop or outside Animate mode.
   */
  setCycle(cycle) {
    if (!this.#animating() || !this.#loop()) return false;
    this.pause();
    this.#endHold(false);
    this.#moveTo(Math.min(Math.max(1, Math.round(cycle)), this.cycleLimit), this.#modes.playhead);
    this.#emitView(true);
    return true;
  }

  /**
   * Starts the live Simulate run: the rest pose from Edit mode, or the open clip from 0 from Animate mode, spawned as
   * the clip simulation spawns (the clip's pose at 0 for a looping clip), and plays it.
   * @returns {boolean} `false` when Simulate cannot start (no simulator, already simulating, or a mode without Play).
   * @throws {Error} When the simulator fails; the mode is unchanged.
   */
  simulate() {
    if (this.#session !== null || this.#simulator === null || !this.#modes.can('play')) return false;
    const clip = this.#modes.mode === 'animate' ? this.#modes.clip : null;
    const key = clip === null ? null : this.#model.prop(clip, 'key');
    const loop = clip !== null && this.#model.prop(clip, 'loop') === true;
    const session = this.#simulator(toJson(this.#model, PREVIEW_VERSION), { clip: key, pose: loop ? key : null });
    this.#liveClip = clip;
    this.#liveSteps = 0;
    this.#accumulated = 0;
    try {
      this.#modes.startSimulate();
      this.#session = session;
      if (clip !== null) this.#withMoving(() => this.#modes.setPlayhead(this.#liveClipTime()));
    } catch (error) {
      this.#session = null;
      session.destroy();
      throw error;
    }
    this.#readLive();
    this.#setPlaying(true);
    this.#emitView(true);
    return true;
  }

  /**
   * Shows released Pose bodies as the posed hold (Animate mode) until the clip simulation is up to date at the
   * playhead; then the view hands over to it.
   * @param {Map<number, import('../lib/geometry.js').Transform>} pose Root-local transforms by body uid.
   * @returns {void}
   */
  hold(pose) {
    if (!this.#animating() || !(pose instanceof Map)) return;
    this.#hold = pose;
    this.#emitView(false);
    this.#schedule();
  }

  /**
   * Main figure from the clip simulation at the playhead.
   * @returns {FigurePose|null} `null` when the clip simulation is not available.
   */
  figure() {
    if (!this.#animating() || !this.simulationAvailable) return null;
    const read = this.#clips.pose(this.#cycle, this.#modes.playhead);
    if (read === null) return null;
    return Object.freeze({ pose: this.#uidPose(read), source: `${read.run}:${read.exact ? 'at' : 'latest'}` });
  }

  /**
   * Ghosts of the open clip at its key times in the playhead cycle, from the run the main figure shows.
   * @returns {Ghost[]} Empty when the clip simulation is not available.
   */
  ghosts() {
    if (!this.#animating() || !this.simulationAvailable) return [];
    const times = keyTimes(this.#model, this.#open);
    const ghosts = [];
    for (const { t, side } of ghostTimes(times, this.#modes.playhead, (time) => this.#clips.stepOf(this.#cycle, time))) {
      const read = this.#clips.ghostPose(this.#cycle, t);
      if (read !== null) ghosts.push(Object.freeze({ t, side, pose: this.#uidPose(read), key: `${read.run}:${read.step}:${side}` }));
    }
    return ghosts;
  }

  /** @returns {PlayerProgress|null} Progress in the playhead cycle; `null` when the clip simulation is not available. */
  progress() {
    if (!this.#animating() || !this.simulationAvailable) return null;
    const { current, previous, pending } = this.#clips.progress();
    const length = this.#length();
    const offset = this.#cycleOffset();
    const within = (value) => (value === null ? null : Math.min(Math.max(value - offset, 0), length));
    return Object.freeze({ current: within(current), previous: within(previous), pending, cycle: this.#cycle, loop: this.#loop() });
  }

  /**
   * @param {'playing'|'cycle'|'progress'|'view'} type Event name.
   * @param {(payload: *) => void} fn Listener.
   * @returns {() => void} Unsubscribe function.
   */
  on(type, fn) {
    return this.#emitter.on(type, fn);
  }

  #animating() {
    return this.#modes.mode === 'animate' && this.#modes.clip !== null && this.#session === null;
  }

  #length() {
    const clip = this.#modes.clip;
    const length = clip === null ? 0 : this.#model.prop(clip, 'length');
    return Number.isFinite(length) && length > 0 ? length : 0;
  }

  #speed() {
    const clip = this.#modes.clip;
    const speed = clip === null ? 1 : (this.#model.prop(clip, 'speed') ?? 1);
    return Number.isFinite(speed) && speed > 0 ? speed : 1;
  }

  #loop() {
    const clip = this.#modes.clip;
    return clip !== null && this.#model.prop(clip, 'loop') === true;
  }

  #stepSeconds() {
    return SIMULATE_STEP * this.#speed();
  }

  #cycleOffset() {
    return this.#loop() ? (this.#cycle - 1) * this.#length() : 0;
  }

  #atEnd() {
    if (this.#modes.playhead < this.#length() - STEP_EPSILON) return false;
    return !this.#loop() || this.#cycle >= this.cycleLimit;
  }

  #spec(clip) {
    return Object.freeze({
      json: toJson(this.#model, PREVIEW_VERSION),
      clip: this.#model.prop(clip, 'key'),
      length: this.#length(),
      speed: this.#speed(),
      loop: this.#loop(),
    });
  }

  #withMoving(run) {
    const moving = this.#moving;
    this.#moving = true;
    try {
      run();
    } finally {
      this.#moving = moving;
    }
  }

  #moveTo(cycle, t) {
    if (cycle !== this.#cycle) {
      this.#cycle = cycle;
      this.#clips?.setCycle(cycle);
      this.#emitter.emit('cycle', cycle);
      this.#emitter.emit('progress');
    }
    this.#withMoving(() => this.#modes.setPlayhead(t));
  }

  #setPlaying(playing) {
    if (this.#playing === playing) return;
    this.#playing = playing;
    this.#last = null;
    if (playing) this.#schedule();
    else if (this.#hold === null) this.#cancel();
    this.#emitter.emit('playing', playing);
  }

  #onMode(mode, clip) {
    if (this.#session !== null && mode !== 'simulate') this.#teardownLive();
    if (mode === 'animate' && clip !== null) {
      if (this.#open !== clip) {
        this.#setPlaying(false);
        this.#hold = null;
        this.#origin = null;
        this.#uncommitted = false;
        this.#cycle = 1;
        this.#open = clip;
        this.#emitter.emit('cycle', 1);
        if (this.#clips !== null) {
          this.#clips.open(this.#spec(clip));
          this.#reportAvailability(true);
        }
      }
    } else if (this.#open !== null) {
      if (this.#session === null) this.#setPlaying(false);
      this.#hold = null;
      this.#origin = null;
      this.#open = null;
      this.#cycle = 1;
      this.#clips?.close();
      this.#available = false;
    }
    this.#emitter.emit('progress');
    this.#emitView(true);
  }

  #onChange() {
    if (this.#history?.inGesture) {
      this.#uncommitted = true;
      return;
    }
    this.#commit();
  }

  #commit() {
    this.#uncommitted = false;
    this.#uidCache.clear();
    if (!this.#animating() || this.#open !== this.#modes.clip) {
      this.#emitView(false);
      return;
    }
    if (!this.#loop() && this.#cycle !== 1) {
      this.#cycle = 1;
      this.#clips?.setCycle(1);
      this.#emitter.emit('cycle', 1);
    }
    this.#clips?.change(this.#spec(this.#open));
    this.#emitter.emit('progress');
    this.#emitView(false);
    this.#schedule();
  }

  #onSimulation() {
    this.#reportAvailability(false);
    this.#checkHold();
    this.#emitter.emit('progress');
    this.#emitView(false);
  }

  #reportAvailability(opening) {
    const available = this.simulationAvailable;
    if (!available && (opening || this.#available)) this.#status(ERRORS_STATUS);
    this.#available = available;
  }

  #checkHold() {
    if (this.#hold === null || this.#uncommitted || this.#history?.inGesture) return;
    if (this.simulationAvailable && !this.#clips.upToDate(this.#cycle, this.#modes.playhead)) return;
    this.#endHold(true);
  }

  #endHold(handover) {
    if (this.#hold === null) return;
    this.#hold = null;
    if (handover) this.#emitView(false);
  }

  #emitView(instant) {
    this.#emitter.emit('view', Object.freeze({ instant }));
  }

  #uidPose(read) {
    const key = `${read.run}:${read.step}`;
    const cached = this.#uidCache.get(key);
    if (cached !== undefined) return cached;
    const pose = new Map();
    for (const [id, transform] of read.pose) {
      const uid = this.#model.uidOf(id);
      if (uid !== null && uid !== undefined) pose.set(uid, transform);
    }
    if (this.#uidCache.size >= UID_CACHE_SIZE) this.#uidCache.clear();
    this.#uidCache.set(key, pose);
    return pose;
  }

  #schedule() {
    if (this.#handle === null) this.#handle = this.#clock.request((timestamp) => this.#frame(timestamp));
  }

  #cancel() {
    if (this.#handle !== null) this.#clock.cancel(this.#handle);
    this.#handle = null;
  }

  #frame(timestamp) {
    this.#handle = null;
    const elapsed = this.#last === null ? 0 : Math.max(0, (timestamp - this.#last) / 1000);
    this.#last = timestamp;
    if (this.#session !== null) {
      if (!this.#playing) return;
      this.#accumulated = Math.min(this.#accumulated + elapsed, SIMULATE_MAX_STEPS * SIMULATE_STEP);
      const steps = Math.floor(this.#accumulated / SIMULATE_STEP + STEP_EPSILON);
      this.#accumulated = Math.max(0, this.#accumulated - steps * SIMULATE_STEP);
      if (steps > 0) this.#advanceLive(steps);
    } else {
      this.#checkHold();
      if (this.#playing && this.#hold === null && this.#animating()) this.#advanceAnimate(Math.min(elapsed, ANIMATE_MAX_FRAME));
    }
    if (this.#playing || this.#hold !== null) this.#schedule();
  }

  #advanceAnimate(seconds) {
    if (seconds <= 0) return;
    const length = this.#length();
    let cycle = this.#cycle;
    let t = this.#modes.playhead + seconds * this.#speed();
    let stopped = false;
    if (t >= length) {
      if (!this.#loop() || length <= 0) {
        t = length;
        stopped = true;
      } else {
        while (t >= length && cycle < this.cycleLimit) {
          t -= length;
          cycle++;
        }
        if (t >= length) {
          t = length;
          stopped = true;
          this.#status(`Clip simulation: cycle limit ${this.cycleLimit} reached`);
        }
      }
    }
    this.#moveTo(cycle, t);
    if (stopped) this.pause();
    this.#emitView(false);
  }

  #advanceLive(steps) {
    for (let i = 0; i < steps; i++) this.#session.step(SIMULATE_STEP);
    this.#liveSteps += steps;
    if (this.#liveClip !== null && this.#modes.clip === this.#liveClip) {
      this.#withMoving(() => this.#modes.setPlayhead(this.#liveClipTime()));
    }
    this.#readLive();
    this.#emitView(false);
  }

  #liveClipTime() {
    const length = this.#model.prop(this.#liveClip, 'length');
    const speed = this.#model.prop(this.#liveClip, 'speed') ?? 1;
    const time = this.#liveSteps * SIMULATE_STEP * speed;
    if (!(length > 0)) return 0;
    return this.#model.prop(this.#liveClip, 'loop') === true ? time % length : Math.min(time, length);
  }

  #readLive() {
    const pose = new Map();
    for (const [id, transform] of this.#session.pose()) {
      const uid = this.#model.uidOf(id);
      if (uid !== null && uid !== undefined) pose.set(uid, transform);
    }
    this.#livePose = pose;
  }

  #teardownLive() {
    const session = this.#session;
    this.#session = null;
    this.#liveClip = null;
    this.#livePose = null;
    this.#setPlaying(false);
    session.destroy();
    this.#emitView(true);
  }
}
