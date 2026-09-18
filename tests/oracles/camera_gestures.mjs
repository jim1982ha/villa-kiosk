// tests/oracles/camera_gestures.mjs
//
// ⚠️ THE THIRD PROMISE THAT WAS NEVER KEPT. cameraGestures.ts's header named
// a camera_gesture_test.ts under tests/consistency/ and said it "runs this
// under bare node" — no such file was ever written, and the module's own argument is that the rule was written
// as two complementary halves in two files with nothing holding them together,
// a failure already reported once ("swiping across a feed to reach the next
// camera did the one thing it must not"). Five constants were exported for a
// test that was never written.
//
// The citation is corrected to point here.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  wheelOwner, wheelStep, swipeStep,
  SWIPE_MIN_PX, SWIPE_DIR_RATIO, SWIPE_MAX_MS, WHEEL_STEP_PX,
} from "../../src/components/panels/cameraGestures.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};

// ── the tie, which is the whole reason the module exists ─────────────────
console.log("  one wheel event has exactly one owner:");
eq("a sideways trackpad swipe is the camera's",  wheelOwner(-40, 2, false), "camera");
eq("a vertical wheel is the zoom's",             wheelOwner(0, -40, false), "zoom");
eq("an exactly diagonal wheel goes to the zoom", wheelOwner(30, 30, false), "zoom");
eq("...and so does a (0,0) event, which is most of them on some hardware",
   wheelOwner(0, 0, false), "zoom");
eq("once zoomed, everything is the zoom's",      wheelOwner(-90, 1, true), "zoom");
// The two halves were `|dx| > |dy|` and `|dx| <= |dy|`. Loosen one and a single
// flick either does BOTH — zooming and changing camera — or neither. Exhaustive
// check that no input can be claimed twice or dropped:
const OWNERS = new Set();
for (const dx of [-90, -1, 0, 1, 90]) for (const dy of [-90, -1, 0, 1, 90]) for (const z of [true, false]) {
  OWNERS.add(wheelOwner(dx, dy, z));
}
eq("every input resolves to one of the two owners, never neither",
   [...OWNERS].sort(), ["camera", "zoom"]);

// ── the inversion only this module can see ───────────────────────────────
console.log("\n  content follows the gesture, and the two signs are OPPOSITE:");
eq("dragging the picture LEFT brings the next camera in", swipeStep(-80, 0, 200), 1);
eq("dragging it right goes back",                         swipeStep(80, 0, 200), -1);
eq("scrolling the wheel RIGHT also brings the next in",   wheelStep(WHEEL_STEP_PX), 1);
eq("scrolling it left goes back",                         wheelStep(-WHEEL_STEP_PX), -1);
// ⚠️ swipeStep returns 1 for NEGATIVE dx and wheelStep returns 1 for POSITIVE
// travel. That is deliberate and is the one fact a reader gets wrong: a module
// holding both is the only place the inversion is visible at all.
eq("the signs genuinely disagree, on purpose",
   Math.sign(swipeStep(-80, 0, 200)) === Math.sign(wheelStep(WHEEL_STEP_PX))
     && Math.sign(-80) !== Math.sign(WHEEL_STEP_PX), true);

// ── the thresholds, at their edges ───────────────────────────────────────
console.log("\n  a swipe has to be far enough, fast enough, and straight enough:");
eq("one pixel short of the distance is nothing",  swipeStep(-(SWIPE_MIN_PX - 1), 0, 200), 0);
eq("exactly the distance counts",                 swipeStep(-SWIPE_MIN_PX, 0, 200), 1);
eq("a millisecond over the time limit is a hold that moved",
   swipeStep(-200, 0, SWIPE_MAX_MS + 1), 0);
eq("exactly the time limit still counts",         swipeStep(-200, 0, SWIPE_MAX_MS), 1);
// ⚠️ A RATIO, NOT |dx| > |dy| — a bare comparison calls a 51°/49° drag a swipe,
// and a finger moving mostly down the screen is reading, not changing camera.
eq("a 51°/49° drag is NOT a swipe",               swipeStep(-100, 98, 200), 0);
eq("just inside the ratio is not either",         swipeStep(-100, 100 / SWIPE_DIR_RATIO, 200), 0);
eq("comfortably past the ratio is",               swipeStep(-100, 40, 200), 1);

console.log("\n  and a wheel step needs a full step of travel:");
eq("just under is nothing",   wheelStep(WHEEL_STEP_PX - 1), 0);
eq("a step never exceeds one", [wheelStep(99999), wheelStep(-99999)], [1, -1]);

// ── nobody may write the rule a second time ──────────────────────────────
const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8", cwd: ROOT })
  .split("\n").filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const src = new Map(files.map((f) => [f, readFileSync(ROOT + f, "utf8")]));
if (src.size < 100) { console.log(`    FAIL  the scan reached the source tree  →  ${src.size}`); process.exit(1); }

console.log("\n  the two halves have not grown back:");
const OWNER = "src/components/panels/cameraGestures.ts";
const halves = [...src].filter(([f, s]) => f !== OWNER &&
  /Math\.abs\(\s*(?:e\.)?delta?X?[A-Za-z]*\s*\)\s*[<>]=?\s*Math\.abs\(/.test(
    s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ""))).map(([f]) => f);
eq("nobody compares |dx| to |dy| outside the owner", halves.length ? halves : "nobody", "nobody");

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ one gesture, one owner, one answer"}`);
process.exit(fail ? 1 : 0);
