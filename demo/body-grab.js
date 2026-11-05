const IMPULSE_SPEED = 12;
const LIFT = 0.35;
const FORCE_PER_KG = 1000;
const FREQUENCY_HZ = 5;
const DAMPING_RATIO = 0.7;

/**
 * Creates the click-impulse and mouse-joint drag behavior over a world.
 * @param {*} Box2D The liquidfun.js namespace.
 * @param {*} world `Box2D.b2World` that owns the ragdolls and the anchor body.
 * @param {*} anchor Static body the mouse joint is attached to.
 * @returns {{ pick: (instance: *, point: { x: number, y: number }) => (* | null),
 *   grab: (body: *, point: { x: number, y: number }) => void, drag: (point: { x: number, y: number }) => void,
 *   release: () => void, push: (body: *, point: { x: number, y: number }) => void, readonly grabbing: boolean }}
 *   `pick` finds the instance body under a world point (meters), `grab` starts a mouse joint on it, `drag` moves the target,
 *   `release` destroys the joint (call it before the grabbed instance is destroyed) and `push` applies an impulse at the point.
 */
export function createBodyGrab(Box2D, world, anchor) {
  const first = new Box2D.b2Vec2(0, 0);
  const second = new Box2D.b2Vec2(0, 0);
  let mouse = null;
  let joint = null;

  function setFirst(point) {
    first.set_x(point.x);
    first.set_y(point.y);
    return first;
  }

  return {
    get grabbing() {
      return mouse !== null;
    },
    pick(instance, point) {
      if (instance === null) return null;
      setFirst(point);
      for (const body of instance.bodies.values()) {
        for (let fixture = body.GetFixtureList(); Box2D.getPointer(fixture) !== 0; fixture = fixture.GetNext()) {
          if (fixture.TestPoint(first)) return body;
        }
      }
      return null;
    },
    grab(body, point) {
      this.release();
      const def = new Box2D.b2MouseJointDef();
      try {
        def.set_bodyA(anchor);
        def.set_bodyB(body);
        def.set_target(setFirst(point));
        def.set_maxForce(FORCE_PER_KG * body.GetMass());
        def.set_frequencyHz(FREQUENCY_HZ);
        def.set_dampingRatio(DAMPING_RATIO);
        joint = world.CreateJoint(def);
        mouse = Box2D.castObject(joint, Box2D.b2MouseJoint);
      } finally {
        Box2D.destroy(def);
      }
      body.SetAwake(true);
    },
    drag(point) {
      if (mouse !== null) mouse.SetTarget(setFirst(point));
    },
    release() {
      if (joint !== null) world.DestroyJoint(joint);
      joint = null;
      mouse = null;
    },
    push(body, point) {
      const center = body.GetWorldCenter();
      const dx = center.get_x() - point.x;
      const dy = center.get_y() - point.y + LIFT;
      const length = Math.hypot(dx, dy);
      const scale = (IMPULSE_SPEED * body.GetMass()) / length;
      first.set_x(dx * scale);
      first.set_y(dy * scale);
      second.set_x(point.x);
      second.set_y(point.y);
      body.ApplyLinearImpulse(first, second, true);
    },
  };
}
