import { ROOT_UID } from '../model/model.js';
import { setProps } from '../commands/props.js';
import { createClip } from '../commands/create.js';
import { deleteClip } from '../commands/delete.js';
import { SNAP_STEP, fractionOfTime, rulerTicks, snapTime, timeAtOffset } from '../timeline-time.js';

const REST_POSE = '';
const RULER_LABEL = 'Playhead';

/**
 * @typedef {object} Timeline
 * @property {() => void} destroy Removes listeners and the panel content.
 */

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(doc, label) {
  const node = element(doc, 'button', 'timeline-button', label);
  node.type = 'button';
  return node;
}

function clipLabel(model, uid) {
  const name = model.prop(uid, 'name');
  return typeof name === 'string' && name !== '' ? name : String(model.prop(uid, 'key'));
}

function formatSeconds(value) {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Mounts the Timeline panel into a dock panel element, replacing its content: a header with the clip selector,
 * New and Delete buttons, the length field and the loop toggle, then a ruler with the playhead. Clip edits run
 * as commands through `editor.history`; opening a clip and moving the playhead go through `editor.modes`.
 * @param {HTMLElement} element Panel element given by the dock.
 * @param {import('../editor.js').Editor} editor Editor core.
 * @param {import('../timeline-player.js').TimelinePlayer} player Playback driver behind the Play/Pause button.
 * @returns {Timeline}
 */
export function createTimeline(element_, editor, player) {
  const { model, history, modes } = editor;
  const doc = element_.ownerDocument;

  const header = element(doc, 'div', 'timeline-header');
  const select = element(doc, 'select', 'timeline-select');
  select.setAttribute('aria-label', 'Clip');
  const playButton = button(doc, 'Play');
  playButton.setAttribute('aria-label', 'Play');
  const newButton = button(doc, '+ New');
  newButton.setAttribute('aria-label', 'New clip');
  const deleteButton = button(doc, 'Delete');
  deleteButton.setAttribute('aria-label', 'Delete clip');
  const lengthLabel = element(doc, 'label', 'timeline-field');
  const lengthInput = element(doc, 'input', 'timeline-length');
  lengthInput.type = 'number';
  lengthInput.step = String(SNAP_STEP);
  lengthInput.min = String(SNAP_STEP);
  lengthInput.setAttribute('aria-label', 'Clip length in seconds');
  lengthLabel.append('length ', lengthInput, ' s');
  const loopLabel = element(doc, 'label', 'timeline-field');
  const loopInput = element(doc, 'input', 'timeline-loop');
  loopInput.type = 'checkbox';
  loopLabel.append(loopInput, ' loop');
  header.append(select, playButton, newButton, deleteButton, lengthLabel, loopLabel);

  const body = element(doc, 'div', 'timeline-body');
  const labels = element(doc, 'div', 'timeline-labels');
  const main = element(doc, 'div', 'timeline-main');
  const ruler = element(doc, 'div', 'timeline-ruler');
  ruler.tabIndex = 0;
  ruler.setAttribute('role', 'slider');
  ruler.setAttribute('aria-label', RULER_LABEL);
  ruler.setAttribute('aria-valuemin', '0');
  const ticks = element(doc, 'div', 'timeline-ticks');
  const playhead = element(doc, 'div', 'timeline-playhead');
  ruler.append(ticks, playhead);
  const lanes = element(doc, 'div', 'timeline-lanes');
  main.append(ruler, lanes);
  body.append(labels, main);

  element_.classList.add('timeline-panel');
  element_.replaceChildren(header, body);

  let signature = '';
  let scrubPointer = null;

  const canOpen = () => modes.can('clip.open') && !history.inGesture;
  const canEditClip = () => modes.clip !== null && modes.can('edit.animation') && !history.inGesture;
  const canScrub = () => modes.clip !== null && modes.can('timeline.scrub');

  function clipLength() {
    return modes.clip === null ? 0 : model.prop(modes.clip, 'length');
  }

  function renderOptions() {
    const clips = model.children(ROOT_UID, 'clips');
    const options = [{ value: REST_POSE, text: '(rest pose)' }].concat(
      clips.map((uid) => ({ value: String(uid), text: clipLabel(model, uid) })),
    );
    select.replaceChildren(
      ...options.map(({ value, text }) => {
        const option = element(doc, 'option', '', text);
        option.value = value;
        return option;
      }),
    );
  }

  function renderTicks(length) {
    ticks.replaceChildren(
      ...rulerTicks(length).map((time) => {
        const tick = element(doc, 'span', 'timeline-tick', formatSeconds(time));
        tick.style.left = `${fractionOfTime(time, length) * 100}%`;
        return tick;
      }),
    );
  }

  function renderPlayhead() {
    const length = clipLength();
    const open = modes.clip !== null;
    playhead.hidden = !open;
    playhead.style.left = `${fractionOfTime(modes.playhead, length) * 100}%`;
    ruler.setAttribute('aria-valuemax', String(length));
    ruler.setAttribute('aria-valuenow', String(modes.playhead));
    ruler.setAttribute('aria-valuetext', `${formatSeconds(modes.playhead)} s`);
    ruler.setAttribute('aria-disabled', String(!canScrub()));
  }

  function renderControls() {
    const open = modes.clip !== null;
    playButton.textContent = player.playing ? 'Pause' : 'Play';
    playButton.setAttribute('aria-label', playButton.textContent);
    playButton.setAttribute('aria-disabled', String(!player.canPlay()));
    select.disabled = !canOpen();
    for (const [node, enabled] of [[newButton, canOpen()], [deleteButton, canOpen() && open]]) {
      node.setAttribute('aria-disabled', String(!enabled));
    }
    const editable = canEditClip();
    lengthInput.disabled = !open;
    lengthInput.readOnly = !editable;
    loopInput.disabled = !open || !editable;
    if (doc.activeElement !== lengthInput) lengthInput.value = open ? formatSeconds(model.prop(modes.clip, 'length')) : '';
    loopInput.checked = open ? model.prop(modes.clip, 'loop') === true : false;
    select.value = open ? String(modes.clip) : REST_POSE;
  }

  function render() {
    const clips = model.children(ROOT_UID, 'clips');
    const open = modes.clip;
    const next = JSON.stringify([
      clips.map((uid) => [uid, clipLabel(model, uid)]),
      open,
      open === null ? 0 : model.prop(open, 'length'),
    ]);
    if (next !== signature) {
      signature = next;
      renderOptions();
      renderTicks(clipLength());
    }
    renderControls();
    renderPlayhead();
  }

  function togglePlay() {
    if (playButton.getAttribute('aria-disabled') === 'true') return;
    player.toggle();
  }

  function addClip() {
    if (newButton.getAttribute('aria-disabled') === 'true') return;
    const uid = history.execute(createClip());
    modes.openClip(uid);
  }

  function removeClip() {
    if (deleteButton.getAttribute('aria-disabled') === 'true' || modes.clip === null) return;
    history.execute(deleteClip(modes.clip));
  }

  function commitLength() {
    if (!canEditClip()) {
      render();
      return;
    }
    const value = Number(lengthInput.value);
    if (lengthInput.value.trim() === '' || !Number.isFinite(value) || value <= 0) {
      lengthInput.value = formatSeconds(model.prop(modes.clip, 'length'));
      return;
    }
    if (value !== model.prop(modes.clip, 'length')) history.execute(setProps([modes.clip], { length: value }, 'Set clip length'));
    lengthInput.value = formatSeconds(model.prop(modes.clip, 'length'));
  }

  function commitLoop() {
    if (!canEditClip()) {
      render();
      return;
    }
    history.execute(setProps([modes.clip], { loop: loopInput.checked }, 'Toggle clip loop'));
  }

  function scrubTo(event) {
    const rect = ruler.getBoundingClientRect();
    modes.setPlayhead(timeAtOffset(event.clientX - rect.left, rect.width, clipLength()));
  }

  const onSelect = () => {
    if (!canOpen()) {
      render();
      return;
    }
    modes.openClip(select.value === REST_POSE ? null : Number(select.value));
  };
  const onPointerDown = (event) => {
    if (event.button !== 0 || !canScrub()) return;
    scrubPointer = event.pointerId;
    ruler.setPointerCapture?.(event.pointerId);
    ruler.focus();
    scrubTo(event);
    event.preventDefault();
  };
  const onPointerMove = (event) => {
    if (scrubPointer !== event.pointerId || !canScrub()) return;
    scrubTo(event);
  };
  const onPointerEnd = (event) => {
    if (scrubPointer !== event.pointerId) return;
    scrubPointer = null;
    if (ruler.hasPointerCapture?.(event.pointerId)) ruler.releasePointerCapture(event.pointerId);
  };
  const onKeyDown = (event) => {
    if (!canScrub()) return;
    const length = clipLength();
    const targets = { ArrowLeft: modes.playhead - SNAP_STEP, ArrowRight: modes.playhead + SNAP_STEP, Home: 0, End: length };
    if (!(event.key in targets)) return;
    modes.setPlayhead(snapTime(targets[event.key], length));
    event.preventDefault();
  };
  const onLengthKey = (event) => {
    if (event.key === 'Enter') commitLength();
    else if (event.key === 'Escape') {
      lengthInput.value = formatSeconds(model.prop(modes.clip, 'length'));
      lengthInput.blur();
      event.stopPropagation();
    }
  };

  select.addEventListener('change', onSelect);
  playButton.addEventListener('click', togglePlay);
  newButton.addEventListener('click', addClip);
  deleteButton.addEventListener('click', removeClip);
  lengthInput.addEventListener('change', commitLength);
  lengthInput.addEventListener('keydown', onLengthKey);
  loopInput.addEventListener('change', commitLoop);
  ruler.addEventListener('pointerdown', onPointerDown);
  ruler.addEventListener('pointermove', onPointerMove);
  ruler.addEventListener('pointerup', onPointerEnd);
  ruler.addEventListener('pointercancel', onPointerEnd);
  ruler.addEventListener('keydown', onKeyDown);

  const unsubscribe = [
    model.on('change', render),
    model.on('reset', render),
    modes.on('mode', render),
    modes.on('playhead', renderPlayhead),
    player.on('playing', renderControls),
    history.on('history', renderControls),
  ];
  render();

  return {
    destroy() {
      for (const off of unsubscribe) off();
      element_.classList.remove('timeline-panel');
      element_.replaceChildren();
    },
  };
}
