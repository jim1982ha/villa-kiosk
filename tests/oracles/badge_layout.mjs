// One badge's geometry for placement — the glue that kept breaking.
//
// ⚠️ SEVEN OF ENTITYVISUALS' LAST TEN FIXES WERE HERE, BETWEEN TESTED MODULES:
// a glyph baked at the UNSCALED size (the "icons are very low resolution"
// report), two widths for one card, a badge's box measured at its anchor
// rather than where it is drawn, the depth pull. badgeLayout is that glue for
// one badge; this calls it directly instead of reading EntityVisuals' source.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { onGlass, depthPull, glyphDrawPx, glyphBakePx } = await import("@/babylon/badgeLayout");
const { viewBasis, VIEW_BASIS_STEPS } = await import("@/babylon/badgeProjection");
const { badgeMetricsFor } = await import("@/babylon/badgeMetrics");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;

// The overview pose depth_residual.mjs uses: 30 m out, tilted. In plane mode
// `pd` is depth ALONG THE PLAN (a straight-down view has none), so "further"
// means further across the villa, which is where the reported overlaps were.
const R = 30, BETA = 0.5;
const cam = { x: 0, y: R * Math.cos(BETA), z: -R * Math.sin(BETA) };
const L = Math.hypot(cam.x, cam.y, cam.z);
const basis = viewBasis(-cam.x / L, -cam.y / L, -cam.z / L, VIEW_BASIS_STEPS, "plane");
const c = { pxPerWorld: 20, allow: 1, basis, refDepth: 30 };
const scratch = { px: 0, py: 0, pz: 0, pd: 0 };
const at = (x, y, z, box) => onGlass(c, x, y, z, box, scratch, { sx: 0, sy: 0, sz: 0, reach: 0, reachY: 0 });

console.log("  on the glass:");
{
  const box = { halfW: 22, halfH: 22, cy: 0 };
  const a = at(0, 0, 0, box), b = at(1, 0, 0, box);
  ck("one world unit is pxPerWorld apart on the glass", near(Math.hypot(b.sx - a.sx, b.sy - a.sy), 20));
  const readout = at(0, 0, 0, { ...box, cy: -45.5 }), bare = at(0, 0, 0, { ...box, cy: -56 });
  ck("a badge is measured where it is DRAWN, not at its anchor (2.287.0)",
     near(readout.sy - bare.sy, 10.5), readout.sy - bare.sy);
}
{
  const box = { halfW: 22, halfH: 18, cy: 0 };
  const level = at(0, 0, 0, box);
  ck("at the reference depth a badge claims its own size", near(level.reach, 22) && near(level.reachY, 18), level);
  const far = at(0, 0, 12, box);             // 12 m further across the plan
  const pull = depthPull(30, scratch.pd);
  ck("further than the reference, it claims more room — on BOTH axes",
     near(pull, 1.4) && near(far.reach, 22 * pull) && near(far.reachY, 18 * pull), { pull, far });
  const nearer = at(0, 0, -12, box);
  ck("  ...and nearer, never less (one-sided)", near(nearer.reach, 22) && near(nearer.reachY, 18), nearer);
}
ck("no reference depth means no correction", depthPull(0, 50) === 1);

console.log("\n  the glyph:");
for (const pointer of ["fine", "coarse"]) {
  const m = badgeMetricsFor(pointer);
  const inner = m.cardHeightPx - 2 * m.ringThicknessPx;
  ck(`${pointer}: a card's glyph fits its inner box even at the heaviest ring`, glyphDrawPx(m, true) <= inner,
     { glyph: glyphDrawPx(m, true), inner });
  ck(`${pointer}: a lone badge's glyph is the badge`, glyphDrawPx(m, false) === m.badgeDiameterPx);
  // A retina tablet at the user's 1.25x step.
  const bake = glyphBakePx(m, false, 1.25, 2);
  ck(`${pointer}: the bake is in RENDER px — drawn size x size step x DPR`,
     near(bake, m.badgeDiameterPx * 1.25 * 2), bake);
  ck(`${pointer}:   ...so on a retina screen it is never the unscaled size`, bake > glyphDrawPx(m, false));
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ a badge's geometry is the geometry it is drawn with");
process.exit(fail ? 1 : 0);
