// tests/consistency/camera_gesture_test.ts
// Run: npm run test:camera-gesture   (node strips the types; no runner, no deps)
// Also run by `tests/py/test_villa_rules.py`, which parametrises every oracle
// in this directory, so this is a CI gate.
//
// ⚠️ THE WHEEL RULE WAS WRITTEN AS TWO HALVES IN TWO FILES, each a comment
// describing the other's job:
//
//   useMediaZoom.ts:126   if (scale <= MIN_SCALE && |deltaX| >  |deltaY|) return;
//   CameraPanel.tsx:222   if (zoomed            || |deltaX| <= |deltaY|) return;
//
// Exact complements. Loosen one side and the same flick either zooms AND steps
// the camera, or does neither — the failure already reported and repaired once:
// "swiping across a feed to reach the next camera did the one thing it must
// not." Neither half could be tested, because one lives in a `.tsx` and node
// refuses those outright.

import {
  SWIPE_DIR_RATIO, SWIPE_MAX_MS, SWIPE_MIN_PX, WHEEL_STEP_PX,
  swipeStep, wheelOwner, wheelStep,
} from "../../src/components/panels/cameraGestures.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
}

// ── whose wheel is it ───────────────────────────────────────────────────────
{
  // A trackpad's sideways swipe: deltaX, almost no deltaY.
  check("an unzoomed sideways flick belongs to the camera",
    wheelOwner(-90, 2, false) === "camera");
  check("...and to the zoom once the picture is magnified — it is a pan then",
    wheelOwner(-90, 2, true) === "zoom");
  check("a vertical wheel is always the zoom",
    wheelOwner(0, -120, false) === "zoom" && wheelOwner(0, -120, true) === "zoom");
  check("a pinch arrives as ctrl+wheel, which is vertical, so it is unaffected",
    wheelOwner(0, -12, false) === "zoom");

  // ⚠️ THE TIE. `|dx| > |dy|` on one side and `|dx| <= |dy|` on the other means
  // an exactly diagonal wheel goes to the ZOOM. That is arbitrary but it must be
  // ONE arbitrary answer: if both halves claimed it the flick would do both.
  check("a perfectly diagonal wheel goes to exactly one of them",
    wheelOwner(40, 40, false) === "zoom");
  check("...including at zero, which every wheel event technically is",
    wheelOwner(0, 0, false) === "zoom");
}

// ── the two halves cannot both refuse, or both accept ───────────────────────
{
  // ⚠️ THIS IS THE WHOLE POINT OF THE MODULE. The property is not "the rule is
  // right", it is "there is one rule". Exhaustive over the sign/magnitude cases
  // that matter, both zoom states.
  let bad = 0;
  for (const dx of [-120, -40, -1, 0, 1, 40, 120]) {
    for (const dy of [-120, -40, -1, 0, 1, 40, 120]) {
      for (const zoomed of [false, true]) {
        const owner = wheelOwner(dx, dy, zoomed);
        if (owner !== "zoom" && owner !== "camera") bad++;
      }
    }
  }
  check("every wheel event has exactly one owner", bad === 0, `${bad} undecided`);

  // The camera may never take a wheel while the picture is zoomed: that is the
  // pan of a magnified image, and stepping away from it loses the reader's place.
  let stolen = 0;
  for (const dx of [-200, -50, 0, 50, 200]) {
    for (const dy of [-200, 0, 200]) {
      if (wheelOwner(dx, dy, true) === "camera") stolen++;
    }
  }
  check("a zoomed feed never hands the wheel to the camera step", stolen === 0);
}

// ── a wheel gesture steps at most one camera ────────────────────────────────
{
  check("travel under the threshold steps nothing",
    wheelStep(WHEEL_STEP_PX - 1) === 0 && wheelStep(-(WHEEL_STEP_PX - 1)) === 0);
  // ⚠️ CONTENT FOLLOWS THE GESTURE. Scrolling right (positive deltaX) brings
  // the NEXT camera in from the right.
  check("scrolling right brings the next camera in", wheelStep(WHEEL_STEP_PX) === 1);
  check("scrolling left brings the previous one", wheelStep(-WHEEL_STEP_PX) === -1);
}

// ── a touch swipe steps one camera ──────────────────────────────────────────
{
  // ⚠️ THE OPPOSITE SIGN TO THE WHEEL, AND BOTH ARE "content follows the
  // gesture". Dragging the picture LEFT pulls the next camera in from the
  // right; scrolling the wheel right does the same thing. A module holding
  // both is the only place that inversion is visible at all.
  check("swiping left brings the next camera in",
    swipeStep(-SWIPE_MIN_PX, 0, 100) === 1);
  check("swiping right brings the previous one",
    swipeStep(SWIPE_MIN_PX, 0, 100) === -1);

  check("a short drag is not a swipe",
    swipeStep(-(SWIPE_MIN_PX - 1), 0, 100) === 0);
  check("a slow drag is not a swipe — it is a hold that happened to move",
    swipeStep(-200, 0, SWIPE_MAX_MS + 1) === 0);
  check("...and one exactly at the limit still is",
    swipeStep(-200, 0, SWIPE_MAX_MS) === 1);

  // ⚠️ THE DIRECTION RATIO IS WHAT KEEPS A SCROLL FROM BEING A SWIPE. A finger
  // moving mostly down the screen is reading the page, not changing camera.
  check("a mostly-vertical drag is not a swipe",
    swipeStep(-100, 100, 100) === 0);
  // ⚠️ THE BOUNDARY, BOTH SIDES. At |dx| = 100 the rule blocks when
  // |dy| >= 100 / 1.6 = 62.5 — so 63 is a scroll and 62 is a swipe. My first
  // version of this case used 61 and expected a block, which is the ratio
  // arithmetic done wrong in the test rather than in the code; running it is
  // what said so. A bare `|dx| > |dy|` would call BOTH of these a swipe, which
  // is the comparison the ratio replaced.
  check("a drag just past the ratio is a scroll, not a swipe",
    swipeStep(-100, 63, 100) === 0);
  check("...and just inside it is a swipe",
    swipeStep(-100, 62, 100) === 1);
  check("a bare |dx| > |dy| would call both of those a swipe, which is why "
        + "the ratio exists", 100 > 63 && 100 > 62);
}

// ── the thresholds are named, not inline ───────────────────────────────────
{
  check("every threshold is a positive number", [
    SWIPE_MIN_PX, SWIPE_DIR_RATIO, SWIPE_MAX_MS, WHEEL_STEP_PX,
  ].every((n) => typeof n === "number" && n > 0));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
