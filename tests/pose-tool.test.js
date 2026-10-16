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

function environment({ physics = fakePhysics(), withPhysics = true } = {}) {
  const editor = createEditor(withPhysics ? { physics } : {});
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
  const view = { hits: [], cursor: [], poses: [], invalidations: 0 };
  tools.bindView({
    hitTest: () => view.hits,
    boxTest: () => [],
    setCursor: (css) => view.cursor.push(css),
    invalidateOverlay: () => {
      view.invalidations++;
    },
    setPose: (pose) => view.poses.push(pose),
  });
  assert.equal(tools.activate('pose'), true);
  const snapshot = () => ({
    json: JSON.stringify(toJson(model, 'dev')),
    selection: [...selection.objects],
    history: JSON.stringify(history.state),
  });
  return { ...editor, physics, view, shapes, bodies, joint, snapshot, before: snapshot() };
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

test('presses that start nothing: empty space, a joint, the root, a right press, modifiers, no physics, Animate', () => {
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

  const animate = environment();
  animate.modes.openClip(addClip(animate));
  assert.equal(animate.tools.active?.id, 'pose');
  const before = animate.snapshot();
  animate.view.hits = [animate.shapes[0]];
  send(animate.tools, 'down', 10, 10);
  send(animate.tools, 'up', 10, 10);
  assert.equal(animate.physics.starts.length, 0);
  assert.deepEqual(animate.snapshot(), before);
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
