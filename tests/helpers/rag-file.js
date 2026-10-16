function shape(id, name, geometry, asset) {
  return {
    id,
    name,
    shape: geometry,
    density: 1,
    friction: 0.6,
    restitution: 0,
    isSensor: false,
    selfCollide: false,
    filter: { categoryBits: 2, maskBits: 65527 },
    sprite: asset === null ? null : { asset, offset: [0, 0], angle: 0, scale: [1, 1], z: 0, visible: true },
    editor: { color: '#c8a07a' },
  };
}

function body(id, name, position, angle, fixture) {
  return {
    id,
    name,
    position,
    angle,
    linearDamping: 0.2,
    angularDamping: 0.3,
    fixedRotation: false,
    bullet: false,
    fixtures: [fixture],
  };
}

function joint(id, name, bodyA, bodyB, anchor, limits, aimAxis) {
  return {
    id,
    name,
    type: 'revolute',
    bodyA,
    bodyB,
    anchor,
    collideConnected: false,
    limits,
    motor: { maxTorque: 80, gain: 10, damping: 0.5, maxSpeed: 20 },
    aimAxis,
  };
}

/**
 * Builds a valid `.rag.json` document with a box, a circle and a polygon body, three joints and one clip.
 * Names `arm` (bodies), `torso` (shapes) and `shoulder` (joints) repeat, so the first in file order wins.
 * @returns {object} A fresh document.
 */
export function ragFile() {
  return {
    format: 'ragassembler',
    version: 1,
    meta: { name: 'sample', editorVersion: '0.1.0' },
    units: { pixelsPerMeter: 40 },
    preview: { gravity: [0, -10] },
    ragdoll: {
      id: 'root',
      name: 'sample',
      position: [5, 7],
      angle: 1.2,
      rootBody: 'b_torso',
      channels: { strength: 1, gain: 1, damping: 1 },
    },
    sprites: [
      { id: 's_a', name: 'a', src: 'parts/a.png' },
      { id: 's_b', name: 'b', src: 'parts/b.png' },
      { id: 's_c', name: 'c', src: 'parts/a.png' },
    ],
    bodies: [
      body('b_torso', 'torso', [0.3, 0.2], 0.1,
        shape('f_torso', 'torso', { type: 'box', center: [0.05, 0.1], width: 0.4, height: 0.6, angle: 0.2 }, 's_a')),
      body('b_head', 'head', [0.3, 0.8], 0.3,
        shape('f_head', 'head', { type: 'circle', center: [0.02, 0.05], radius: 0.15 }, 's_b')),
      body('b_arm', 'arm', [0.7, 0.4], -0.2,
        shape('f_arm', 'upper', { type: 'polygon', vertices: [[0, -0.05], [0.3, -0.05], [0.35, 0.05], [0, 0.05]] }, 's_c')),
      body('b_arm2', 'arm', [-0.2, 0.4], 0,
        shape('f_arm2', 'torso', { type: 'box', center: [0, 0], width: 0.3, height: 0.1, angle: 0 }, null)),
    ],
    joints: [
      joint('j_neck', 'neck', 'b_torso', 'b_head', [0.3, 0.6], { enabled: true, lower: -0.5, upper: 0.2 }, 0.4),
      joint('j_shoulder', 'shoulder', 'b_torso', 'b_arm', [0.6, 0.4], { enabled: true, lower: -1, upper: 0.3 }, 0),
      joint('j_shoulder2', 'shoulder', 'b_torso', 'b_arm2', [0, 0.4], { enabled: false, lower: 0, upper: 0 }, 0),
    ],
    clips: [
      {
        key: 'walk',
        name: 'Walk',
        loop: true,
        hold: true,
        layer: 1,
        blend: 'override',
        length: 2,
        fadeIn: 0,
        fadeOut: 0,
        speed: 1,
        tracks: [{ target: 'j_neck', channel: 'angle', keys: [{ t: 0, v: 0.1, interp: 'linear' }] }],
        events: [{ t: 0.5, name: 'step', data: { foot: 'left', tags: ['a'] } }],
      },
    ],
  };
}
