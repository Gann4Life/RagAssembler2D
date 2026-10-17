import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, ROOT_UID } from '../js/model/model.js';
import { History, HISTORY_LIMIT } from '../js/commands/history.js';
import { defaultsOf } from '../lib/schema.js';

function bodySnapshot(model, shapeCount = 1) {
  const id = model.nextId('b');
  const fixtures = Array.from({ length: shapeCount }, () => {
    const shapeId = model.nextId('f');
    return { type: 'shape', props: { id: shapeId, name: `box_${shapeId}`, ...defaultsOf('shape', 'box') } };
  });
  const { fixtures: omitted, ...props } = defaultsOf('body');
  return { type: 'body', props: { id, name: `body_${id}`, ...props }, children: { fixtures } };
}

function command(label, run) {
  return { label, run };
}

function addBody(history, model, shapeCount = 1) {
  return history.execute(
    command('Add body', (tx) => tx.add(ROOT_UID, 'bodies', undefined, bodySnapshot(model, shapeCount))),
  );
}

function setName(uid, name, label = 'Rename') {
  return command(label, (tx) => tx.set(uid, 'name', name));
}

function setup(options) {
  const model = new Model();
  const history = new History(model, options);
  const changes = [];
  const states = [];
  model.on('change', (payload) => changes.push(payload));
  history.on('history', (state) => states.push(state));
  return { model, history, changes, states };
}

function snapshotOf(model) {
  const walk = (uid) => {
    const node = model.get(uid);
    const children = {};
    const collections = { root: ['sprites', 'bodies', 'joints', 'clips'], body: ['fixtures'] }[node.type] ?? [];
    for (const name of collections) children[name] = model.children(uid, name).map(walk);
    return { uid, type: node.type, props: node.props, children };
  };
  return structuredClone(walk(ROOT_UID));
}

test('HISTORY_LIMIT is 200', () => {
  assert.equal(HISTORY_LIMIT, 200);
});

test('a set command emits one change, and undo and redo restore it', () => {
  const { model, history, changes } = setup();
  const uid = addBody(history, model);
  changes.length = 0;
  history.execute(setName(uid, 'torso'));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].cause, 'do');
  assert.equal(model.prop(uid, 'name'), 'torso');
  assert.equal(history.undo(), true);
  assert.equal(model.prop(uid, 'name'), `body_${model.prop(uid, 'id')}`);
  assert.equal(changes.at(-1).cause, 'undo');
  assert.equal(history.redo(), true);
  assert.equal(model.prop(uid, 'name'), 'torso');
  assert.equal(changes.at(-1).cause, 'redo');
});

test('a set to an absent path is undone by removing the key', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  history.execute(command('Tag', (tx) => tx.set(uid, 'editor.tag', 'x')));
  assert.equal(model.prop(uid, 'editor.tag'), 'x');
  history.undo();
  assert.equal(model.prop(uid, 'editor.tag'), undefined);
  history.redo();
  assert.equal(model.prop(uid, 'editor.tag'), 'x');
});

test('execute returns the value of run, and redo of an add keeps uids and ids', () => {
  const { model, history } = setup();
  const uid = addBody(history, model, 2);
  assert.equal(model.get(uid).type, 'body');
  const id = model.prop(uid, 'id');
  const shapes = [...model.children(uid, 'fixtures')];
  history.undo();
  assert.equal(model.get(uid), null);
  assert.deepEqual(model.children(ROOT_UID, 'bodies'), []);
  history.redo();
  assert.equal(model.get(uid).type, 'body');
  assert.equal(model.prop(uid, 'id'), id);
  assert.deepEqual(model.children(uid, 'fixtures'), shapes);
  assert.equal(model.uidOf(id), uid);
});

test('undo of a remove restores the subtree with the same uids at the same index', () => {
  const { model, history } = setup();
  const first = addBody(history, model);
  const second = addBody(history, model, 2);
  const third = addBody(history, model);
  const before = snapshotOf(model);
  history.execute(command('Delete', (tx) => tx.remove(second)));
  assert.deepEqual(model.children(ROOT_UID, 'bodies'), [first, third]);
  history.undo();
  assert.deepEqual(snapshotOf(model), before);
  history.redo();
  assert.deepEqual(model.children(ROOT_UID, 'bodies'), [first, third]);
  assert.equal(model.get(second), null);
});

test('undo and redo of a move restore both slots', () => {
  const { model, history } = setup();
  const a = addBody(history, model);
  const b = addBody(history, model);
  const shape = model.children(a, 'fixtures')[0];
  history.execute(command('Move', (tx) => tx.move(shape, b, 'fixtures', 0)));
  assert.deepEqual(model.children(a, 'fixtures'), []);
  assert.equal(model.children(b, 'fixtures')[0], shape);
  history.undo();
  assert.deepEqual(model.children(a, 'fixtures'), [shape]);
  assert.equal(model.get(shape).parent, a);
  history.redo();
  assert.equal(model.get(shape).parent, b);
  assert.equal(model.children(b, 'fixtures')[0], shape);
});

test('a compound command is one change, one undo step and one undo change', () => {
  const { model, history, changes } = setup();
  const a = addBody(history, model);
  const b = addBody(history, model);
  const before = snapshotOf(model);
  changes.length = 0;
  history.execute(
    command('Compound', (tx) => {
      tx.set(a, 'name', 'left');
      tx.remove(b);
      tx.add(ROOT_UID, 'bodies', 0, bodySnapshot(model));
      tx.set(ROOT_UID, 'rootBody', model.prop(a, 'id'));
    }),
  );
  assert.equal(changes.length, 1);
  const after = snapshotOf(model);
  assert.equal(history.state.undoLabel, 'Compound');
  history.undo();
  assert.equal(changes.length, 2);
  assert.equal(changes[1].cause, 'undo');
  assert.deepEqual(snapshotOf(model), before);
  history.redo();
  assert.deepEqual(snapshotOf(model), after);
  history.undo();
  history.undo();
  assert.equal(model.get(b), null);
});

test('run reads its own writes and tx.add returns the new uid', () => {
  const { model, history } = setup();
  const result = history.execute(
    command('Add and rename', (tx) => {
      const uid = tx.add(ROOT_UID, 'bodies', undefined, bodySnapshot(model));
      assert.equal(tx.model.get(uid).type, 'body');
      tx.set(uid, 'name', `${tx.model.prop(uid, 'name')}_x`);
      return uid;
    }),
  );
  assert.match(model.prop(result, 'name'), /_x$/);
});

test('a command that throws reverts its ops, records nothing and emits nothing', () => {
  const { model, history, changes, states } = setup();
  const uid = addBody(history, model);
  history.execute(setName(uid, 'a'));
  history.undo();
  changes.length = 0;
  states.length = 0;
  const failure = new Error('precondition');
  assert.throws(
    () =>
      history.execute(
        command('Broken', (tx) => {
          tx.set(uid, 'name', 'changed');
          tx.add(ROOT_UID, 'bodies', undefined, bodySnapshot(model));
          throw failure;
        }),
      ),
    (error) => error === failure,
  );
  assert.equal(model.prop(uid, 'name'), `body_${model.prop(uid, 'id')}`);
  assert.equal(model.children(ROOT_UID, 'bodies').length, 1);
  assert.deepEqual(changes, []);
  assert.deepEqual(states, []);
  assert.equal(history.state.redoLabel, 'Rename');
  assert.equal(history.state.undoLabel, 'Add body');
});

test('an invalid op inside run reverts the whole command', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  assert.throws(() =>
    history.execute(
      command('Bad', (tx) => {
        tx.set(uid, 'name', 'x');
        tx.remove(ROOT_UID);
      }),
    ),
  );
  assert.equal(model.prop(uid, 'name'), `body_${model.prop(uid, 'id')}`);
  assert.equal(history.state.undoLabel, 'Add body');
});

test('a command without effective changes is discarded and keeps redo', () => {
  const { model, history, changes } = setup();
  const uid = addBody(history, model);
  history.execute(setName(uid, 'a'));
  history.undo();
  changes.length = 0;
  const name = model.prop(uid, 'name');
  history.execute(setName(uid, name, 'Same'));
  history.execute(command('Nothing', () => 42));
  assert.deepEqual(changes, []);
  assert.equal(history.state.undoLabel, 'Add body');
  assert.equal(history.canRedo, true);
});

test('a malformed command throws a TypeError and the transaction closes after run', () => {
  const { model, history } = setup();
  assert.throws(() => history.execute({ label: 'x' }), TypeError);
  assert.throws(() => history.execute({ run() {} }), TypeError);
  let leaked;
  history.execute(command('Leak', (tx) => (leaked = tx)));
  assert.throws(() => leaked.set(ROOT_UID, 'meta.name', 'late'), /closed/);
  assert.equal(model.prop(ROOT_UID, 'meta.name'), 'root');
});

test('a new step clears redo', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  history.execute(setName(uid, 'a'));
  history.undo();
  assert.equal(history.canRedo, true);
  history.execute(setName(uid, 'b'));
  assert.equal(history.canRedo, false);
  assert.equal(history.redo(), false);
});

test('undo and redo return false when there is nothing to do', () => {
  const { history, states } = setup();
  assert.equal(history.undo(), false);
  assert.equal(history.redo(), false);
  assert.deepEqual(states, []);
});

test('the stack keeps HISTORY_LIMIT steps and drops the oldest', () => {
  const { model, history } = setup();
  for (let index = 0; index <= HISTORY_LIMIT; index++) {
    history.execute(command(`Step ${index}`, (tx) => tx.set(ROOT_UID, 'meta.name', `n${index}`)));
  }
  let undone = 0;
  while (history.undo()) undone++;
  assert.equal(undone, HISTORY_LIMIT);
  assert.equal(model.prop(ROOT_UID, 'meta.name'), 'n0');
  assert.equal(history.state.redoLabel, 'Step 1');
});

test('a custom limit is honored and must be a positive integer', () => {
  const { model, history } = setup({ limit: 3 });
  for (let index = 0; index < 5; index++) {
    history.execute(command(`Step ${index}`, (tx) => tx.set(ROOT_UID, 'meta.name', `n${index}`)));
  }
  let undone = 0;
  while (history.undo()) undone++;
  assert.equal(undone, 3);
  assert.equal(model.prop(ROOT_UID, 'meta.name'), 'n1');
  assert.throws(() => new History(new Model(), { limit: 0 }), RangeError);
  assert.throws(() => new History(new Model(), { limit: 1.5 }), RangeError);
});

test('a gesture is one undo step with one change per command', () => {
  const { model, history, changes } = setup();
  const uid = addBody(history, model);
  changes.length = 0;
  history.beginGesture();
  assert.equal(history.inGesture, true);
  for (let x = 1; x <= 10; x++) history.execute(command(`Move ${x}`, (tx) => tx.set(uid, 'angle', x)));
  assert.equal(changes.length, 10);
  assert.ok(changes.every((change) => change.cause === 'do'));
  assert.equal(history.state.undoLabel, 'Move 1');
  assert.equal(history.endGesture(), true);
  assert.equal(history.inGesture, false);
  assert.equal(history.state.undoLabel, 'Move 1');
  history.undo();
  assert.equal(model.prop(uid, 'angle'), 0);
  assert.equal(changes.at(-1).changes.length, 1);
  history.undo();
  assert.equal(model.get(uid), null);
  history.redo();
  history.redo();
  assert.equal(model.prop(uid, 'angle'), 10);
});

test('a gesture is labelled after its first command with changes', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  history.beginGesture();
  history.execute(command('Noop', () => {}));
  history.execute(setName(uid, model.prop(uid, 'name'), 'Same'));
  history.execute(setName(uid, 'x', 'Rename'));
  history.execute(setName(uid, 'y', 'Other'));
  history.endGesture();
  assert.equal(history.state.undoLabel, 'Rename');
});

test('gesture coalescing does not merge across an overlapping path set', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  history.execute(command('Init', (tx) => tx.set(uid, 'sprite', { offset: { x: 0, y: 0 }, angle: 0 })));
  const before = model.get(uid).props;
  history.beginGesture();
  history.execute(command('A', (tx) => tx.set(uid, 'sprite.offset', { x: 1, y: 0 })));
  history.execute(command('B', (tx) => tx.set(uid, 'sprite', { offset: { x: 5, y: 5 }, angle: 1 })));
  history.execute(command('C', (tx) => tx.set(uid, 'sprite.offset', { x: 2, y: 0 })));
  history.endGesture();
  const after = model.get(uid).props;
  assert.deepEqual(after.sprite, { offset: { x: 2, y: 0 }, angle: 1 });
  history.undo();
  assert.deepEqual(model.get(uid).props, before);
  history.redo();
  assert.deepEqual(model.get(uid).props, after);
});

test('gesture coalescing does not merge across a remove and add of the same node', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  const before = snapshotOf(model);
  history.beginGesture();
  history.execute(setName(uid, 'a'));
  history.execute(
    command('Replace', (tx) => {
      const snapshot = structuredClone(tx.model.get(uid));
      const fixtures = tx.model.children(uid, 'fixtures').map((shape) => ({
        uid: shape,
        type: 'shape',
        props: tx.model.get(shape).props,
      }));
      tx.remove(uid);
      tx.add(ROOT_UID, 'bodies', 0, { uid, type: 'body', props: snapshot.props, children: { fixtures } });
    }),
  );
  history.execute(setName(uid, 'b'));
  history.endGesture();
  const after = snapshotOf(model);
  assert.equal(model.prop(uid, 'name'), 'b');
  history.undo();
  assert.deepEqual(snapshotOf(model), before);
  history.redo();
  assert.deepEqual(snapshotOf(model), after);
});

test('sets on the same path merge, keeping the first previous value', () => {
  const { model, history, changes } = setup();
  const uid = addBody(history, model);
  history.beginGesture();
  history.execute(command('Name', (tx) => tx.set(uid, 'name', 'a')));
  history.execute(command('Angle', (tx) => tx.set(uid, 'angle', 1)));
  history.execute(command('Name', (tx) => tx.set(uid, 'name', 'b')));
  history.execute(command('Name', (tx) => tx.set(uid, 'name', 'c')));
  history.endGesture();
  changes.length = 0;
  history.undo();
  assert.deepEqual(
    changes[0].changes.map((change) => [change.path, change.value]),
    [
      ['angle', 0],
      ['name', `body_${model.prop(uid, 'id')}`],
    ],
  );
  history.redo();
  assert.equal(model.prop(uid, 'name'), 'c');
  assert.equal(model.prop(uid, 'angle'), 1);
});

test('a gesture that ends where it started leaves no step and keeps redo', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  history.execute(setName(uid, 'kept'));
  history.undo();
  history.beginGesture();
  history.execute(command('Drag', (tx) => tx.set(uid, 'angle', 1.5)));
  assert.equal(history.state.undoLabel, 'Drag');
  history.execute(command('Drag', (tx) => tx.set(uid, 'angle', 0)));
  assert.equal(history.canUndo, true);
  assert.equal(history.state.undoLabel, 'Add body');
  assert.equal(history.endGesture(), false);
  assert.equal(history.state.undoLabel, 'Add body');
  assert.equal(history.state.redoLabel, 'Rename');
});

test('an empty gesture records nothing, and end and cancel without a gesture return false', () => {
  const { history, states } = setup();
  assert.equal(history.endGesture(), false);
  assert.equal(history.cancelGesture(), false);
  history.beginGesture();
  assert.equal(history.endGesture(), false);
  assert.equal(history.canUndo, false);
  assert.deepEqual(
    states.map((state) => state.gesture),
    [true, false],
  );
});

test('beginGesture throws while a gesture is open', () => {
  const { history } = setup();
  history.beginGesture();
  assert.throws(() => history.beginGesture(), /already open/);
});

test('cancelGesture reverts the pending ops with cause cancel and keeps redo', () => {
  const { model, history, changes } = setup();
  const uid = addBody(history, model);
  history.execute(setName(uid, 'kept'));
  history.undo();
  const before = snapshotOf(model);
  history.beginGesture();
  history.execute(setName(uid, 'a'));
  history.execute(command('Add', (tx) => tx.add(ROOT_UID, 'bodies', undefined, bodySnapshot(model))));
  history.execute(setName(uid, 'b'));
  changes.length = 0;
  assert.equal(history.cancelGesture(), true);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].cause, 'cancel');
  assert.deepEqual(snapshotOf(model), before);
  assert.equal(history.inGesture, false);
  assert.equal(history.state.undoLabel, 'Add body');
  assert.equal(history.state.redoLabel, 'Rename');
  assert.equal(history.endGesture(), false);
});

test('cancelling a gesture without ops emits no change', () => {
  const { history, changes } = setup();
  history.beginGesture();
  assert.equal(history.cancelGesture(), true);
  assert.deepEqual(changes, []);
});

test('undo during a gesture only cancels it, and redo does nothing', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  history.execute(setName(uid, 'first'));
  history.execute(setName(uid, 'second'));
  history.undo();
  history.beginGesture();
  history.execute(command('Drag', (tx) => tx.set(uid, 'angle', 2)));
  assert.equal(history.canRedo, false);
  assert.equal(history.state.redoLabel, null);
  assert.equal(history.redo(), false);
  assert.equal(model.prop(uid, 'angle'), 2);
  assert.equal(history.undo(), true);
  assert.equal(history.inGesture, false);
  assert.equal(model.prop(uid, 'angle'), 0);
  assert.equal(model.prop(uid, 'name'), 'first');
  assert.equal(history.state.redoLabel, 'Rename');
  assert.equal(history.endGesture(), false);
});

test('a command that throws inside a gesture leaves the gesture as it was', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  history.beginGesture();
  history.execute(setName(uid, 'a'));
  assert.throws(() =>
    history.execute(
      command('Broken', (tx) => {
        tx.set(uid, 'name', 'z');
        throw new Error('nope');
      }),
    ),
  );
  assert.equal(history.inGesture, true);
  assert.equal(model.prop(uid, 'name'), 'a');
  assert.equal(history.endGesture(), true);
  history.undo();
  assert.equal(model.prop(uid, 'name'), `body_${model.prop(uid, 'id')}`);
});

test('the history event fires only when the state changes', () => {
  const { model, history, states } = setup();
  const uid = addBody(history, model);
  assert.equal(states.length, 1);
  assert.deepEqual(states[0], {
    canUndo: true,
    canRedo: false,
    undoLabel: 'Add body',
    redoLabel: null,
    dirty: true,
    gesture: false,
  });
  assert.ok(Object.isFrozen(states[0]));
  history.execute(setName(uid, 'a', 'Add body'));
  assert.equal(states.length, 1);
  history.beginGesture();
  history.execute(command('Drag', (tx) => tx.set(uid, 'angle', 1)));
  history.execute(command('Drag', (tx) => tx.set(uid, 'angle', 2)));
  assert.deepEqual(
    states.map((state) => [state.gesture, state.undoLabel]),
    [
      [false, 'Add body'],
      [true, 'Add body'],
      [true, 'Drag'],
    ],
  );
});

test('dirty follows the saved point through undo and redo', () => {
  const { model, history } = setup();
  assert.equal(history.dirty, false);
  const uid = addBody(history, model);
  assert.equal(history.dirty, true);
  history.undo();
  assert.equal(history.dirty, false);
  history.redo();
  history.markSaved();
  assert.equal(history.dirty, false);
  history.execute(setName(uid, 'a'));
  assert.equal(history.dirty, true);
  history.undo();
  assert.equal(history.dirty, false);
  history.undo();
  assert.equal(history.dirty, true);
  history.redo();
  assert.equal(history.dirty, false);
});

test('an open gesture with changes is dirty until it is cancelled', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  history.markSaved();
  history.beginGesture();
  assert.equal(history.dirty, false);
  history.execute(setName(uid, 'a'));
  assert.equal(history.dirty, true);
  history.cancelGesture();
  assert.equal(history.dirty, false);
});

test('the saved point is lost when a new step replaces it on the redo stack', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  history.execute(setName(uid, 'a'));
  history.markSaved();
  history.undo();
  history.execute(setName(uid, 'b'));
  history.undo();
  assert.equal(history.dirty, true);
  history.undo();
  assert.equal(history.dirty, true);
  history.redo();
  history.redo();
  assert.equal(history.dirty, true);
  history.markSaved();
  assert.equal(history.dirty, false);
});

test('the saved point is lost when the limit drops it, and kept when it becomes the bottom', () => {
  const lost = setup({ limit: 2 });
  for (let index = 0; index < 3; index++) {
    lost.history.execute(command(`S${index}`, (tx) => tx.set(ROOT_UID, 'meta.name', `n${index}`)));
  }
  while (lost.history.undo());
  assert.equal(lost.history.dirty, true);

  const kept = setup({ limit: 2 });
  kept.history.execute(command('A', (tx) => tx.set(ROOT_UID, 'meta.name', 'a')));
  kept.history.markSaved();
  kept.history.execute(command('B', (tx) => tx.set(ROOT_UID, 'meta.name', 'b')));
  kept.history.execute(command('C', (tx) => tx.set(ROOT_UID, 'meta.name', 'c')));
  assert.equal(kept.history.dirty, true);
  while (kept.history.undo());
  assert.equal(kept.model.prop(ROOT_UID, 'meta.name'), 'a');
  assert.equal(kept.history.dirty, false);
});

test('reset with cause new or load clears both stacks and saves, dropping an open gesture without reverting', () => {
  for (const cause of ['new', 'load']) {
    const { model, history, changes, states } = setup();
    const uid = addBody(history, model);
    history.execute(setName(uid, 'a'));
    history.undo();
    history.beginGesture();
    history.execute(setName(uid, 'b'));
    changes.length = 0;
    model.reset({ type: 'root', props: model.get(ROOT_UID).props }, cause);
    assert.deepEqual(changes, []);
    assert.deepEqual(states.at(-1), {
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      dirty: false,
      gesture: false,
    });
    assert.equal(history.undo(), false);
    assert.equal(history.redo(), false);
    assert.equal(history.endGesture(), false);
  }
});

test('reset with cause recover is dirty until markSaved', () => {
  const { model, history } = setup();
  model.reset({ type: 'root', props: model.get(ROOT_UID).props }, 'recover');
  assert.equal(history.dirty, true);
  assert.equal(history.canUndo, false);
  addBody(history, model);
  history.undo();
  assert.equal(history.dirty, true);
  history.markSaved();
  assert.equal(history.dirty, false);
});

test('history calls from inside run throw and revert the outer command', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  for (const call of [
    () => history.execute(setName(uid, 'inner')),
    () => history.undo(),
    () => history.redo(),
    () => history.beginGesture(),
    () => history.markSaved(),
  ]) {
    assert.throws(
      () =>
        history.execute(
          command('Outer', (tx) => {
            tx.set(uid, 'name', 'outer');
            call();
          }),
        ),
      /in progress/,
    );
    assert.equal(model.prop(uid, 'name'), `body_${model.prop(uid, 'id')}`);
  }
  assert.equal(history.state.undoLabel, 'Add body');
});

test('endGesture and cancelGesture throw from inside run only while a gesture is open', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  history.execute(
    command('Outer', (tx) => {
      assert.equal(history.endGesture(), false);
      assert.equal(history.cancelGesture(), false);
      tx.set(uid, 'name', 'x');
    }),
  );
  history.beginGesture();
  assert.throws(() => history.execute(command('Outer', () => history.endGesture())), /in progress/);
  assert.throws(() => history.execute(command('Outer', () => history.cancelGesture())), /in progress/);
  assert.equal(history.inGesture, true);
});

test('history calls from a model change listener throw, and the call that triggered it still records', () => {
  const { model, history } = setup();
  const uid = addBody(history, model);
  const listener = () => history.undo();
  model.on('change', listener);
  assert.throws(() => history.execute(setName(uid, 'a')), /in progress/);
  model.off('change', listener);
  assert.equal(model.prop(uid, 'name'), 'a');
  assert.equal(history.state.undoLabel, 'Rename');
  history.undo();
  assert.equal(model.prop(uid, 'name'), `body_${model.prop(uid, 'id')}`);
});

test('a throwing model listener does not desynchronize execute, undo, redo or cancel', () => {
  const { model, history, states } = setup();
  const uid = addBody(history, model);
  const failure = new Error('listener');
  const listener = () => {
    throw failure;
  };
  model.on('change', listener);
  assert.equal(states.at(-1).undoLabel, 'Add body');
  assert.throws(() => history.execute(setName(uid, 'a')), (error) => error === failure);
  assert.equal(history.state.undoLabel, 'Rename');
  assert.equal(states.at(-1).undoLabel, 'Rename');
  assert.throws(() => history.undo(), (error) => error === failure);
  assert.equal(history.state.redoLabel, 'Rename');
  assert.equal(states.at(-1).redoLabel, 'Rename');
  assert.throws(() => history.redo(), (error) => error === failure);
  assert.equal(history.state.undoLabel, 'Rename');
  assert.equal(history.canRedo, false);
  history.beginGesture();
  assert.throws(() => history.execute(setName(uid, 'b', 'Drag')), (error) => error === failure);
  assert.equal(history.state.undoLabel, 'Drag');
  assert.throws(() => history.cancelGesture(), (error) => error === failure);
  assert.equal(history.inGesture, false);
  model.off('change', listener);
  assert.equal(model.prop(uid, 'name'), 'a');
  history.undo();
  assert.equal(model.prop(uid, 'name'), `body_${model.prop(uid, 'id')}`);
});

test('a throwing history listener is rethrown after the state is updated', () => {
  const { model, history } = setup();
  const failure = new Error('history listener');
  history.on('history', () => {
    throw failure;
  });
  assert.throws(() => addBody(history, model), (error) => error === failure);
  assert.equal(history.canUndo, true);
});
