import { ROOT_UID } from '../model/model.js';
import { setProps } from '../commands/props.js';
import { createClip } from '../commands/create.js';
import { deleteKeys, moveKeys, setClipLength } from '../commands/keys.js';
import { deleteClip } from '../commands/delete.js';
import { jointAngleRows } from '../timeline-rows.js';
import { SNAP_STEP, fractionOfTime, rulerTicks, snapTime, timeAtOffset } from '../timeline-time.js';

const REST_POSE = '';
const RULER_LABEL = 'Playhead';
const ONION_TITLE = 'Onion skins: ghosts of the nearest key times in Animate';
const GHOSTS_SETTING = 'display.ghosts';

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
 * New and Delete buttons, the length field, the loop toggle, the cycle control and the Onion skins toggle (the
 * `onion-skins` action, pressed while `display.ghosts` is on), then a ruler with the playhead. Clip edits run
 * as commands through `editor.history`; opening a clip and moving the playhead go through `editor.modes`.
 * @param {HTMLElement} element_ Panel element given by the dock.
 * @param {import('../editor.js').Editor} editor Editor core.
 * @param {import('../timeline-player.js').TimelinePlayer} player Playback driver behind the Play/Pause button.
 * @returns {Timeline}
 */
export function createTimeline(element_, editor, player) {
  const { model, history, modes, selection, settings } = editor;
  const doc = element_.ownerDocument;

  const header = element(doc, 'div', 'timeline-header');
  const select = element(doc, 'select', 'timeline-select');
  select.setAttribute('aria-label', 'Clip');
  const playButton = button(doc, 'Play');
  playButton.setAttribute('aria-label', 'Play');
  const renameButton = button(doc, 'Rename');
  renameButton.setAttribute('aria-label', 'Rename clip');
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
  const cycleGroup = element(doc, 'span', 'timeline-cycle');
  cycleGroup.setAttribute('role', 'group');
  const cyclePrev = button(doc, '‹');
  cyclePrev.setAttribute('aria-label', 'Previous cycle');
  const cycleLabel = element(doc, 'span', 'timeline-cycle-label');
  const cycleNext = button(doc, '›');
  cycleNext.setAttribute('aria-label', 'Next cycle');
  cycleGroup.append(cyclePrev, cycleLabel, cycleNext);
  const onionButton = button(doc, 'Onion skins');
  onionButton.setAttribute('aria-pressed', 'false');
  onionButton.title = ONION_TITLE;
  header.append(playButton, select, renameButton, newButton, deleteButton, lengthLabel, loopLabel, cycleGroup, onionButton);

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
  const progress = element(doc, 'div', 'timeline-progress');
  progress.setAttribute('aria-hidden', 'true');
  const progressCurrent = element(doc, 'div', 'timeline-progress-current');
  const progressPrevious = element(doc, 'div', 'timeline-progress-previous');
  progress.append(progressCurrent, progressPrevious);
  ruler.append(ticks, progress, playhead);
  const lanes = element(doc, 'div', 'timeline-lanes');
  main.append(ruler, lanes);
  body.append(labels, main);

  element_.classList.add('timeline-panel');
  element_.replaceChildren(header, body);

  let signature = '';
  let scrubPointer = null;
  let keyDrag = null;
  let nameField = null;

  const canOpen = () => modes.can('clip.open') && !history.inGesture;
  const canEditClip = () => modes.clip !== null && modes.can('edit.animation') && !history.inGesture;
  const canScrub = () => modes.mode === 'animate' && modes.clip !== null;
  const showsCycle = () => modes.mode === 'animate' && modes.clip !== null && model.prop(modes.clip, 'loop') === true;

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
    if (canScrub()) ruler.removeAttribute('title');
    else ruler.title = 'Scrub: only in Animate mode';
    renderProgress();
  }

  function renderProgress() {
    const state = player.progress();
    const length = clipLength();
    progress.hidden = state === null || !(length > 0);
    if (progress.hidden) {
      ruler.removeAttribute('aria-description');
      return;
    }
    const current = state.current ?? 0;
    const previous = Math.max(state.previous ?? 0, current);
    progressCurrent.style.width = `${fractionOfTime(current, length) * 100}%`;
    progressPrevious.style.left = `${fractionOfTime(current, length) * 100}%`;
    progressPrevious.style.width = `${(fractionOfTime(previous, length) - fractionOfTime(current, length)) * 100}%`;
    if (state.pending) {
      const where = state.loop ? `cycle ${state.cycle}, ${formatSeconds(current)} s` : `${formatSeconds(current)} s`;
      ruler.setAttribute('aria-description', `simulated to ${where}`);
    } else {
      ruler.removeAttribute('aria-description');
    }
  }

  function setReason(node, reason) {
    node.setAttribute('aria-disabled', String(reason !== null));
    if (reason === null) node.removeAttribute('title');
    else node.title = `${node.getAttribute('aria-label')}: ${reason}`;
  }

  function renderCycle() {
    cycleGroup.hidden = !showsCycle();
    const cycle = player.cycle;
    const limit = player.cycleLimit;
    cycleLabel.textContent = `cycle ${cycle}`;
    cycleGroup.setAttribute('aria-label', `Cycle ${cycle} of ${limit}`);
    setReason(cyclePrev, cycle <= 1 ? 'first cycle' : null);
    setReason(cycleNext, cycle >= limit ? 'cycle limit reached' : null);
  }

  function renderOnion() {
    onionButton.setAttribute('aria-pressed', String(settings.get(GHOSTS_SETTING) === true));
  }

  function renderControls() {
    const open = modes.clip !== null;
    renderOnion();
    playButton.textContent = player.playing ? 'Pause' : 'Play';
    playButton.setAttribute('aria-label', playButton.textContent);
    playButton.setAttribute('aria-disabled', String(!player.canPlay()));
    renderCycle();
    select.disabled = !canOpen();
    setReason(renameButton, renameReason());
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

  function renderRows(rows, length) {
    labels.replaceChildren(...rows.map((row) => element(doc, 'div', 'timeline-row-label', `${row.label} · angle`)));
    lanes.replaceChildren(
      ...rows.map((row) => {
        const lane = element(doc, 'div', 'timeline-lane');
        lane.append(
          ...row.keys.map((key) => {
            const diamond = element(doc, 'span', 'timeline-key');
            diamond.dataset.key = String(key.uid);
            diamond.dataset.time = String(key.t);
            diamond.style.left = `${fractionOfTime(key.t, length) * 100}%`;
            diamond.title = `${formatSeconds(key.t)} s`;
            diamond.classList.toggle('selected', selection.timeline.includes(key.uid));
            return diamond;
          }),
        );
        return lane;
      }),
    );
  }

  function renderKeySelection() {
    for (const diamond of lanes.querySelectorAll('.timeline-key')) {
      diamond.classList.toggle('selected', selection.timeline.includes(Number(diamond.dataset.key)));
    }
  }

  function render() {
    const clips = model.children(ROOT_UID, 'clips');
    const open = modes.clip;
    const rows = jointAngleRows(model, open);
    const next = JSON.stringify([
      clips.map((uid) => [uid, clipLabel(model, uid)]),
      open,
      open === null ? 0 : model.prop(open, 'length'),
      rows.map((row) => [row.joint, row.label, row.keys.map((key) => [key.uid, key.t])]),
    ]);
    if (next !== signature) {
      signature = next;
      renderOptions();
      renderTicks(clipLength());
      renderRows(rows, clipLength());
    }
    renderControls();
    renderPlayhead();
  }

  function togglePlay() {
    if (playButton.getAttribute('aria-disabled') === 'true') return;
    editor.actions.run('toggle-play');
  }

  function addClip() {
    if (newButton.getAttribute('aria-disabled') === 'true') return;
    const uid = history.execute(createClip());
    modes.openClip(uid);
  }

  function renameReason() {
    if (!modes.can('clip.rename')) return 'not available in this mode';
    if (history.inGesture) return 'finish the current gesture first';
    if (modes.clip === null) return 'open a clip';
    return null;
  }

  function closeNameField() {
    if (nameField === null) return;
    const field = nameField;
    nameField = null;
    field.remove();
    select.hidden = false;
    renameButton.focus();
  }

  function finishRename(commit) {
    if (nameField === null) return;
    const clip = modes.clip;
    const value = nameField.value.trim();
    if (!commit || clip === null || value === model.prop(clip, 'name')) {
      closeNameField();
      return;
    }
    if (value === '') {
      editor.status('Rename clip: the name cannot be empty');
      closeNameField();
      return;
    }
    closeNameField();
    history.execute(setProps([clip], { name: value }, 'Rename clip'));
  }

  function startRename() {
    if (nameField !== null) return;
    const reason = renameReason();
    if (reason !== null) {
      editor.status(`Rename clip: ${reason}`);
      return;
    }
    const field = element(doc, 'input', 'timeline-select timeline-rename');
    field.type = 'text';
    field.spellcheck = false;
    field.autocomplete = 'off';
    field.setAttribute('aria-label', 'Clip name');
    field.value = model.prop(modes.clip, 'name');
    field.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        finishRename(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finishRename(false);
      }
    });
    field.addEventListener('blur', () => finishRename(true));
    nameField = field;
    select.hidden = true;
    select.after(field);
    field.focus();
    field.select();
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
    if (value !== model.prop(modes.clip, 'length')) {
      const removed = history.execute(setClipLength(modes.clip, value));
      const count = removed.keys + removed.events;
      if (count > 0) editor.status(`Set clip length: removed ${removed.keys} key(s) and ${removed.events} event(s) beyond the new length`);
    }
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
    player.scrub(timeAtOffset(event.clientX - rect.left, rect.width, clipLength()));
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
    player.scrub(snapTime(targets[event.key], length));
    event.preventDefault();
  };
  function selectedDiamonds() {
    return [...lanes.querySelectorAll('.timeline-key.selected')];
  }

  function previewDrag(delta) {
    const length = clipLength();
    for (const diamond of selectedDiamonds()) {
      const t = snapTime(Number(diamond.dataset.time) + delta, length);
      diamond.style.left = `${fractionOfTime(t, length) * 100}%`;
    }
  }

  function dragDelta(event) {
    const rect = ruler.getBoundingClientRect();
    if (!(rect.width > 0)) return 0;
    const length = clipLength();
    const raw = ((event.clientX - keyDrag.startX) / rect.width) * length;
    const times = keyDrag.times;
    const limited = Math.min(Math.max(raw, -Math.min(...times)), length - Math.max(...times));
    return snapTime(keyDrag.anchor + limited, length) - keyDrag.anchor;
  }

  function endKeyDrag(event) {
    if (keyDrag === null || keyDrag.pointer !== event.pointerId) return;
    const drag = keyDrag;
    keyDrag = null;
    if (lanes.hasPointerCapture?.(event.pointerId)) lanes.releasePointerCapture(event.pointerId);
    const delta = event.type === 'pointerup' && canEditClip() ? drag.delta : 0;
    if (delta !== 0) history.execute(moveKeys(drag.keys, delta));
    else previewDrag(0);
    signature = '';
    render();
  }

  const onKeyPointerDown = (event) => {
    const diamond = event.target.closest?.('.timeline-key');
    if (event.button !== 0 || !diamond || keyDrag !== null) return;
    const uid = Number(diamond.dataset.key);
    if (!selection.timeline.includes(uid)) selection.set([uid]);
    lanes.focus();
    event.preventDefault();
    if (!canEditClip()) return;
    const keys = [...selection.timeline];
    const times = selectedDiamonds().map((node) => Number(node.dataset.time));
    keyDrag = { pointer: event.pointerId, startX: event.clientX, keys, times, anchor: Number(diamond.dataset.time), delta: 0 };
    lanes.setPointerCapture?.(event.pointerId);
  };
  const onKeyPointerMove = (event) => {
    if (keyDrag === null || keyDrag.pointer !== event.pointerId) return;
    keyDrag.delta = dragDelta(event);
    previewDrag(keyDrag.delta);
  };
  const onLanesKeyDown = (event) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (keyDrag !== null || !canEditClip() || selection.timeline.length === 0) return;
    history.execute(deleteKeys([...selection.timeline]));
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

  const stepCycle = (delta) => {
    const node = delta < 0 ? cyclePrev : cycleNext;
    if (node.getAttribute('aria-disabled') === 'true') return;
    player.setCycle(player.cycle + delta);
  };
  const onSettings = ({ key }) => {
    if (key === GHOSTS_SETTING) renderOnion();
  };
  onionButton.addEventListener('click', () => editor.actions.run('onion-skins'));
  cyclePrev.addEventListener('click', () => stepCycle(-1));
  cycleNext.addEventListener('click', () => stepCycle(1));
  select.addEventListener('change', onSelect);
  playButton.addEventListener('click', togglePlay);
  renameButton.addEventListener('click', startRename);
  select.addEventListener('dblclick', startRename);
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
  lanes.tabIndex = 0;
  lanes.addEventListener('pointerdown', onKeyPointerDown);
  lanes.addEventListener('pointermove', onKeyPointerMove);
  lanes.addEventListener('pointerup', endKeyDrag);
  lanes.addEventListener('pointercancel', endKeyDrag);
  lanes.addEventListener('keydown', onLanesKeyDown);

  const unsubscribe = [
    selection.on('selection', renderKeySelection),
    model.on('change', render),
    model.on('reset', render),
    modes.on('mode', render),
    modes.on('playhead', renderPlayhead),
    player.on('playing', renderControls),
    player.on('cycle', renderCycle),
    player.on('progress', renderProgress),
    history.on('history', renderControls),
    settings.on('settings', onSettings),
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
