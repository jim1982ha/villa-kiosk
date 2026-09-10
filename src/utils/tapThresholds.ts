// src/utils/tapThresholds.ts
//
// WHAT COUNTS AS A TAP ON THIS TABLET — one answer, for every surface.
//
// ⚠️ THERE WERE TWO, AND ONE OF THEM CLAIMED TO BE THE ONLY ONE.
// `babylon/TapRecognizer.ts`'s header says "the tap thresholds and the
// ghost-click fix live in exactly one place", and it meant it — but
// `components/panels/CameraPanel.tsx` had its own pair (12px / 400ms against
// 14px / 500ms), so the same finger on the same glass was a tap in the 3D villa
// and a drag on the camera feed, in the 400-500ms band and the 12-14px band.
//
// Converged on the recogniser's values, because its rationale is the one that
// was reasoned about — "generous for fat-finger touch" — and because the scene
// is where a mis-read tap costs the most (it moves the camera).
//
// ⚠️ IMPORTS NOTHING AT RUNTIME, so both consumers can share it without the
// panel gaining an edge to the Babylon tier. Numbers, not behaviour.

/** How far a finger may travel and still be a tap. Generous: a finger on glass
 *  always drifts a little, and a real swipe travels several times this. */
export const TAP_MOVE_TOL_PX = 14;

/** A near-stationary press held past this is a LONG press, not a tap. */
export const LONG_PRESS_MS = 500;

/** Second press within this window, this close, is a DOUBLE press.
 *
 *  ⚠️ THIS FILE'S OWN HEADER SAYS "one answer, for every surface" AND THE
 *  DOUBLE PRESS WAS STILL TWO. It converged the single-tap pair and left
 *  `TapRecognizer`'s `DOUBLE_MS = 320` / `DOUBLE_TOL = 30` against
 *  `useMediaZoom`'s inline `now - lastTap < 300` with no distance check at all
 *  — in the exact pair of files it was written to unify. In the 300-320ms band
 *  the same finger double-tapped the 3D villa and merely tapped twice on a
 *  camera feed.
 *
 *  Converged on the recogniser's values for the reason its own comment gives:
 *  "two cameras disagreeing about how fast a double tap is would be felt as one
 *  of them being broken" — which is as true of two surfaces as of two cameras,
 *  and 320ms/30px are the values first-person shipped with.
 *
 *  ⚠️ THE CAMERA FEED GAINS THE DISTANCE CHECK, which is a real change: a
 *  double-tap whose second press lands more than 30px away no longer resets the
 *  zoom. That is the recogniser's rule, and the argument for it is the same one
 *  — two presses in two places are two taps, wherever the glass is. */
export const DOUBLE_PRESS_MS = 320;

/** How far apart two presses may land and still be one double press.
 *  Looser than `TAP_MOVE_TOL_PX` on purpose: that is how far ONE finger may
 *  drift during a single press, and this is where a SECOND press may land. */
export const DOUBLE_PRESS_TOL_PX = 30;

/** Is this press the second half of a double press?
 *
 *  Both conditions, and both are the point: fast but far apart is two taps in
 *  two places, near but slow is two separate presses.
 */
export function isDoublePress(elapsedMs: number, dx: number, dy: number): boolean {
  if (elapsedMs < 0 || elapsedMs >= DOUBLE_PRESS_MS) return false;
  return Math.hypot(dx, dy) < DOUBLE_PRESS_TOL_PX;
}
