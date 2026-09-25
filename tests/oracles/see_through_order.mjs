// A camera's viewing cone is never cut off by the window it looks through.
//
// ⚠️ REPRODUCED 2026-09-25, BEFORE THE FIX. Window glass is transparent AND
// writes depth (ModelLoader's forceDepthWrite), and both it and the cone were
// ordered by Babylon's distance to each bounding sphere's centre. A glazed
// façade imports as ONE fused primitive whose centre is the façade's middle,
// so from roughly half of all outside viewpoints the glass drew first, wrote
// its depth, and the cone behind the pane failed the depth test — the same
// defect class as the light pools under the presence glow (2.496.53).
// Babylon's own transparent sort, on the real CameraBeams mesh.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
globalThis.OffscreenCanvas ??= class { constructor(w,h){this.width=w;this.height=h} getContext(){return{createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}}} };
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { Vector3 } = await import("@babylonjs/core/Maths/math.vector.js");
const { MeshBuilder } = await import("@babylonjs/core/Meshes/meshBuilder.js");
const { Mesh } = await import("@babylonjs/core/Meshes/mesh.js");
const { StandardMaterial } = await import("@babylonjs/core/Materials/standardMaterial.js");
const { RenderingGroup } = await import("@babylonjs/core/Rendering/renderingGroup.js");
const { CameraBeams } = await import("@/babylon/CameraBeams");
const scene = new Scene(new NullEngine());
// A glazed facade at z=0: two panes 16 m apart, fused into ONE mesh (as a GLB primitive is).
const a = MeshBuilder.CreatePlane("a", { width: 3, height: 2.5 }, scene); a.position.set(-8, 1.5, 0);
const b = MeshBuilder.CreatePlane("b", { width: 3, height: 2.5 }, scene); b.position.set(8, 1.5, 0);
const glass = Mesh.MergeMeshes([a, b], true);
const gm = new StandardMaterial("glass", scene); gm.alpha = 0.38; gm.forceDepthWrite = true; glass.material = gm;
// A camera cone INSIDE, behind the left pane, looking out through it.
const beams = new CameraBeams(scene);
beams.addBeam({ entityId: "camera.x", origin: new Vector3(-8, 2, -5), direction: new Vector3(0, -0.2, 1).normalize() }, new Set());
const beam = scene.meshes.find((m) => m.name.startsWith("beam_"));
const cameras = [];
for (let deg = 0; deg < 180; deg += 10) for (const r of [6, 12, 20]) for (const h of [2, 6])
  cameras.push(new Vector3(-8 + r * Math.cos(deg * Math.PI / 180), h, r * Math.sin(deg * Math.PI / 180)));
/** Outside viewpoints (the cone is behind the pane from all of them) from
 *  which the glass is drawn BEFORE the cone, i.e. cuts it off. */
const cutOff = (indexOf) => cameras.filter((cam) => {
  const subs = [glass, beam].map((m) => { m.computeWorldMatrix(true); const s = m.subMeshes[0];
    s._alphaIndex = indexOf(m); s._distanceToCamera = Vector3.Distance(s.getBoundingInfo().boundingSphere.centerWorld, cam); return s; });
  subs.sort(RenderingGroup.defaultTransparentSortCompare);
  return subs[0].getMesh() === glass;
}).length;

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const before = cutOff(() => Number.MAX_VALUE);
console.log(`  ${cameras.length} outside viewpoints; the OLD order cuts the cone off from ${before}`);
ck("the old order really does let the glass cut the cone off", before > 0, before);
ck("now the cone is drawn first from EVERY viewpoint", cutOff((m) => m.alphaIndex) === 0);
ck("the cone writes no depth — it must not cut off what is behind IT", beam.material.disableDepthWrite === true);

const order = await import("@/babylon/seeThroughOrder");
const idx = Object.entries(order).filter(([k]) => k.endsWith("_ALPHA_INDEX"));
ck("every layer in the table has its own slot", new Set(idx.map(([, v]) => v)).size === idx.length, idx);
ck("  ...before every default-ordered transparent mesh", idx.every(([, v]) => v < Number.MAX_VALUE));
ck("  ...and the cone comes after the floor layers it may stand over",
   order.CAMERA_BEAM_ALPHA_INDEX > order.LIGHT_POOL_ALPHA_INDEX && order.CAMERA_BEAM_ALPHA_INDEX > order.ROOM_GLOW_ALPHA_INDEX);

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ no see-through layer is ordered by where the camera happens to be");
process.exit(fail ? 1 : 0);
