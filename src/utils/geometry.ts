// src/utils/geometry.ts

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** a → b at t (0..1). Four files wrote `a + (b - a) * t` (2.496.200). */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** An angle folded into -π..π — the signed shortest difference between two
 *  bearings. SkyDome and OverviewController each had their own formula. */
export const wrapAngle = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

export interface Pt2 {
  x: number;
  z: number;
}

/** The XZ box around `pts`, or null for none. Three files wrote the
 *  min/max loop out (2.496.263). */
export function boundsXZ(pts: Iterable<Pt2>): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return minX <= maxX ? { minX, maxX, minZ, maxZ } : null;
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
  // ⚠️ NO CORNER THAT IS NOT A CORNER (2026-11-20, measured on the villa's
  // plan): an outline traced in a drawing tool repeats a point, or puts one on
  // a straight run. Such a vertex is never an ear and blocks its neighbours'
  // test (it lies on their triangle's edge), so the clipping stopped early: a
  // garden drawn round the house lost 16 m², an outdoor bath half its floor,
  // a storeroom nearly all of it. Dropping them changes no area.
  const size = Math.sqrt(Math.abs(signedArea2(poly))) || 1;
  for (let i = 0; remaining.length > 3 && i < remaining.length;) {
    const a = poly[remaining[(i - 1 + remaining.length) % remaining.length]];
    const b = poly[remaining[i]];
    const c = poly[remaining[(i + 1) % remaining.length]];
    const same = Math.hypot(b.x - c.x, b.z - c.z) <= 1e-9 * size;
    if (same || Math.abs(cross2(a, b, c)) <= 1e-12 * size * size) { remaining.splice(i, 1); i = Math.max(0, i - 1); } else i++;
  }

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

/** Where the segment p→q crosses the infinite line through a→b, or null if
 *  they are parallel. Only ever called by `clipPolygonToConvex`, and only for
 *  a pair already known to straddle that line, so the segment/line distinction
 *  cannot bite here. */
function segmentLineCross(p: Pt2, q: Pt2, a: Pt2, b: Pt2): Pt2 | null {
  const dx = q.x - p.x, dz = q.z - p.z;
  const ex = b.x - a.x, ez = b.z - a.z;
  const denom = ex * dz - ez * dx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = (ez * (p.x - a.x) - ex * (p.z - a.z)) / denom;
  return { x: p.x + dx * t, z: p.z + dz * t };
}

/**
 * Sutherland–Hodgman: the part of `subject` that lies inside `clip`.
 *
 * ⚠️ THE ARGUMENT ORDER IS THE WHOLE CORRECTNESS ARGUMENT. This algorithm
 * clips against each of the clip region's edges in turn, so the CLIP polygon
 * must be CONVEX; the SUBJECT may be any simple polygon, concave included.
 * Villa rooms are routinely L-shaped, so the room is always the subject and the
 * marker's own footprint (a regular polygon from `regularPolygon`) is always
 * the clip. Swapping them compiles, looks plausible on a rectangular test room,
 * and quietly mangles every L-shaped one.
 *
 * Winding-agnostic in the clip: it is normalised to CCW here, so a caller
 * never has to know which way its polygon was authored. Returns an empty array
 * when the two do not overlap at all.
 */
export function clipPolygonToConvex(subject: Pt2[], clip: Pt2[]): Pt2[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const region = signedArea2(clip) > 0 ? clip : [...clip].reverse();
  let out: Pt2[] = subject;
  for (let i = 0; i < region.length && out.length > 0; i++) {
    const a = region[i], b = region[(i + 1) % region.length];
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j - 1 + input.length) % input.length];
      // Inside == left of the directed edge, which is what CCW winding means.
      const curIn = cross2(a, b, cur) >= 0;
      const prevIn = cross2(a, b, prev) >= 0;
      if (curIn) {
        if (!prevIn) {
          const p = segmentLineCross(prev, cur, a, b);
          if (p) out.push(p);
        }
        out.push(cur);
      } else if (prevIn) {
        const p = segmentLineCross(prev, cur, a, b);
        if (p) out.push(p);
      }
    }
  }
  return out;
}

/** A regular `sides`-gon of circumradius `radius` centred on (cx, cz), CCW.
 *  Used as the convex clip region for a round floor marker — an octagon bounds
 *  a disc far more tightly than its AABB does, and every vertex outside the
 *  disc lands where the marker's own gradient is already fully transparent. */
export function regularPolygon(cx: number, cz: number, radius: number, sides: number): Pt2[] {
  const pts: Pt2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius });
  }
  return pts;
}

/** Shortest distance from (x, z) to the polygon's BOUNDARY — not to its
 *  interior, so a point inside and a point outside both report their distance
 *  to the nearest edge. The fallback for a marker that belongs to no room: cap
 *  its radius at this and it still cannot reach across the nearest wall. */
export function distanceToPolygonBoundary(x: number, z: number, poly: Pt2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j].x, az = poly[j].z;
    const bx = poly[i].x, bz = poly[i].z;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1) : 0;
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

/** A point inside the polygon: `near` if it is inside (a room's middle), else
 *  the point of a grid over the polygon farthest from its edges. A garden
 *  drawn round a house has its middle on the house: its floor was read there,
 *  2.1 m up, and the lamps of the terrace beside it stopped at the lawn
 *  (owner, 2026-11-20). */
export function pointInside(poly: Pt2[], near: Pt2, steps = 24): Pt2 {
  if (pointInPolygon(near.x, near.z, poly)) return near;
  const b = boundsXZ(poly);
  if (!b) return near;
  let best = near, far = -1;
  for (let i = 0; i < steps; i++) for (let j = 0; j < steps; j++) {
    const x = b.minX + ((b.maxX - b.minX) * (i + 0.5)) / steps, z = b.minZ + ((b.maxZ - b.minZ) * (j + 0.5)) / steps;
    if (!pointInPolygon(x, z, poly)) continue;
    const d = distanceToPolygonBoundary(x, z, poly);
    if (d > far) { far = d; best = { x, z }; }
  }
  return best;
}
