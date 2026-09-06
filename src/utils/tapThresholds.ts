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
