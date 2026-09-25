// A light pool must show on a floor that is red for presence, from EVERY angle.
//
// ⚠️ FOUND BY THE OWNER TILTING THE CAMERA, 2026-09-25. Four lights on over the
// 2F patio: all four pools showed while the patio was clear; with presence
// detected (the red glow), the top-down view showed ONE, a tilted view two,
// another all four. Same lights, same state — only the camera had moved.
//
// Cause: Babylon draws transparent meshes far to near by the distance to each
// mesh's CENTRE unless `alphaIndex` says otherwise. The glow is one room-sized
// mesh; each pool is small. Both lay 0.02m above the floor and both wrote
// depth, so whichever the camera happened to rank first hid the other.
//
// This runs Babylon's OWN transparent sort, on the REAL meshes the two classes
// build, from a ring of camera positions — and first proves that the same
// layout under the OLD rule (no alphaIndex) really does put a pool before the
// glow from some of them. Without that counterfactual the oracle could pass
// for a reason unrelated to the fix.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);

// The pool's gradient is drawn on a 2D canvas, which Node has none of. The
// NullEngine never uploads it, so a canvas that accepts the calls is enough —
// what is under test is draw ORDER, not the gradient.
globalThis.OffscreenCanvas ??= class {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() {
    return {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}, clearRect() {}, fillRect() {},
    };
  }
};
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { Vector3 } = await import("@babylonjs/core/Maths/math.vector.js");
const { RenderingGroup } = await import("@babylonjs/core/Rendering/renderingGroup.js");
const { RoomHighlight } = await import("@/babylon/RoomHighlight");
const { LightPool } = await import("@/babylon/LightPools");

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };

const scene = new Scene(new NullEngine());
const noop = () => {};
const glow = new RoomHighlight(scene, { repaint: noop, animate: noop }, { surfaceUnder: () => null });
// A long patio, 20m x 6m, with four fixtures along it — the reported shape.
glow.setRooms([{ name: "Patio", floorY: 0,
  pts: [{ x: -10, z: -3 }, { x: 10, z: -3 }, { x: 10, z: 3 }, { x: -10, z: 3 }] }]);
glow.setActive("Patio", true);
const glowMesh = scene.meshes.find((m) => m.name.startsWith("roomGlow_"));
const pools = [-7, -2, 3, 8].map((x, i) =>
  new LightPool(scene, `p${i}`, new Vector3(x, 0.02, 0), 1.5).mesh);
ck("the fixture built one glow and four pools", !!glowMesh && pools.length === 4);

/** Every camera position on a ring above the patio, from overhead to low. */
const cameras = [];
for (let deg = 0; deg < 360; deg += 15)
  for (const [r, h] of [[0.5, 20], [8, 14], [16, 8], [24, 4]])
    cameras.push(new Vector3(r * Math.cos(deg * Math.PI / 180), h, r * Math.sin(deg * Math.PI / 180)));

/** How many camera positions draw some pool BEFORE the glow, under Babylon's
 *  own compare, with each mesh's alphaIndex as `indexOf` says. */
const poolFirst = (indexOf) => {
  let bad = 0;
  for (const cam of cameras) {
    const subs = [glowMesh, ...pools].map((m) => {
      m.computeWorldMatrix(true);
      const s = m.subMeshes[0];
      s._alphaIndex = indexOf(m);
      s._distanceToCamera = Vector3.Distance(
        s.getBoundingInfo().boundingSphere.centerWorld, cam);
      return s;
    });
    subs.sort(RenderingGroup.defaultTransparentSortCompare);
    const at = subs.findIndex((s) => s.getMesh() === glowMesh);
    if (at !== 0) bad++;
  }
  return bad;
};

console.log(`  ${cameras.length} camera positions\n`);
const before = poolFirst(() => Number.MAX_VALUE);
console.log(`      OLD rule (no alphaIndex): a pool drawn before the glow from ${before}`);
ck("the OLD rule really does let the camera reorder them", before > 0);
const after = poolFirst((m) => m.alphaIndex);
console.log(`      NOW: a pool drawn before the glow from ${after}`);
ck("now the glow is drawn first from EVERY position", after === 0);
ck("  ...and before every ordinary transparent mesh (glass, blades)",
   glowMesh.alphaIndex < Number.MAX_VALUE && pools.every((p) => p.alphaIndex < Number.MAX_VALUE));

// The order alone is not enough: two coplanar layers that both write depth
// still reject each other wherever their triangles round differently.
ck("the glow writes no depth", glowMesh.material.disableDepthWrite === true);
ck("no pool writes depth", pools.every((p) => p.material.disableDepthWrite === true));

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ a lit floor reads as lit, whoever is standing on it");
process.exit(fail ? 1 : 0);
