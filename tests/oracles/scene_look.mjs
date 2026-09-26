// Exposure, IBL strength and the background: one writer, any call order.
//
// ⚠️ EACH HAD TWO OR THREE WRITERS, KEPT RIGHT BY CALL ORDER. RenderEnhancements
// wrote Settings' exposure and IBL strength; SunController then scaled both for
// night, "the final word" — correct only while every path ran renderFx first,
// a rule restated at four call sites. The other order showed a baked villa at
// daytime exposure all night. The clear colour had three writers. SceneLook is
// now the only one; this checks the rule (resolveLook) and that the order in
// which the two passes report no longer matters.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { Color4 } = await import("@babylonjs/core/Maths/math.color.js");
const { StandardMaterial } = await import("@babylonjs/core/Materials/standardMaterial.js");
const { resolveLook, SceneLook } = await import("@/babylon/sceneLook");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const base = { exposure: 1.2, ibl: true, environmentIntensity: 0.8, nightDimming: 0.5,
  isDay: true, baked: false, nightAtlas: false, backdrop: null };

console.log("  the rule:");
ck("by day, Settings' exposure stands", near(resolveLook(base).exposure, 1.2));
ck("a lit villa keeps it at night too — the sun pass lights it instead",
   near(resolveLook({ ...base, isDay: false }).exposure, 1.2));
ck("a baked single-atlas villa dims to sell night",
   near(resolveLook({ ...base, isDay: false, baked: true }).exposure, 1.2 * (1 + (0.45 - 1) * 0.5)));
ck("  ...a night atlas only adds dimming, floor 0.5",
   near(resolveLook({ ...base, isDay: false, baked: true, nightAtlas: true }).exposure, 1.2 * (1 + (0.5 - 1) * 0.5)));
ck("the IBL counts for less after dark",
   near(resolveLook({ ...base, isDay: false }).environmentIntensity, 0.8 * (0.4 + (0.12 - 0.4) * 0.5)));
ck("with the IBL off its strength is not the look's to write",
   resolveLook({ ...base, ibl: false }).environmentIntensity === null);
ck("the overview backdrop wins over the sky",
   JSON.stringify(resolveLook({ ...base, backdrop: [0.1, 0.1, 0.1, 1] }).clearColor) === "[0.1,0.1,0.1,1]");

console.log("\n  one writer, any order:");
const render = { exposure: 1.2, ibl: true, environmentIntensity: 0.8, nightDimming: 0.5 };
const run = (steps) => {
  const scene = new Scene(new NullEngine());
  const look = new SceneLook(scene);
  for (const s of steps) s(look);
  return [scene.imageProcessingConfiguration.exposure, scene.environmentIntensity,
    scene.clearColor.r, scene.clearColor.g, scene.clearColor.b];
};
const renderThenSun = run([(l) => l.setRender(render), (l) => l.setBaked(true, false), (l) => l.setDay(false)]);
const sunThenRender = run([(l) => l.setBaked(true, false), (l) => l.setDay(false), (l) => l.setRender(render)]);
ck("render-then-sun and sun-then-render leave the same scene", JSON.stringify(renderThenSun) === JSON.stringify(sunThenRender),
   [renderThenSun, sunThenRender]);
ck("  ...and it is the NIGHT exposure, not Settings' daytime value", near(renderThenSun[0], 1.2 * (1 + (0.45 - 1) * 0.5)), renderThenSun[0]);
{
  const scene = new Scene(new NullEngine());
  const look = new SceneLook(scene);
  look.setDay(false);
  look.setBackdrop(new Color4(0.2, 0.2, 0.25, 1));
  ck("a backdrop set in overview shows", near(scene.clearColor.b, 0.25));
  look.setBackdrop(null);
  ck("  ...and releasing it restores the NIGHT sky", near(scene.clearColor.r, 0.03));
}

console.log("\n  reach:");
{
  const scene = new Scene(new NullEngine());
  const look = new SceneLook(scene);
  const lit = new StandardMaterial("lit", scene);
  const unlit = new StandardMaterial("unlit", scene); unlit.disableLighting = true;
  void lit; void unlit;
  const r = look.environmentReach();
  ck("an unlit material is not reached by the environment", r.reach === 1 && r.total === 2, r);
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ the look has one writer, and order no longer matters");
process.exit(fail ? 1 : 0);
