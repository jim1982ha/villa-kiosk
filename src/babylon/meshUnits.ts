// src/babylon/meshUnits.ts
// Shared local<->world unit conversion for mesh-geometry edits.
//
// The GLB keeps SweetHome's CENTIMETRE vertex data; SceneManager.normalizeScale
// converts to metres by scaling only the ROOT node (~0.01) — so any mesh's
// LOCAL vertex/bounding-box data stays ~100x its WORLD (metre) size. Any code
// that edits local vertex data, or a local-space shader offset (e.g. outline
// width), using a METRE constant directly is comparing/applying the wrong
// unit — see EntityVisuals' strip-repair fixes (v2.5.2) and the outline-width
// fix that found the same bug in applyHighlight. Centralised here so the next
// piece of mesh-geometry code doesn't have to rediscover this the hard way.

import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { BoundingBox } from "@babylonjs/core/Culling/boundingBox";

/** World length (metres) of one LOCAL unit along each of a mesh's local axes.
 *  Divide a target WORLD size by the relevant axis to get the LOCAL value to
 *  write into vertex data or a local-space shader parameter; multiply a LOCAL
 *  size by it to compare against a WORLD/metre constant. */
export function axisWorldScale(mesh: AbstractMesh): { x: number; y: number; z: number } {
  const m = mesh.getWorldMatrix().m;
  return {
    x: Math.hypot(m[0], m[1], m[2]),
    y: Math.hypot(m[4], m[5], m[6]),
    z: Math.hypot(m[8], m[9], m[10]),
  };
}

/** A mesh's bounding box, its per-axis world scale, its size in WORLD metres
 *  and its longest world axis — what both LED-strip fixes in EntityVisuals
 *  measure a piece by (written out in each until 2.496.263). `bb` is LOCAL
 *  (the model's own units), for a vertex edit along `longAxis`. */
export function stripExtent(mesh: AbstractMesh): {
  bb: BoundingBox; unit: { x: number; y: number; z: number };
  worldSize: { x: number; y: number; z: number }; longAxis: "x" | "y" | "z";
} {
  const bb = mesh.getBoundingInfo().boundingBox;
  const size = bb.maximum.subtract(bb.minimum);
  const unit = axisWorldScale(mesh);
  const worldSize = { x: size.x * unit.x, y: size.y * unit.y, z: size.z * unit.z };
  const axes: Array<"x" | "y" | "z"> = ["x", "y", "z"];
  const longAxis = axes.reduce((a, b) => (worldSize[b] > worldSize[a] ? b : a));
  return { bb, unit, worldSize, longAxis };
}
