// src/components/panels/cameraGestures.ts
//
// What a gesture over a camera feed MEANS. The rules only — no React, no DOM,
// no event objects.
//
// ── Why this file exists ──────────────────────────────────────────────────
// "Zoom the picture, or step to the next camera?" was written as two halves in
// two files, each a comment describing the other's job:
//
//   useMediaZoom.ts    if (scale <= MIN_SCALE && |deltaX| >  |deltaY|) return;
//   CameraPanel.tsx    if (zoomed             || |deltaX| <= |deltaY|) return;
//
// Exact complements, and nothing held them together. Loosen one side and the
// same flick either does BOTH — zooming and changing camera — or neither. That
// failure has already been reported and repaired once: "swiping across a feed
// to reach the next camera did the one thing it must not."
//
// Neither half could be tested, because `CameraPanel` is a `.tsx` and node
// refuses those outright. This module is a `.ts` importing nothing, so
// `tests/consistency/camera_gesture_test.ts` runs it under bare node — the same
// treatment `twoFingerGesture.ts` and `tapThresholds.ts` had, for the same
// reason: a misread gesture does not look like a wrong branch, it looks like
// the app ignoring you.

/** How far a finger must travel across the glass to mean "next camera". */
export const SWIPE_MIN_PX = 48;

/** How much more horizontal than vertical that travel must be.
 *
 *  ⚠️ A RATIO, NOT `|dx| > |dy|`. A finger moving mostly down the screen is
 *  reading, not changing camera, and a bare comparison calls a 51°/49° drag a
 *  swipe. */
export const SWIPE_DIR_RATIO = 1.6;

/** Longer than this and it is a hold that happened to move, not a swipe.
 *
 *  ⚠️ IT LIVED INSIDE THE EFFECT while `LONG_PRESS_MS` (500) sits at module
 *  scope in `utils/tapThresholds.ts` — so the two durations that partition one
 *  finger's press could not be read together. They are different questions
 *  (how long may a TAP rest; how long may a SWIPE take) and they are allowed
 *  to differ, but only where a reader can see both. */
export const SWIPE_MAX_MS = 600;

/** How much wheel travel is one camera step. */
export const WHEEL_STEP_PX = 120;

/** A wheel gesture ends after a quiet moment; that is what re-arms it. */
export const WHEEL_IDLE_MS = 320;

/** -1 previous, 0 nothing, +1 next. */
export type CameraStep = -1 | 0 | 1;

export type WheelOwner = "zoom" | "camera";

/**
 * Who does this wheel event belong to?
 *
 * A trackpad's two-finger SIDEWAYS swipe is a wheel event with `deltaX` and
 * almost no `deltaY`. Treating every wheel as zoom meant that gesture read
 * `deltaY < 0 === false` and zoomed OUT. While the feed is unzoomed a
 * horizontal wheel belongs to the camera step; once zoomed it belongs to the
 * zoom again, as the pan of a magnified image. A pinch arrives as ctrl+wheel,
 * which is vertical, so it is unaffected.
 *
 * ⚠️ THE TIE GOES TO THE ZOOM, and that has to be decided ONCE. The two halves
 * were `|dx| > |dy|` and `|dx| <= |dy|`, so an exactly diagonal wheel — and
 * every `(0, 0)` event, which is most of them on some hardware — fell to the
 * zoom. Arbitrary, but a single arbitrary answer: if both halves claimed it,
 * one flick would zoom AND change camera.
 */
export function wheelOwner(deltaX: number, deltaY: number,
                           zoomed: boolean): WheelOwner {
  if (zoomed) return "zoom";
  return Math.abs(deltaX) > Math.abs(deltaY) ? "camera" : "zoom";
}

/**
 * One camera step from accumulated wheel travel.
 *
 * ⚠️ CONTENT FOLLOWS THE GESTURE: scrolling right (positive `deltaX`) brings
 * the NEXT camera in from the right — the opposite SIGN to `swipeStep`, and
 * the same idea. Dragging the picture left and scrolling the wheel right both
 * pull the next camera in; a module holding both is the only place that
 * inversion is visible.
 */
export function wheelStep(travelPx: number): CameraStep {
  if (Math.abs(travelPx) < WHEEL_STEP_PX) return 0;
  return travelPx > 0 ? 1 : -1;
}

/**
 * One camera step from a finger's travel and how long it took.
 *
 * ⚠️ SWIPE LEFT MEANS NEXT. The picture follows the finger, so dragging it off
 * to the left brings the next camera in from the right.
 */
export function swipeStep(dx: number, dy: number, elapsedMs: number): CameraStep {
  if (elapsedMs > SWIPE_MAX_MS) return 0;
  if (Math.abs(dx) < SWIPE_MIN_PX) return 0;
  if (Math.abs(dx) <= Math.abs(dy) * SWIPE_DIR_RATIO) return 0;
  return dx < 0 ? 1 : -1;
}
