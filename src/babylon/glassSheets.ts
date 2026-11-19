// src/babylon/glassSheets.ts
// A glass pane modelled as ONE face, given its back.
//
// Glass is drawn single-sided (ModelLoader: backFaceCulling, because a
// double-sided pane that writes depth occludes itself in camera-dependent
// patches). That is safe for a pane modelled as a thin BOX — from either side
// its near face is front-facing — and ModelLoader's note there already named
// the case it is not safe for: a pane authored as a single unbacked sheet is
// invisible from behind.
//
// ⚠️ A PANE IS OFTEN TWO SHEETS, NOT A BOX (measured on the current bake,
// 2026-11-19, after the owner's report of the light and glass beside the lamps).
// Most panes there are two one-faced sheets a millimetre to a centimetre apart,
// facing away from each other, with no edges joining them: from either side the
// near sheet faces the camera, so the pane already shows one tinted face from
// each side. Counted sheet by sheet, two of every three panes looked one-faced;
// backing them all would have shown two tinted faces from each side, a darker
// pane. Such a twin is a two-faced pane and is left alone, like a box and like a
// sheet with its reverse on the same corners.
//
// What is left is a sheet with nothing behind it: from one side its tint, from
// the other nothing at all. The fix the old note asked for, dropping the depth
// write, brings back the sorting glitch it was set for; a reversed copy of the
// sheet's own triangles gives it one tinted face from either side.
//
// A pane is found in the vertex data, not by name: the triangles joined by
// shared corners make a piece; a piece is a lone one-faced sheet when it is
// flat, faces one way, is not closed (a box), has no triangle lying on another
// (a sheet with its back already) and no twin (a flat piece facing the other
// way just behind it, overlapping it). A fused structure imports one mesh per
// material, so every pane of one material shares one mesh: each piece is
// judged on its own. Positions are the mesh's own (local) ones, whatever node
// transform carries them: winding, flatness, coincidence and twins do not
// depend on it.

import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

/** Two faces of one piece this far from parallel (cosine) mean it is not flat. */
const FLAT_COS = Math.cos((5 * Math.PI) / 180);
/** A twin sheet lies behind a sheet closer than this fraction of the sheet's
 *  smallest side: a pane's thickness, never the room between two windows. */
const TWIN_GAP_OF_SIDE = 0.1;

/**
 * The triangles (indices into `indices` / 3) of every lone one-faced flat
 * sheet in this vertex data. Pure: arrays in, triangle numbers out.
 */
export function oneFacedSheetTriangles(positions: ArrayLike<number>, indices: ArrayLike<number>): number[] {
  const nv = positions.length / 3, nt = Math.floor(indices.length / 3);
  if (nt === 0) return [];
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  // Corners closer than a millionth of the mesh's size are one corner: an
  // exporter splits a corner per face for its normals and UVs.
  const eps = Math.max(Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 1e-6, 1e-9);
  const weld = new Map<string, number>();
  const id = new Int32Array(nv);
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(positions[3 * i] / eps)},${Math.round(positions[3 * i + 1] / eps)},${Math.round(positions[3 * i + 2] / eps)}`;
    let w = weld.get(k);
    if (w === undefined) { w = weld.size; weld.set(k, w); }
    id[i] = w;
  }
  // Pieces: triangles joined through a shared (welded) corner.
  const parent = new Int32Array(weld.size).map((_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const tri = (t: number) => [id[indices[3 * t]], id[indices[3 * t + 1]], id[indices[3 * t + 2]]];
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = tri(t);
    parent[find(b)] = find(a); parent[find(c)] = find(a);
  }
  const pieces = new Map<number, number[]>();
  for (let t = 0; t < nt; t++) {
    const r = find(tri(t)[0]);
    const list = pieces.get(r);
    if (list) list.push(t); else pieces.set(r, [t]);
  }
  /** The flat, open, unbacked pieces: one-faced, unless a twin backs them. */
  interface Sheet { tris: number[]; n: [number, number, number]; d: number; min: number[]; max: number[]; side: number }
  const sheets: Sheet[] = [];
  for (const tris of pieces.values()) {
    const edges = new Map<string, number>();
    const seen = new Set<string>();
    let backed = false, flat = true;
    let n0: [number, number, number] | null = null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) {
      const [a, b, c] = tri(t);
      const key = [a, b, c].sort((p, q) => p - q).join(",");
      if (seen.has(key)) backed = true;
      seen.add(key);
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const e = p < q ? `${p},${q}` : `${q},${p}`;
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
      const i0 = indices[3 * t], i1 = indices[3 * t + 1], i2 = indices[3 * t + 2];
      for (const i of [i0, i1, i2]) for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], positions[3 * i + k]); max[k] = Math.max(max[k], positions[3 * i + k]);
      }
      const ux = positions[3 * i1] - positions[3 * i0], uy = positions[3 * i1 + 1] - positions[3 * i0 + 1], uz = positions[3 * i1 + 2] - positions[3 * i0 + 2];
      const vx = positions[3 * i2] - positions[3 * i0], vy = positions[3 * i2 + 1] - positions[3 * i0 + 1], vz = positions[3 * i2 + 2] - positions[3 * i0 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len <= 0) continue;
      const n: [number, number, number] = [nx / len, ny / len, nz / len];
      if (!n0) n0 = n;
      else if (n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2] < FLAT_COS) flat = false;
    }
    const closed = [...edges.values()].every((k) => k === 2);
    if (!n0 || !flat || backed || closed) continue;
    const v = indices[3 * tris[0]];
    const d = n0[0] * positions[3 * v] + n0[1] * positions[3 * v + 1] + n0[2] * positions[3 * v + 2];
    // Its smallest side in its own plane: the box's sides less the one across it.
    const sides = [0, 1, 2].map((k) => max[k] - min[k]).sort((p, q) => p - q);
    sheets.push({ tris, n: n0, d, min, max, side: sides[1] });
  }
  // A twin: facing the other way, just behind (the two face away from each
  // other), the two boxes overlapping.
  const twin = (a: Sheet, b: Sheet): boolean => {
    if (a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2] > -FLAT_COS) return false;
    const gap = a.d + b.d;   // a's plane above b's, along a's normal
    const limit = TWIN_GAP_OF_SIDE * Math.min(a.side, b.side);
    if (!(gap > 0 && gap <= limit)) return false;
    for (let k = 0; k < 3; k++) if (a.min[k] > b.max[k] + limit || b.min[k] > a.max[k] + limit) return false;
    return true;
  };
  const out: number[] = [];
  for (const a of sheets) if (!sheets.some((b) => b !== a && twin(a, b))) out.push(...a.tris);
  return out;
}

/**
 * Give every lone one-faced flat sheet in this mesh its back: a copy of its
 * triangles wound the other way, its normals turned round. Returns how many
 * sheet triangles were backed. A mesh of several sub-meshes, or none of its own
 * geometry, is left as it is.
 */
export function backOneFacedSheets(mesh: AbstractMesh): number {
  if (!(mesh instanceof Mesh) || !mesh.geometry || mesh.subMeshes?.length > 1) return 0;
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind, true, true);
  const indices = mesh.getIndices();
  if (!positions || !indices) return 0;
  const tris = oneFacedSheetTriangles(positions, indices);
  if (tris.length === 0) return 0;
  // The sheets' own corners, copied once each, in order.
  const copyOf = new Map<number, number>();
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = indices[3 * t + k];
    if (!copyOf.has(v)) copyOf.set(v, copyOf.size);
  }
  const base = positions.length / 3;
  for (const kind of mesh.getVerticesDataKinds()) {
    const data = mesh.getVerticesData(kind, true, true);
    const stride = mesh.getVertexBuffer(kind)?.getSize();
    if (!data || !stride) continue;
    const grown = new Float32Array(data.length + copyOf.size * stride);
    grown.set(data);
    for (const [v, c] of copyOf) for (let s = 0; s < stride; s++) {
      let value = data[v * stride + s];
      // The back faces the other way: its normal turned round; a tangent
      // keeps its direction and flips its handedness.
      if (kind === VertexBuffer.NormalKind) value = -value;
      if (kind === VertexBuffer.TangentKind && s === 3) value = -value;
      grown[(base + c) * stride + s] = value;
    }
    mesh.setVerticesData(kind, grown, false, stride);
  }
  const all = Array.from(indices);
  for (const t of tris) {
    const a = base + copyOf.get(indices[3 * t])!, b = base + copyOf.get(indices[3 * t + 1])!, c = base + copyOf.get(indices[3 * t + 2])!;
    all.push(a, c, b);
  }
  mesh.setIndices(all, base + copyOf.size);
  return tris.length;
}
