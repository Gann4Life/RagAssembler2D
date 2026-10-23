const CIRCLE_SHAPE = 0;
const OUTLINE = 0x1b1d22;
const BODY_FILL = 0xc8a07a;
const JOINT_COLOR = 0xff5a5a;

function toWorld(body, x, y) {
  const position = body.GetPosition();
  const angle = body.GetAngle();
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: position.get_x() + x * cos - y * sin, y: position.get_y() + x * sin + y * cos };
}

function drawCircle(graphics, body, shape) {
  const center = shape.get_m_p();
  const world = toWorld(body, center.get_x(), center.get_y());
  graphics.circle(world.x, world.y, shape.get_m_radius());
}

function drawPolygon(graphics, body, shape) {
  const points = [];
  for (let i = 0; i < shape.GetVertexCount(); i++) {
    const vertex = shape.GetVertex(i);
    const world = toWorld(body, vertex.get_x(), vertex.get_y());
    points.push(world.x, world.y);
  }
  graphics.poly(points, true);
}

function drawBody(Box2D, graphics, body, fill) {
  for (let fixture = body.GetFixtureList(); Box2D.getPointer(fixture) !== 0; fixture = fixture.GetNext()) {
    const shape = fixture.GetShape();
    if (shape.GetType() === CIRCLE_SHAPE) drawCircle(graphics, body, Box2D.castObject(shape, Box2D.b2CircleShape));
    else drawPolygon(graphics, body, Box2D.castObject(shape, Box2D.b2PolygonShape));
    graphics.fill({ color: fill, alpha: 0.85 });
    graphics.stroke({ color: OUTLINE, width: 0.02 });
  }
}

/**
 * Redraws a world into a PIXI.Graphics in meters, Y up: every body fixture as a filled shape and every
 * joint anchor as a dot. Clears the graphics first.
 * @param {*} Box2D The liquidfun.js namespace.
 * @param {*} graphics `PIXI.Graphics` living in a meter-scaled container.
 * @param {{ bodies: Map<string, *>, joints: Map<string, *> } | null} instance Ragdoll instance, or `null`.
 * @param {*} ground Static ground body.
 * @returns {void}
 */
export function drawPhysics(Box2D, graphics, instance, ground) {
  graphics.clear();
  drawBody(Box2D, graphics, ground, 0x4b5160);
  if (instance === null) return;
  for (const body of instance.bodies.values()) drawBody(Box2D, graphics, body, BODY_FILL);
  for (const joint of instance.joints.values()) {
    const anchor = joint.GetAnchorA();
    graphics.circle(anchor.get_x(), anchor.get_y(), 0.035);
    graphics.fill({ color: JOINT_COLOR });
  }
}
