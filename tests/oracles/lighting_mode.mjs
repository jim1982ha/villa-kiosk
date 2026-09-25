// Which lights a villa gets (src/babylon/lightingMode.ts), and that every
// consumer reads that one answer.
//
// ⚠️ IT WAS TWO FLAGS NOBODY CHECKED AGAINST EACH OTHER: `baked` made pools
// and turned shadows off, "a material already carries the glow" switched the
// furniture light on, and nine comments said a baked villa has no PointLights.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { flavourOf, lightingModeFor } = await import("@/babylon/lightingMode");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

console.log("  the table");
ck("no bake: unbaked", flavourOf({ baked: false }) === "unbaked");
ck("an albedo bake", flavourOf({ baked: true }) === "albedo-baked");
ck("a lightmap bake", flavourOf({ baked: true, lightmapped: true }) === "lightmapped");
const u = lightingModeFor("unbaked"), a = lightingModeFor("albedo-baked"), l = lightingModeFor("lightmapped");
ck("unbaked: PointLights light the rooms, with wall shadows — no pools, no furniture light",
   !u.pools && !u.furnitureLight && u.lightShadows, u);
ck("albedo-baked: pools, no furniture light, no shadow maps (the bake has them)",
   a.pools && !a.furnitureLight && !a.lightShadows, a);
ck("lightmapped: pools AND the furniture light, no shadow maps",
   l.pools && l.furnitureLight && !l.lightShadows, l);
ck("every mode says why, for the load capture", [u, a, l].every((m) => m.describe.length > 20));

console.log("\n  the callers read the table, and nothing else decides");
{
  const src = (f) => readFileSync(new URL(`../../src/babylon/${f}`, import.meta.url), "utf8");
  const ml = src("ModelLoader.ts"), sm = src("SceneManager.ts"), ev = src("EntityVisuals.ts"), bs = src("bulbSet.ts");
  ck("the loader states the mode once, from what it found",
     /const lighting = lightingModeFor\(flavourOf\(\{ baked, lightmapped \}\)\);/.test(ml) && /tapDebug\(`lighting mode: \$\{lighting\.describe\}`\)/.test(ml));
  ck("  ...and no longer claims the dynamic lights are disabled", !/dynamic light simulation disabled/.test(ml));
  ck("the scene hands it to the visuals before they build the bulbs", /this\.visuals\.setLightingMode\(result\.lighting\);/.test(sm));
  ck("the visuals read pools, the furniture light and shadows from it — no bakedMode left",
     /this\.lighting\.pools/.test(ev) && /this\.lighting\.furnitureLight/.test(ev) && /this\.lighting\.lightShadows/.test(ev) && !/bakedMode/.test(ev));
  ck("BulbSet no longer infers lightmapping from a material", !/some\(\(m\) => hasLampGlow/.test(bs));
}

if (fail) { console.log(`  ${fail} FAILED`); process.exit(1); }
console.log("  all passed");
