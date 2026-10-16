import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History } from '../js/commands/history.js';
import { setProps } from '../js/commands/props.js';
import { Modes, MODE_POLICY } from '../js/modes.js';
import { defaultsOf } from '../lib/schema.js';

const DESIGN = readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8');
const ARCHITECTURE = readFileSync(new URL('../docs/architecture.md', import.meta.url), 'utf8');

function tableAfter(markdown, marker) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(marker));
  assert.ok(start >= 0, `marker ${marker} not found`);
  const header = lines.findIndex((line, index) => index > start && line.startsWith('|'));
  const rows = [];
  for (let index = header + 2; index < lines.length && lines[index].startsWith('|'); index++) {
    rows.push(lines[index].split('|').slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
}

const POLICY_ROW_OF = {
  select: 'Select, Select Box, Hierarchy selection',
  'tool.pose': 'Pose',
  'tool.circle': 'Creation tools: Circle, Box, Polygon, Hinge',
  'tool.box': 'Creation tools: Circle, Box, Polygon, Hinge',
  'tool.polygon': 'Creation tools: Circle, Box, Polygon, Hinge',
  'tool.hinge': 'Creation tools: Circle, Box, Polygon, Hinge',
  'edit.rest': 'Rest-pose and object edits',
  'edit.animation': 'Animation edits',
  'assets.import': 'Asset import',
  'assets.delete': 'Asset delete',
  'clip.open': 'Clip selector, New clip',
  'timeline.scrub': 'Scrub',
  'preview.stack': 'Preview stack',
  'preview.procedural': 'Procedural preview',
  file: 'New, Load, Save; Undo, Redo',
  history: 'New, Load, Save; Undo, Redo',
  play: 'Play',
  'simulate.control': 'Pause, Next frame, Stop',
  'settings.editor': 'Editor settings',
  layout: 'Editor settings',
  camera: 'Editor settings',
};

function setup() {
  const model = new Model();
  const history = new History(model);
  const modes = new Modes(model);
  const events = [];
  modes.on('mode', (payload) => events.push(['mode', payload]));
  modes.on('playhead', (payload) => events.push(['playhead', payload]));
  const addClip = (length = 2) => {
    const { tracks, events: clipEvents, ...props } = defaultsOf('clip');
    return history.execute({
      label: 'Add clip',
      run: (tx) => tx.add(ROOT_UID, 'clips', undefined, { type: 'clip', props: { ...props, length } }),
    });
  };
  return { model, history, modes, events, addClip };
}

test('MODE_POLICY rows map one-to-one to the DESIGN.md §5.1 policy table', () => {
  const rows = tableAfter(DESIGN, '**Mode policy.**');
  const covered = new Set();
  for (const [capability, policy] of Object.entries(MODE_POLICY)) {
    const label = POLICY_ROW_OF[capability];
    assert.ok(label, `${capability} has no DESIGN row`);
    const matches = rows.filter(([first]) => first === label || first.startsWith(`${label}:`) || first.startsWith(`${label} (`));
    assert.equal(matches.length, 1, `${capability} should match exactly one DESIGN row`);
    const [, edit, animate, simulate] = matches[0];
    const allowed = (cell) => cell.startsWith('✓');
    assert.deepEqual(policy, { edit: allowed(edit), animate: allowed(animate), simulate: allowed(simulate) }, capability);
    covered.add(matches[0][0]);
  }
  assert.deepEqual([...covered].sort(), rows.map(([first]) => first).sort());
  assert.ok(Object.isFrozen(MODE_POLICY));
  assert.ok(Object.values(MODE_POLICY).every((row) => Object.isFrozen(row)));
});

test('MODE_POLICY capabilities equal the docs/architecture.md capability table', () => {
  const rows = tableAfter(ARCHITECTURE, 'Its rows map one-to-one to the policy table');
  const capabilities = rows.flatMap(([first]) => [...first.matchAll(/`([^`]+)`/g)].map((match) => match[1]));
  assert.deepEqual(capabilities.sort(), Object.keys(MODE_POLICY).sort());
});

test('a new Modes is in Edit with no clip and the playhead at 0', () => {
  const { modes } = setup();
  assert.equal(modes.mode, 'edit');
  assert.equal(modes.clip, null);
  assert.equal(modes.playhead, 0);
});

test('can follows the policy of the current mode and rejects unknown capabilities', () => {
  const { modes, addClip } = setup();
  assert.equal(modes.can('tool.circle'), true);
  assert.equal(modes.can('edit.animation'), false);
  modes.openClip(addClip());
  assert.equal(modes.can('tool.circle'), false);
  assert.equal(modes.can('edit.animation'), true);
  modes.startSimulate();
  assert.equal(modes.can('history'), false);
  assert.equal(modes.can('simulate.control'), true);
  assert.throws(() => modes.can('fly'), /Unknown capability/);
  assert.throws(() => modes.can('toString'), /Unknown capability/);
});

test('openClip enters Animate, resets the playhead for another clip and is a no-op for the open one', () => {
  const { modes, events, addClip } = setup();
  const a = addClip(2);
  const b = addClip(3);
  modes.openClip(a);
  assert.deepEqual(events, [['mode', { mode: 'animate', previous: 'edit', clip: a }]]);
  modes.setPlayhead(1.5);
  events.length = 0;
  modes.openClip(a);
  assert.deepEqual(events, []);
  assert.equal(modes.playhead, 1.5);
  modes.openClip(b);
  assert.deepEqual(events, [
    ['mode', { mode: 'animate', previous: 'animate', clip: b }],
    ['playhead', { time: 0 }],
  ]);
  events.length = 0;
  modes.setPlayhead(1);
  modes.openClip(null);
  assert.deepEqual(events, [
    ['playhead', { time: 1 }],
    ['mode', { mode: 'edit', previous: 'animate', clip: null }],
    ['playhead', { time: 0 }],
  ]);
  events.length = 0;
  modes.openClip(null);
  assert.deepEqual(events, []);
});

test('openClip throws for non-clips and in Simulate', () => {
  const { modes, addClip } = setup();
  assert.throws(() => modes.openClip(ROOT_UID), /not a clip/);
  assert.throws(() => modes.openClip(9999), /not a clip/);
  const clip = addClip();
  modes.startSimulate();
  assert.throws(() => modes.openClip(clip), /Simulate/);
  assert.throws(() => modes.openClip(null), /Simulate/);
});

test('setPlayhead clamps to the clip length and throws in Edit or for non-finite times', () => {
  const { modes, events, addClip } = setup();
  assert.throws(() => modes.setPlayhead(1), /Edit/);
  modes.openClip(addClip(2));
  events.length = 0;
  modes.setPlayhead(5);
  assert.equal(modes.playhead, 2);
  modes.setPlayhead(-1);
  assert.equal(modes.playhead, 0);
  modes.setPlayhead(0);
  assert.deepEqual(events, [
    ['playhead', { time: 2 }],
    ['playhead', { time: 0 }],
  ]);
  assert.throws(() => modes.setPlayhead(Number.NaN), TypeError);
  assert.throws(() => modes.setPlayhead('1'), TypeError);
});

test('Simulate stores and restores the mode, clip and playhead', () => {
  const { modes, events, addClip } = setup();
  assert.throws(() => modes.stopSimulate(), /Not in Simulate/);
  const clip = addClip(2);
  modes.openClip(clip);
  modes.setPlayhead(1.25);
  events.length = 0;
  modes.startSimulate();
  assert.deepEqual(events, [['mode', { mode: 'simulate', previous: 'animate', clip }]]);
  assert.throws(() => modes.startSimulate(), /Already/);
  modes.setPlayhead(1.75);
  events.length = 0;
  modes.stopSimulate();
  assert.deepEqual(events, [
    ['mode', { mode: 'animate', previous: 'simulate', clip }],
    ['playhead', { time: 1.25 }],
  ]);
  modes.openClip(null);
  modes.startSimulate();
  assert.equal(modes.clip, null);
  modes.setPlayhead(3);
  assert.equal(modes.playhead, 0);
  modes.stopSimulate();
  assert.equal(modes.mode, 'edit');
});

test('removing the open clip returns to Edit, also through undo', () => {
  const { history, modes, events, addClip } = setup();
  const clip = addClip(2);
  modes.openClip(clip);
  modes.setPlayhead(1);
  events.length = 0;
  history.undo();
  assert.deepEqual(events, [
    ['mode', { mode: 'edit', previous: 'animate', clip: null }],
    ['playhead', { time: 0 }],
  ]);
  history.redo();
  assert.equal(modes.mode, 'edit');
});

test('removing the open clip in Simulate makes Stop return to Edit', () => {
  const { history, modes, events, addClip } = setup();
  const clip = addClip(2);
  modes.openClip(clip);
  modes.setPlayhead(1);
  modes.startSimulate();
  events.length = 0;
  history.undo();
  assert.deepEqual(events, [['mode', { mode: 'simulate', previous: 'simulate', clip: null }]]);
  modes.stopSimulate();
  assert.equal(modes.mode, 'edit');
  assert.equal(modes.clip, null);
  assert.equal(modes.playhead, 0);
});

test('changing the open clip length re-clamps the playhead', () => {
  const { history, modes, events, addClip } = setup();
  const clip = addClip(2);
  const other = addClip(5);
  modes.openClip(clip);
  modes.setPlayhead(1.5);
  events.length = 0;
  history.execute(setProps([other], { length: 0.5 }));
  history.execute(setProps([clip], { length: 3 }));
  assert.deepEqual(events, []);
  history.execute(setProps([clip], { length: 1 }));
  assert.deepEqual(events, [['playhead', { time: 1 }]]);
  assert.equal(modes.playhead, 1);
});

test('reset returns to Edit from any mode and drops the stored state', () => {
  for (const enterSimulate of [false, true]) {
    const { model, modes, events, addClip } = setup();
    modes.openClip(addClip(2));
    modes.setPlayhead(1);
    if (enterSimulate) modes.startSimulate();
    events.length = 0;
    model.reset({ type: 'root', props: model.get(ROOT_UID).props }, 'new');
    assert.deepEqual(events, [
      ['mode', { mode: 'edit', previous: enterSimulate ? 'simulate' : 'animate', clip: null }],
      ['playhead', { time: 0 }],
    ]);
    assert.throws(() => modes.stopSimulate(), /Not in Simulate/);
  }
});

test('a throwing mode listener still lets the playhead event fire before rethrowing', () => {
  const { modes, events, addClip } = setup();
  const clip = addClip(2);
  modes.openClip(clip);
  modes.setPlayhead(1);
  const failure = new Error('listener');
  modes.on('mode', () => {
    throw failure;
  });
  events.length = 0;
  assert.throws(() => modes.openClip(null), (error) => error === failure);
  assert.equal(events.at(-1)[0], 'playhead');
  assert.equal(modes.mode, 'edit');
});
