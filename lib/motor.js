import { bodyMassData, transformPoint } from './geometry.js';

/**
 * Constants of the suggested motor torque (`DESIGN.md` §3.1).
 * @type {Readonly<{ alpha: number, gravity: number, min: number, overpoweredFactor: number, margin: number }>}
 *   `alpha` in rad/s², `gravity` in m/s², `min` in N·m; `overpoweredFactor` is the ratio above which
 *   `W_MOTOR_OVERPOWERED` fires; `margin` multiplies the worst-case static load.
 */
export const MOTOR_TORQUE = Object.freeze({ alpha: 100, gravity: 10, min: 0.001, overpoweredFactor: 1000, margin: 2 });

const ROUNDING_SLACK = 1e-9;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVec2(value) {
  return Array.isArray(value) && value.length === 2 && isNumber(value[0]) && isNumber(value[1]);
}

function roundUp2(value) {
  const exponent = Math.floor(Math.log10(value));
  const shift = 1 - exponent;
  const scaled = shift >= 0 ? value * 10 ** shift : value / 10 ** -shift;
  const digits = Math.ceil(scaled - ROUNDING_SLACK);
  return shift >= 0 ? digits / 10 ** shift : digits * 10 ** -shift;
}

function readBodies(bodies) {
  const result = new Map();
  if (!Array.isArray(bodies)) return result;
  for (const body of bodies) {
    if (!isObject(body) || typeof body.id !== 'string' || result.has(body.id)) continue;
    if (!isVec2(body.position) || !isNumber(body.angle)) continue;
    const fixtures = Array.isArray(body.fixtures) ? body.fixtures.filter(isObject) : [];
    const data = bodyMassData(fixtures);
    const frame = { x: body.position[0], y: body.position[1], angle: body.angle };
    const center = data.center === null ? { x: frame.x, y: frame.y } : transformPoint(frame, data.center);
    result.set(body.id, { mass: data.mass, center, inertia: data.inertia, outline: outlineOf(fixtures, frame, center) });
  }
  return result;
}

function shapePoints(shape) {
  if (shape?.type === 'circle' && isVec2(shape.center) && isNumber(shape.radius)) {
    return [{ x: shape.center[0], y: shape.center[1], radius: Math.abs(shape.radius) }];
  }
  if (shape?.type === 'box' && isVec2(shape.center) && isNumber(shape.width) && isNumber(shape.height)) {
    const frame = { x: shape.center[0], y: shape.center[1], angle: isNumber(shape.angle) ? shape.angle : 0 };
    const w = shape.width / 2;
    const h = shape.height / 2;
    return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => ({ ...transformPoint(frame, { x, y }), radius: 0 }));
  }
  if (shape?.type === 'polygon' && Array.isArray(shape.vertices)) {
    return shape.vertices.filter(isVec2).map(([x, y]) => ({ x, y, radius: 0 }));
  }
  return [];
}

function outlineOf(fixtures, frame, center) {
  const outline = [{ x: center.x, y: center.y, radius: 0 }];
  for (const fixture of fixtures) {
    if (fixture.isSensor === true) continue;
    for (const point of shapePoints(fixture.shape)) outline.push({ ...transformPoint(frame, point), radius: point.radius });
  }
  return outline;
}

function readEdges(joints, bodies) {
  const edges = [];
  if (!Array.isArray(joints)) return edges;
  joints.forEach((joint, index) => {
    if (!isObject(joint)) return;
    const { bodyA, bodyB } = joint;
    if (!bodies.has(bodyA) || !bodies.has(bodyB) || bodyA === bodyB) return;
    const anchor = isVec2(joint.anchor) ? { x: joint.anchor[0], y: joint.anchor[1] } : null;
    edges.push({ index, a: bodyA, b: bodyB, anchor });
  });
  return edges;
}

const adjacencies = new WeakMap();

function adjacencyOf(edges) {
  let adjacency = adjacencies.get(edges);
  if (adjacency) return adjacency;
  adjacency = new Map();
  for (const edge of edges) {
    for (const id of [edge.a, edge.b]) {
      if (!adjacency.has(id)) adjacency.set(id, []);
      adjacency.get(id).push(edge);
    }
  }
  adjacencies.set(edges, adjacency);
  return adjacency;
}

function reachable(start, edges, skipped) {
  const adjacency = adjacencyOf(edges);
  const seen = new Set([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    for (const edge of adjacency.get(queue[head]) ?? []) {
      if (edge === skipped) continue;
      const other = edge.a === queue[head] ? edge.b : edge.a;
      if (seen.has(other)) continue;
      seen.add(other);
      queue.push(other);
    }
  }
  return seen;
}

function sideAbout(ids, bodies, anchor) {
  let mass = 0;
  let inertia = 0;
  for (const id of ids) {
    const body = bodies.get(id);
    if (!(body.mass > 0)) continue;
    const dx = body.center.x - anchor.x;
    const dy = body.center.y - anchor.y;
    mass += body.mass;
    inertia += body.inertia + body.mass * (dx * dx + dy * dy);
  }
  return { mass, inertia };
}

function farthest(body, from) {
  let distance = 0;
  for (const point of body.outline) distance = Math.max(distance, Math.hypot(point.x - from.x, point.y - from.y) + point.radius);
  return distance;
}

function chainReach(start, anchor, side, edges, bodies, cut) {
  const adjacency = adjacencyOf(edges);
  const queue = [{ id: start, entry: anchor, along: 0 }];
  const seen = new Set([start]);
  let reach = 0;
  for (let head = 0; head < queue.length; head++) {
    const { id, entry, along } = queue[head];
    reach = Math.max(reach, along + farthest(bodies.get(id), entry));
    for (const edge of adjacency.get(id) ?? []) {
      if (edge === cut || edge.anchor === null) continue;
      const other = edge.a === id ? edge.b : edge.a;
      if (!side.has(other) || seen.has(other)) continue;
      seen.add(other);
      queue.push({ id: other, entry: edge.anchor, along: along + Math.hypot(edge.anchor.x - entry.x, edge.anchor.y - entry.y) });
    }
  }
  return reach;
}

function suggestionFor(edge, edges, bodies) {
  if (!edge || edge.anchor === null) return null;
  const { anchor } = edge;
  let sideA = reachable(edge.a, edges, edge);
  let sideB;
  let whole;
  if (sideA.has(edge.b)) {
    whole = sideA;
    sideA = new Set([edge.a]);
    sideB = new Set([edge.b]);
  } else {
    sideB = reachable(edge.b, edges, edge);
    whole = new Set([...sideA, ...sideB]);
  }
  const a = sideAbout(sideA, bodies, anchor);
  const b = sideAbout(sideB, bodies, anchor);
  if (!(a.mass > 0) || !(b.mass > 0) || !(a.inertia + b.inertia > 0)) return null;
  const effective = (a.inertia * b.inertia) / (a.inertia + b.inertia);
  const lever = Math.min(chainReach(edge.a, anchor, sideA, edges, bodies, edge), chainReach(edge.b, anchor, sideB, edges, bodies, edge));
  const weight = sideAbout(whole, bodies, anchor).mass * MOTOR_TORQUE.gravity;
  const need = effective * MOTOR_TORQUE.alpha + MOTOR_TORQUE.margin * weight * lever;
  if (!Number.isFinite(need)) return null;
  return need > 0 ? Math.max(roundUp2(need), MOTOR_TORQUE.min) : MOTOR_TORQUE.min;
}

function massAbout(ids, bodies) {
  let mass = 0;
  let x = 0;
  let y = 0;
  for (const id of ids) {
    const body = bodies.get(id);
    if (!(body.mass > 0)) continue;
    mass += body.mass;
    x += body.mass * body.center.x;
    y += body.mass * body.center.y;
  }
  return mass > 0 ? { mass, center: { x: x / mass, y: y / mass } } : { mass: 0, center: null };
}

/**
 * Suggested `ragdoll.balance.maxTorque` (`DESIGN.md` §3.2): with `R` = `rootBody` and every body connected to it
 * through joints and `O` = `R` without `rootBody`, `roundUp2(I_tot · alpha + M_O · gravity · |C_O − c_root|)`, at
 * least `MOTOR_TORQUE.min`, where `I_tot` is the inertia of `R` about its common center of mass in the rest pose.
 * Pure; never throws.
 * @param {{ ragdoll: { rootBody: (string|null) }, bodies: ReadonlyArray<object>, joints: ReadonlyArray<object> }} doc
 *   Ragdoll document in file shape, root-local meters and radians.
 * @returns {number|null} N·m; `null` when `rootBody` is not a body id or `R` has zero mass.
 */
export function balanceTorqueSuggestion(doc) {
  try {
    const bodies = readBodies(doc?.bodies);
    const rootBody = doc?.ragdoll?.rootBody;
    if (typeof rootBody !== 'string' || !bodies.has(rootBody)) return null;
    const connected = reachable(rootBody, readEdges(doc?.joints, bodies), null);
    const whole = massAbout(connected, bodies);
    if (!(whole.mass > 0)) return null;
    const inertia = sideAbout(connected, bodies, whole.center).inertia;
    const others = massAbout([...connected].filter((id) => id !== rootBody), bodies);
    const root = bodies.get(rootBody);
    const lever = others.mass > 0 ? Math.hypot(others.center.x - root.center.x, others.center.y - root.center.y) : 0;
    const need = inertia * MOTOR_TORQUE.alpha + others.mass * MOTOR_TORQUE.gravity * lever;
    if (!Number.isFinite(need)) return null;
    return need > 0 ? Math.max(roundUp2(need), MOTOR_TORQUE.min) : MOTOR_TORQUE.min;
  } catch {
    return null;
  }
}

/**
 * Suggested `motor.maxTorque` of every joint (`DESIGN.md` §3.1), the worst case the joint can face: the joint graph is
 * cut at the joint, each side's inertia is summed about the anchor in the rest pose, each side's reach is its farthest
 * non-sensor point from the anchor with every joint of the side straightened, and the result is
 * `roundUp2(I_eff · alpha + margin · M · gravity · min(reach_A, reach_B))`, at least `MOTOR_TORQUE.min`, `M` being the
 * mass of every body connected to the joint. Pure and cheap enough to run on every edit; never throws and skips
 * bodies and fixtures it cannot read.
 * @param {{ bodies: ReadonlyArray<object>, joints: ReadonlyArray<object> }} doc Bodies and joints in file shape,
 *   root-local meters and radians.
 * @returns {Map<string, number|null>} N·m by joint id, first joint of each id; `null` when `bodyA` or `bodyB` is
 *   not a body id, both are the same body, the anchor is unreadable, or a side has zero mass.
 */
export function motorTorqueSuggestions(doc) {
  const result = new Map();
  try {
    const bodies = readBodies(doc?.bodies);
    const edges = readEdges(doc?.joints, bodies);
    const edgeAt = new Map(edges.map((edge) => [edge.index, edge]));
    if (!Array.isArray(doc?.joints)) return result;
    doc.joints.forEach((joint, index) => {
      if (!isObject(joint) || typeof joint.id !== 'string' || result.has(joint.id)) return;
      result.set(joint.id, suggestionFor(edgeAt.get(index), edges, bodies));
    });
  } catch {
    return result;
  }
  return result;
}
