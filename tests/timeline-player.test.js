import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { loadJson, saveJson, toJson } from '../js/model/io.js';
import { createClip, createShapeBody } from '../js/commands/create.js';
import { setProps } from '../js/commands/props.js';
import { setJointAngleKey } from '../js/commands/keys.js';
import { ClipSimulation } from '../js/physics/clip-simulation.js';
import { ANIMATE_MAX_FRAME, SIMULATE_MAX_STEPS, SIMULATE_STEP, TimelinePlayer } from '../js/timeline-player.js';

function fakeSimulator({ throws = () => false } = {}) {
  const sessions = [];
  const simulator = (json, options) => {
    if (throws(json, options)) throw new Error('invalid document');
    const session = {
      json,
      options,
      steps: 0,
      destroyed: false,
      step() {
        session.steps++;
      },
      pose() {
        const x = options.pose ? 1 : 0;
        return new Map(json.bodies.map((body) => [body.id, { x, y: 0 - session.steps, angle: 0 }]));
      },
      destroy() {
        session.destroyed = true;
      },
    };
    sessions.push(session);
    return session;
  };
  return { simulator, sessions };
}

function fakeClock() {
  const clock = {
    time: 0,
    frames: new Map(),
    next: 1,
    request(callback) {
      const handle = clock.next++;
      clock.frames.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      clock.frames.delete(handle);
    },
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
      const pending = [...clock.frames.values()];
      clock.frames.clear();
      for (const frame of pending) frame(clock.time);
    },
    settle(ms = 16, limit = 200) {
      for (let i = 0; i < limit && clock.frames.size > 0; i++) clock.advance(ms);
    },
  };
  return clock;
}

function setup({ length = 1, loop = false, speed = 1, clipThrows, history = true } = {}) {
  const editor = createEditor();
  editor.history.execute(createShapeBody({ position: { x: 0, y: 0 }, angle: 0, shape: { type: 'circle', radius: 0.5 } }));
  editor.history.execute(createShapeBody({ position: { x: 1, y: 0 }, angle: 0, shape: { type: 'circle', radius: 0.5 } }));
  const clip = editor.history.execute(createClip());
  editor.history.execute(setProps([clip], { length, loop, speed }));
  const clock = fakeClock();
  const live = fakeSimulator();
  const clipFake = fakeSimulator({ throws: clipThrows });
  const clipSimulation = new ClipSimulation(clipFake.simulator, clock);
  const statuses = [];
  const player = new TimelinePlayer({
    model: editor.model,
    modes: editor.modes,
    history: history ? editor.history : null,
    clock,
    simulator: live.simulator,
    clipSimulation,
    status: (text) => statuses.push(text),
  });
  const views = [];
  player.on('view', (view) => views.push(view.instant));
  return { editor, clip, clock, live, clipFake, clipSimulation, player, statuses, views };
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} != ${expected}`);
}

test('Play in Edit mode starts Simulate with the rest pose and Stop restores Edit without touching the model', () => {
  const { editor, clock, live, player, clipFake } = setup();
  const before = JSON.stringify(toJson(editor.model, 'dev'));
  assert.equal(player.canPlay(), true);
  assert.equal(player.play(), true);
  assert.equal(editor.modes.mode, 'simulate');
  assert.deepEqual(live.sessions[0].options, { clip: null, pose: null });
  clock.advance(0);
  clock.advance(50);
  assert.equal(live.sessions[0].steps, 3);
  assert.equal(player.livePose.get(editor.model.uidOf(live.sessions[0].json.bodies[0].id)).y, -3);
  assert.equal(player.stop(), true);
  assert.equal(editor.modes.mode, 'edit');
  assert.equal(live.sessions[0].destroyed, true);
  assert.equal(player.livePose, null);
  assert.equal(clipFake.sessions.length, 0);
  assert.equal(JSON.stringify(toJson(editor.model, 'dev')), before);
});

test('Play in Animate moves the playhead in real time at the clip speed and never enters Simulate', () => {
  const { editor, clip, clock, live, player } = setup({ length: 2, speed: 0.5 });
  editor.modes.openClip(clip);
  editor.modes.setPlayhead(0.25);
  assert.equal(player.play(), true);
  assert.equal(editor.modes.mode, 'animate');
  assert.equal(player.playing, true);
  clock.advance(0);
  clock.advance(100);
  near(editor.modes.playhead, 0.3);
  clock.advance(5000);
  near(editor.modes.playhead, 0.3 + ANIMATE_MAX_FRAME * 0.5);
  player.pause();
  const paused = editor.modes.playhead;
  clock.settle();
  assert.equal(editor.modes.playhead, paused);
  assert.equal(player.canStop(), false);
  player.play();
  clock.advance(0);
  clock.advance(100);
  assert.equal(player.stop(), true);
  assert.equal(editor.modes.playhead, paused);
  assert.equal(player.playing, false);
  assert.equal(live.sessions.length, 0);
  assert.equal(editor.modes.mode, 'animate');
});

test('a non-looping clip pauses at length, and Play there starts again from 0', () => {
  const { editor, clip, clock, player } = setup();
  editor.modes.openClip(clip);
  editor.modes.setPlayhead(0.95);
  player.play();
  clock.advance(0);
  clock.advance(100);
  assert.equal(editor.modes.playhead, 1);
  assert.equal(player.playing, false);
  assert.equal(player.canNextFrame(), false);
  assert.equal(player.nextFrame(), false);
  player.play();
  assert.equal(editor.modes.playhead, 0);
  player.stop();
  assert.equal(editor.modes.playhead, 0);
});

test('a looping clip wraps into the next cycle and pauses at the cycle limit with a status message', () => {
  const { editor, clip, clock, player, clipSimulation, statuses } = setup({ loop: true });
  editor.modes.openClip(clip);
  const cycles = [];
  player.on('cycle', (cycle) => cycles.push(cycle));
  editor.modes.setPlayhead(0.95);
  player.play();
  clock.advance(0);
  clock.advance(100);
  assert.equal(player.cycle, 2);
  near(editor.modes.playhead, 0.05);
  assert.deepEqual(cycles, [2]);
  for (let i = 0; i < 200 && player.playing; i++) clock.advance(100);
  assert.equal(player.cycle, clipSimulation.cycleLimit);
  assert.equal(editor.modes.playhead, 1);
  assert.equal(player.playing, false);
  assert.deepEqual(statuses, ['Clip simulation: cycle limit 8 reached']);
  player.play();
  assert.equal(player.cycle, 1);
  assert.equal(editor.modes.playhead, 0);
  clock.advance(100);
  clock.advance(100);
  player.stop();
  assert.equal(player.cycle, 1);
  assert.equal(editor.modes.playhead, 0);
});

test('Stop puts the playhead back where Play started, cycle included', () => {
  const { editor, clip, clock, player } = setup({ loop: true });
  editor.modes.openClip(clip);
  editor.modes.setPlayhead(0.5);
  player.play();
  clock.advance(0);
  for (let i = 0; i < 8; i++) clock.advance(100);
  assert.equal(player.cycle, 2);
  player.stop();
  assert.equal(player.cycle, 1);
  assert.equal(editor.modes.playhead, 0.5);
});

test('Next frame moves one step, and a looping clip at length wraps to one step into the next cycle', () => {
  const { editor, clip, player, views } = setup({ loop: true, speed: 2 });
  editor.modes.openClip(clip);
  editor.modes.setPlayhead(0.5);
  assert.equal(player.nextFrame(), true);
  near(editor.modes.playhead, 0.5 + 2 * SIMULATE_STEP);
  assert.equal(views.at(-1), true);
  editor.modes.setPlayhead(1);
  player.nextFrame();
  assert.equal(player.cycle, 2);
  near(editor.modes.playhead, 2 * SIMULATE_STEP);
  player.setCycle(8);
  editor.modes.setPlayhead(1);
  assert.equal(player.canNextFrame(), false);
});

test('scrub pauses, keeps the cycle and shows the new time at once; the cycle control moves like a scrub', () => {
  const { editor, clip, clock, player, views, clipSimulation } = setup({ loop: true });
  editor.modes.openClip(clip);
  player.play();
  clock.advance(0);
  assert.equal(player.setCycle(3), true);
  assert.equal(player.playing, false);
  assert.equal(player.cycle, 3);
  assert.equal(views.at(-1), true);
  assert.equal(player.scrub(0.25), true);
  assert.equal(player.cycle, 3);
  assert.equal(editor.modes.playhead, 0.25);
  player.setCycle(0);
  assert.equal(player.cycle, 1);
  player.setCycle(99);
  assert.equal(player.cycle, clipSimulation.cycleLimit);
  editor.history.execute(setProps([clip], { loop: false }));
  assert.equal(player.cycle, 1);
  assert.equal(player.setCycle(2), false);
});

test('scrub and the transport do nothing outside Animate mode, and leaving Animate drops the clip simulation', () => {
  const { editor, clip, clock, player, clipFake } = setup({ loop: true });
  assert.equal(player.scrub(0.5), false);
  assert.equal(player.setCycle(2), false);
  editor.modes.openClip(clip);
  clock.settle();
  assert.equal(clipFake.sessions.length, 1);
  player.setCycle(4);
  editor.modes.openClip(null);
  assert.ok(clipFake.sessions.every((session) => session.destroyed));
  assert.equal(player.cycle, 1);
  assert.equal(player.figure(), null);
  assert.deepEqual(player.ghosts(), []);
  assert.equal(player.progress(), null);
});

test('the figure is the clip simulation at the playhead and does not move the model', () => {
  const { editor, clip, clock, player } = setup();
  const before = JSON.stringify(toJson(editor.model, 'dev'));
  editor.modes.openClip(clip);
  clock.settle();
  player.scrub(0.5);
  const figure = player.figure();
  const body = editor.model.children(ROOT_UID, 'bodies')[0];
  assert.equal(figure.pose.get(body).y, -30);
  assert.match(figure.source, /^\d+:at$/);
  assert.equal(player.figure().pose, figure.pose);
  assert.deepEqual(player.progress(), { current: 1, previous: null, pending: false, cycle: 1, loop: false });
  assert.equal(JSON.stringify(toJson(editor.model, 'dev')), before);
});

test('ghosts sit at key times other than the playhead step, green ahead and red behind, from the main run in the playhead cycle', () => {
  const { editor, clip, clock, player } = setup({ loop: true });
  const joint = editor.history.execute({
    label: 'joint',
    run: (tx) => tx.add(ROOT_UID, 'joints', undefined, { type: 'joint', props: { id: 'j_test', bodyA: null, bodyB: null, anchor: [0.5, 0] } }),
  });
  for (const t of [0, 0.5, 1]) editor.history.execute(setJointAngleKey(clip, joint, t, 0.1));
  editor.modes.openClip(clip);
  clock.settle();
  player.setCycle(2);
  player.scrub(0.5);
  const ghosts = player.ghosts();
  assert.deepEqual(ghosts.map((ghost) => [ghost.t, ghost.side]), [
    [0, 'behind'],
    [1, 'ahead'],
  ]);
  const body = editor.model.children(ROOT_UID, 'bodies')[0];
  assert.equal(ghosts[1].pose.get(body).x, 1);
  assert.equal(ghosts[1].pose.get(body).y, -120);
  assert.equal(ghosts[0].pose.get(body).y, -60);
  assert.equal(player.figure().pose.get(body).x, 1);
  assert.equal(player.figure().pose.get(body).y, -90);
});

test('a posed hold lasts until a run started after the commit reaches the playhead, then hands over', () => {
  const { editor, clip, clock, player, views, clipFake } = setup();
  editor.modes.openClip(clip);
  clock.settle();
  player.scrub(0.5);
  const held = new Map([[2, { x: 9, y: 9, angle: 0 }]]);
  editor.history.beginGesture();
  editor.history.execute(setProps([clip], { speed: 1.5 }));
  player.hold(held);
  assert.equal(player.holding, true);
  assert.equal(player.heldPose, held);
  assert.equal(views.at(-1), false);
  clock.advance(16);
  assert.equal(player.holding, true);
  editor.history.endGesture();
  assert.equal(player.holding, true);
  player.play();
  clock.advance(100);
  assert.equal(editor.modes.playhead, 0.5);
  assert.equal(player.holding, true);
  clock.advance(200);
  assert.equal(clipFake.sessions.length, 2);
  for (let i = 0; i < 5 && player.holding; i++) clock.advance(1);
  assert.equal(player.holding, false);
  assert.equal(views.includes(false), true);
  assert.equal(player.playing, true);
  clock.advance(100);
  assert.ok(editor.modes.playhead > 0.5);
});

test('a hold that committed nothing ends on the next frame; a scrub ends a hold at once', () => {
  const { editor, clip, clock, player } = setup();
  editor.modes.openClip(clip);
  clock.settle();
  player.hold(new Map());
  assert.equal(player.holding, true);
  clock.advance(16);
  assert.equal(player.holding, false);
  editor.history.execute(setProps([clip], { speed: 2 }));
  player.hold(new Map());
  player.scrub(0.2);
  assert.equal(player.holding, false);
});

test('pauseAtStep puts the playhead at the time of the displayed step', () => {
  const { editor, clip, clock, player } = setup({ speed: 1 });
  editor.modes.openClip(clip);
  clock.settle();
  player.play();
  clock.advance(0);
  clock.advance(27);
  near(editor.modes.playhead, 0.027);
  player.pauseAtStep();
  assert.equal(player.playing, false);
  near(editor.modes.playhead, 2 / 60);
  player.pauseAtStep();
  near(editor.modes.playhead, 2 / 60);
});

test('validation errors make Animate show FK with a status message on entering and on the first error', () => {
  let broken = true;
  const { editor, clip, clock, player, statuses } = setup({ clipThrows: () => broken });
  editor.modes.openClip(clip);
  assert.equal(player.simulationAvailable, false);
  assert.equal(player.figure(), null);
  assert.deepEqual(statuses, ['Clip simulation: fix the errors in Problems']);
  broken = false;
  editor.history.execute(setProps([clip], { speed: 2 }));
  clock.settle();
  assert.equal(player.simulationAvailable, true);
  broken = true;
  editor.history.execute(setProps([clip], { speed: 3 }));
  clock.settle();
  assert.equal(player.simulationAvailable, false);
  assert.equal(statuses.length, 2);
  assert.equal(player.play(), true);
  clock.advance(0);
  clock.advance(100);
  assert.ok(editor.modes.playhead > 0);
});

test('simulate() from Animate runs the open clip live from 0, spawned in its pose, and Stop returns', () => {
  const { editor, clip, clock, live, player, clipFake } = setup({ loop: true });
  editor.modes.openClip(clip);
  editor.modes.setPlayhead(0.5);
  player.play();
  assert.equal(player.simulate(), true);
  assert.equal(editor.modes.mode, 'simulate');
  const key = editor.model.prop(clip, 'key');
  assert.deepEqual(live.sessions[0].options, { clip: key, pose: key });
  assert.ok(clipFake.sessions.every((session) => session.destroyed));
  assert.equal(player.scrub(0.2), false);
  clock.advance(0);
  for (let i = 0; i < 20; i++) player.nextFrame();
  near(editor.modes.playhead, 20 * SIMULATE_STEP);
  assert.equal(player.stop(), true);
  assert.equal(editor.modes.mode, 'animate');
  assert.equal(editor.modes.playhead, 0.5);
  assert.equal(clipFake.sessions.length, 2);
});

test('a long Simulate frame runs at most the step cap and a model reset ends it in Edit mode', () => {
  const { editor, clock, live, player } = setup();
  const text = saveJson(editor.model, 'dev').text;
  player.play();
  clock.advance(0);
  clock.advance(5000);
  assert.equal(live.sessions[0].steps, SIMULATE_MAX_STEPS);
  assert.equal(loadJson(editor.model, text).ok, true);
  assert.equal(editor.modes.mode, 'edit');
  assert.equal(player.simulating, false);
  assert.equal(player.playing, false);
  assert.equal(live.sessions[0].destroyed, true);
});

test('without a simulator Edit cannot play, and a failing simulator leaves the mode unchanged', () => {
  const editor = createEditor();
  const clock = fakeClock();
  const idle = new TimelinePlayer({ model: editor.model, modes: editor.modes, clock });
  assert.equal(idle.canPlay(), false);
  assert.equal(idle.play(), false);
  assert.equal(idle.stop(), false);
  const failing = new TimelinePlayer({
    model: editor.model,
    modes: editor.modes,
    clock,
    simulator: () => {
      throw new Error('invalid document');
    },
  });
  assert.throws(() => failing.play(), /invalid document/);
  assert.equal(editor.modes.mode, 'edit');
  assert.equal(failing.simulating, false);
});

test('document edits during Animate playback do not stop it and restart the clip simulation', () => {
  const { editor, clip, clock, player, clipFake } = setup();
  editor.modes.openClip(clip);
  player.play();
  clock.advance(0);
  editor.history.execute(setProps([clip], { speed: 1.25 }));
  editor.history.undo();
  assert.equal(player.playing, true);
  clock.advance(300);
  assert.equal(clipFake.sessions.length, 2);
});
