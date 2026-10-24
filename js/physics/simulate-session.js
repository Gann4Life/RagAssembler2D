import { RagImporter } from '../../lib/ragimporter.js';
import { composeTransforms, invertTransform } from '../../lib/geometry.js';

/**
 * Simulate mode environment: `gravity` in m/s² along Y when the document has no valid `preview.gravity`, ground
 * `halfWidth` and `halfHeight` in meters, ground `friction` without unit.
 * @type {Readonly<{ gravity: number, halfWidth: number, halfHeight: number, friction: number }>}
 */
export const SIMULATE_WORLD = Object.freeze({
  gravity: -10,
  halfWidth: 50,
  halfHeight: 0.5,
  friction: 0.8,
});

const SUBSTEPS = 8;
const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;

function rootTransform(json) {
  const position = Array.isArray(json.ragdoll?.position) ? json.ragdoll.position : [0, 0];
  return { x: position[0], y: position[1], angle: json.ragdoll?.angle ?? 0 };
}

function gravityOf(json) {
  const gravity = json.preview?.gravity;
  if (Array.isArray(gravity) && gravity.length === 2 && gravity.every(Number.isFinite)) return gravity;
  return [0, SIMULATE_WORLD.gravity];
}

function restBounds(Box2D, rag, root) {
  let lowest = Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const body of rag.bodies.values()) {
    for (let fixture = body.GetFixtureList(); Box2D.getPointer(fixture) !== 0; fixture = fixture.GetNext()) {
      const aabb = fixture.GetAABB(0);
      lowest = Math.min(lowest, aabb.get_lowerBound().get_y());
      left = Math.min(left, aabb.get_lowerBound().get_x());
      right = Math.max(right, aabb.get_upperBound().get_x());
    }
  }
  if (!Number.isFinite(lowest)) return { top: root.y, centerX: root.x };
  return { top: lowest, centerX: (left + right) / 2 };
}

function lowerBy(Box2D, rag, drop) {
  if (drop === 0 || !Number.isFinite(drop)) return;
  const scratch = new Box2D.b2Vec2(0, 0);
  try {
    for (const body of rag.bodies.values()) {
      const position = body.GetPosition();
      scratch.set_x(position.get_x());
      scratch.set_y(position.get_y() - drop);
      body.SetTransform(scratch, body.GetAngle());
    }
  } finally {
    Box2D.destroy(scratch);
  }
}

function spawnOnGround(Box2D, world, def, root, pose) {
  const spawn = { x: root.x, y: root.y, angle: root.angle, flipX: false };
  const rest = def.spawn(world, spawn);
  if (pose === null) return { rag: rest, bounds: restBounds(Box2D, rest, root) };
  let bounds;
  try {
    bounds = restBounds(Box2D, rest, root);
  } finally {
    rest.destroy();
  }
  const rag = def.spawn(world, { ...spawn, pose });
  try {
    lowerBy(Box2D, rag, restBounds(Box2D, rag, root).top - bounds.top);
  } catch (error) {
    rag.destroy();
    throw error;
  }
  return { rag, bounds };
}

function createGround(Box2D, world, { top, centerX }) {
  const bodyDef = new Box2D.b2BodyDef();
  let body;
  try {
    body = world.CreateBody(bodyDef);
  } finally {
    Box2D.destroy(bodyDef);
  }
  const shape = new Box2D.b2PolygonShape();
  const center = new Box2D.b2Vec2(centerX, top - SIMULATE_WORLD.halfHeight);
  try {
    shape.SetAsBox(SIMULATE_WORLD.halfWidth, SIMULATE_WORLD.halfHeight, center, 0);
    body.CreateFixture(shape, 0).SetFriction(SIMULATE_WORLD.friction);
  } finally {
    Box2D.destroy(center);
    Box2D.destroy(shape);
  }
  return body;
}

/**
 * Starts a Simulate mode run: a LiquidFun world with the document's `preview.gravity`, the ragdoll spawned through RagImporter at its root
 * transform in rest pose, or in the pose of clip `options.pose` at time 0 (RagImporter's posed spawn), a static
 * ground whose top touches the lowest point of the rest pose, a posed spawn being moved vertically so that its lowest
 * point touches it too, and the clip with key `options.clip` playing from
 * 0 (none when `null`: the motors hold the rest pose). Owns every native object it creates until `destroy`.
 * @param {*} Box2D The liquidfun.js namespace.
 * @param {object} json A `.rag.json` document.
 * @param {{ clip: string|null, pose?: string|null }} options Key of the clip to play, and key of the clip whose pose
 *   at time 0 the bodies spawn in (`null` or omitted: the rest pose).
 * @returns {import('../timeline-player.js').SimulationSession} The session; `step(dt)` runs 8 substeps of
 *   `rag.update(dt / 8)` then `world.Step(dt / 8, 8, 3)`, `pose()` returns root-local body transforms by body id.
 * @throws {import('../../lib/ragimporter.js').RagFormatError} When the document has validation errors; nothing
 *   native is created.
 * @throws {Error} When the clip key is unknown or a native call fails; everything built is released first.
 */
export function createSimulateSession(Box2D, json, { clip, pose = null }) {
  const def = RagImporter.parse(json);
  const root = rootTransform(json);
  const gravity = new Box2D.b2Vec2(...gravityOf(json));
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  let rag = null;
  let ground = null;

  const release = () => {
    if (rag !== null) rag.destroy();
    if (ground !== null) world.DestroyBody(ground);
    Box2D.destroy(world);
  };

  try {
    const spawned = spawnOnGround(Box2D, world, def, root, pose);
    rag = spawned.rag;
    ground = createGround(Box2D, world, spawned.bounds);
    if (clip !== null) rag.play(clip, { restart: true });
  } catch (error) {
    release();
    throw error;
  }

  const toRoot = invertTransform(root);
  let destroyed = false;
  const alive = () => {
    if (destroyed) throw new Error('Simulate session is destroyed');
  };

  return Object.freeze({
    step(dt) {
      alive();
      const substep = dt / SUBSTEPS;
      for (let i = 0; i < SUBSTEPS; i++) {
        rag.update(substep);
        world.Step(substep, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
      }
    },
    pose() {
      alive();
      const pose = new Map();
      for (const [id, body] of rag.bodies) {
        const position = body.GetPosition();
        const placed = { x: position.get_x(), y: position.get_y(), angle: body.GetAngle() };
        pose.set(id, composeTransforms(toRoot, placed));
      }
      return pose;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      release();
    },
  });
}
