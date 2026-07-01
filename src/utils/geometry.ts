// src/utils/geometry.ts

export interface Pt2 {
  x: number;
  z: number;
}

/** Ray-casting point-in-polygon test on the XZ plane. */
export function pointInPolygon(x: number, z: number, poly: Pt2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Twice the signed area of a polygon on the XZ plane (positive ⇒ CCW winding). */
function signedArea2(poly: Pt2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a;
}

function cross2(o: Pt2, a: Pt2, b: Pt2): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

function pointInTriangle(p: Pt2, a: Pt2, b: Pt2, c: Pt2): boolean {
  const d1 = cross2(a, b, p);
  const d2 = cross2(b, c, p);
  const d3 = cross2(c, a, p);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Ear-clipping triangulation of a simple polygon on the XZ plane. Returns
 * index triples (into `poly`) for a triangle-list vertex buffer — used to
 * build the room-floor highlight mesh without pulling in the `earcut`
 * dependency Babylon's own polygon builder needs.
 *
 * Falls back to stopping early (rather than looping forever) if no ear can
 * be found — a slightly-wrong glow shape for a self-intersecting/degenerate
 * room polygon beats hanging the render loop.
 */
export function earClipTriangulate(poly: Pt2[]): [number, number, number][] {
  if (poly.length < 3) return [];

  // The convexity test below assumes CCW winding; walk the index list
  // backwards if the polygon came in CW.
  const ccw = signedArea2(poly) > 0;
  const remaining = poly.map((_, i) => i);
  if (!ccw) remaining.reverse();

  const tris: [number, number, number][] = [];
  let guard = 0;
  const guardLimit = poly.length * poly.length + 8;
  while (remaining.length > 3 && guard++ < guardLimit) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const iPrev = remaining[(i - 1 + remaining.length) % remaining.length];
      const iCur = remaining[i];
      const iNext = remaining[(i + 1) % remaining.length];
      const a = poly[iPrev], b = poly[iCur], c = poly[iNext];
      if (cross2(a, b, c) <= 0) continue; // reflex vertex — not an ear candidate

      let anyInside = false;
      for (const idx of remaining) {
        if (idx === iPrev || idx === iCur || idx === iNext) continue;
        if (pointInTriangle(poly[idx], a, b, c)) { anyInside = true; break; }
      }
      if (anyInside) continue;

      tris.push([iPrev, iCur, iNext]);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate polygon — stop rather than loop forever
  }
  if (remaining.length === 3) tris.push([remaining[0], remaining[1], remaining[2]]);
  return tris;
}
