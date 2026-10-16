import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter } from '../lib/ragimporter.js';
import { composeTransforms, transformPoint } from '../lib/geometry.js';
import { ragFile } from './helpers/rag-file.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

const TOLERANCE = 1e-5;

class Container {
  constructor() {
    this.children = [];
    this.parent = null;
    this.sortableChildren = false;
    this.destroyed = false;
  }

  addChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = null;
    return child;
  }

  destroy() {
    this.destroyed = true;
  }
}

const PIXI = { Container };

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function withWorld(run) {
  RagImporter.configure({ Box2D, PIXI });
  const gravity = new Box2D.b2Vec2(0, -10);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  try {
    return run(world);
  } finally {
    Box2D.destroy(world);
  }
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < TOLERANCE, `${message}: ${actual} != ${expected}`);
}

function heapProbe() {
  const probe = new Box2D.b2Vec2(0, 0);
  const pointer = Box2D.getPointer(probe);
  Box2D.destroy(probe);
  return pointer;
}

function polygonOf(fixture) {
  const polygon = Box2D.castObject(fixture.GetShape(), Box2D.b2PolygonShape);
  const vertices = [];
  for (let i = 0; i < polygon.GetVertexCount(); i++) {
    const vertex = polygon.GetVertex(i);
    vertices.push([vertex.get_x(), vertex.get_y()]);
  }
  return { polygon, vertices };
}

function signedArea(vertices) {
  let sum = 0;
  vertices.forEach(([x, y], i) => {
    const [nx, ny] = vertices[(i + 1) % vertices.length];
    sum += x * ny - nx * y;
  });
  return sum / 2;
}

function mirrored(body) {
  return { x: -body.position[0], y: body.position[1], angle: -body.angle };
}

function local(body) {
  return { x: body.position[0], y: body.position[1], angle: body.angle };
}

test('bodies spawn at S × L in rest pose, ignoring ragdoll.position and angle', () => {
  const json = ragFile();
  const def = RagImporter.parse(json);
  withWorld((world) => {
    const spawn = { x: 2, y: -1, angle: 0.7 };
    const parent = new Container();
    const rag = def.spawn(world, { ...spawn, parent });
    assert.equal(world.GetBodyCount(), 4);
    assert.equal(world.GetJointCount(), 3);
    assert.deepEqual([...rag.bodies.keys()], ['b_torso', 'b_head', 'b_arm', 'b_arm2']);
    assert.deepEqual([...rag.joints.keys()], ['j_neck', 'j_shoulder', 'j_shoulder2']);
    for (const body of json.bodies) {
      const expected = composeTransforms(spawn, local(body));
      const native = rag.bodies.get(body.id);
      near(native.GetPosition().get_x(), expected.x, `${body.id} x`);
      near(native.GetPosition().get_y(), expected.y, `${body.id} y`);
      near(native.GetAngle(), expected.angle, `${body.id} angle`);
      near(native.GetLinearDamping(), 0.2, 'linear damping');
      near(native.GetAngularDamping(), 0.3, 'angular damping');
      assert.equal(native.GetLinearVelocity().get_x(), 0);
      assert.equal(native.IsAwake(), 1);
    }
    const root = composeTransforms(spawn, local(json.bodies[0]));
    near(rag.position.x, root.x, 'position x');
    near(rag.position.y, root.y, 'position y');
    near(rag.angle, root.angle, 'angle');
    for (const joint of json.joints) {
      const native = rag.joints.get(joint.id);
      near(native.GetJointAngle(), 0, `${joint.id} angle`);
      assert.equal(native.IsMotorEnabled(), 0);
      assert.equal(native.IsLimitEnabled(), joint.limits.enabled ? 1 : 0);
      near(native.GetLowerLimit(), joint.limits.lower, 'lower');
      near(native.GetUpperLimit(), joint.limits.upper, 'upper');
      const anchor = transformPoint(spawn, { x: joint.anchor[0], y: joint.anchor[1] });
      near(native.GetAnchorA().get_x(), anchor.x, 'anchor x');
      near(native.GetAnchorB().get_y(), anchor.y, 'anchor y');
    }
    const torso = rag.shape('torso');
    const filter = torso.GetFilterData();
    assert.equal(filter.get_categoryBits(), 2);
    assert.equal(filter.get_maskBits() & 0xffff, 65527);
    assert.equal(filter.get_groupIndex(), 0);
    near(torso.GetFriction(), 0.6, 'friction');
    assert.equal(rag.view.parent, parent);
    assert.equal(rag.view.sortableChildren, true);
    assert.equal(rag.destroyed, false);
  });
});

test('the §7.2 example lands where the spec says, with and without flipX', () => {
  const json = ragFile();
  json.bodies[0].position = [1, 0];
  json.bodies[0].angle = 0.3;
  const def = RagImporter.parse(json);
  withWorld((world) => {
    const plain = def.spawn(world, { x: 2, y: 0, angle: Math.PI / 2 });
    near(plain.position.x, 2, 'x');
    near(plain.position.y, 1, 'y');
    near(plain.angle, Math.PI / 2 + 0.3, 'angle');
    const flipped = def.spawn(world, { x: 2, y: 0, angle: Math.PI / 2, flipX: true });
    near(flipped.position.x, 2, 'flipped x');
    near(flipped.position.y, -1, 'flipped y');
    near(flipped.angle, Math.PI / 2 - 0.3, 'flipped angle');
  });
});

test('flipX mirrors bodies, shapes, anchors and limits and keeps polygons CCW', () => {
  const json = ragFile();
  const def = RagImporter.parse(json);
  withWorld((world) => {
    const spawn = { x: -1, y: 3, angle: 0.4 };
    const rag = def.spawn(world, { ...spawn, flipX: true });
    for (const body of json.bodies) {
      const expected = composeTransforms(spawn, mirrored(body));
      const native = rag.bodies.get(body.id);
      near(native.GetPosition().get_x(), expected.x, `${body.id} x`);
      near(native.GetPosition().get_y(), expected.y, `${body.id} y`);
      near(native.GetAngle(), expected.angle, `${body.id} angle`);
    }
    for (const joint of json.joints) {
      const native = rag.joints.get(joint.id);
      near(native.GetJointAngle(), 0, `${joint.id} angle`);
      near(native.GetLowerLimit(), -joint.limits.upper, 'lower');
      near(native.GetUpperLimit(), -joint.limits.lower, 'upper');
      const anchor = transformPoint(spawn, { x: -joint.anchor[0], y: joint.anchor[1] });
      near(native.GetAnchorA().get_x(), anchor.x, 'anchor x');
      near(native.GetAnchorA().get_y(), anchor.y, 'anchor y');
      near(native.GetAnchorB().get_x(), anchor.x, 'anchor B x');
    }

    const circle = Box2D.castObject(rag.shape('head').GetShape(), Box2D.b2CircleShape);
    near(circle.get_m_p().get_x(), -0.02, 'circle center x');
    near(circle.get_m_p().get_y(), 0.05, 'circle center y');
    near(circle.get_m_radius(), 0.15, 'radius');

    const box = polygonOf(rag.shape('torso'));
    near(box.polygon.get_m_centroid().get_x(), -0.05, 'box center x');
    near(box.polygon.get_m_centroid().get_y(), 0.1, 'box center y');
    const [x0, y0] = box.vertices[0];
    const [x1, y1] = box.vertices[1];
    const edgeAngle = Math.atan2(y1 - y0, x1 - x0);
    const expectedEdge = -0.2;
    const delta = Math.abs(Math.sin(2 * (edgeAngle - expectedEdge)));
    assert.ok(delta < TOLERANCE, `box angle ${edgeAngle}`);
    assert.ok(signedArea(box.vertices) > 0);

    const arm = polygonOf(rag.shape('upper'));
    assert.ok(signedArea(arm.vertices) > 0);
    const expected = json.bodies[2].fixtures[0].shape.vertices.map(([x, y]) => [-x, y]);
    for (const [x, y] of expected) {
      assert.ok(arm.vertices.some(([vx, vy]) => Math.abs(vx - x) < TOLERANCE && Math.abs(vy - y) < TOLERANCE), `${x},${y}`);
    }
  });
});

test('a mirrored passive ragdoll moves as the mirror of the original', () => {
  const def = RagImporter.parse(ragFile());
  withWorld((world) => {
    const rag = def.spawn(world, { flipX: true });
    const plain = def.spawn(world, { x: 10 });
    world.Step(1 / 60, 8, 3);
    for (const id of rag.joints.keys()) {
      near(rag.joints.get(id).GetJointAngle(), -plain.joints.get(id).GetJointAngle(), id);
    }
  });
});

test('name lookups return the first match in file order and undefined for unknown names', () => {
  const def = RagImporter.parse(ragFile());
  withWorld((world) => {
    const rag = def.spawn(world);
    assert.equal(rag.body('arm'), rag.bodies.get('b_arm'));
    assert.equal(rag.joint('shoulder'), rag.joints.get('j_shoulder'));
    assert.equal(Box2D.getPointer(rag.shape('torso').GetBody()), Box2D.getPointer(rag.bodies.get('b_torso')));
    assert.equal(rag.body('nobody'), undefined);
    assert.equal(rag.joint('nobody'), undefined);
    assert.equal(rag.shape('nobody'), undefined);
    assert.equal(rag.joint('neck'), Box2D.castObject(rag.joint('neck'), Box2D.b2RevoluteJoint));
  });
});

test('destroy removes joints, then bodies, and the view, and is idempotent', () => {
  const def = RagImporter.parse(ragFile());
  withWorld((world) => {
    const bodyDef = new Box2D.b2BodyDef();
    world.CreateBody(bodyDef);
    Box2D.destroy(bodyDef);
    const parent = new Container();
    const rag = def.spawn(world, { parent });
    const { bodies, joints, view } = rag;
    let calls = 0;
    const listener = () => calls++;
    const remove = rag.on('event', listener);
    assert.equal(typeof remove, 'function');
    remove();
    rag.on('event', listener);
    rag.destroy();
    assert.equal(world.GetBodyCount(), 1);
    assert.equal(world.GetJointCount(), 0);
    assert.equal(rag.destroyed, true);
    assert.equal(rag.bodies, bodies);
    assert.equal(rag.joints, joints);
    assert.equal(bodies.size, 0);
    assert.equal(joints.size, 0);
    assert.equal(rag.position, null);
    assert.equal(rag.angle, null);
    assert.equal(rag.body('torso'), undefined);
    assert.equal(rag.joint('neck'), undefined);
    assert.equal(rag.shape('head'), undefined);
    assert.equal(view.parent, null);
    assert.equal(view.destroyed, true);
    assert.deepEqual(parent.children, []);
    assert.doesNotThrow(() => rag.destroy());
    assert.equal(calls, 0);
  });
});

test('repeated spawn and destroy do not grow the heap', () => {
  const def = RagImporter.parse(ragFile());
  withWorld((world) => {
    def.spawn(world, { flipX: true }).destroy();
    const before = heapProbe();
    for (let i = 0; i < 2000; i++) def.spawn(world, { x: i % 7, flipX: i % 2 === 0 }).destroy();
    assert.equal(heapProbe(), before);
    assert.equal(world.GetBodyCount(), 0);
  });
});

test('a failure after natives exist rolls back joints and bodies and frees temporaries', () => {
  const def = RagImporter.parse(ragFile());
  withWorld((world) => {
    def.spawn(world).destroy();
    const before = heapProbe();
    RagImporter.configure({
      PIXI: {
        Container: class {
          constructor() {
            throw new Error('no container');
          }
        },
      },
    });
    try {
      assert.throws(() => def.spawn(world), { message: 'no container' });
    } finally {
      RagImporter.configure({ PIXI });
    }
    assert.equal(world.GetBodyCount(), 0);
    assert.equal(world.GetJointCount(), 0);
    assert.equal(heapProbe(), before);
  });
});

test('spawn and destroy throw on a locked world and change nothing', () => {
  const def = RagImporter.parse(ragFile());
  withWorld((world) => {
    const rag = def.spawn(world);
    const host = def.spawn(world, { x: 0.05 });
    const errors = [];
    const listener = new Box2D.JSContactListener();
    listener.EndContact = () => {};
    listener.PreSolve = () => {};
    listener.PostSolve = () => {};
    listener.BeginContact = () => {
      if (errors.length === 0) {
        for (const action of [() => def.spawn(world), () => rag.destroy()]) {
          try {
            action();
            errors.push(null);
          } catch (error) {
            errors.push(error);
          }
        }
      }
    };
    world.SetContactListener(listener);
    for (let i = 0; i < 10 && errors.length === 0; i++) world.Step(1 / 60, 8, 3);
    world.SetContactListener(null);
    Box2D.destroy(listener);
    assert.equal(errors.length, 2);
    for (const error of errors) assert.match(error.message, /locked/);
    assert.equal(rag.destroyed, false);
    assert.equal(world.GetBodyCount(), 8);
    assert.equal(world.GetJointCount(), 6);
    host.destroy();
    rag.destroy();
    assert.equal(world.GetBodyCount(), 0);
  });
});
