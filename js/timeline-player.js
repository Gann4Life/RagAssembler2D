import { Emitter } from '../lib/emitter.js';

/**
 * @typedef {object} PlayerClock
 * @property {(callback: (timestamp: number) => void) => number} request Schedules one frame; the callback gets a
 *   timestamp in milliseconds.
 * @property {(handle: number) => void} cancel Cancels a scheduled frame.
 */

/**
 * Advances the playhead of the open clip in real time while in Animate mode. The playhead stays editor state held
 * by `modes`; consumers read `modes.playhead` and listen to its `playhead` event. Never touches the model.
 * Events: `playing` with the new `boolean`.
 */
export class TimelinePlayer {
  #model;
  #modes;
  #clock;
  #emitter = new Emitter();
  #playing = false;
  #handle = null;
  #last = null;

  /**
   * @param {import('./model/model.js').Model} model Document model, read for clip `length` and `loop`.
   * @param {import('./modes.js').Modes} modes Editor modes holding the open clip and the playhead.
   * @param {PlayerClock} clock Frame scheduler, `requestAnimationFrame` in the browser.
   */
  constructor(model, modes, clock) {
    this.#model = model;
    this.#modes = modes;
    this.#clock = clock;
    modes.on('mode', () => {
      if (this.#playing && !this.canPlay()) this.pause();
    });
    model.on('reset', () => this.pause());
  }

  /** @returns {boolean} Whether the playhead is advancing. */
  get playing() {
    return this.#playing;
  }

  /** @returns {boolean} Whether a clip is open in Animate mode. */
  canPlay() {
    return this.#modes.mode === 'animate' && this.#modes.clip !== null;
  }

  /**
   * Starts advancing the playhead from its current time; a non-looping clip at its end restarts from 0.
   * @returns {boolean} `false` when nothing can play.
   */
  play() {
    if (!this.canPlay()) return false;
    if (this.#playing) return true;
    const { clip, playhead } = this.#modes;
    if (this.#model.prop(clip, 'loop') !== true && playhead >= this.#model.prop(clip, 'length')) this.#modes.setPlayhead(0);
    this.#playing = true;
    this.#last = null;
    this.#schedule();
    this.#emitter.emit('playing', true);
    return true;
  }

  /** Stops advancing; the playhead stays where it is. */
  pause() {
    if (!this.#playing) return;
    this.#playing = false;
    if (this.#handle !== null) this.#clock.cancel(this.#handle);
    this.#handle = null;
    this.#emitter.emit('playing', false);
  }

  /**
   * Plays when paused, pauses when playing.
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
   * @param {'playing'} type Event name.
   * @param {(playing: boolean) => void} fn Listener.
   * @returns {() => void} Unsubscribe function.
   */
  on(type, fn) {
    return this.#emitter.on(type, fn);
  }

  #schedule() {
    this.#handle = this.#clock.request((timestamp) => this.#frame(timestamp));
  }

  #frame(timestamp) {
    this.#handle = null;
    if (!this.#playing) return;
    if (!this.canPlay()) {
      this.pause();
      return;
    }
    const elapsed = this.#last === null ? 0 : Math.max(0, (timestamp - this.#last) / 1000);
    this.#last = timestamp;
    const { clip, playhead } = this.#modes;
    const length = this.#model.prop(clip, 'length');
    const looping = this.#model.prop(clip, 'loop') === true;
    let next = playhead + elapsed;
    let finished = false;
    if (next >= length) {
      if (looping) next %= length;
      else {
        next = length;
        finished = true;
      }
    }
    if (next !== playhead) this.#modes.setPlayhead(next);
    if (finished) {
      this.pause();
      return;
    }
    this.#schedule();
  }
}
