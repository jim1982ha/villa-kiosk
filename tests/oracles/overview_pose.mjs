// The overview camera's fit and clamps (src/babylon/overviewPose.ts, round
// 11, 2.496.171). fitTo's arithmetic had no test; the clamps were written at
// eight sites with their own fallbacks. The fit is checked against the
// 2.496.170 arithmetic over a grid of extents and aspects, then the clamps by
// name, then that no site clamps by hand again.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const P = await import("@/babylon/overviewPose");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const eq = (a, b) => Math.abs(a - b) < 1e-12;

// ── the 2.496.170 fitTo arithmetic ──
const ref = (ext, aspect) => {
  const span = Math.max(ext.max.x - ext.min.x, ext.max.z - ext.min.z, 4);
  const cs = span * Math.max(1, aspect);
  return { minX: ext.min.x - span * 0.25, maxZ: ext.max.z + span * 0.25, lo: Math.max(2, span * 0.08), hi: cs * 2.2,
    tx: (ext.min.x + ext.max.x) / 2, ty: ext.min.y + 1, tz: (ext.min.z + ext.max.z) / 2, r: cs * 1.05 };
};
let bad = 0, n = 0;
for (const w of [1, 3, 12, 30, 80]) for (const d of [2, 9, 25]) for (const aspect of [0.6, 1, 1.4, 2.2]) {
  const ext = { min: { x: -w / 3, y: -0.5, z: -d / 2 }, max: { x: (2 * w) / 3, y: 6, z: d / 2 } };
  const f = P.fitFrame(ext, aspect), r = ref(ext, aspect); n++;
  if (!(eq(f.bounds.minX, r.minX) && eq(f.bounds.maxZ, r.maxZ) && eq(f.limits.lo, r.lo) && eq(f.limits.hi, r.hi)
    && eq(f.target.x, r.tx) && eq(f.target.y, r.ty) && eq(f.target.z, r.tz) && eq(f.radius, r.r))) bad++;
}
ck(`fitFrame matches the old fitTo over ${n} extents × aspects`, bad === 0, bad);

const f = P.fitFrame({ min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 6, z: 10 } }, 2);
ck("a portrait viewport widens the shot AND the zoom-out limit with it (fit stays inside)", f.radius === 20 * 2 * 1.05 && f.limits.hi > f.radius);
ck("a tiny model still gets a 4 m span and a 2 m zoom-in floor", P.fitFrame({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, 1).limits.lo === 2);
ck("zoom clamps to the limits", P.clampRadius(1, { lo: 3, hi: 50 }) === 3 && P.clampRadius(99, { lo: 3, hi: 50 }) === 50);
ck("tilt stays between ~3° (0.05 rad) and ~80° (1.4 rad)", P.clampBeta(0) === 0.05 && P.clampBeta(2) === 1.4 && P.clampBeta(0.7) === 0.7);
const B = { minX: -1, maxX: 1, minZ: -2, maxZ: 2 };
ck("pan stays inside the bounds on all four sides",
   JSON.stringify([P.clampTarget(-5, -5, B), P.clampTarget(5, 5, B), P.clampTarget(0.5, 1, B)]) === JSON.stringify([{ x: -1, z: -2 }, { x: 1, z: 2 }, { x: 0.5, z: 1 }]));
const pose = P.clampPose({ alpha: 1, beta: 3, radius: 500, target: { x: 99, y: 7, z: -99 } }, f.bounds, f.limits);
ck("a saved pose is brought inside this model (height free)",
   pose.beta === P.BETA_MAX && pose.radius === f.limits.hi && pose.target.x === f.bounds.maxX && pose.target.z === f.bounds.minZ && pose.target.y === 7);

const src = (p) => readFileSync(new URL(`../../src/babylon/${p}`, import.meta.url), "utf8");
const oc = src("OverviewController.ts"), sm = src("SceneManager.ts");
ck("OverviewController clamps only through overviewPose (no clamp(), no `?? 2`/`?? 200`)",
   !/\bclamp\(/.test(oc.replace(/\/\/.*$|^\s*\*.*$/gm, "")) && !/RadiusLimit \?\?/.test(oc) && /fitFrame\(ext,/.test(oc));
ck("SceneManager reads the controller's limits, with no fallback of its own",
   !/lowerRadiusLimit \?\?|lowerBetaLimit \?\?/.test(sm) && /getRadiusLimits\(\)\.lo/.test(sm));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ the overview camera's fit and clamps, one module");
