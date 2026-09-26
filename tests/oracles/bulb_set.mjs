// Every bulb and every light it gives (src/babylon/bulbSet.ts), through its
// interface on a Babylon NullEngine.
//
// ⚠️ ONE BULB'S LIGHT WAS DECIDED IN FIFTEEN PLACES AND THEY DISAGREED
// (architecture review round 3): the PointLight divided among an entity's
// bulbs and the pools not; three strip tests; a pool dark with its hidden
// storey while the PointLight kept lighting through the slab. Each rule below
// is now BulbSet's, and each is driven here, not grepped.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
globalThis.OffscreenCanvas ??= class {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() { return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }; }
};
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { Color3 } = await import("@babylonjs/core/Maths/math.color.js");
const { CreateBox } = await import("@babylonjs/core/Meshes/Builders/boxBuilder.js");
const { PBRMaterial } = await import("@babylonjs/core/Materials/PBR/pbrMaterial.js");
const { BulbSet, STRIP_MIN_LENGTH, OFF_ALPHA } = await import("@/babylon/bulbSet");
const { Material } = await import("@babylonjs/core/Materials/material.js");
const { RenderTargetTexture } = await import("@babylonjs/core/Materials/Textures/renderTargetTexture.js");
const { attachLampGlow, hasLampGlow } = await import("@/babylon/lampGlow");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
const probe = (floor = 0) => ({ below: () => floor, describeBelow: () => null, clearMemo() {}, save() {}, stats: { probeAbove: 0 } });
const warm = new Color3(1, 0.8, 0.6);
function rig({ withPools = true } = {}) {
  const scene = new Scene(new NullEngine());
  const entities = [];
  const casters = [];
  const bulbs = new BulbSet(scene, probe(0), () => entities, () => {}, () => casters);
  const bulb = (x, { w = 0.1, d = 0.1, y = 2.3 } = {}) => {
    const m = CreateBox(`light.b${x}`, { width: w, height: 0.05, depth: d }, scene);
    m.position.set(x, y, 0); m.computeWorldMatrix(true); m.refreshBoundingInfo();
    bulbs.addFixture(m, withPools);
    return m;
  };
  const entity = (meshes, reading) => { const e = { meshes, reading }; entities.push(e); return e; };
  return { scene, bulbs, bulb, entity, casters };
}
const on = (frac = 1) => ({ on: true, colour: warm, frac });

console.log("  brightness: one fixture's worth per entity, and a whole pool per bulb");
{
  const r = rig();
  const spots = [0, 3, 6].map((x) => r.bulb(x));
  const e = r.entity(spots, on());
  r.bulbs.show(e.meshes, e.reading);
  const ls = spots.map((m) => r.bulbs.lightOf(m.uniqueId));
  ck("three bulbs of one entity: each PointLight is a third of one fixture's worth", ls.every((l) => near(l.intensity, 1.3 / 3)), ls.map((l) => l.intensity));
  ck("  ...and each is on", ls.every((l) => l.isEnabled()));
  const lamps = r.bulbs.lamps();
  ck("each bulb's pool — and the furniture light it feeds — is at FULL strength", lamps.length === 3 && lamps.every((l) => near(l.amount, 1)), lamps.map((l) => l.amount));
  r.bulbs.setStrength(0.5);
  ck("the slider halves the PointLights", ls.every((l) => near(l.intensity, 0.65 / 3)), ls.map((l) => l.intensity));
  ck("  ...and the pools, together", r.bulbs.lamps().every((l) => near(l.amount, 0.5)));
  ck("an unchanged slider is not a change", r.bulbs.setStrength(0.5) === false);
  e.reading = { on: false, colour: warm, frac: 1 };
  r.bulbs.show(e.meshes, e.reading);
  ck("off: every PointLight disabled, every pool gone", ls.every((l) => !l.isEnabled() && l.intensity === 0) && r.bulbs.lamps().length === 0);
}

console.log("\n  the storey: a hidden storey's bulbs are dark — ALL their light");
{
  const r = rig();
  const up = r.bulb(0, { y: 4.9 });
  const e = r.entity([up], on());
  r.bulbs.show(e.meshes, e.reading);
  up.setEnabled(false); // FloorManager hides the storey
  r.bulbs.resync();
  const l = r.bulbs.lightOf(up.uniqueId);
  ck("its PointLight goes off with the storey (it used to light through the slab)", !l.isEnabled(), l.isEnabled());
  ck("  ...and its pool", r.bulbs.lamps().length === 0);
  up.setEnabled(true);
  r.bulbs.resync();
  ck("shown again: both back", l.isEnabled() && r.bulbs.lamps().length === 1);
}

console.log("\n  strips: one rule");
{
  const r = rig();
  const strip = r.bulb(0, { w: STRIP_MIN_LENGTH + 0.5 });
  const spot = r.bulb(5);
  const sl = r.bulbs.lightOf(strip.uniqueId), pl = r.bulbs.lightOf(spot.uniqueId);
  ck("a strip's light is lowered toward what is below (0.45 of the gap, at most 1.1 m)",
     near(sl.position.y, 2.3 - Math.min(1.1, 2.3 * 0.45), 1e-3), sl.position.y);
  ck("a spot's is not", near(pl.position.y, 2.3, 1e-3), pl.position.y);
  const e = r.entity([strip], on());
  r.bulbs.show(e.meshes, e.reading);
  ck("a horizontal strip has three pools: its centre and both ends", r.bulbs.lamps().length === 3, r.bulbs.lamps().length);
}
{
  const r = rig();
  const sides = [0, 3, 6, 9].map((x) => r.bulb(x, { w: 2 }));
  const before = new Set(sides.map((m) => r.bulbs.lightOf(m.uniqueId)));
  r.bulbs.mergeStrips([sides]);
  const after = new Set(sides.map((m) => r.bulbs.lightOf(m.uniqueId)));
  ck("an entity of strips shares ONE PointLight", before.size === 4 && after.size === 1, [before.size, after.size]);
  ck("  ...and the old four are gone from the scene", [...before].every((l) => !r.scene.lights.includes(l)));
  const e = r.entity(sides, on());
  r.bulbs.show(e.meshes, e.reading);
  ck("  ...at a WHOLE fixture's worth, not a quarter", near([...after][0].intensity, 1.3), [...after][0].intensity);
  const mixed = [r.bulb(20, { w: 2 }), r.bulb(25)];
  r.bulbs.mergeStrips([mixed]);
  ck("two bedside lamps (not all strips) keep a light each", r.bulbs.lightOf(mixed[0].uniqueId) !== r.bulbs.lightOf(mixed[1].uniqueId));
}

console.log("\n  the furniture light: every lit surface, and the PointLights kept off them");
{
  const r = rig();
  const lamp = r.bulb(0);
  const wall = CreateBox("Structure_wall", { size: 1 }, r.scene); wall.material = new PBRMaterial("lm", r.scene); attachLampGlow(wall.material);
  const curtain = CreateBox("cover.curtain", { size: 1 }, r.scene); curtain.material = new PBRMaterial("fabric", r.scene);
  const glass = CreateBox("window", { size: 1 }, r.scene); glass.material = new PBRMaterial("glass", r.scene); glass.material.alpha = 0.3;
  lamp.material = new PBRMaterial("fixture", r.scene);
  r.bulbs.glowEverythingLit();
  ck("a curtain (not lightmapped) gets the furniture light too", hasLampGlow(curtain.material));
  ck("  ...glass does not, nor the bulb itself", !hasLampGlow(glass.material) && !hasLampGlow(lamp.material));
  const excluded = r.bulbs.lightOf(lamp.uniqueId).excludedMeshes;
  ck("the bulb's PointLight is kept off every glowing mesh", excluded.includes(wall) && excluded.includes(curtain) && !excluded.includes(glass));
}
{
  const r = rig();
  const lamp = r.bulb(0);
  r.bulbs.clear();
  ck("clear: every light disposed", r.scene.lights.length === 0 && r.bulbs.size === 0, r.scene.lights.length);
}

console.log("\n  the fixture's own look, and its shadow — BulbSet's since 2.496.92");
{
  const r = rig();
  const a = r.bulb(0), b = r.bulb(3);
  for (const m of [a, b]) m.material = new PBRMaterial(`f${m.uniqueId}`, r.scene);
  const e = r.entity([a, b], on(0.5));
  r.bulbs.show(e.meshes, e.reading);
  ck("on: the fixture glows its light's colour at its brightness, opaque",
     near(a.material.emissiveColor.r, warm.r * 0.5) && a.material.alpha === 1 && a.material.transparencyMode === Material.MATERIAL_OPAQUE, [a.material.emissiveColor, a.material.alpha]);
  e.reading = { on: false, colour: warm, frac: 1 };
  r.bulbs.show(e.meshes, e.reading);
  ck("off: dark and window-glass translucent", a.material.emissiveColor.r === 0 && a.material.alpha === OFF_ALPHA
     && a.material.transparencyMode === Material.MATERIAL_ALPHABLEND && b.material.alpha === OFF_ALPHA);
}
{
  const r = rig();
  const wall = CreateBox("Structure_wall", { size: 1 }, r.scene); r.casters.push(wall);
  const spots = [r.bulb(0), r.bulb(3)];
  const e = r.entity(spots, on());
  r.bulbs.show(e.meshes, e.reading);
  ck("no shadow maps where the lighting mode has none (a baked villa)", r.bulbs.shadowCount === 0);
  r.bulbs.setCastShadows(true);
  ck("turned on for an unbaked villa: a light already ON gets its map (the first paint used to forget it)", r.bulbs.shadowCount === 1, r.bulbs.shadowCount);
  const gen = [...r.bulbs["shadows"].values()][0];
  const map = gen.getShadowMap();
  ck("  ...ONE for the entity's two bulbs, drawing the villa's casters, rendered once",
     map.renderList.length === 1 && map.renderList[0] === wall && map.refreshRate === RenderTargetTexture.REFRESHRATE_RENDER_ONCE && wall.receiveShadows);
  let redraws = 0; const orig = map.resetRefreshCounter.bind(map); map.resetRefreshCounter = () => { redraws++; orig(); };
  r.bulbs.resync();
  ck("a floor switch (resync) redraws it — what occludes changed", redraws === 1, redraws);
  r.bulbs.invalidateShadows();
  ck("a pose swap (invalidateShadows) redraws it", redraws === 2, redraws);
  e.reading = { on: false, colour: warm, frac: 1 };
  r.bulbs.show(e.meshes, e.reading);
  ck("off: the map is disposed — an off light costs nothing", r.bulbs.shadowCount === 0);
  e.reading = on();
  r.bulbs.show(e.meshes, e.reading);
  r.bulbs.clear();
  ck("clear: the maps go with the lights", r.bulbs.shadowCount === 0);
}

console.log("\n  the callers (a module nobody calls is green and useless)");
{
  const { readFileSync } = await import("node:fs");
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  ck("a state change shows the entity's bulbs — the live event and the first paint",
     (ev.match(/this\.bulbs\.show\(/g) ?? []).length === 2, (ev.match(/this\.bulbs\.show\(/g) ?? []).length);
  ck("a floor switch repaints every bulb", /setActiveFloor\(floor: number\): void \{[\s\S]*?this\.bulbs\.resync\(\);/.test(ev));
  ck("the slider goes to BulbSet", /setLightPoolIntensity\(value: number\): void \{\s*if \(this\.bulbs\.setStrength\(value\)\)/.test(ev));
  ck("the load: every fixture (pools per the lighting mode), then the strip merge, then every lit surface",
     /this\.bulbs\.addFixture\(m, this\.lighting\.pools\)/.test(ev)
       && /this\.bulbs\.mergeStrips\([^)]*\)\);\s*if \(this\.lighting\.furnitureLight\) this\.bulbs\.glowEverythingLit\(\);/.test(ev));
  ck("the furniture light is written before each frame", /onBeforeRender = \(\) => \{[\s\S]*?this\.bulbs\.syncGlow\(\);[\s\S]*?\};/.test(ev));
  ck("and nothing in EntityVisuals computes a bulb's light itself any more",
     !/MAX_LIGHT_INTENSITY|lightShare|new PointLight\(|meshLights/.test(ev));
  ck("  ...nor its look or its shadow", !/ShadowGenerator|STRIP_OFF_ALPHA|syncEntityShadow|invalidateShadowMaps|fixtureMat\.alpha/.test(ev));
  ck("the lighting mode tells BulbSet whether lamps cast shadows", /this\.bulbs\.setCastShadows\(mode\.lightShadows\);/.test(ev));
  ck("a pose swap redraws the shadow maps", /if \(poseChanged\) \{ this\.bulbs\.invalidateShadows\(\);/.test(ev));
  ck("the casters are handed in", /new BulbSet\([^;]*\(\) => this\.shadowCasters\)/.test(ev));
}

if (fail) { console.log(`  ${fail} FAILED`); process.exit(1); }
console.log("  all passed");
