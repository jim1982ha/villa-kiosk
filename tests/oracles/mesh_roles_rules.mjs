// The ceiling rule and the pane-candidate rule, by value (src/babylon/
// meshRoles.ts, round 11, 2.496.170). The ceiling rule was half inline in
// StructureSet.apply's loop; the pane rule said `> 40`, which is 40 cm on a
// SweetHome export and 40 m on a GLB in metres.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { ceilingVerdict, looksLikePane } = await import("@/babylon/meshRoles");

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };
const f = (o) => ({ named: false, pipelineStructure: false, name: "Mesh", footMax: 5, minY: 2.8, height: 0.1, ...o });

ck("a stamped or named ceiling is one", ceilingVerdict(f({ named: true, minY: 0, height: 3 })));
ck("a thin mesh high up is a ceiling by height…", ceilingVerdict(f({})));
ck("  ...but never a pipeline slab (the 2F floor hole)", !ceilingVerdict(f({ pipelineStructure: true })));
ck("  ...nor a thick one, nor one at eye level", !ceilingVerdict(f({ height: 0.5 })) && !ceilingVerdict(f({ minY: 2.0 })));
ck("a mesh with no area is never a ceiling, even named", !ceilingVerdict(f({ named: true, footMax: 0.005 })));
ck("  ...nor the pipeline's BAKED_ carrier", !ceilingVerdict(f({ named: true, name: "BAKED_LightmapCarrier" })));

ck("a 120×150×2 cm pane on a 700 cm model is a candidate", looksLikePane([2, 120, 150], 700));
ck("  ...and the SAME pane in metres on a 7 m model", looksLikePane([0.02, 1.2, 1.5], 7));
ck("a 30 cm tile is not; nor a thick box", !looksLikePane([0.01, 0.3, 0.3], 7) && !looksLikePane([0.5, 1.2, 1.5], 7));
ck("a model in millimetres scales too", looksLikePane([20, 1200, 1500], 7000) && !looksLikePane([20, 300, 300], 7000));

const src = (p) => readFileSync(new URL(`../../src/babylon/${p}`, import.meta.url), "utf8");
ck("StructureSet.apply asks ceilingVerdict (no inline height rule)",
   /ceilingVerdict\(\{/.test(src("structureSet.ts")) && !/meshMinY > 2\.5/.test(src("structureSet.ts")));
const ml = src("ModelLoader.ts");
ck("ModelLoader's pane list asks looksLikePane and skips alpha glass",
   /looksLikePane\(\[thin, mid, big\], yHi - yLo\)/.test(ml) && /alphaGlass\.has\(m\.material\)\) continue/.test(ml) && !/big > 40/.test(ml));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ one ceiling rule, a pane rule in the model's own units");
