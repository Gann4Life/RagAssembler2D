import { balanceTorqueSuggestion, motorTorqueSuggestions } from '../../lib/motor.js';
import { shapeBounds } from '../../lib/geometry.js';

const MOTOR = Object.freeze({ maxTorque: 80, gain: 10, damping: 0.5, maxSpeed: 20 });
const BALANCE = Object.freeze({ enabled: true, maxTorque: 80, gain: 10, damping: 0.5, maxSpeed: 20 });

function box(width, height, center = [0, 0], angle = 0) {
  return { type: 'box', center, width, height, angle };
}

function circle(radius, center = [0, 0]) {
  return { type: 'circle', center, radius };
}

function fixture(id, index, shape, density) {
  return {
    id: `f_${id}_${index}`,
    name: `${id}_${index}`,
    shape,
    density,
    friction: 0.6,
    restitution: 0,
    isSensor: false,
    selfCollide: false,
    filter: { categoryBits: 1, maskBits: 65535 },
    sprite: null,
    editor: { color: '#8c9eb5' },
  };
}

/**
 * Builds a valid format version 2 document from a part list: one body per part, one revolute joint per part with a
 * `parent`, every motor at `MOTOR` and balance on.
 * @param {string} name Ragdoll name.
 * @param {string} rootBody Id of the part used as `rootBody`.
 * @param {ReadonlyArray<{ id: string, at: number[], angle?: number, shapes: object[], density?: number,
 *   parent?: string, anchor?: number[], lower?: number, upper?: number }>} parts Parts, root-local meters and radians.
 * @returns {object} A fresh document.
 */
export function rigDocument(name, rootBody, parts) {
  return {
    format: 'ragassembler',
    version: 2,
    meta: { name, editorVersion: '0.0.0' },
    units: { pixelsPerMeter: 32 },
    preview: { gravity: [0, -10] },
    ragdoll: {
      id: 'root',
      name,
      position: [0, 0],
      angle: 0,
      rootBody: `b_${rootBody}`,
      channels: { strength: 1, gain: 1, damping: 1 },
      balance: { ...BALANCE },
    },
    sprites: [],
    bodies: parts.map((part) => ({
      id: `b_${part.id}`,
      name: part.id,
      position: part.at,
      angle: part.angle ?? 0,
      linearDamping: 0,
      angularDamping: 0,
      fixedRotation: false,
      bullet: false,
      fixtures: part.shapes.map((shape, index) => fixture(part.id, index, shape, part.density ?? 1)),
    })),
    joints: parts.filter((part) => part.parent !== undefined).map((part) => ({
      id: `j_${part.id}`,
      name: part.id,
      type: 'revolute',
      bodyA: `b_${part.parent}`,
      bodyB: `b_${part.id}`,
      anchor: part.anchor,
      collideConnected: false,
      limits: { enabled: part.lower !== undefined, lower: part.lower ?? 0, upper: part.upper ?? 0 },
      motor: { ...MOTOR },
      aimAxis: 0,
    })),
    clips: [],
  };
}

/**
 * Two bodies: a 0.6 × 0.2 m base (`rootBody`) and a 0.1 × 1 m pole hinged on top of it.
 * @returns {{ json: object, pose: Map<string, number> }} Document and a keyed pose, radians by joint id.
 */
export function poleRig() {
  const json = rigDocument('pole', 'base', [
    { id: 'base', at: [0, 0.1], shapes: [box(0.6, 0.2)] },
    { id: 'pole', at: [0, 0.7], shapes: [box(0.1, 1)], parent: 'base', anchor: [0, 0.2], lower: -1.5, upper: 1.5 },
  ]);
  return { json, pose: new Map([['j_pole', 0.5]]) };
}

const CREATURE = [
  { id: 'trunk', box: [0.33, 0.33], at: [0, 0.95], angle: 0.6 },
  { id: 'hip', parent: 'trunk', box: [0.43, 0.45], at: [0, 0.82], angle: 0.7, anchor: [0.02, 0.94], limit: 1.57 },
  { id: 'thigh', parent: 'hip', box: [0.21, 0.53], at: [0.12, 0.58], angle: -0.76, anchor: [0.2, 0.75], limit: 0.8 },
  { id: 'shin', parent: 'thigh', box: [0.19, 0.6], at: [0.02, 0.3], angle: 0.73, anchor: [-0.06, 0.42], limit: 1 },
  { id: 'foot', parent: 'shin', box: [0.19, 0.08], at: [0.21, 0.02], angle: 0.6, anchor: [0.22, 0.03], limit: 0.26 },
  { id: 'toe', parent: 'foot', box: [0.15, 0.07], at: [0.06, -0.06], angle: 0, anchor: [0.12, -0.05], limit: 0.78 },
  { id: 'heel', parent: 'shin', box: [0.25, 0.09], at: [0.39, 0.02], angle: -0.64, anchor: [0.3, 0.09], limit: 0.52 },
  { id: 'claw', parent: 'heel', box: [0.22, 0.07], at: [0.51, -0.07], angle: 0, anchor: [0.43, -0.05], limit: 0.78 },
  { id: 'tail1', parent: 'trunk', box: [0.47, 0.25], at: [-0.29, 0.92], angle: 0, anchor: [-0.17, 1], limit: 0.52 },
  { id: 'tail2', parent: 'tail1', box: [0.47, 0.23], at: [-0.7, 0.96], angle: -0.16, anchor: [-0.51, 0.93], limit: 0.52 },
  { id: 'tail3', parent: 'tail2', box: [0.48, 0.23], at: [-1.11, 1.11], angle: -0.5, anchor: [-0.92, 1], limit: 0.52 },
  { id: 'neck', parent: 'trunk', box: [0.32, 0.41], at: [0.17, 1.21], angle: -0.48, anchor: [0.08, 1.09], limit: 0.52 },
  { id: 'head', parent: 'neck', circle: 0.3, at: [0.39, 1.34], anchor: [0.33, 1.31], limit: 0.52 },
  { id: 'jaw', parent: 'head', box: [0.37, 0.22], at: [0.7, 1.43], angle: -0.32, anchor: [0.59, 1.43], limit: 0.26 },
  { id: 'arm', parent: 'head', box: [0.08, 0.15], at: [0.63, 1.08], angle: 0.57, anchor: [0.52, 1.15], limit: 1.57 },
  { id: 'hand', parent: 'arm', box: [0.06, 0.13], at: [0.68, 1.02], angle: 1.23, anchor: [0.59, 1.06], limit: 0.78 },
  { id: 'finger', parent: 'hand', circle: 0.044, at: [0.7, 0.98], anchor: [0.68, 1.01], limit: 0.78 },
];

/**
 * A one-legged 1.6 kg creature with a long tail whose `rootBody` (the trunk) is about 0.11 kg.
 * @returns {{ json: object, pose: Map<string, number> }} Document and a keyed pose, radians by joint id.
 */
export function creatureRig() {
  const json = rigDocument('creature', 'trunk', CREATURE.map((part) => ({
    id: part.id,
    at: part.at,
    angle: part.angle ?? 0,
    shapes: [part.circle === undefined ? box(...part.box) : circle(part.circle)],
    parent: part.parent,
    anchor: part.anchor,
    lower: part.parent === undefined ? undefined : -part.limit,
    upper: part.parent === undefined ? undefined : part.limit,
  })));
  const pose = new Map([['j_neck', 0.3], ['j_head', -0.2], ['j_tail1', 0.2], ['j_tail2', 0.2], ['j_arm', 0.8], ['j_jaw', 0.2]]);
  return { json, pose };
}

/**
 * A snake of `count` 0.4 × 0.15 m segments lying on the ground, `rootBody` at the tail end.
 * @param {number} [count] Number of segments, default 10.
 * @returns {{ json: object, pose: Map<string, number> }} Document and a keyed pose that raises the head end.
 */
export function snakeRig(count = 10) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    parts.push({
      id: `s${i}`,
      at: [0.4 * i, 0.075],
      shapes: [box(0.4, 0.15)],
      ...(i === 0 ? {} : { parent: `s${i - 1}`, anchor: [0.4 * i - 0.2, 0.075], lower: -0.8, upper: 0.8 }),
    });
  }
  const json = rigDocument('snake', 's0', parts);
  const pose = new Map();
  for (let i = count - 4; i < count; i++) pose.set(`j_s${i}`, 0.35);
  return { json, pose };
}

/**
 * A 2.6 m humanoid whose bodies are made of several overlapping shapes, `rootBody` at the pelvis.
 * @returns {{ json: object, pose: Map<string, number> }} Document and a keyed pose (one leg lifted, arms raised).
 */
export function humanoidRig() {
  const leg = (side, x) => [
    { id: `thigh${side}`, at: [x, 1.2], shapes: [box(0.22, 0.6), box(0.26, 0.5, [0, 0.05], 0.1)], parent: 'pelvis', anchor: [x, 1.5], lower: -2, upper: 0.8 },
    { id: `shin${side}`, at: [x, 0.6], shapes: [box(0.18, 0.6), box(0.22, 0.4, [0, 0.1], -0.1)], parent: `thigh${side}`, anchor: [x, 0.9], lower: 0, upper: 2.5 },
    { id: `foot${side}`, at: [x + 0.08, 0.06], shapes: [box(0.36, 0.12), circle(0.08, [-0.1, 0.04])], parent: `shin${side}`, anchor: [x, 0.3], lower: -0.8, upper: 0.8 },
  ];
  const arm = (side, x) => [
    { id: `upper${side}`, at: [x, 2.0], shapes: [circle(0.08, [0, 0.2]), box(0.13, 0.42)], parent: 'chest', anchor: [x, 2.2], lower: -3, upper: 3 },
    { id: `fore${side}`, at: [x, 1.6], shapes: [box(0.11, 0.4), box(0.09, 0.36, [0.01, 0], 0.08)], parent: `upper${side}`, anchor: [x, 1.8], lower: 0, upper: 2.4 },
    { id: `hand${side}`, at: [x, 1.33], shapes: [circle(0.06), box(0.1, 0.12, [0, -0.04])], parent: `fore${side}`, anchor: [x, 1.4], lower: -0.8, upper: 0.8 },
  ];
  const json = rigDocument('humanoid', 'pelvis', [
    { id: 'pelvis', at: [0, 1.6], shapes: [circle(0.18), box(0.34, 0.3, [0, 0.05], 0.1), box(0.34, 0.3, [0, 0.05], -0.1)] },
    { id: 'chest', at: [0, 2.0], shapes: [box(0.38, 0.5), box(0.36, 0.45, [0.02, 0.02], -0.2), box(0.2, 0.2, [0, 0.25])], parent: 'pelvis', anchor: [0, 1.75], lower: -0.8, upper: 0.8 },
    { id: 'head', at: [0, 2.45], shapes: [circle(0.16), box(0.18, 0.16, [0.06, -0.06])], parent: 'chest', anchor: [0, 2.3], lower: -0.5, upper: 0.8 },
    ...leg('L', -0.12),
    ...leg('R', 0.12),
    ...arm('L', -0.3),
    ...arm('R', 0.3),
  ]);
  const pose = new Map([['j_thighR', -0.9], ['j_shinR', 1.3], ['j_footR', 0.3], ['j_upperL', 1.2], ['j_foreL', 0.6], ['j_upperR', -0.8], ['j_chest', 0.15], ['j_head', -0.2]]);
  return { json, pose };
}

/**
 * A 1.3 m, 0.9 kg biped like a small robot: a light `rootBody` pelvis (94 g) joining two overlapping legs of 20 g
 * thighs, 48 g shins and 120 g feet, a torso, a head and two overlapping arms.
 * @returns {{ json: object, pose: Map<string, number> }} Document and a keyed pose with both knees bent.
 */
export function bipedRig() {
  const leg = (side) => [
    { id: `thigh${side}`, at: [0, 0.55], shapes: [box(0.04, 0.2)], density: 2.5, parent: 'pelvis', anchor: [0, 0.64], lower: -1.05, upper: 1.05 },
    { id: `shin${side}`, at: [0, 0.35], shapes: [box(0.06, 0.2)], density: 4, parent: `thigh${side}`, anchor: [0, 0.45], lower: -1.57, upper: 1.57 },
    { id: `foot${side}`, at: [0.02, 0.12], shapes: [box(0.1, 0.24)], density: 5, parent: `shin${side}`, anchor: [0, 0.25], lower: -1.57, upper: 0.26 },
  ];
  const arm = (side) => [
    { id: `upper${side}`, at: [0, 0.92], shapes: [box(0.06, 0.25)], density: 3, parent: 'torso', anchor: [0, 1.04] },
    { id: `fore${side}`, at: [0, 0.67], shapes: [box(0.06, 0.25)], density: 3, parent: `upper${side}`, anchor: [0, 0.795], lower: -1.05, upper: 1.57 },
  ];
  const json = rigDocument('biped', 'pelvis', [
    { id: 'pelvis', at: [0, 0.7], shapes: [circle(0.1)], density: 3 },
    { id: 'torso', at: [0, 0.95], shapes: [box(0.2, 0.3)], density: 3, parent: 'pelvis', anchor: [0, 0.8], lower: -0.78, upper: 0.78 },
    { id: 'head', at: [0, 1.18], shapes: [circle(0.08)], density: 4, parent: 'torso', anchor: [0, 1.1], lower: -0.78, upper: 0.78 },
    ...leg('L'),
    ...leg('R'),
    ...arm('L'),
    ...arm('R'),
  ]);
  const pose = new Map([['j_thighL', 0.45], ['j_shinL', -0.69], ['j_footL', -0.29], ['j_thighR', -0.24], ['j_shinR', -0.8], ['j_footR', 0.24], ['j_torso', -0.47], ['j_head', 0.16]]);
  return { json, pose };
}

/**
 * Writes the suggested torques into a document, as the editor does on every rig change: every joint's `motor.maxTorque` and
 * `ragdoll.balance.maxTorque`.
 * @param {object} json Document; changed in place.
 * @returns {object} The same document.
 */
export function fitTorque(json) {
  const suggestions = motorTorqueSuggestions(json);
  for (const joint of json.joints) {
    const value = suggestions.get(joint.id);
    if (typeof value === 'number') joint.motor.maxTorque = value;
  }
  const balance = balanceTorqueSuggestion(json);
  if (typeof balance === 'number') json.ragdoll.balance.maxTorque = balance;
  return json;
}

/**
 * Adds a clip `hold` that ramps every joint of `pose` from 0 to its value in `ramp` seconds and holds it.
 * @param {object} json Document; changed in place.
 * @param {Map<string, number>} pose Radians by joint id.
 * @param {number} ramp Ramp duration, seconds, > 0.
 * @returns {string} The clip key.
 */
export function addHoldClip(json, pose, ramp) {
  json.clips.push({
    key: 'hold',
    name: 'hold',
    loop: false,
    hold: true,
    layer: 0,
    blend: 'override',
    length: ramp,
    fadeIn: 0,
    fadeOut: 0,
    speed: 1,
    tracks: [...pose].map(([target, v]) => ({ target, channel: 'angle', keys: [{ t: 0, v: 0, interp: 'linear' }, { t: ramp, v, interp: 'linear' }] })),
    events: [],
  });
  return 'hold';
}

function lowestPoint(json) {
  let lowest = Infinity;
  for (const body of json.bodies) {
    const frame = { x: body.position[0], y: body.position[1], angle: body.angle };
    for (const entry of body.fixtures) lowest = Math.min(lowest, shapeBounds(entry.shape, frame).minY);
  }
  return lowest;
}

/**
 * @typedef {object} HoldResult
 * @property {number} jointError Largest |target − joint angle| of any joint in the second half, degrees.
 * @property {string} worstJoint Joint id of `jointError`.
 * @property {number} jointErrorRms Root mean square of every joint's error in the second half, degrees.
 * @property {number} rootTilt Largest |rootBody angle − rest angle| in the second half, degrees.
 * @property {number} rootTiltPeak Largest root tilt over the whole run, degrees.
 * @property {number} rootSpin Largest |rootBody angular velocity| over the whole run, rad/s.
 * @property {number} jitter Largest angular velocity of any body in the second half, rad/s.
 * @property {number} tremble Root mean square of every body's angular velocity in the second half, rad/s.
 * @property {number} flips Sign changes of the root angular velocity above 0.05 rad/s in the second half.
 * @property {number} energy Largest kinetic energy in the second half, J.
 * @property {number} drop Rest height of `rootBody` minus its lowest height, meters.
 */

/**
 * Runs a ragdoll on a flat ground (top at the rest pose's lowest point, friction 0.8, gravity 10 m/s², each step split
 * into 8 substeps of 8 velocity and 3 position iterations, as Simulate mode does) and measures how firmly it holds its
 * target pose.
 * @param {*} Box2D The liquidfun.js namespace.
 * @param {*} RagImporter RagImporter, configured with `Box2D` and a PIXI stub.
 * @param {object} json Document; not changed.
 * @param {{ pose?: Map<string, number>, seconds?: number, step?: number, ramp?: number, velocityIterations?: number,
 *   substeps?: number }} [options] Keyed pose (none: the rest pose), duration (default 10 s), step (default 1/60 s),
 *   pose ramp (default 1 s), velocity iterations (default 8) and substeps per step (default 8).
 * @returns {HoldResult} Measurements.
 */
export function holdRun(Box2D, RagImporter, json, { pose = new Map(), seconds = 10, step = 1 / 60, ramp = 1, velocityIterations = 8, substeps = 8 } = {}) {
  const doc = structuredClone(json);
  const clip = pose.size > 0 ? addHoldClip(doc, pose, ramp) : null;
  const gravity = new Box2D.b2Vec2(0, -10);
  const world = new Box2D.b2World(gravity);
  Box2D.destroy(gravity);
  const groundDef = new Box2D.b2BodyDef();
  const ground = world.CreateBody(groundDef);
  Box2D.destroy(groundDef);
  const shape = new Box2D.b2PolygonShape();
  const center = new Box2D.b2Vec2(0, lowestPoint(doc) - 0.5);
  shape.SetAsBox(50, 0.5, center, 0);
  ground.CreateFixture(shape, 0).SetFriction(0.8);
  Box2D.destroy(center);
  Box2D.destroy(shape);
  const rag = RagImporter.parse(doc).spawn(world, { x: 0, y: 0 });
  if (clip !== null) rag.play(clip);
  const root = rag.bodies.get(doc.ragdoll.rootBody);
  const restAngle = root.GetAngle();
  const restY = root.GetPosition().get_y();
  let errorSquares = 0;
  let errorSamples = 0;
  const result = { jointError: 0, worstJoint: '', jointErrorRms: 0, rootTilt: 0, rootTiltPeak: 0, rootSpin: 0, jitter: 0, tremble: 0, flips: 0, energy: 0, drop: 0 };
  let previous = 0;
  let spinSquares = 0;
  let samples = 0;
  try {
    const steps = Math.round(seconds / step);
    for (let i = 0; i < steps; i++) {
      for (let k = 0; k < substeps; k++) {
        rag.update(step / substeps);
        world.Step(step / substeps, velocityIterations, 3);
      }
      const late = i >= steps / 2;
      const tilt = Math.abs(root.GetAngle() - restAngle) * 180 / Math.PI;
      const omega = root.GetAngularVelocity();
      result.rootTiltPeak = Math.max(result.rootTiltPeak, tilt);
      result.rootSpin = Math.max(result.rootSpin, Math.abs(omega));
      result.drop = Math.max(result.drop, restY - root.GetPosition().get_y());
      if (!late) continue;
      result.rootTilt = Math.max(result.rootTilt, tilt);
      if (Math.abs(omega) > 0.05 && Math.sign(omega) !== Math.sign(previous)) result.flips++;
      previous = omega;
      let energy = 0;
      for (const body of rag.bodies.values()) {
        const velocity = body.GetLinearVelocity();
        const spin = body.GetAngularVelocity();
        energy += 0.5 * body.GetMass() * (velocity.get_x() ** 2 + velocity.get_y() ** 2) + 0.5 * body.GetInertia() * spin ** 2;
        result.jitter = Math.max(result.jitter, Math.abs(spin));
        spinSquares += spin * spin;
        samples++;
      }
      result.tremble = Math.sqrt(spinSquares / samples);
      result.energy = Math.max(result.energy, energy);
      for (const [id, joint] of rag.joints) {
        const error = Math.abs((pose.get(id) ?? 0) - joint.GetJointAngle()) * 180 / Math.PI;
        errorSquares += error * error;
        errorSamples++;
        result.jointErrorRms = Math.sqrt(errorSquares / errorSamples);
        if (error > result.jointError) {
          result.jointError = error;
          result.worstJoint = id;
        }
      }
    }
    return result;
  } finally {
    rag.destroy();
    world.DestroyBody(ground);
    Box2D.destroy(world);
  }
}
