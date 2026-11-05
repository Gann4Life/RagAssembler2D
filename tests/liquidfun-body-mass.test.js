import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RagImporter } from '../lib/ragimporter.js';
import { bodyMassData } from '../lib/geometry.js';
import { rigDocument } from './helpers/rigs.js';

const require = createRequire(import.meta.url);
const Box2D = require('../vendor/liquidfun.js');

const RELATIVE = 1e-6;

class Container {
  constructor() {
    this.parent = null;
  }

  destroy() {}
}

after(() => RagImporter.configure({ Box2D: null, PIXI: null }));

function massDocument() {
  const json = rigDocument('masses', 'circle', [
    { id: 'circle', at: [0, 0], mass: 2.5, shapes: [{ type: 'circle', center: [0.1, -0.2], radius: 0.3 }] },
    { id: 'box', at: [1, 0], angle: 0.4, mass: 0.7, shapes: [{ type: 'box', center: [0.2, 0.1], width: 0.6, height: 0.2, angle: 0.9 }], parent: 'circle', anchor: [0.5, 0] },
    { id: 'polygon', at: [2, 0], mass: 1, shapes: [{ type: 'polygon', vertices: [[0, 0], [0.5, -0.1], [0.6, 0.3], [0.1, 0.4]] }], parent: 'box', anchor: [1.5, 0] },
    {
      id: 'mixed',
      at: [3, 0],
      mass: 3,
      shapes: [{ type: 'box', center: [0, 0], width: 1, height: 0.5, angle: 0 }, { type: 'box', center: [1, 0], width: 0.5, height: 0.5, angle: 0 }, { type: 'circle', center: [3, 3], radius: 1 }],
      parent: 'polygon',
      anchor: [2.5, 0],
    },
    { id: 'sensors', at: [5, 0], mass: 1.5, shapes: [{ type: 'box', center: [0, 0], width: 2, height: 2, angle: 0 }, { type: 'circle', center: [3, 0], radius: 0.5 }], parent: 'mixed', anchor: [4, 0] },
  ]);
  json.bodies[3].fixtures[2].isSensor = true;
  for (const fixture of json.bodies[4].fixtures) fixture.isSensor = true;
  return json;
}

function close(actual, expected, label) {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= RELATIVE * scale, `${label}: ${actual} != ${expected}`);
}

test('after spawn, Box2D mass, local center and inertia match bodyMassData (DESIGN §3.3)', () => {
  RagImporter.configure({ Box2D, PIXI: { Container } });
  const json = massDocument();
  const gravity = new Box2D.b2Vec2(0, 0);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const rag = RagImporter.parse(json).spawn(world, { x: 0, y: 0 });
  try {
    for (const body of json.bodies) {
      const expected = bodyMassData(body);
      const native = rag.bodies.get(body.id);
      const center = native.GetLocalCenter();
      close(native.GetMass(), body.mass, `${body.id} mass`);
      close(center.get_x(), expected.center.x, `${body.id} center x`);
      close(center.get_y(), expected.center.y, `${body.id} center y`);
      close(native.GetInertia(), expected.inertia + expected.mass * (expected.center.x ** 2 + expected.center.y ** 2), `${body.id} inertia`);
    }
    const densities = [];
    for (let fixture = rag.bodies.get('b_mixed').GetFixtureList(); Box2D.getPointer(fixture) !== 0; fixture = fixture.GetNext()) {
      densities.push(fixture.GetDensity());
    }
    assert.deepEqual(densities.toSorted((a, b) => a - b), [0, 4, 4]);
  } finally {
    rag.destroy();
    Box2D.destroy(world);
  }
});
