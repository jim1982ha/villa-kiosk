// The villa's ceilings: found once, shown only while walking, probed, forgotten.
//
// ⚠️ THE CEILING LIST LIVED IN FIVE PLACES OF SceneManager, and the one that
// forgot it was dispose — a 35 MB leak per remount (b9763abd). StructureSet
// owns it now. This builds a small villa in a NullEngine scene (a floor, a
// wall, a stair, a named ceiling, a slab caught only by the height rule, a
// ceiling LAMP whose id says "ceiling") and runs the real structure pass.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
globalThis.OffscreenCanvas ??= class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }; } };
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { Vector3 } = await import("@babylonjs/core/Maths/math.vector.js");
const { MeshBuilder } = await import("@babylonjs/core/Meshes/meshBuilder.js");
const { StandardMaterial } = await import("@babylonjs/core/Materials/standardMaterial.js");
const { StructureSet } = await import("@/babylon/structureSet");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const scene = new Scene(new NullEngine());
const box = (name, w, h, d, x, y, z) => {
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z); m.material = new StandardMaterial(`${name}_mat`, scene);
  m.computeWorldMatrix(true); return m;
};
const meshes = [
  box("Floor_Living", 10, 0.2, 10, 0, -0.1, 0),
  box("Wall_North", 10, 2.7, 0.15, 0, 1.35, 5),
  box("Stairs_Main", 1, 2.6, 3, 4, 1.3, 0),
  box("Ceiling_Living", 6, 0.1, 6, -2, 2.8, 0),
  box("Slab_Unnamed", 3, 0.1, 3, 3, 2.9, 3),        // no name, no stamp — only the height rule
  box("light.living_ceiling_lamp", 0.4, 0.1, 0.4, 0, 2.7, 0),
];
const renders = { n: 0 };
const set = new StructureSet({ requestRender: () => { renders.n++; }, worldExtents: () => ({ min: new Vector3(-5, 0, -5), max: new Vector3(5, 3, 5) }), eyeHeight: () => 1.7 });
set.apply(meshes, "overview");
const names = set.ceilings.map((m) => m.name).sort();

console.log("  what is a ceiling:");
ck("a named ceiling and a flat high slab are ceilings", JSON.stringify(names) === '["Ceiling_Living","Slab_Unnamed"]', names);
ck("  ...a ceiling LAMP is not, whatever its id says", !names.includes("light.living_ceiling_lamp"));
ck("a ceiling never collides (the walker would wedge on a stair)", set.ceilings.every((m) => !m.checkCollisions));
ck("a stair is tagged for the floor-follower and never collides",
   meshes[2].metadata?.isStair === true && !meshes[2].checkCollisions);

console.log("\n  views:");
ck("hidden in the bird's-eye cut-away", set.ceilings.every((m) => !m.isVisible));
set.setView("first-person");
ck("shown while walking", set.ceilings.every((m) => m.isVisible));
set.setView("overview");
ck("  ...and hidden again", set.ceilings.every((m) => !m.isVisible));
const walking = new StructureSet({ requestRender() {}, worldExtents: () => ({ min: Vector3.Zero(), max: Vector3.One() }), eyeHeight: () => 1.7 });
walking.apply(meshes, "first-person");
ck("a model loaded while walking gets its ceilings shown at once", walking.ceilings.every((m) => m.isVisible));

console.log("\n  what is over the walker's head:");
set.setView("first-person");
const under = set.ceilingState({ x: -2, y: 1.7, z: 0 }, []);
ck("under the living-room ceiling, one is found straight above", under.above !== null && Math.abs(under.above - 2.75) < 0.06, under);
const outside = set.ceilingState({ x: -20, y: 1.7, z: 0 }, []);
ck("out in the garden, none — and the nearest is metres away, not centimetres",
   outside.above === null && outside.near > 10, outside);

console.log("\n  forgetting:");
set.clear();
ck("clear() leaves no ceiling behind", set.ceilings.length === 0);
const sm = readFileSync(new URL("../../src/babylon/SceneManager.ts", import.meta.url), "utf8");
const dispose = sm.slice(sm.indexOf("  dispose(): void {"), sm.indexOf("\n  }\n", sm.indexOf("  dispose(): void {")));
ck("SceneManager's dispose clears it (the 35 MB leak)", /this\.structure\.clear\(\)/.test(dispose));
ck("  ...and keeps no ceiling list of its own", !/ceilingMeshes/.test(sm.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one owner for the ceilings, from load to dispose");
process.exit(fail ? 1 : 0);
