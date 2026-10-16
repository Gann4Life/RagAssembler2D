/**
 * Viewport colors as `0xRRGGBB` integers: hover and selection, invalid feedback, shape outlines, gizmos, the
 * transform gizmo's X arrow, Y arrow, rotation ring and free-move square, and the outline of point handles.
 * @type {Readonly<{ highlight: number, invalid: number, shapeOutline: number, gizmo: number, gizmoX: number, gizmoY: number, gizmoZ: number, gizmoFree: number, handleOutline: number }>}
 */
export const COLORS = Object.freeze({
  highlight: 0x5b9cf5,
  shapeOutline: 0xf08a24,
  gizmoZ: 0x3d6dff,
  invalid: 0xe5484d,
  gizmo: 0xd8dade,
  gizmoX: 0xe0524f,
  gizmoY: 0x58b85c,
  gizmoFree: 0xf2c94c,
  handleOutline: 0x1b1d21,
});

/**
 * Line widths, CSS px: outlines (hover included), selection outlines and transform gizmo strokes.
 * @type {Readonly<{ outline: number, selected: number, gizmo: number }>}
 */
export const LINE_WIDTH = Object.freeze({ outline: 1, selected: 2, gizmo: 2 });

/**
 * Gizmo sizes, CSS px: root cross arm and ring radius, joint circle radius, limit arc radius, needle and
 * `aimAxis` arrow lengths, center-of-mass marker radius, and the transform gizmo: arrow start and tip distances
 * from the pivot, arrow head length and width, free-move square offset and side, rotation ring radius and pivot
 * mark size; resize handle side, and its side when hovered or dragged.
 * @type {Readonly<{ rootCross: number, rootRing: number, jointCircle: number, jointArc: number, jointNeedle: number, aimArrow: number, centerOfMass: number, arrowStart: number, arrowTip: number, arrowHead: number, arrowWidth: number, squareOffset: number, squareSize: number, rotateRing: number, pivot: number, resizeHandle: number, resizeHandleActive: number }>}
 */
export const GIZMO_SIZE = Object.freeze({
  rootCross: 14,
  rootRing: 10,
  jointCircle: 6,
  jointArc: 20,
  jointNeedle: 20,
  aimArrow: 32,
  centerOfMass: 5,
  arrowStart: 16,
  arrowTip: 56,
  arrowHead: 10,
  arrowWidth: 8,
  squareOffset: 16,
  squareSize: 12,
  rotateRing: 72,
  pivot: 4,
  resizeHandle: 8,
  resizeHandleActive: 10,
});

/**
 * Hit radii, CSS px: joint anchors, the root position, the distance around shapes, point handles and the
 * transform gizmo's arrows and ring.
 * @type {Readonly<{ joint: number, root: number, shape: number, handle: number, gizmo: number }>}
 */
export const HIT_RADIUS = Object.freeze({ joint: 8, root: 12, shape: 4, handle: 8, gizmo: 6 });

/** Overlay label font size, CSS px. */
export const LABEL_SIZE = 11;
