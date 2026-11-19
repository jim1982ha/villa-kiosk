// tests/oracles/glass_sheets.mjs
// Every glass pane shows one tinted face from either side (src/babylon/glassSheets.ts).
//
// Glass is drawn with its back faces culled (ModelLoader). A pane modelled as
// one sheet with nothing behind it was tinted from one side and not there at
// all from the other; it gets a reversed copy of its triangles. A box, a sheet
// with its reverse on the same corners, and a pane drawn as two sheets facing
// away from each other (most panes of the current bake, measured 2026-11-19)
// already show one face from each side and must not get a second.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { oneFacedSheetTriangles } = await import("@/babylon/glassSheets");

/** One mesh's vertex data, built piece by piece (each piece its own corners,
 *  as an exporter writes them). */
function meshOf(pieces) {
  const positions = [], indices = [];
  for (const tris of pieces) for (const tri of tris) {
    const base = positions.length / 3;
    for (const p of tri) positions.push(...p);
    indices.push(base, base + 1, base + 2);
  }
  return { positions, indices };
}
/** A 1 x 1 pane in the plane z = `z`, facing +z (or -z). */
const sheet = (x0, z, facing = 1) => {
  const a = [x0, 0, z], b = [x0 + 1, 0, z], c = [x0 + 1, 1, z], d = [x0, 1, z];
  return facing > 0 ? [[a, b, c], [a, c, d]] : [[a, c, b], [a, d, c]];
};
/** A closed thin box 1 x 1 x t at x0, its faces wound outward. */
const box = (x0, t) => {
  const v = (x, y, z) => [x0 + x, y, z];
  const q = (a, b, c, d) => [[a, b, c], [a, c, d]];
  const P = [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0), v(0, 0, t), v(1, 0, t), v(1, 1, t), v(0, 1, t)];
  return [...q(P[4], P[5], P[6], P[7]), ...q(P[1], P[0], P[3], P[2]), ...q(P[0], P[4], P[7], P[3]),
          ...q(P[5], P[1], P[2], P[6]), ...q(P[3], P[7], P[6], P[2]), ...q(P[0], P[1], P[5], P[4])];
};

/** What a person sees: looking at the pane at (cx, 0.3) along z from the
 *  front (from +z) and from behind (from -z), how many tinted faces face them
 *  on the line of sight, after the lone sheets got their backs. */
function facesSeen({ positions, indices }, backed, cx) {
  const tris = [];
  for (let t = 0; t < indices.length / 3; t++) tris.push([0, 1, 2].map((k) => positions.slice(3 * indices[3 * t + k], 3 * indices[3 * t + k] + 3)));
  for (const t of backed) tris.push([tris[t][0], tris[t][2], tris[t][1]]);
  const seen = (fromFront) => tris.filter(([a, b, c]) => {
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(nz) < 1e-12 || (fromFront ? nz <= 0 : nz >= 0)) return false;   // culled: facing away
    // The line of sight (cx, 0.3) inside the triangle's outline (x, y).
    const s = (p, q) => (q[0] - p[0]) * (0.3 - p[1]) - (q[1] - p[1]) * (cx - p[0]);
    const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
    return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
  }).length;
  return [seen(true), seen(false)];
}

// One mesh of one glass material, as a fused structure imports it: a lone
// sheet, a closed box, a sheet with its reverse on the same corners, and a
// pane of two sheets 1 cm apart facing away from each other; panes 2 m apart.
const PANES = { lone: 0, box: 2, reversed: 4, twin: 6 };
const mesh = meshOf([
  sheet(PANES.lone, 0),
  box(PANES.box, 0.01),
  sheet(PANES.reversed, 0), sheet(PANES.reversed, 0, -1),
  sheet(PANES.twin, 0.01), sheet(PANES.twin, 0, -1),
]);
const backed = oneFacedSheetTriangles(mesh.positions, mesh.indices);
for (const [name, x0] of Object.entries(PANES)) {
  const [front, back] = facesSeen(mesh, backed, x0 + 0.7);
  ck(`the ${name} pane: one tinted face from the front and one from behind`, front === 1 && back === 1, { front, back });
}

console.log("\n  a sheet in a rotated, scaled frame (positions as a node's local ones):");
{
  const rot = (p) => [p[0] * 37, p[2] * 37, -p[1] * 37];   // turned to lie flat, 37x larger
  const lone = meshOf([sheet(0, 0).map((t) => t.map(rot))]);
  ck("it is found as a lone sheet all the same", oneFacedSheetTriangles(lone.positions, lone.indices).length === 2);
}
console.log("\n  what is not a pane:");
{
  const bent = meshOf([[[[0, 0, 0], [1, 0, 0], [1, 1, 0]], [[0, 0, 0], [1, 1, 0], [0, 1, 1]]]]);
  ck("an open piece that is not flat is left as it is", oneFacedSheetTriangles(bent.positions, bent.indices).length === 0);
  const far = meshOf([sheet(0, 0.5), sheet(0, 0, -1)]);
  ck("two sheets half a pane apart are two lone panes, each backed",
     oneFacedSheetTriangles(far.positions, far.indices).length === 4);
}

done("✅ every pane: one tinted face from either side");
