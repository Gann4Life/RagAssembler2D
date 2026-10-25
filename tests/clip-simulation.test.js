import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_SIMULATION, ClipSimulation } from '../js/physics/clip-simulation.js';

function fakeSimulator({ throws = () => false } = {}) {
  const sessions = [];
  const simulator = (json, options) => {
    if (throws(json, options)) throw new Error('invalid document');
    const session = {
      json,
      options,
      steps: 0,
      destroyed: false,
      step(dt) {
        assert.equal(session.destroyed, false);
        assert.ok(Math.abs(dt - CLIP_SIMULATION.step * json.speed) < 1e-12);
        session.steps++;
      },
      pose() {
        const spawn = options.pose === null ? 0 : 100;
        return new Map(json.bodies.map((id, index) => [id, { x: spawn + index, y: 0 - session.steps, angle: json.version }]));
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
    frames: [],
    perStep: 0,
    request(callback) {
      clock.frames.push(callback);
      return clock.frames.length;
    },
    cancel(handle) {
      clock.frames[handle - 1] = null;
    },
    now: () => clock.time,
    run(count = 1) {
      for (let i = 0; i < count; i++) {
        const pending = clock.frames.filter(Boolean);
        clock.frames = [];
        for (const frame of pending) frame(clock.time);
      }
    },
    settle(limit = 100) {
      for (let i = 0; i < limit && clock.frames.some(Boolean); i++) clock.run();
    },
  };
  return clock;
}

function spec({ loop = false, length = 1, speed = 1, version = 1 } = {}) {
  return { json: { bodies: ['b_a', 'b_b'], version, speed }, clip: 'walk', length, speed, loop };
}

function simulation(options = {}) {
  const fake = fakeSimulator(options);
  const clock = fakeClock();
  const simulator = (json, opts) => {
    const session = fake.simulator(json, opts);
    const step = session.step;
    session.step = (dt) => {
      step(dt);
      clock.time += options.msPerStep ?? 0;
    };
    return session;
  };
  const sim = new ClipSimulation(simulator, clock);
  const updates = [];
  sim.on('update', () => updates.push(true));
  return { ...fake, clock, sim, updates };
}

test('CLIP_SIMULATION holds the 60 Hz step, budget, debounce and cycle limit', () => {
  assert.deepEqual({ ...CLIP_SIMULATION }, { step: 1 / 60, budget: 8, maxStepsPerFrame: 240, debounce: 250, cycleLimit: 8 });
  assert.equal(Object.isFrozen(CLIP_SIMULATION), true);
});

test('a non-looping clip spawns in its own pose at once and runs to length, stored per step', () => {
  const { sim, sessions, clock } = simulation();
  sim.open(spec());
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].options, { clip: 'walk', pose: 'walk' });
  assert.equal(sim.available, true);
  assert.deepEqual(sim.pose(1, 0.5).exact, false);
  assert.deepEqual(sim.pose(1, 0).pose.get('b_a'), { x: 100, y: 0, angle: 1 });
  clock.settle();
  assert.equal(sessions[0].steps, 60);
  assert.equal(sessions[0].destroyed, true);
  const read = sim.pose(1, 0.5);
  assert.equal(read.exact, true);
  assert.equal(read.step, 30);
  assert.deepEqual(read.pose.get('b_b'), { x: 101, y: -30, angle: 1 });
  assert.deepEqual(sim.pose(5, 2).pose.get('b_a').y, -60);
  assert.equal(sim.upToDate(1, 1), true);
  assert.deepEqual(sim.progress(), { current: 1, previous: null, pending: false });
  assert.equal(sim.ghostPose(1, 0.25).step, 15);
  assert.equal(sim.ghostPose(1, 0.25).run, read.run);
});

test('scrubbing back reads the stored step: no new session, same pose', () => {
  const { sim, sessions, clock } = simulation();
  sim.open(spec());
  clock.settle();
  const late = sim.pose(1, 0.9).pose;
  const early = sim.pose(1, 0.1).pose;
  assert.deepEqual(sim.pose(1, 0.9).pose, late);
  assert.deepEqual(early.get('b_a').y, -6);
  assert.equal(sessions.length, 1);
});

test('a looping clip spawns in its pose at 0 in one run, runs two cycles, and extends its horizon with the playhead cycle', () => {
  const { sim, sessions, clock } = simulation();
  sim.open(spec({ loop: true }));
  assert.deepEqual(sessions.map((session) => session.options), [{ clip: 'walk', pose: 'walk' }]);
  clock.settle();
  assert.equal(sessions[0].steps, 120);
  assert.equal(sessions[0].destroyed, false);
  assert.equal(sim.pose(2, 0.5).step, 90);
  assert.equal(sim.pose(2, 0.5).pose.get('b_a').x, 100);
  assert.equal(sim.pose(1, 1).step, sim.pose(2, 0).step);
  assert.equal(sim.upToDate(3, 0.5), false);
  sim.setCycle(3);
  clock.settle();
  assert.equal(sessions[0].steps, 240);
  sim.setCycle(20);
  clock.settle();
  assert.equal(sessions[0].steps, 8 * 60);
  assert.equal(sessions[0].destroyed, true);
  assert.equal(sim.upToDate(8, 1), true);
  assert.deepEqual(sim.ghostPose(3, 0.5), sim.pose(3, 0.5));
  assert.equal(sim.ghostPose(3, 0.5).step, 150);
  assert.equal(sim.ghostPose(1, 0.5).pose.get('b_a').x, 100);
});

test('each frame stays within the time budget and the step cap', () => {
  const fake = fakeSimulator();
  const clock = fakeClock();
  const original = fake.simulator;
  const sim = new ClipSimulation((json, options) => {
    const session = original(json, options);
    const step = session.step;
    session.step = (dt) => {
      step(dt);
      clock.time += 1;
    };
    return session;
  }, clock);
  sim.open(spec({ length: 10 }));
  clock.run();
  assert.equal(fake.sessions[0].steps, CLIP_SIMULATION.budget);

  const capped = simulation();
  capped.sim.open(spec({ length: 10 }));
  capped.clock.run();
  assert.equal(capped.sessions[0].steps, CLIP_SIMULATION.maxStepsPerFrame);
});

test('a committed change restarts 250 ms later and the previous run is shown until the new one gets there', () => {
  const { sim, sessions, clock } = simulation({ msPerStep: 1 });
  sim.open(spec());
  clock.settle();
  const first = sim.pose(1, 0.5).run;
  sim.change(spec({ version: 2 }));
  assert.equal(sim.upToDate(1, 0), false);
  clock.time = 249;
  clock.run();
  assert.equal(sessions.length, 1);
  assert.equal(sim.pose(1, 0.5).run, first);
  sim.change(spec({ version: 3 }));
  clock.time = 400;
  clock.run();
  assert.equal(sessions.length, 1);
  clock.time = 499;
  clock.run(1);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[1].json.version, 3);
  const early = sim.pose(1, 0);
  assert.equal(early.run, first + 1);
  assert.equal(early.exact, true);
  assert.equal(sim.upToDate(1, 0), true);
  assert.equal(sim.progress().pending, true);
  const late = sim.pose(1, 1);
  assert.notEqual(late.run, first + 1);
  assert.equal(late.run, first);
  assert.equal(late.exact, true);
  assert.equal(sim.progress().previous, 1);
  clock.settle();
  assert.equal(sim.pose(1, 1).run, first + 1);
  assert.equal(sim.progress().previous, null);
  assert.equal(sim.pose(1, 1).pose.get('b_a').angle, 3);
});

test('the main figure shows the latest step reached when no run has the step', () => {
  const { sim, clock } = simulation();
  sim.open(spec({ length: 10 }));
  clock.run();
  const read = sim.pose(1, 9);
  assert.equal(read.exact, false);
  assert.equal(read.step, CLIP_SIMULATION.maxStepsPerFrame);
  assert.equal(sim.ghostPose(1, 9), null);
});

test('a document that cannot be simulated makes the clip simulation unavailable until a change fixes it', () => {
  let broken = true;
  const { sim, sessions, clock } = simulation({ throws: () => broken });
  sim.open(spec());
  assert.equal(sim.available, false);
  assert.equal(sim.pose(1, 0), null);
  assert.equal(sim.ghostPose(1, 0), null);
  assert.equal(sim.upToDate(1, 0), false);
  assert.deepEqual(sim.progress(), { current: null, previous: null, pending: false });
  broken = false;
  sim.change(spec());
  clock.time = 300;
  clock.settle();
  assert.equal(sim.available, true);
  assert.equal(sessions.length, 1);
  assert.equal(sim.upToDate(1, 1), true);
});

test('close and open release every session and start over', () => {
  const { sim, sessions, clock } = simulation();
  sim.open(spec({ loop: true }));
  clock.run();
  sim.change(spec({ loop: true, version: 2 }));
  clock.time = 300;
  clock.run();
  sim.open(spec({ loop: true }));
  assert.ok(sessions.slice(0, 2).every((session) => session.destroyed));
  sim.close();
  assert.ok(sessions.every((session) => session.destroyed));
  assert.equal(sim.available, false);
  assert.equal(sim.pose(1, 0), null);
  clock.settle();
  assert.equal(sessions.length, 3);
});

test('the speed scales the step: clip time per step is 1/60 s times speed', () => {
  const { sim, sessions, clock } = simulation();
  sim.open(spec({ speed: 2 }));
  clock.settle();
  assert.equal(sessions[0].steps, 30);
  assert.equal(sim.stepOf(1, 0.5), 15);
});
