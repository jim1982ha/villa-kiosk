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
const { LampGlowState, LAMP_GLOW_MAX, LAMP_GLOW_ANCHOR, LAMP_GLOW_GLSL, LAMP_GLOW_PLAIN_POINT, LAMP_GLOW_PLAIN_GLSL, GLOW_TERM, POOL_CENTRE, attachLampGlow, hasLampGlow } =
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
  ck("the shader is generated from GLOW_TERM, every step of it",
    GLOW_TERM.every(([name, expr]) => LAMP_GLOW_GLSL.includes(`float ${name} = ${expr};`)));
}

console.log("  the numbers — GLOW_TERM evaluated, the same steps the shader runs");
{
  // Every expression is valid JS given these; the shader gets them from GLSL.
  const helpers = {
    max: Math.max, min: Math.min, clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
    smoothstep: (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); },
    step: (edge, x) => (x >= edge ? 1 : 0), inversesqrt: (x) => 1 / Math.sqrt(x),
  };
  const body = GLOW_TERM.map(([n, e]) => `const ${n} = ${e};`).join("\n") + "\nreturn lgW;";
  const term = new Function(...Object.keys(helpers), "pX", "pY", "pZ", "nX", "nY", "nZ", "lgPx", "lgPy", "lgPz", "lgFloor", "lgCeil", body)
    .bind(null, ...Object.values(helpers));
  // A ceiling spot at 2.3 m over a room floor at 0, the storey above at 2.56.
  const lamp = [0, 2.3, 0, 0, 2.56];
  const w = (p, n) => term(...p, ...n, ...lamp);
  const up = [0, 1, 0];
  const table = w([0.3, 0.75, 0], up);
  ck("a table top (0.75 m) under the spot is lit", table > 0.3, table);
  ck("  ...a seat at 0.45 m too", w([0.5, 0.45, 0.4], up) > 0.2, w([0.5, 0.45, 0.4], up));
  ck("the floor under it is NOT — that is its pool's", w([0.3, 0.0, 0], up) === 0, w([0.3, 0.0, 0], up));
  ck("a wall facing the spot is lit", w([1, 1.5, 0], [-1, 0, 0]) > 0, w([1, 1.5, 0], [-1, 0, 0]));
  ck("the FAR face of that wall — facing away — gets nothing (2.496.78's wrap lit it)",
     w([1.15, 1.5, 0], [1, 0, 0]) === 0, w([1.15, 1.5, 0], [1, 0, 0]));
  ck("  ...even the outer face of a wall right beside the bulb, where the light arrives almost edge-on",
     w([0.4, 1.0, 0], [1, 0, 0]) === 0, w([0.4, 1.0, 0], [1, 0, 0]));
  ck("the storey above gets nothing, even facing the bulb (2.496.79)", w([0.5, 2.7, 0], [0, -1, 0]) === 0, w([0.5, 2.7, 0], [0, -1, 0]));
  ck("beyond the reach (4 m) nothing", w([4.2, 0.75, 0], up) === 0, w([4.2, 0.75, 0], up));
  const near = w([0.05, 2.0, 0], up);
  ck("right under the bulb the inverse square is capped", near <= POOL_CENTRE * 1.4 + 1e-9, near);
  ck("nearer is brighter, all else equal", w([0.2, 0.75, 0], up) > w([1.5, 0.75, 0], up));
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
  // What lights which mesh, and when, is BulbSet's — tests/oracles/bulb_set.mjs.
  const ml = readFileSync(new URL("../../src/babylon/ModelLoader.ts", import.meta.url), "utf8");
  ck("ModelLoader attaches it to every lightmapped material",
    /for \(const sm of lmMats\) \{[\s\S]*?useLightmapAsShadowmap = true;[\s\S]*?attachLampGlow\(sm as unknown as Material\);[\s\S]*?\n      \}/.test(ml));
}

if (fail) { console.log(`  ${fail} FAILED`); process.exit(1); }
console.log("  all passed");
