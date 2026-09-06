// tests/consistency/two_finger_test.ts
// Run: npm run test:two-finger   (node strips the types; no runner, no deps)
// Also run by `tests/py/test_villa_rules.py`, which parametrises every oracle
// in this directory.
//
// ⚠️ A MISCLASSIFICATION HERE LOOKS LIKE THE APP IGNORING YOU. A pinch read as
// a tilt tips the villa when the reader meant to zoom; a tilt read as a pinch
// jumps its scale when they meant to tip it. Neither reads as "the wrong branch
// ran", which is why it went untested and why the branch it gates has already
// shipped with its sign inverted, reported from the villa.

import {
  TILT_SHARED_DRIFT_PX, classifyTwoFinger, separationDrift, sharedDrift,
} from "../../src/babylon/twoFingerGesture.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
}

/** A finger that started at `from` and is now at `to`. */
const f = (from: number, to: number) => ({ y: to, startY: from });

// ── two fingers moving together is a drag ───────────────────────────────────
{
  check("both fingers up, well past the threshold, is a tilt",
    classifyTwoFinger(f(400, 340), f(400, 335)) === "tilt");
  check("both fingers down is a tilt too — direction is not the question",
    classifyTwoFinger(f(300, 380), f(300, 375)) === "tilt");
  check("the shared drift is the SMALLER of two agreeing moves",
    sharedDrift(f(400, 340), f(400, 300)) === -60);
  check("...and zero the moment they disagree",
    sharedDrift(f(400, 340), f(400, 460)) === 0);
}

// ── a pinch is a zoom however far it travels ────────────────────────────────
{
  check("fingers moving apart vertically is a zoom",
    classifyTwoFinger(f(300, 200), f(300, 400)) === "zoom");
  check("fingers moving together vertically is a zoom",
    classifyTwoFinger(f(200, 300), f(400, 300)) === "zoom");
  check("one finger still and one moving a long way is a zoom",
    classifyTwoFinger(f(300, 300), f(300, 100)) === "zoom");
  // ⚠️ THIS WAS NAMED "a purely horizontal spread" AND `FingerTrack` HAS NO `x`.
  // What it asserts is that two fingers which have not moved VERTICALLY are a
  // zoom — true, and the right default, but not the thing the name claimed.
  // The classifier never sees horizontal motion at all: that is the caller's
  // (`handleTwoFingerTouch` takes the twist from `atan2` separately), and a
  // test naming an input its subject cannot receive is a test nobody can check.
  check("no vertical drift at all is a zoom, which is the default",
    classifyTwoFinger(f(300, 300), f(300, 300)) === "zoom");
}

// ── the threshold, from both sides ──────────────────────────────────────────
{
  // ⚠️ IT WAS AN UNNAMED `6`, the one sensitivity in OverviewController with no
  // name. Two fingers rarely spread along a perfectly straight line, so a small
  // shared drift during a pinch must NOT steal the zoom.
  const below = TILT_SHARED_DRIFT_PX;
  const above = TILT_SHARED_DRIFT_PX + 1;
  check("a shared drift exactly at the threshold is still a zoom",
    classifyTwoFinger(f(300, 300 - below), f(300, 300 - below)) === "zoom",
    `${below}px`);
  check("one pixel past it is a tilt",
    classifyTwoFinger(f(300, 300 - above), f(300, 300 - above)) === "tilt",
    `${above}px`);
  check("a real pinch with a little shared drift stays a zoom",
    classifyTwoFinger(f(300, 290), f(300, 250)) === "zoom",
    "shared 10, separation 30");
}

// ── drift against separation ────────────────────────────────────────────────
{
  // ⚠️ `>=`, DELIBERATELY. A gesture that is exactly as much drift as
  // separation is a drag with a little spread in it, and reading it as a pinch
  // is the failure that is visible — the villa jumps in scale when the reader
  // meant to tip it.
  check("equal drift and separation is a TILT, not a zoom",
    classifyTwoFinger(f(300, 280), f(300, 260)) === "tilt",
    "shared 20, separation 20");
  check("...and separation just past the drift flips it to zoom",
    classifyTwoFinger(f(300, 280), f(300, 259)) === "zoom",
    "shared 20, separation 21");
  check("separation is measured on the SIGNED moves, not the finger positions",
    separationDrift(f(100, 80), f(500, 480)) === 0,
    "two fingers 400px apart moving identically have not separated at all");
}

// ── the classification is over the WHOLE gesture ────────────────────────────
{
  // ⚠️ `startY`, NOT THE PREVIOUS FRAME. One pointermove carries one finger, so
  // a per-frame reading would see each finger move alone and call every slow
  // tilt a zoom. Twenty 3px steps are a 60px drag, and 3px alone is nothing.
  const slow = classifyTwoFinger(f(400, 340), f(400, 340));
  check("a slow tilt accumulated from the gesture's start is still a tilt",
    slow === "tilt");
  const perFrame = classifyTwoFinger(f(343, 340), f(343, 340));
  check("...and the same motion judged frame by frame would not be",
    perFrame === "zoom",
    "which is why the baseline is the gesture's start");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
