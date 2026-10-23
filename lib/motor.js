import { bodyMassData, shapeBounds, transformPoint } from './geometry.js';

/**
 * Constants of the suggested motor torque (`DESIGN.md` §3.1).
 * @type {Readonly<{ alpha: number, gravity: number, min: number, overpoweredFactor: number, groundBand: number }>}
 *   `alpha` in rad/s², `gravity` in m/s², `min` in N·m; `overpoweredFactor` is the ratio above which
 *   `W_MOTOR_OVERPOWERED` fires; `groundBand` is the fraction of the rest pose's height above its lowest point
 *   within which a body counts as a foot.
 */
export const MOTOR_TORQUE = Object.freeze({ alpha: 100, gravity: 10, min: 0.001, overpoweredFactor: 1000, groundBand: 0.05 });

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
    result.set(body.id, { mass: data.mass, center, inertia: data.inertia, ...verticalExtent(fixtures, frame) });
  }
  return result;
}

function verticalExtent(fixtures, frame) {
  let bottom = Infinity;
  let top = -Infinity;
  for (const fixture of fixtures) {
    if (fixture.isSensor === true) continue;
    try {
      const bounds = shapeBounds(fixture.shape, frame);
      if (!isNumber(bounds.minY) || !isNumber(bounds.maxY)) continue;
      bottom = Math.min(bottom, bounds.minY);
      top = Math.max(top, bounds.maxY);
    } catch {
      continue;
    }
  }
  return { bottom, top };
}

function groundedBodies(bodies) {
  let bottom = Infinity;
  let top = -Infinity;
  for (const body of bodies.values()) {
    bottom = Math.min(bottom, body.bottom);
    top = Math.max(top, body.top);
  }
  const grounded = new Set();
  if (!Number.isFinite(bottom)) return grounded;
  const band = MOTOR_TORQUE.groundBand * Math.max(top - bottom, 0);
  for (const [id, body] of bodies) if (body.bottom <= bottom + band) grounded.add(id);
  return grounded;
}

function footGroups(grounded, edges) {
  const groupOf = new Map();
  const groundEdges = edges.filter((edge) => grounded.has(edge.a) && grounded.has(edge.b));
  for (const id of grounded) {
    if (groupOf.has(id)) continue;
    const group = reachable(id, groundEdges, null);
    for (const member of group) groupOf.set(member, id);
  }
  return groupOf;
}

function readEdges(joints, bodies) {
  const edges = [];
  if (!Array.isArray(joints)) return edges;
  joints.forEach((joint, index) => {
    if (!isObject(joint)) return;
    const { bodyA, bodyB } = joint;
    if (bodies.has(bodyA) && bodies.has(bodyB) && bodyA !== bodyB) edges.push({ index, a: bodyA, b: bodyB });
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
  let x = 0;
  let y = 0;
  for (const id of ids) {
    const body = bodies.get(id);
    if (!(body.mass > 0)) continue;
    const dx = body.center.x - anchor.x;
    const dy = body.center.y - anchor.y;
    mass += body.mass;
    inertia += body.inertia + body.mass * (dx * dx + dy * dy);
    x += body.mass * dx;
    y += body.mass * dy;
  }
  return { mass, inertia, reach: mass > 0 ? Math.hypot(x / mass, y / mass) : 0 };
}

function standsOn(side, groupOf) {
  for (const id of side) if (groupOf.has(id)) return true;
  return false;
}

function loadOf(a, b, sideA, sideB, edge, groupOf) {
  const inside = groupOf.has(edge.a) && groupOf.get(edge.a) === groupOf.get(edge.b);
  const onA = !inside && standsOn(sideA, groupOf);
  const onB = !inside && standsOn(sideB, groupOf);
  if (!onA && !onB) {
    const lighter = a.inertia < b.inertia ? a : b;
    return lighter.mass * lighter.reach;
  }
  return Math.max(onA ? b.mass * b.reach : 0, onB ? a.mass * a.reach : 0);
}

function suggestionFor(joint, edge, edges, bodies, groupOf) {
  if (!edge || !isVec2(joint.anchor)) return null;
  const anchor = { x: joint.anchor[0], y: joint.anchor[1] };
  let sideA = reachable(edge.a, edges, edge);
  let sideB;
  if (sideA.has(edge.b)) {
    sideA = new Set([edge.a]);
    sideB = new Set([edge.b]);
  } else {
    sideB = reachable(edge.b, edges, edge);
  }
  const a = sideAbout(sideA, bodies, anchor);
  const b = sideAbout(sideB, bodies, anchor);
  if (!(a.mass > 0) || !(b.mass > 0) || !(a.inertia + b.inertia > 0)) return null;
  const effective = (a.inertia * b.inertia) / (a.inertia + b.inertia);
  const need = effective * MOTOR_TORQUE.alpha + loadOf(a, b, sideA, sideB, edge, groupOf) * MOTOR_TORQUE.gravity;
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
 * Suggested `motor.maxTorque` of every joint (`DESIGN.md` §3.1): the joint graph is cut at the joint, each
 * side's mass, center and inertia are summed about the anchor in the rest pose, and the result is
 * `roundUp2(I_eff · alpha + M_load · gravity · r_load)`, at least `MOTOR_TORQUE.min`, where the load is the side away
 * from a foot (the bodies within `groundBand` of the rest pose's lowest point), or the lighter side when no foot
 * decides. Pure and cheap enough to run on every edit; never throws and skips bodies and fixtures it cannot read.
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
    const groupOf = footGroups(groundedBodies(bodies), edges);
    if (!Array.isArray(doc?.joints)) return result;
    doc.joints.forEach((joint, index) => {
      if (!isObject(joint) || typeof joint.id !== 'string' || result.has(joint.id)) return;
      result.set(joint.id, suggestionFor(joint, edgeAt.get(index), edges, bodies, groupOf));
    });
  } catch {
    return result;
  }
  return result;
}
