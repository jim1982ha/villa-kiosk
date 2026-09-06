// src/babylon/twoFingerGesture.ts
//
// Which gesture two fingers are making: a tilt, or a zoom. The rule only, over
// finger coordinates — no camera, no Babylon, no DOM.
//
// ── Why this file exists ──────────────────────────────────────────────────
// The classification lived inside `OverviewController.handleTwoFingerTouch`, a
// method on a class that constructs an `ArcRotateCamera`, so it could only ever
// be exercised by a person putting two fingers on the wall tablet. It is a pure
// function of two finger tracks. `TapRecognizer`'s thresholds were extracted to
// `utils/tapThresholds.ts` for the same reason; this one was not, and it is the
// harder of the two to judge by eye — a pinch that reads as a tilt and a tilt
// that reads as a pinch look like the app ignoring you, not like a wrong branch.
//
// ⚠️ THE BRANCH THIS GATES HAS ALREADY SHIPPED WITH ITS SIGN INVERTED, and it
// was reported from the villa: "beta is measured DOWN FROM straight-up, so a
// bigger beta lowers the camera toward the horizon. Dragging two fingers UP
// must therefore INCREASE beta … Feeding dCentY straight through did the
// opposite: fingers up flattened the view to top-down."

/** How far the two fingers' SHARED vertical drift must reach before a gesture
 *  counts as a tilt rather than a pinch, in CSS pixels.
 *
 *  ⚠️ NAMED, LIKE EVERY OTHER SENSITIVITY IN THIS SUBSYSTEM. It was an inline
 *  `6` — the one dial in `OverviewController` with no name, in the branch whose
 *  sign has already been wrong once. Below it, a small shared drift during a
 *  pinch (two fingers rarely spread on a perfectly straight line) would be read
 *  as a deliberate two-finger drag and steal the zoom. */
export const TILT_SHARED_DRIFT_PX = 6;

export interface FingerTrack {
  /** Where the finger is now. */
  y: number;
  /** Where it was when the gesture began — NOT the previous frame. The
   *  classification is over the whole gesture, so a slow tilt cannot be
   *  reclassified frame by frame into a series of tiny pinches. */
  startY: number;
}

export type TwoFingerGesture = "tilt" | "zoom";

/**
 * The shared vertical drift: how far BOTH fingers have moved the same way.
 *
 * Zero unless they agree on direction, which is the whole distinction — two
 * fingers moving oppositely are a pinch however far they travel, and two moving
 * together are a drag however little.
 */
export function sharedDrift(a: FingerTrack, b: FingerTrack): number {
  const dyA = a.y - a.startY;
  const dyB = b.y - b.startY;
  if (dyA > 0 && dyB > 0) return Math.min(dyA, dyB);
  if (dyA < 0 && dyB < 0) return Math.max(dyA, dyB);
  return 0;
}

/** How much the fingers' vertical SEPARATION has changed — the pinch signal. */
export function separationDrift(a: FingerTrack, b: FingerTrack): number {
  return Math.abs((a.y - a.startY) - (b.y - b.startY));
}

/**
 * Tilt or zoom?
 *
 * Both fingers drifted the same way, that shared drift cleared the threshold,
 * and it outweighs how much their separation changed → a two-finger vertical
 * DRAG, so tilt, and zoom is suppressed so it cannot creep in. Anything else —
 * a pinch, a mostly-horizontal move, one finger still — is a zoom.
 *
 * ⚠️ `>=` ON THE SECOND COMPARISON, DELIBERATELY. A gesture that is exactly as
 * much drift as separation is a drag with a little spread in it, and reading it
 * as a pinch is the failure that is visible: the villa jumps in scale when the
 * reader meant to tip it.
 */
export function classifyTwoFinger(a: FingerTrack, b: FingerTrack): TwoFingerGesture {
  const shared = Math.abs(sharedDrift(a, b));
  return shared > TILT_SHARED_DRIFT_PX && shared >= separationDrift(a, b)
    ? "tilt"
    : "zoom";
}
