// Oracle for the moon terminator.
//
// ⚠️ READ THIS BEFORE TRUSTING THE GREEN. Everything below REPLAYS the canvas
// path rather than calling it — there is no way to run a real CanvasRenderingp
// context under bare node — so on its own it is a DECISION RECORD (it proves
// which sweep flag is right) and not a regression guard. For the life of this
// file it had no imports and no readFileSync at all: NightSky.drawMoon could
// have been rewritten to draw a square and not one line here would have gone
// red. That is exactly the defect entity_value.mjs warns about — a pinned copy
// with no production caller — with the copy on the ORACLE's side this time.
//
// The static pin at the bottom is what ties the replay to the source. It is the
// cheap half of the real fix (lifting the path arithmetic out of drawMoon so it
// can be called); until that happens, this at least fails when the thing it
// replays stops matching.
//
// Replays the exact canvas path arithmetic and
// measures the ENCLOSED AREA by the shoelace formula, so "97% lit draws black"
// becomes a number instead of a description.
const R = 100, N = 2000;

function sample(a0, a1, ccw, rx, ry) {
  // Canvas: angles from +x, increasing toward +y. ccw=true means DECREASING.
  let span = ccw ? -(((a0 - a1) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI))
                 :  (((a1 - a0) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI));
  if (Math.abs(span) < 1e-12) span = ccw ? -2*Math.PI : 2*Math.PI;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const a = a0 + span * (i / N);
    pts.push([rx * Math.cos(a), ry * Math.sin(a)]);
  }
  return pts;
}

/** Enclosed area of the moon path, as a fraction of the full disc. */
function litArea(lit, flagRule) {
  const b = R * Math.abs(1 - 2 * lit);
  const ccw = flagRule(lit);
  const pts = [
    ...sample(-Math.PI/2, Math.PI/2, false, R, R),   // lit limb: right semicircle
    ...sample( Math.PI/2, -Math.PI/2, ccw,  b, R),   // terminator
  ];
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1,y1] = pts[i], [x2,y2] = pts[(i+1) % pts.length];
    a += x1*y2 - x2*y1;
  }
  return Math.abs(a/2) / (Math.PI * R * R);
}

const MAIN = (lit) => lit > 0.5;   // what is on main today
const DEV  = (lit) => lit < 0.5;   // the proposed fix

const phases = [0, 0.05, 0.25, 0.5, 0.75, 0.95, 0.97, 1.0];
console.log("  lit     main(lit>0.5)   dev(lit<0.5)    expected");
for (const lit of phases) {
  const m = litArea(lit, MAIN), d = litArea(lit, DEV);
  console.log(`  ${lit.toFixed(2)}    ${m.toFixed(4)}          ${d.toFixed(4)}         ~${lit.toFixed(2)}`);
}

function verdict(name, rule) {
  const areas = phases.map((l) => litArea(l, rule));
  const monotonic = areas.every((v,i) => i === 0 || v >= areas[i-1] - 1e-9);
  const fullIsFull = Math.abs(litArea(1.0, rule) - 1) < 1e-3;
  const newIsDark  = litArea(0.0, rule) < 1e-3;
  const nearFull   = litArea(0.97, rule) > 0.9;
  console.log(`\n  ${name}`);
  console.log(`    area rises with lit ............ ${monotonic ? "PASS" : "FAIL"}`);
  console.log(`    lit=1.00 is a full disc ........ ${fullIsFull ? "PASS" : "FAIL"}`);
  console.log(`    lit=0.00 draws nothing ......... ${newIsDark ? "PASS" : "FAIL"}`);
  console.log(`    lit=0.97 is nearly full ........ ${nearFull ? "PASS" : `FAIL (${litArea(0.97,rule).toFixed(4)})`}`);
  return monotonic && fullIsFull && newIsDark && nearFull;
}
const mOk = verdict("main  (lit > 0.5)", MAIN);
const dOk = verdict("dev   (lit < 0.5)", DEV);
console.log(`\n  => main ${mOk ? "PASSES" : "FAILS"}, dev ${dOk ? "PASSES" : "FAILS"}`);

// ── the replay above must still match the source ─────────────────────────
import { readFileSync } from "node:fs";
const NS = readFileSync(new URL("../../src/babylon/NightSky.ts", import.meta.url), "utf8");
let pinFail = 0;
const pin = (name, ok) => {
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) pinFail++;
};
console.log("\n  and the source still draws what this file replays:");
pin("drawMoon exists to be replayed", /drawMoon\s*\(/.test(NS));
// The three facts the replay depends on. Change any one in NightSky and the
// areas computed above stop describing the moon anyone sees.
pin("the terminator is still an ellipse, not an arc",
    /ctx\.ellipse\(/.test(NS));
pin("its semi-minor axis is still R * |1 - 2*lit|",
    /R \* Math\.abs\(1 - 2 \* lit\)/.test(NS));
pin("the sweep flag is still `lit < 0.5` — the fix this file argued for",
    /Math\.PI \/ 2, -Math\.PI \/ 2, lit < 0\.5\)/.test(NS));
// ⚠️ `lit > 0.5` is what main ships and what the areas above prove wrong:
// under it a 97%-lit moon encloses 3% of a disc, i.e. draws almost black at
// the brightest phase. Kept as a named rule here so the comparison stays
// legible rather than becoming a bare boolean.
// ⚠️ THE EXIT MOVED TO THE END. It sat above this block, so everything
// below was dead code on the first attempt — the pin printed nothing and
// could not fail. An unreachable assertion is the same as no assertion.
process.exit(dOk && !mOk && !pinFail ? 0 : 1);
