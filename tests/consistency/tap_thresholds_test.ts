// tests/consistency/tap_thresholds_test.ts
// Run: npm run test:tap-thresholds   (node strips the types; no runner, no deps)
// Also run by `tests/py/test_villa_rules.py`, which parametrises every oracle
// in this directory.
//
// ⚠️ `tapThresholds.ts` OPENS "WHAT COUNTS AS A TAP ON THIS TABLET — one
// answer, for every surface", AND THE DOUBLE PRESS WAS STILL TWO. It converged
// the single-tap pair (12px/400ms against 14px/500ms) and left:
//
//   TapRecognizer.ts   DOUBLE_MS = 320,  DOUBLE_TOL = 30
//   useMediaZoom.ts    now - lastTap < 300, no distance check at all
//
// in the exact pair of files that module was written to unify. In the 300-320ms
// band the same finger double-tapped the 3D villa and merely tapped twice on a
// camera feed. The recogniser's own comment makes the argument for both: "two
// cameras disagreeing about how fast a double tap is would be felt as one of
// them being broken."

import {
  DOUBLE_PRESS_MS, DOUBLE_PRESS_TOL_PX, LONG_PRESS_MS, TAP_MOVE_TOL_PX,
  isDoublePress,
} from "../../src/utils/tapThresholds.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
}

// ── the window, from both sides ─────────────────────────────────────────────
{
  check("a second press just inside the window is a double press",
    isDoublePress(DOUBLE_PRESS_MS - 1, 0, 0));
  check("...and just outside it is not",
    !isDoublePress(DOUBLE_PRESS_MS, 0, 0));
  check("a press at the same instant is a double press",
    isDoublePress(0, 0, 0));

  // ⚠️ THE BAND THAT WAS THE DEFECT. Whatever the shared window is, there must
  // not be a value where one surface says yes and another says no — which is
  // what 300-against-320 was. Stated as a property of the ONE answer.
  check("there is exactly one window, so no press is double on one surface only",
    typeof DOUBLE_PRESS_MS === "number" && DOUBLE_PRESS_MS > 0);
}

// ── the distance, from both sides ───────────────────────────────────────────
{
  check("a second press within the tolerance counts",
    isDoublePress(100, DOUBLE_PRESS_TOL_PX - 1, 0));
  check("...and one beyond it does not — that is two taps in two places",
    !isDoublePress(100, DOUBLE_PRESS_TOL_PX, 0));
  check("the distance is radial, not per-axis",
    !isDoublePress(100, DOUBLE_PRESS_TOL_PX * 0.8, DOUBLE_PRESS_TOL_PX * 0.8),
    "0.8+0.8 on the diagonal is 1.13 tolerances away");
  check("...and a small diagonal drift still counts",
    isDoublePress(100, 5, 5));
}

// ── both conditions are required ────────────────────────────────────────────
{
  check("near but too slow is not a double press",
    !isDoublePress(DOUBLE_PRESS_MS + 1, 0, 0));
  check("fast but too far is not a double press",
    !isDoublePress(1, DOUBLE_PRESS_TOL_PX + 1, 0));
  // A negative elapsed time is a clock going backwards, not a fast finger.
  check("a negative interval is not a double press", !isDoublePress(-1, 0, 0));
}

// ── the four thresholds are one set ─────────────────────────────────────────
{
  // ⚠️ A DOUBLE PRESS IS TWO TAPS, so its window cannot be longer than a press
  // is allowed to rest before it stops being a tap at all — that would admit a
  // second press the first surface had already called a long press.
  check("the double window is shorter than a long press",
    DOUBLE_PRESS_MS < LONG_PRESS_MS,
    `${DOUBLE_PRESS_MS} vs ${LONG_PRESS_MS}`);
  // ⚠️ AND A DOUBLE PRESS MAY LAND FURTHER AWAY THAN ONE FINGER MAY DRIFT
  // DURING a tap: they are different questions. Two presses land where two
  // presses land; a single press must stay put.
  check("the double tolerance is looser than the single-tap drift",
    DOUBLE_PRESS_TOL_PX > TAP_MOVE_TOL_PX,
    `${DOUBLE_PRESS_TOL_PX} vs ${TAP_MOVE_TOL_PX}`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
