// Oracle for the moon terminator. Replays the exact canvas path arithmetic and
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
process.exit(dOk && !mOk ? 0 : 1);
