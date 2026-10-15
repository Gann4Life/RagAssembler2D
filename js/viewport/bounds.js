import { composeTransforms, shapeBounds, transformPoint } from '../../lib/geometry.js';
import { ROOT_UID } from '../model/model.js';

/**
 * Body transforms that override the model's rest pose, root-local.
 * @typedef {Map<number, import('../../lib/geometry.js').Transform>} Pose
 */

/** Minimum width and height of a framed box, meters. */
export const FRAME_MIN_SIZE = 1;

/** Width and height of the box framed around the root when the ragdoll has no bodies and no joints, meters. */
export const FRAME_EMPTY_SIZE = 4;

function vec(value) {
  return Array.isArray(value) ? { x: value[0], y: value[1] } : { x: 0, y: 0 };
}

function restTransform(props) {
  const { x, y } = vec(props.position);
  return { x, y, angle: props.angle ?? 0 };
}

function isFiniteBox(box) {
  return [box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite);
}

function grow(box, size) {
  const width = Math.max(box.maxX - box.minX, size);
  const height = Math.max(box.maxY - box.minY, size);
  const x = (box.minX + box.maxX) / 2;
  const y = (box.minY + box.maxY) / 2;
  return { minX: x - width / 2, minY: y - height / 2, maxX: x + width / 2, maxY: y + height / 2 };
}

function inverseTransformPoint(t, p) {
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

class Collector {
  box = null;

  constructor(model, pose) {
    this.model = model;
    this.pose = pose;
    this.root = restTransform(model.get(ROOT_UID).props);
  }

  addBox(box) {
    if (!isFiniteBox(box)) return;
    this.box = this.box
      ? {
          minX: Math.min(this.box.minX, box.minX),
          minY: Math.min(this.box.minY, box.minY),
          maxX: Math.max(this.box.maxX, box.maxX),
          maxY: Math.max(this.box.maxY, box.maxY),
        }
      : box;
  }

  addPoint(p) {
    this.addBox({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y });
  }

  bodyTransform(bodyUid) {
    return this.pose?.get(bodyUid) ?? restTransform(this.model.get(bodyUid).props);
  }

  addRoot() {
    this.addPoint(this.root);
  }

  addShape(shapeUid) {
    const node = this.model.get(shapeUid);
    const body = composeTransforms(this.root, this.bodyTransform(node.parent));
    try {
      this.addBox(shapeBounds(node.props.shape, body));
    } catch {
      return;
    }
  }

  addBody(bodyUid) {
    for (const shapeUid of this.model.children(bodyUid, 'fixtures')) this.addShape(shapeUid);
  }

  addJoint(jointUid) {
    const props = this.model.get(jointUid).props;
    const anchor = vec(props.anchor);
    const bodyA = typeof props.bodyA === 'string' ? this.model.uidOf(props.bodyA) : null;
    const posed = bodyA !== null && this.model.get(bodyA)?.type === 'body' ? this.pose?.get(bodyA) : undefined;
    const local = posed
      ? transformPoint(posed, inverseTransformPoint(restTransform(this.model.get(bodyA).props), anchor))
      : anchor;
    this.addPoint(transformPoint(this.root, local));
  }

  add(uid) {
    switch (this.model.get(uid)?.type) {
      case 'root':
        return this.addRoot();
      case 'body':
        return this.addBody(uid);
      case 'shape':
        return this.addShape(uid);
      case 'joint':
        return this.addJoint(uid);
      default:
        return undefined;
    }
  }
}

/**
 * World box to frame: shapes (through `shapeBounds`), joint anchors and the root position, under the root
 * transform and an optional pose. Of given uids, a body counts its shapes, a shape itself, a joint its anchor
 * and the root its position; other or unknown uids count nothing. The box is grown around its center to at
 * least `FRAME_MIN_SIZE`, or to `FRAME_EMPTY_SIZE` around the root when framing everything in a ragdoll with
 * no bodies and no joints. Sprites are not included.
 * @param {import('../model/model.js').Model} model Document model.
 * @param {Iterable<number>|null} uids Uids to frame, or `null` for everything.
 * @param {Pose|null} [pose] Body transforms replacing the rest pose, e.g. the FK pose in Animate mode.
 * @returns {import('../../lib/geometry.js').Aabb|null} World box in meters; `null` only when the given uids contribute nothing.
 */
export function framingBounds(model, uids, pose = null) {
  const collector = new Collector(model, pose);
  if (uids === null) {
    const bodies = model.children(ROOT_UID, 'bodies');
    const joints = model.children(ROOT_UID, 'joints');
    if (bodies.length === 0 && joints.length === 0) {
      return grow({ minX: collector.root.x, minY: collector.root.y, maxX: collector.root.x, maxY: collector.root.y }, FRAME_EMPTY_SIZE);
    }
    collector.addRoot();
    for (const uid of bodies) collector.addBody(uid);
    for (const uid of joints) collector.addJoint(uid);
  } else {
    for (const uid of uids) collector.add(uid);
  }
  return collector.box ? grow(collector.box, FRAME_MIN_SIZE) : null;
}
