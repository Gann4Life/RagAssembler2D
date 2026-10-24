import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { ROOT_UID } from '../js/model/model.js';
import { createJoint, createShapeBody } from '../js/commands/create.js';
import { setProps } from '../js/commands/props.js';
import { toJson } from '../js/model/io.js';
import { poseTool } from '../js/tools/pose.js';
import { COLORS, GIZMO_SIZE, LINE_WIDTH } from '../js/viewport/style.js';
import { defaultsOf } from '../lib/schema.js';

const NO_MODIFIERS = { shift: false, ctrl: false, alt: false };

function fakePhysics({ startThrows = false } = {}) {
  const physics = {
    starts: [],
    sessions: [],
    startPose(json, options) {
      physics.starts.push({ json, options });
      if (startThrows) throw new Error('invalid document');
      const session = {
        log: [],
        destroyed: 0,
        throwOn: null,
        drag(point) {
          if (session.throwOn === 'drag') throw new Error('drag');
          session.log.push(['drag', point]);
        },
        advance(seconds) {
          if (session.throwOn === 'advance') throw new Error('advance');
          session.log.push(['advance', seconds]);
        },
        pose() {
          return new Map([
            [options.bodyId, { x: 1, y: 2, angle: 0.5 }],
            ['b_unknown', { x: 0, y: 0, angle: 0 }],
          ]);
        },
        grab() {
          return { anchor: { x: 0, y: 0 }, target: { x: 1, y: 1 } };
        },
        destroy() {
          session.destroyed++;
        },
      };
      physics.sessions.push(session);
      return session;
    },
  };
  return physics;
}

function addClip(editor) {
  const { tracks, events, ...props } = defaultsOf('clip');
  return editor.history.execute({
    label: 'Add clip',
    run: (tx) => tx.add(ROOT_UID, 'clips', undefined, { type: 'clip', props: { ...props, length: 1 } }),
  });
}

function fakePlayback() {
  const playback = {
    playing: false,
    pauses: 0,
    holds: [],
    onPause: () => {},
    pause() {
      playback.pauses++;
      playback.playing = false;
      playback.onPause();
    },
    hold(pose) {
      playback.holds.push(pose);
    },
  };
  return playback;
}

function environment({ physics = fakePhysics(), withPhysics = true, playback = fakePlayback(), autokey = true } = {}) {
  const statuses = [];
  const editor = createEditor({
    ...(withPhysics ? { physics } : {}),
    playback,
    autokey: () => autokey,
    status: (text) => statuses.push(text),
  });
  const { model, history, camera, tools, selection } = editor;
  camera.setSize(400, 400);
  camera.zoomAt({ x: 200, y: 200 }, 100 / camera.scale);
  history.execute(setProps([ROOT_UID], { position: [0.5, -0.25], angle: 0.3 }, 'Move root'));
  const shapes = [0, 1].map((x) =>
    history.execute(createShapeBody({ position: { x, y: 0 }, angle: 0, shape: { type: 'circle', radius: 0.4 } })),
  );
  const bodies = shapes.map((uid) => model.get(uid).parent);
  const joint = history.execute(createJoint({ bodyA: bodies[0], bodyB: bodies[1], anchor: { x: 0.5, y: 0 } }));
  selection.set([bodies[1]]);
  const view = { hits: [], cursor: [], poses: [], invalidations: 0, displayed: null };
  tools.bindView({
    hitTest: () => view.hits,
    boxTest: () => [],
    setCursor: (css) => view.cursor.push(css),
    invalidateOverlay: () => {
      view.invalidations++;
    },
    setPose: (pose) => view.poses.push(pose),
    displayedPose: () => view.displayed,
  });
  assert.equal(tools.activate('pose'), true);
  const snapshot = () => ({
    json: JSON.stringify(toJson(model, 'dev')),
    selection: [...selection.objects],
    history: JSON.stringify(history.state),
  });
  const poseStatuses = () => statuses.filter((text) => text.startsWith('Pose:'));
  return { ...editor, physics, playback, statuses: { all: statuses, get pose() { return poseStatuses(); } }, view, shapes, bodies, joint, snapshot, before: snapshot() };
}

function send(tools, type, x, y, extra = {}) {
  tools.pointer({
    type,
    screen: { x, y },
    button: type === 'move' ? -1 : (extra.button ?? 0),
    buttons: type === 'up' ? 0 : 1,
    ...NO_MODIFIERS,
    clicks: 1,
    ...extra,
  });
}

function assertUnchanged(env) {
  assert.deepEqual(env.snapshot(), env.before);
  assert.equal(env.history.inGesture, false);
}

test('Pose is idle with the default cursor and hover on', () => {
  const tool = poseTool();
  assert.equal(tool.id, 'pose');
  assert.equal(tool.cursor, 'default');
  assert.equal(tool.hover, true);
});

test('a press on a shape starts a session with the body id, root transform and world point', () => {
  const env = createEnvAndPress();
  const { physics, model, bodies, camera, view } = env;
  assert.equal(physics.starts.length, 1);
  const { json, options } = physics.starts[0];
  assert.equal(json.format, 'ragassembler');
  assert.deepEqual(json, toJson(model, 'dev'));
  assert.equal(options.bodyId, model.get(bodies[1]).props.id);
  assert.deepEqual(options.root, { x: 0.5, y: -0.25, angle: 0.3 });
  assert.deepEqual(options.point, camera.screenToWorld({ x: 260, y: 190 }));
  assert.equal(view.cursor.at(-1), 'grabbing');
  send(env.tools, 'up', 260, 190);
  assertUnchanged(env);
});

function createEnvAndPress(options) {
  const env = environment(options);
  env.view.hits = [env.joint, env.shapes[1], env.shapes[0], ROOT_UID];
  send(env.tools, 'down', 260, 190);
  return env;
}

test('presses that start nothing: empty space, a joint, the root, a right press, modifiers, no physics', () => {
  const cases = [
    (env) => {
      env.view.hits = [];
      send(env.tools, 'down', 10, 10);
      send(env.tools, 'up', 10, 10);
    },
    (env) => {
      env.view.hits = [env.joint, ROOT_UID];
      send(env.tools, 'down', 10, 10);
      send(env.tools, 'up', 10, 10);
    },
    (env) => {
      env.view.hits = [env.shapes[0]];
      send(env.tools, 'down', 10, 10, { button: 2 });
      send(env.tools, 'up', 10, 10, { button: 2 });
    },
    (env) => {
      env.view.hits = [env.shapes[0]];
      send(env.tools, 'down', 10, 10, { shift: true });
      send(env.tools, 'up', 10, 10, { shift: true });
    },
  ];
  for (const run of cases) {
    const env = environment();
    run(env);
    assert.equal(env.physics.starts.length, 0);
    assert.deepEqual(env.view.poses, []);
    assertUnchanged(env);
  }

  const noPhysics = environment({ withPhysics: false });
  noPhysics.view.hits = [noPhysics.shapes[0]];
  send(noPhysics.tools, 'move', 10, 10, { buttons: 0 });
  send(noPhysics.tools, 'down', 10, 10);
  send(noPhysics.tools, 'up', 10, 10);
  assert.notEqual(noPhysics.view.cursor.at(-1), 'grab');
  assert.deepEqual(noPhysics.view.poses, []);
});

function animateEnvironment({ playhead = 0.5, turn = 0.3, playback, autokey = true } = {}) {
  const physics = fakePhysics();
  const env = environment({ physics, playback, autokey });
  const clip = addClip(env);
  env.modes.openClip(clip);
  env.modes.setPlayhead(playhead);
  const ids = env.bodies.map((uid) => env.model.prop(uid, 'id'));
  const original = physics.startPose.bind(physics);
  physics.startPose = (json, options) => {
    const session = original(json, options);
    session.pose = () => {
      const pose = new Map(options.start);
      const child = pose.get(ids[1]);
      pose.set(ids[1], { ...child, angle: child.angle + turn });
      return pose;
    };
    return session;
  };
  env.view.hits = [env.shapes[1]];
  return { ...env, clip, ids, before: env.snapshot() };
}

function angleKeys(env) {
  return env.model.children(env.clip, 'tracks').map((track) => ({
    target: env.model.prop(track, 'target'),
    channel: env.model.prop(track, 'channel'),
    keys: env.model.children(track, 'keys').map((key) => [env.model.prop(key, 't'), env.model.prop(key, 'v')]),
  }));
}

function drag(env) {
  send(env.tools, 'down', 260, 190);
  send(env.tools, 'move', 270, 190);
  env.tools.tick(1 / 60);
  send(env.tools, 'up', 270, 190);
}

test('Animate: the press starts from exactly the displayed bodies', () => {
  const env = animateEnvironment();
  env.view.displayed = new Map(env.bodies.map((uid, index) => [uid, { x: index, y: 0.25, angle: 0.7 + index }]));
  send(env.tools, 'down', 260, 190);
  const { start } = env.physics.starts[0].options;
  assert.deepEqual(start, new Map(env.ids.map((id, index) => [id, { x: index, y: 0.25, angle: 0.7 + index }])));
  assert.equal('holdRoot' in env.physics.starts[0].options, false);
  env.actions.run('escape');
  assert.equal(env.view.poses.at(-1), null);
  assert.deepEqual(env.playback.holds, []);
});

test('Animate: without a displayed pose the press starts from the FK pose at the playhead', () => {
  const env = animateEnvironment();
  env.history.execute({
    label: 'seed',
    run: (tx) => tx.add(env.clip, 'tracks', undefined, {
      type: 'track',
      props: { target: env.model.prop(env.joint, 'id'), channel: 'angle' },
      children: { keys: [{ type: 'key', props: { t: 0, v: 0.4, interp: 'linear' } }] },
    }),
  });
  send(env.tools, 'down', 260, 190);
  assert.equal(env.physics.starts.length, 1);
  const { start } = env.physics.starts[0].options;
  assert.ok(start instanceof Map);
  const restAngle = env.model.prop(env.bodies[1], 'angle');
  assert.ok(Math.abs(start.get(env.ids[1]).angle - (restAngle + 0.4)) < 1e-9);
  env.actions.run('escape');
});

test('Animate: a drag release keys the changed joint angle at the playhead, unsnapped, as one undo step', () => {
  const env = animateEnvironment({ playhead: 0.51, turn: 0.3 });
  drag(env);
  const tracks = angleKeys(env);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].target, env.model.prop(env.joint, 'id'));
  assert.equal(tracks[0].channel, 'angle');
  assert.equal(tracks[0].keys.length, 1);
  const [t, v] = tracks[0].keys[0];
  assert.ok(Math.abs(t - 0.51) < 1e-9, `t ${t}`);
  assert.ok(Math.abs(v - 0.3) < 1e-9, `v ${v}`);
  assert.equal(env.history.inGesture, false);
  assert.equal(env.history.state.undoLabel, 'Pose');
  assert.equal(env.view.poses.at(-1), null);
  assert.equal(env.playback.holds.length, 1);
  assert.ok(Math.abs(env.playback.holds[0].get(env.bodies[1]).angle - 0.3) < 1e-9);
  env.history.undo();
  assert.equal(env.snapshot().json, env.before.json);
  assert.notEqual(env.history.state.undoLabel, 'Pose');
});

test('Animate: a displayed pose that lags the keys is not keyed when the drag does not move it', () => {
  const env = animateEnvironment({ turn: 0 });
  const lagging = new Map(env.bodies.map((uid) => [uid, { x: env.model.prop(uid, 'position')[0], y: 0, angle: 0 }]));
  lagging.set(env.bodies[1], { ...lagging.get(env.bodies[1]), angle: 0.2 });
  env.view.displayed = lagging;
  drag(env);
  assert.deepEqual(env.snapshot(), env.before);
});

function seedJointKey(env, value) {
  env.history.execute({
    label: 'seed',
    run: (tx) => tx.add(env.clip, 'tracks', undefined, {
      type: 'track',
      props: { target: env.model.prop(env.joint, 'id'), channel: 'angle' },
      children: { keys: [{ type: 'key', props: { t: 0, v: value, interp: 'linear' } }] },
    }),
  });
}

test('Animate: a changed joint is keyed at its released angle, not the evaluated value plus the change', () => {
  const env = animateEnvironment({ turn: 0.3 });
  env.history.execute(setProps([ROOT_UID], { rootBody: env.ids[0] }));
  seedJointKey(env, 0.4);
  const before = env.snapshot();
  env.view.displayed = new Map([
    [env.bodies[0], { x: 0, y: -0.02, angle: 0.05 }],
    [env.bodies[1], { x: 1, y: -0.1, angle: 0.05 + 0.15 }],
  ]);
  drag(env);
  const tracks = angleKeys(env);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].channel, 'angle');
  const key = tracks[0].keys.find(([t]) => Math.abs(t - 0.5) < 1e-9);
  assert.ok(Math.abs(key[1] - 0.45) < 1e-9, `v ${key[1]}`);
  env.history.undo();
  assert.equal(env.snapshot().json, before.json);
});

function limitJoint(env, lower, upper) {
  env.history.execute(setProps([env.joint], { limits: { enabled: true, lower, upper } }));
}

test('Animate: repeated drags from a display that lags the keys never key past the joint limits', () => {
  const env = animateEnvironment({ turn: 0.35 });
  limitJoint(env, -0.5, 0.5);
  seedJointKey(env, 0.5);
  const restAngle = env.model.prop(env.bodies[1], 'angle');
  for (let i = 0; i < 4; i++) {
    env.view.displayed = new Map([
      [env.bodies[0], { x: 0, y: 0, angle: 0 }],
      [env.bodies[1], { x: 1, y: -0.1, angle: restAngle + 0.1 }],
    ]);
    drag(env);
    const key = angleKeys(env)[0].keys.find(([t]) => Math.abs(t - 0.5) < 1e-9);
    assert.ok(Math.abs(key[1] - 0.45) < 1e-9, `drag ${i}: v ${key[1]}`);
  }
});

test('Animate: a released angle past an enabled limit (solver slop) is keyed at the limit', () => {
  for (const [turn, expected] of [[0.55, 0.5], [-0.62, -0.6]]) {
    const env = animateEnvironment({ turn });
    limitJoint(env, -0.6, 0.5);
    drag(env);
    const [, v] = angleKeys(env)[0].keys[0];
    assert.ok(Math.abs(v - expected) < 1e-9, `turn ${turn}: v ${v}`);
  }
  const free = animateEnvironment({ turn: 0.55 });
  limitJoint(free, -0.6, 0.5);
  free.history.execute(setProps([free.joint], { limits: { enabled: false, lower: -0.6, upper: 0.5 } }));
  drag(free);
  assert.ok(Math.abs(angleKeys(free)[0].keys[0][1] - 0.55) < 1e-9);
});

test('Animate: a joint whose child is bodyA is keyed with the Box2D sign', () => {
  const env = animateEnvironment({ turn: 0 });
  env.history.execute(setProps([ROOT_UID], { rootBody: env.ids[1] }));
  const original = env.physics.startPose.bind(env.physics);
  env.physics.startPose = (json, options) => {
    const session = original(json, options);
    session.pose = () => {
      const pose = new Map(options.start);
      const child = pose.get(env.ids[0]);
      pose.set(env.ids[0], { ...child, angle: child.angle + 0.3 });
      return pose;
    };
    return session;
  };
  drag(env);
  const track = angleKeys(env).find((entry) => entry.channel === 'angle');
  assert.ok(Math.abs(track.keys[0][1] + 0.3) < 1e-9, `v ${track.keys[0][1]}`);
});

test('Animate: a click writes nothing but still holds the released bodies', () => {
  const env = animateEnvironment({ turn: 0.5 });
  send(env.tools, 'down', 260, 190);
  send(env.tools, 'move', 262, 191);
  send(env.tools, 'up', 262, 191);
  assert.deepEqual(env.snapshot(), env.before);
  assert.equal(env.playback.holds.length, 1);
  assert.deepEqual(env.statuses.pose, []);
});

test('Animate: with autokey off a drag writes no keys and the status line says so', () => {
  const env = animateEnvironment({ turn: 0.5, autokey: false });
  drag(env);
  assert.deepEqual(env.snapshot(), env.before);
  assert.deepEqual(env.statuses.pose, ['Pose: autokey is off, no keys written']);
  assert.equal(env.playback.holds.length, 1);
  const quiet = animateEnvironment({ turn: 0, autokey: false });
  drag(quiet);
  assert.deepEqual(quiet.statuses.pose, []);
});

test('Animate: a press while playing pauses at the displayed step and grabs in the same press', () => {
  const playback = fakePlayback();
  const env = animateEnvironment({ playback, playhead: 0.4, turn: 0.3 });
  const displayed = new Map(env.bodies.map((uid) => [uid, { x: 0, y: 0, angle: 0 }]));
  env.view.displayed = displayed;
  playback.playing = true;
  playback.onPause = () => env.modes.setPlayhead(0.45);
  env.view.hits = [];
  send(env.tools, 'down', 10, 10);
  send(env.tools, 'up', 10, 10);
  assert.equal(playback.pauses, 0);
  env.view.hits = [env.shapes[1]];
  send(env.tools, 'down', 260, 190);
  assert.equal(playback.pauses, 1);
  assert.equal(env.physics.starts.length, 1);
  assert.equal(env.physics.starts[0].options.start.size, 2);
  send(env.tools, 'move', 280, 190);
  send(env.tools, 'up', 280, 190);
  const [t] = angleKeys(env)[0].keys[0];
  assert.ok(Math.abs(t - 0.45) < 1e-9, `t ${t}`);
});

test('Animate: changes under 0.1 degree and cancelled drags create no keys', () => {
  const small = animateEnvironment({ turn: (0.05 * Math.PI) / 180 });
  drag(small);
  assert.deepEqual(small.snapshot(), small.before);

  const cancelled = animateEnvironment({ turn: 0.5 });
  send(cancelled.tools, 'down', 260, 190);
  cancelled.actions.run('escape');
  send(cancelled.tools, 'up', 260, 190);
  assert.deepEqual(cancelled.snapshot(), cancelled.before);
  assert.equal(cancelled.physics.sessions[0].destroyed, 1);
});

test('Edit: release discards the result and the press starts from the rest pose', () => {
  const env = createEnvAndPress();
  assert.equal(env.physics.starts[0].options.start, null);
  send(env.tools, 'up', 260, 190);
  assertUnchanged(env);
});

test('hover shows grab over a shape and the default cursor elsewhere', () => {
  const env = environment();
  env.view.hits = [env.shapes[0]];
  send(env.tools, 'move', 10, 10, { buttons: 0 });
  assert.equal(env.view.cursor.at(-1), 'grab');
  env.view.hits = [env.joint];
  send(env.tools, 'move', 20, 10, { buttons: 0 });
  assert.equal(env.view.cursor.at(-1), 'default');
});

test('a move drags, and a tick advances and shows a uid-keyed pose', () => {
  const env = createEnvAndPress();
  const session = env.physics.sessions[0];
  send(env.tools, 'move', 300, 150);
  assert.deepEqual(session.log, [['drag', env.camera.screenToWorld({ x: 300, y: 150 })]]);
  const invalidations = env.view.invalidations;
  env.tools.tick(0.02);
  assert.deepEqual(session.log.at(-1), ['advance', 0.02]);
  const pose = env.view.poses.at(-1);
  assert.deepEqual([...pose.entries()], [[env.bodies[1], { x: 1, y: 2, angle: 0.5 }]]);
  assert.ok(env.view.invalidations > invalidations);
  send(env.tools, 'up', 300, 150);
  assert.equal(session.destroyed, 1);
  assert.equal(env.view.poses.at(-1), null);
  env.tools.tick(0.02);
  assert.equal(session.log.at(-1)[0], 'advance');
  assert.equal(session.log.filter(([kind]) => kind === 'advance').length, 1);
  assertUnchanged(env);
});

test('the overlay joins the grabbed point to the target during a session only', () => {
  const env = createEnvAndPress();
  const calls = [];
  const g = new Proxy({}, { get: (target, key) => (key === 'clear' ? () => calls.splice(0) : (...args) => calls.push([key, ...args])) });
  env.tools.drawOverlay(g);
  const from = env.camera.worldToScreen({ x: 0, y: 0 });
  const to = env.camera.worldToScreen({ x: 1, y: 1 });
  assert.deepEqual(calls, [
    ['moveTo', from.x, from.y],
    ['lineTo', to.x, to.y],
    ['stroke', { width: LINE_WIDTH.outline, color: COLORS.gizmo }],
    ['circle', to.x, to.y, GIZMO_SIZE.pivot],
    ['fill', COLORS.gizmo],
  ]);
  send(env.tools, 'up', 260, 190);
  env.tools.drawOverlay(g);
  assert.deepEqual(calls, []);
});

test('release, Esc, mode change and tool switch end the session once and clear the pose', () => {
  const endings = {
    release: (env) => send(env.tools, 'up', 260, 190),
    escape: (env) => env.actions.run('escape'),
    mode: (env) => env.modes.openClip(addClip(env)),
    tool: (env) => env.actions.run('tool:select'),
  };
  for (const [name, end] of Object.entries(endings)) {
    const env = createEnvAndPress();
    const session = env.physics.sessions[0];
    env.tools.tick(1 / 60);
    end(env);
    assert.equal(session.destroyed, 1, name);
    assert.equal(env.view.poses.at(-1), null, name);
    send(env.tools, 'up', 260, 190);
    env.tools.cancel();
    assert.equal(session.destroyed, 1, name);
    if (name !== 'mode') {
      assertUnchanged(env);
      assert.deepEqual(env.selection.objects, [env.bodies[1]], name);
    }
  }
});

test('Esc during a session cancels it without clearing the selection', () => {
  const env = createEnvAndPress();
  env.actions.run('escape');
  assert.deepEqual(env.selection.objects, [env.bodies[1]]);
  env.actions.run('escape');
  assert.deepEqual(env.selection.objects, []);
});

test('a throwing handler ends the session once and clears the pose', () => {
  for (const [throwOn, act] of [
    ['drag', (env) => send(env.tools, 'move', 300, 150)],
    ['advance', (env) => env.tools.tick(1 / 60)],
  ]) {
    const env = createEnvAndPress();
    const session = env.physics.sessions[0];
    session.throwOn = throwOn;
    assert.throws(() => act(env), { message: throwOn });
    assert.equal(session.destroyed, 1, throwOn);
    assert.equal(env.view.poses.at(-1), null, throwOn);
    send(env.tools, 'up', 300, 150);
    assert.equal(session.destroyed, 1, throwOn);
    assertUnchanged(env);
  }
});

test('a press the physics service refuses shows not-allowed until the release', () => {
  const env = createEnvAndPress({ physics: fakePhysics({ startThrows: true }) });
  assert.equal(env.physics.starts.length, 1);
  assert.equal(env.physics.sessions.length, 0);
  assert.equal(env.view.cursor.at(-1), 'not-allowed');
  send(env.tools, 'move', 300, 150);
  env.tools.tick(1 / 60);
  assert.equal(env.view.cursor.at(-1), 'not-allowed');
  assert.deepEqual(env.view.poses, []);
  send(env.tools, 'up', 300, 150);
  assert.equal(env.view.cursor.at(-1), 'default');
  assertUnchanged(env);

  const cancelled = createEnvAndPress({ physics: fakePhysics({ startThrows: true }) });
  assert.equal(cancelled.tools.cancel(), true);
  assert.equal(cancelled.view.cursor.at(-1), 'default');
  assert.equal(cancelled.tools.cancel(), false);
});

test('Animate: release keys the root bodyAngle with the joint angles', () => {
  const env = animateEnvironment({ turn: 0 });
  env.history.execute(setProps([ROOT_UID], { rootBody: env.ids[0] }));
  const original = env.physics.startPose.bind(env.physics);
  env.physics.startPose = (json, options) => {
    const session = original(json, options);
    session.pose = () => {
      const pose = new Map(options.start);
      const root = pose.get(env.ids[0]);
      pose.set(env.ids[0], { ...root, angle: root.angle + 0.4 });
      return pose;
    };
    return session;
  };
  drag(env);
  const root = angleKeys(env).find((track) => track.channel === 'bodyAngle');
  assert.equal(root.target, 'root');
  assert.equal(root.keys.length, 1);
  assert.ok(Math.abs(root.keys[0][1] - 0.4) < 1e-9);
  assert.equal(env.history.state.undoLabel, 'Pose');
  env.history.undo();
  assert.equal(env.snapshot().json, env.before.json);
});

test('Edit: the session gets no root pin option', () => {
  const env = createEnvAndPress();
  assert.equal('holdRoot' in env.physics.starts[0].options, false);
  send(env.tools, 'up', 260, 190);
});