// The lamp glow on the lightmapped structure (src/babylon/lampGlow.ts).
//
// ⚠️ ITS HOOK IS ONE LINE OF BABYLON'S SHADER. The glow is appended to
// `finalColor.rgb*=lightmapColor.rgb;` by regex; a Babylon upgrade that
// rewrites that line switches every lamp's light on the furniture off with no
// error at all — the villa just goes back to dark tables. So this reads the
// INSTALLED shader and fails if the anchor, or any variable the snippet uses,
// is gone. Then it pins the lamp selection, and both callers (the glow is
// only worth anything if ModelLoader attaches it and EntityVisuals takes the
// lamps' PointLights off the same meshes).
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { PBRMaterial } = await import("@babylonjs/core/Materials/PBR/pbrMaterial.js");
const { pbrBlockFinalColorComposition } = await import("@babylonjs/core/Shaders/ShadersInclude/pbrBlockFinalColorComposition.js");
const { pbrPixelShader } = await import("@babylonjs/core/Shaders/pbr.fragment.js");
const { LampGlowState, LAMP_GLOW_MAX, LAMP_GLOW_ANCHOR, LAMP_GLOW_GLSL, LAMP_GLOW_PLAIN_POINT, LAMP_GLOW_PLAIN_GLSL, attachLampGlow, hasLampGlow } =
  await import("@/babylon/lampGlow");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

console.log("  the hook exists in the installed Babylon");
{
  const matches = pbrBlockFinalColorComposition.shader.match(new RegExp(LAMP_GLOW_ANCHOR, "g")) ?? [];
  ck("the anchor matches exactly once", matches.length === 1, matches.length);
  const main = pbrPixelShader.shader;
  const at = main.indexOf("#include<pbrBlockFinalColorComposition>");
  ck("the PBR fragment includes the composition block", at > 0);
  for (const [name, decl] of [["surfaceAlbedo", "vec3 surfaceAlbedo="], ["normalW", "normalW"], ["vPositionW", "vPositionW"]]) {
    const where = main.indexOf(decl);
    ck(`${name} is in scope before the hook`, where >= 0 && where < at, where);
  }
  for (const v of ["surfaceAlbedo", "normalW", "vPositionW", "vEyePosition", "lampGlowPos", "lampGlowCol", "lampGlowCount", "finalColor"]) {
    ck(`the snippet uses ${v}`, LAMP_GLOW_GLSL.includes(v));
  }
}

console.log("  the second hook, for everything that is not lightmapped");
{
  const main = pbrPixelShader.shader;
  const at = main.indexOf(`#define ${LAMP_GLOW_PLAIN_POINT}`);
  ck("the plain injection point exists in the installed PBR shader", at > 0, at);
  const unlit = main.indexOf("#include<pbrBlockFinalUnlitComponents>");
  ck("  ...after finalDiffuse is declared", unlit > 0 && unlit < at, { unlit, at });
  ck("  ...and before the final colour is composed", at < main.indexOf("#include<pbrBlockFinalColorComposition>"));
  ck("the plain snippet adds to finalDiffuse", /finalDiffuse \+= lgAdd;/.test(LAMP_GLOW_PLAIN_GLSL));
  ck("  ...and never runs on a lightmapped material (which has the anchor instead)",
    LAMP_GLOW_PLAIN_GLSL.includes("!defined(USELIGHTMAPASSHADOWMAP)"));
  ck("nothing at or above the storey above is lit — no ceiling stops this light",
    /step\(vPositionW\.y, lgC\.w - 0\.02\)/.test(LAMP_GLOW_GLSL));
  // 2.496.78 wrapped it, and the outside faces of the room's walls lit up.
  ck("a surface facing AWAY from a bulb gets nothing — the far side of a wall (2.496.79)",
    /lgNdl = max\(dot\(lgN, lgL \* inversesqrt\(lgD2\)\), 0\.0\);/.test(LAMP_GLOW_GLSL) && !/GLOW_WRAP|\+ 0\.6\)/.test(LAMP_GLOW_GLSL));
}

console.log("  the plugin attaches to a material");
{
  const scene = new Scene(new NullEngine());
  const m = new PBRMaterial("wall", scene);
  const other = new PBRMaterial("chair", scene);
  attachLampGlow(m);
  attachLampGlow(m);
  const plugins = m.pluginManager?._plugins?.filter((p) => p.getClassName() === "LampGlowPlugin") ?? [];
  ck("one plugin, however often attached", plugins.length === 1, plugins.length);
  ck("the material reads as glowing", hasLampGlow(m));
  ck("a material never attached does not", !hasLampGlow(other) && !hasLampGlow(null));
  const code = plugins[0]?.getCustomCode("fragment") ?? {};
  const key = Object.keys(code)[0] ?? "";
  ck("its injection points: the anchor, as a regex, and the plain point",
    key === `!${LAMP_GLOW_ANCHOR}` && Object.keys(code)[1] === LAMP_GLOW_PLAIN_POINT, Object.keys(code));
  ck("the anchor line is kept, the glow follows it", (code[key] ?? "").startsWith("$0"));
  ck("nothing in the vertex shader", plugins[0]?.getCustomCode("vertex") === null);
}

console.log("  which lamps are written");
{
  const lamp = (x, over = {}) => ({ x, y: 2.3, z: 0, r: 1, g: 0.8, b: 0.5, amount: 1, radius: 1.8, floorY: 0, ceilingY: 2.56, ...over });
  const eye = { x: 0, y: 2, z: 0 };
  const s = new LampGlowState();
  ck("a pool that is on is written", s.set([lamp(1)], eye) && s.count === 1);
  ck("its bulb and room floor", near4(s.pos.slice(0, 4), [1, 2.3, 0, 0]), [...s.pos.slice(0, 4)]);
  ck("colour x the pool's strength", near4(s.col.slice(0, 3), [1, 0.8, 0.5]), [...s.col.slice(0, 3)]);
  ck("  ...and the floor of the storey above, where its light stops", Math.abs(s.col[3] - 2.56) < 1e-6, s.col[3]);
  s.set([lamp(1, { ceilingY: Infinity })], eye);
  ck("  ...no storey above: a finite stand-in, never NaN or Infinity in a uniform", s.col[3] === 1e6, s.col[3]);
  s.set([lamp(1, { amount: 0.5 })], eye);
  ck("  ...a dimmer pool, a dimmer glow", near4(s.col.slice(0, 3), [0.5, 0.4, 0.25]), [...s.col.slice(0, 3)]);
  ck("the same lamps again change nothing", s.set([lamp(1, { amount: 0.5 })], eye) === false);
  s.set([lamp(1, { amount: 0 }), lamp(2)], eye);
  ck("a pool at strength 0 is left out", s.count === 1 && s.pos[0] === 2, s.count);
  s.set([lamp(1, { radius: 0 }), lamp(2)], eye);
  ck("a pool of no size is left out", s.count === 1 && s.pos[0] === 2, s.count);
  const many = Array.from({ length: LAMP_GLOW_MAX + 4 }, (_, i) => lamp(i + 1));
  s.set(many.slice().reverse(), eye);
  const xs = Array.from({ length: s.count }, (_, i) => s.pos[i * 4]).sort((a, b) => a - b);
  ck(`more than ${LAMP_GLOW_MAX}: the nearest ${LAMP_GLOW_MAX} to the eye`,
    s.count === LAMP_GLOW_MAX && xs[0] === 1 && xs[LAMP_GLOW_MAX - 1] === LAMP_GLOW_MAX, xs);
  const resume = s.suspend();
  ck("suspended: no lamps shown", s.count === 0);
  resume();
  ck("resumed: the same lamps back", s.count === LAMP_GLOW_MAX);
  s.set([], eye);
  ck("all off: count 0 and the slots cleared", s.count === 0 && s.col.every((v) => v === 0));
}
function near4(a, b) { return b.every((v, i) => Math.abs(a[i] - v) < 1e-6); }

console.log("  the callers");
{
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  const idx = ev.match(/this\.mergeStripEntityLights\(\);\s*this\.glowEverythingLit\(\);/);
  ck("every lit surface gets the glow, after every light exists (the strip merge)", !!idx);
  const all = ev.match(/private glowEverythingLit\(\): void \{[\s\S]*?\n  \}/)?.[0] ?? "";
  ck("  ...every PBR material, lightmapped or not", /instanceof PBRMaterial/.test(all) && /attachLampGlow\(mat\)/.test(all));
  ck("  ...but not the light fixtures, markers, unlit or transparent ones",
    /this\.meshLights\.has\(m\.uniqueId\)/.test(all) && /isHelperMesh\(m\)/.test(all) && /mat\.unlit/.test(all) && /mat\.alpha < 1/.test(all));
  ck("  ...and every bulb's PointLight is taken off every glowing mesh",
    /for \(const l of new Set\(this\.meshLights\.values\(\)\)\) l\.excludedMeshes\.push\(\.\.\.this\.glowMeshes\)/.test(all));
  const sync = ev.match(/private syncLampGlow\(\): void \{[\s\S]*?\n  \}/)?.[0] ?? "";
  ck("the glow is the POOLS' light (LightPoolSet.glowLamps), never a PointLight's",
    /this\.pools\.glowLamps\(\)/.test(sync) && !/intensity|\.position\b|meshLights/.test(sync), sync.slice(0, 80));
  ck("the glow is written before each frame", /onBeforeRender = \(\) => \{[\s\S]*?this\.syncLampGlow\(\);[\s\S]*?\};/.test(ev));
  const ml = readFileSync(new URL("../../src/babylon/ModelLoader.ts", import.meta.url), "utf8");
  ck("ModelLoader attaches it to every lightmapped material",
    /for \(const sm of lmMats\) \{[\s\S]*?useLightmapAsShadowmap = true;[\s\S]*?attachLampGlow\(sm as unknown as Material\);[\s\S]*?\n      \}/.test(ml));
}

if (fail) { console.log(`  ${fail} FAILED`); process.exit(1); }
console.log("  all passed");
