import { Emitter } from '../lib/emitter.js';

/**
 * @typedef {'edit'|'animate'|'simulate'} Mode
 */

/**
 * Capability checked against the mode policy (`DESIGN.md` §5.1).
 * @typedef {'select'|'tool.pose'|'tool.circle'|'tool.box'|'tool.polygon'|'tool.hinge'
 *   |'edit.rest'|'edit.animation'|'assets.import'|'assets.delete'|'clip.open'|'timeline.scrub'
 *   |'preview.stack'|'preview.procedural'|'file'|'history'|'play'|'simulate.control'
 *   |'settings.editor'|'layout'|'camera'} Capability
 */

function allowed(edit, animate, simulate) {
  return Object.freeze({ edit, animate, simulate });
}

/**
 * What each mode allows, one row per capability, mapped to the `DESIGN.md` §5.1 policy table.
 * @type {Readonly<Object<Capability, Readonly<{ edit: boolean, animate: boolean, simulate: boolean }>>>}
 */
export const MODE_POLICY = Object.freeze({
  select: allowed(true, true, true),
  'tool.pose': allowed(true, true, false),
  'tool.circle': allowed(true, false, false),
  'tool.box': allowed(true, false, false),
  'tool.polygon': allowed(true, false, false),
  'tool.hinge': allowed(true, false, false),
  'edit.rest': allowed(true, false, false),
  'edit.animation': allowed(false, true, false),
  'assets.import': allowed(true, true, false),
  'assets.delete': allowed(true, false, false),
  'clip.open': allowed(true, true, false),
  'timeline.scrub': allowed(false, true, false),
  'preview.stack': allowed(false, true, true),
  'preview.procedural': allowed(false, false, true),
  file: allowed(true, true, false),
  history: allowed(true, true, false),
  play: allowed(true, true, false),
  'simulate.control': allowed(false, false, true),
  'settings.editor': allowed(true, true, true),
  layout: allowed(true, true, true),
  camera: allowed(true, true, true),
});

function lengthOf(model, clip) {
  if (clip === null) return 0;
  const length = model.prop(clip, 'length');
  return Number.isFinite(length) && length > 0 ? length : 0;
}

/**
 * Editor mode, open clip and playhead (`DESIGN.md` §5.1). Not undoable. Emits `mode`
 * (`{ mode, previous, clip }`) when the mode or open clip changes, then `playhead` (`{ time }`, seconds)
 * when the playhead moved.
 */
export class Modes {
  #model;
  #emitter = new Emitter();
  #mode = 'edit';
  #clip = null;
  #playhead = 0;
  #stored = null;

  /**
   * Starts in Edit mode with no open clip and subscribes to the model's `change` and `reset` events.
   * @param {import('./model/model.js').Model} model Document model.
   */
  constructor(model) {
    this.#model = model;
    model.on('change', ({ changes }) => this.#onChange(changes));
    model.on('reset', () => {
      this.#stored = null;
      this.#update('edit', null, 0);
    });
  }

  /**
   * Current mode.
   * @returns {Mode}
   */
  get mode() {
    return this.#mode;
  }

  /**
   * Uid of the open clip, or `null`.
   * @returns {number|null}
   */
  get clip() {
    return this.#clip;
  }

  /**
   * Playhead time in seconds.
   * @returns {number}
   */
  get playhead() {
    return this.#playhead;
  }

  /**
   * Whether the current mode allows a capability.
   * @param {Capability} capability Policy row.
   * @returns {boolean}
   * @throws {Error} When the capability is unknown.
   */
  can(capability) {
    const row = Object.hasOwn(MODE_POLICY, capability) ? MODE_POLICY[capability] : null;
    if (!row) throw new Error(`Unknown capability "${capability}"`);
    return row[this.#mode];
  }

  /**
   * Opens a clip in Animate mode (playhead at 0 when it is a different clip), or returns to Edit with `null`.
   * Opening the open clip again does nothing.
   * @param {number|null} uid Clip uid, or `null` for the rest pose.
   * @returns {void}
   * @throws {Error} In Simulate mode, or when the uid is not a clip.
   */
  openClip(uid) {
    if (this.#mode === 'simulate') throw new Error('Clips cannot be opened in Simulate mode');
    if (uid === null) {
      this.#update('edit', null, 0);
      return;
    }
    if (this.#model.get(uid)?.type !== 'clip') throw new Error(`Node ${uid} is not a clip`);
    if (uid === this.#clip) return;
    this.#update('animate', uid, 0);
  }

  /**
   * Moves the playhead, clamped to `[0, length]` of the open clip (`0` without one).
   * @param {number} t Time in seconds.
   * @returns {void}
   * @throws {Error} In Edit mode.
   * @throws {TypeError} When `t` is not a finite number.
   */
  setPlayhead(t) {
    if (this.#mode === 'edit') throw new Error('The playhead cannot move in Edit mode');
    if (!Number.isFinite(t)) throw new TypeError(`Playhead time must be a finite number, got ${t}`);
    this.#update(this.#mode, this.#clip, this.#clamp(t, this.#clip));
  }

  /**
   * Stores the mode, clip and playhead and enters Simulate mode, keeping the open clip.
   * @returns {void}
   * @throws {Error} When already in Simulate mode.
   */
  startSimulate() {
    if (this.#mode === 'simulate') throw new Error('Already in Simulate mode');
    this.#stored = { mode: this.#mode, clip: this.#clip, playhead: this.#playhead };
    this.#update('simulate', this.#clip, this.#playhead);
  }

  /**
   * Leaves Simulate mode, restoring the stored mode, clip and playhead.
   * @returns {void}
   * @throws {Error} When not in Simulate mode.
   */
  stopSimulate() {
    if (this.#mode !== 'simulate') throw new Error('Not in Simulate mode');
    const { mode, clip, playhead } = this.#stored;
    this.#stored = null;
    this.#update(mode, clip, this.#clamp(playhead, clip));
  }

  /**
   * Subscribes to `mode` or `playhead` events.
   * @param {'mode'|'playhead'} type Event type.
   * @param {(payload: object) => void} fn Listener.
   * @returns {() => void} Function that unsubscribes the listener.
   */
  on(type, fn) {
    return this.#emitter.on(type, fn);
  }

  /**
   * Unsubscribes a listener.
   * @param {'mode'|'playhead'} type Event type.
   * @param {(payload: object) => void} fn Listener.
   * @returns {void}
   */
  off(type, fn) {
    this.#emitter.off(type, fn);
  }

  #clamp(t, clip) {
    return Math.min(Math.max(t, 0), lengthOf(this.#model, clip));
  }

  #onChange(changes) {
    if (this.#clip === null) return;
    const clip = this.#clip;
    if (changes.some((change) => change.kind === 'remove' && change.uid === clip)) {
      if (this.#mode === 'simulate') {
        this.#stored = { mode: 'edit', clip: null, playhead: 0 };
        this.#update('simulate', null, this.#playhead);
      } else {
        this.#update('edit', null, 0);
      }
      return;
    }
    if (changes.some((change) => change.kind === 'set' && change.uid === clip && change.path === 'length')) {
      this.#update(this.#mode, clip, this.#clamp(this.#playhead, clip));
    }
  }

  #update(mode, clip, playhead) {
    const previous = this.#mode;
    const modeChanged = mode !== this.#mode || clip !== this.#clip;
    const playheadChanged = !Object.is(playhead, this.#playhead);
    this.#mode = mode;
    this.#clip = clip;
    this.#playhead = playhead;
    const modeFailure = modeChanged ? this.#emit('mode', Object.freeze({ mode, previous, clip })) : null;
    const playheadFailure = playheadChanged ? this.#emit('playhead', Object.freeze({ time: playhead })) : null;
    const failure = modeFailure ?? playheadFailure;
    if (failure) throw failure.error;
  }

  #emit(type, payload) {
    try {
      this.#emitter.emit(type, payload);
      return null;
    } catch (error) {
      return { error };
    }
  }
}
