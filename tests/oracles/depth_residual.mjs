// tests/oracles/depth_residual.mjs
//
// Placement measures on an ORTHOGRAPHIC plane at one pixels-per-world for the
// whole scene. The renderer divides every drawn thing by its OWN depth. So two
// badges further from the camera than the rung's reference depth draw CLOSER
// TOGETHER than the plane predicted — and a solver that believes them clear
// lets them overlap.
//
// ⚠️ REPORTED FROM THE VILLA: badges overlapping, and one drawn behind another,
// on the far side of the plan. The guess was "the devices are at different
// heights"; the measurement below says the operative quantity is DEPTH, which
// a height difference changes. A height difference alone draws badges further
// APART, not closer — so the obvious reading of the symptom was the wrong one,
// and this file exists so the next reader does not re-derive that.
//
// EntityVisuals used to carry a blanket margin for this
// (GROUP_OVERLAP_ALLOW_WIDTHS), removed in 2.173.0 with "it should stay there"
// because it made EVERYTHING merge earlier, including badges near the camera
// where the residual is zero or negative. The correction pinned here asks each
// badge for exactly the extra room its own depth will cost it.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { viewBasis, projectToView, VIEW_BASIS_STEPS } = await import("@/babylon/badgeProjection");

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};

// An overview pose, looking down at a villa from 30 m.
const R = 30, BETA = 0.5;
const cam = { x: 0, y: R * Math.cos(BETA), z: -R * Math.sin(BETA) };
const f = { x: -cam.x, y: -cam.y, z: -cam.z };
const L = Math.hypot(f.x, f.y, f.z); f.x /= L; f.y /= L; f.z /= L;
const basis = viewBasis(f.x, f.y, f.z, VIEW_BASIS_STEPS, "plane");
const o = { px: 0, py: 0, pz: 0, pd: 0 };
const proj = (p) => { projectToView(basis, p.x, p.y, p.z, o); return { ...o }; };
const trueDepth = (p) => Math.abs((p.x - cam.x) * f.x + (p.y - cam.y) * f.y + (p.z - cam.z) * f.z);
const REF = trueDepth({ x: 0, y: 0, z: 0 });

console.log("  the projection reports the along-view depth it always computed:");
// ⚠️ pd, NOT pz. pz is zero in plane mode and load-bearing where it is not —
// the solver folds it into its HORIZONTAL term and into the spatial hash, so
// making it non-zero under the orbit camera would re-cut every grouping.
const near = proj({ x: 0, y: 1, z: -10 });
const far = proj({ x: 0, y: 1, z: 10 });
eq("plane mode still reports pz as zero", [near.pz, far.pz], [0, 0]);
eq("...while pd separates near from far", far.pd > near.pd, true);
eq("pd is zero at the projection origin", Math.abs(proj({ x: 0, y: 0, z: 0 }).pd) < 1e-9, true);

console.log("\n  and the depth ratio is what a badge's extents must be inflated by:");
// The correction EntityVisuals.placementItems applies, restated here so the
// number is pinned rather than described.
const pull = (pd) => Math.max(1, (REF + pd) / REF);
eq("a badge at the reference depth is untouched", pull(0), 1);
// ⚠️ ONE-SIDED. A badge NEARER than the reference draws FURTHER apart than the
// plane predicted; shrinking its claim on that basis would group it late,
// which is the error this subsystem has spent several releases removing.
eq("a badge nearer than the reference is also untouched, never shrunk", pull(-12), 1);
eq("a badge 12 m beyond asks for 40% more room", Math.round((pull(12) - 1) * 100), 40);
eq("...and one 20 m beyond asks for 67%", Math.round((pull(20) - 1) * 100), 67);

console.log("\n  which is enough to cover what the renderer actually does:");
// A pair the solver judged EXACTLY touching, at increasing depth. Without the
// correction the drawn separation falls below the requirement — that is the
// overlap. With it, the requirement rises to meet the loss.
const BADGE_HALF = 0.6;                       // world units at this rung
let worstUncorrected = 0, worstCorrected = 0;
for (const z of [0, 4, 8, 12, 16, 20]) {
  const a = { x: -BADGE_HALF, y: 1, z }, b = { x: BADGE_HALF, y: 1, z };
  const pa = proj(a), pb = proj(b);
  const planeSep = Math.hypot(pb.px - pa.px, pb.py - pa.py);
  const sa = REF / trueDepth(a), sb = REF / trueDepth(b);
  const drawnSep = Math.hypot(pb.px * sb - pa.px * sa, pb.py * sb - pa.py * sa);
  // Uncorrected: the solver asked for planeSep and got drawnSep.
  worstUncorrected = Math.max(worstUncorrected, (planeSep - drawnSep) / planeSep);
  // Corrected: it asked for planeSep x pull, so the drawn result is scaled up
  // by the same factor before the comparison.
  const need = planeSep * pull(Math.max(pa.pd, pb.pd));
  worstCorrected = Math.max(worstCorrected, (need - drawnSep * (need / planeSep)) / planeSep);
}
eq("uncorrected, a touching pair loses up to 20%+ of its separation",
   Math.round(worstUncorrected * 100) >= 20, true);
eq("the correction never asks for LESS than the plane did", worstCorrected >= -1e-9, true);

console.log("\n  and the guess the symptom invited is measurably the wrong one:");
// Two devices at one spot differing only in HEIGHT draw FURTHER apart, because
// the higher one is nearer the camera and so drawn larger. Height matters only
// through the depth it changes.
const lo = { x: 4, y: 0.4, z: 3 }, hi = { x: 4, y: 2.4, z: 3 };
const pl = proj(lo), ph = proj(hi);
const planeDy = Math.abs(ph.py - pl.py);
const drawnDy = Math.abs(ph.py * (REF / trueDepth(hi)) - pl.py * (REF / trueDepth(lo)));
eq("a pure height difference draws them further apart, not closer", drawnDy > planeDy, true);

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ the depth the renderer uses is the depth placement asks for"}`);
process.exit(fail ? 1 : 0);
