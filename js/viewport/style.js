/**
 * Viewport colors as `0xRRGGBB` integers: hover and selection, invalid feedback, and gizmos.
 * @type {Readonly<{ highlight: number, invalid: number, gizmo: number }>}
 */
export const COLORS = Object.freeze({ highlight: 0x5b9cf5, invalid: 0xe5484d, gizmo: 0xd8dade });

/**
 * Line widths, CSS px: outlines (hover included) and selection outlines.
 * @type {Readonly<{ outline: number, selected: number }>}
 */
export const LINE_WIDTH = Object.freeze({ outline: 1, selected: 2 });

/**
 * Gizmo sizes, CSS px: root cross arm and ring radius, joint circle radius, limit arc radius, needle and
 * `aimAxis` arrow lengths, center-of-mass marker radius, and the Manipulate rotate knob distance from the pivot,
 * knob radius and pivot cross arm.
 * @type {Readonly<{ rootCross: number, rootRing: number, jointCircle: number, jointArc: number, jointNeedle: number, aimArrow: number, centerOfMass: number, rotateHandle: number, rotateKnob: number, pivot: number }>}
 */
export const GIZMO_SIZE = Object.freeze({
  rootCross: 14,
  rootRing: 10,
  jointCircle: 6,
  jointArc: 20,
  jointNeedle: 20,
  aimArrow: 32,
  centerOfMass: 5,
  rotateHandle: 40,
  rotateKnob: 5,
  pivot: 4,
});

/**
 * Hit radii, CSS px: joint anchors, the root position, the distance around shapes and tool handles.
 * @type {Readonly<{ joint: number, root: number, shape: number, handle: number }>}
 */
export const HIT_RADIUS = Object.freeze({ joint: 8, root: 12, shape: 4, handle: 8 });

/** Overlay label font size, CSS px. */
export const LABEL_SIZE = 11;
