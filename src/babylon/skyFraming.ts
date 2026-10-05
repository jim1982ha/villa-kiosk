// src/babylon/skyFraming.ts
// Where the overview draws a body of the sky — the sun or the moon — given its
// TRUE direction: pure numbers, no Babylon. SkyDome and NightSky are the
// Babylon adapters; tests/oracles/sky_framing.mjs simulates every case and
// sky_bodies.mjs checks the real camera.
//
// ── WHAT IT IS FOR, AND THE ONE RULE (2.496.304) ────────────────────────────
// An INDICATOR, not a physical sun (owner, 2026-10-05: "it doesn't have to be
// 100% realistic: the goal is to indicate on the screen where the sun is along
// the day — East when rising, West when setting, through its mid-day position
// at noon"). So the body is placed ROUND THE VILLA AS THE SCREEN SHOWS IT:
//   · the villa's outline on the frame — the convex hull of a handful of its
//     points, projected (villaShape) — clipped to what is on screen;
//   · the body's direction round that outline is its bearing RELATIVE TO
//     WHERE THE CAMERA FACES: ahead → straight up from the villa, to the
//     right → to the right; and the higher it is, the more that direction
//     turns toward straight up (noon is above the villa from any side);
//   · it sits where a ray from the outline's centre in that direction leaves
//     the outline, plus a clearance, plus a rise for its altitude — so a low
//     sun hugs the villa's own edge on its side and noon stands above it;
//   · behind the viewer it fades out (aheadFade).
// Because it is drawn round the villa's OWN outline, panning, zooming and
// tilting move it with the villa; only turning and the hour move it round.
//
// ⚠️ WHY NOT A 3D OBJECT. 2.496.290–303 placed it in the world — a ground spot
// with screen rules, then a fixed point on a sun-path dome (Revit's display).
// A 3D object moves under the camera by perspective and parallax, and each
// version broke a rule the owner had set in some pose: tilt slid it, pan and
// zoom left it behind, and with the dome as wide as the camera's distance the
// point came BETWEEN the camera and the villa — the sun drawn on the lawn in
// front of the house when it was really behind the viewer (owner recording
// sun7). Round the villa's screen outline none of those can happen, and
// tests/oracles/sky_framing.mjs simulates every pose to show it.

import { wrapAngle } from "@/utils/geometry";

export interface Vec3 { x: number; y: number; z: number }

/** A point on the frame in frame-HEIGHT units both ways (x = frameX·aspect,
 *  y = frameY, y DOWN), so distances are the same in every direction. */
export interface P2 { x: number; y: number }

/** The villa as the frame shows it (frame-height units): the convex hull of
 *  its projected outline points, clipped to the frame, its centre, and its
 *  size (the larger half-extent) — what the body is placed round. */
export interface VillaShape { hull: P2[]; c: P2; size: number; top: number; fill: number }

/** The camera, as the framing measures against it. `pitch` is radians BELOW
 *  horizontal (positive); `halfFov` half the vertical field of view; `camAz`
 *  the camera's own bearing; `hHalf` half the HORIZONTAL field of view. `eye`
 *  is the camera's position in the world, and `villa` the villa's world box
 *  corners (setVillaBox) — null until a camera and a model are known. */
export interface SkyCamera {
  pitch: number;
  halfFov: number;
  camAz: number;
  hHalf: number;
  eye: Vec3 | null;
  villa: Vec3[] | null;
}

/** The pose before the first rendered frame reports the real one. */
export function defaultSkyCamera(): SkyCamera {
  return { pitch: 0, halfFov: 0.4, camAz: 0, hHalf: 0.7, eye: null, villa: null };
}

/** The dome's radius, and the denominator the horizon drop's angle is measured
 *  against — one constant so the two cannot drift apart. */
export const SKY_RADIUS = 500;

/**
 * The angle, in radians, that a given horizon drop rotated the sky by. 0 in
 * first person, where the true sky is what the viewer is standing under and
 * must not be redrawn at all — so `drop > 0` is also "this is the overview".
 */
export function liftFor(units: number): number {
  return units > 0 ? Math.atan(units / SKY_RADIUS) : 0;
}

/** The twilight band a body fades over as it sets: −1°..3° of TRUE altitude. */
export const SET_LOW = (-1 * Math.PI) / 180;
export const SET_HIGH = (3 * Math.PI) / 180;

/** How opaque a body at TRUE altitude `alt` should be, so it sets and rises
 *  rather than blinking out. */
export function horizonFade(alt: number): number {
  const t = (alt - SET_LOW) / (SET_HIGH - SET_LOW);
  return Math.max(0, Math.min(1, t));
}

// ── The placement's numbers (frame-height units unless said) ───────────────

/** Clearance between the villa's outline and the body: the disc's own radius
 *  (the sun's bright core is ~0.025 of the frame height) plus a little air. */
export const CLEAR = 0.045;
/** How far above the villa noon stands, in villa sizes (VillaShape.size) —
 *  capped by the room left above the villa on screen. */
export const RISE = 0.9;
/** The frame's margin: a body's range round the villa narrows to keep it this
 *  far inside the side edges (sideReach), and it is held this far inside the
 *  top and bottom. */
export const EDGE = 0.05;
/** How close to the frame's side edge the path's furthest point may come
 *  before the body's range round the villa starts to narrow (sideReach). */
export const SQUEEZE_SOON = 0.1;
/** Behind the viewer: `ahead` = cos(relative bearing)·cos(altitude) — the
 *  body's horizontal pull toward where the camera faces. Fully shown from
 *  AHEAD_FULL, gone at AHEAD_GONE: for a low sun, up to ~91° off the view
 *  direction and gone by ~105°; a high sun (noon) stays, above the villa. */
export const AHEAD_FULL = -0.02;
export const AHEAD_GONE = -0.26;

/** Zoomed into the villa: shown fully while its outline covers up to
 *  FILL_FULL of the frame, gone by FILL_GONE. With the villa filling the
 *  screen there is no sky round it to point into — every place is over the
 *  villa or off the frame, and the search between them flipped (the
 *  simulation, 2.496.304) — and the disc would be behind the house anyway. */
export const FILL_FULL = 0.6;
export const FILL_GONE = 0.8;

/** The bearing relative to where the camera faces (radians, + = to the right)
 *  and the TRUE altitude, of a body in direction (x,y,z). */
export function relativeSky(x: number, y: number, z: number, camAz: number): { rel: number; alt: number } {
  const h = Math.hypot(x, z);
  return { rel: h < 1e-9 ? 0 : wrapAngle(Math.atan2(x, z) - camAz), alt: Math.atan2(y, h) };
}

/** 1 while the body is ahead or overhead, 0 when it is behind the viewer, a
 *  smooth fade between. */
export function aheadFade(rel: number, alt: number): number {
  const t = (Math.cos(rel) * Math.cos(Math.max(0, alt)) - AHEAD_GONE) / (AHEAD_FULL - AHEAD_GONE);
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** How far along a ray from the shape's centre, in direction (ux, uy), the
 *  ray leaves the hull — the nearest crossing among the edges it is heading
 *  out through. Continuous in the direction, which keeps the body smooth. */
function exitDistance(shape: VillaShape, ux: number, uy: number): number {
  const { hull, c } = shape;
  let t = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    // The edge's normal, turned to point away from the centre.
    let nx = b.y - a.y, ny = a.x - b.x;
    if (nx * (a.x - c.x) + ny * (a.y - c.y) < 0) { nx = -nx; ny = -ny; }
    const out = nx * ux + ny * uy;
    if (out <= 1e-12) continue;
    t = Math.min(t, (nx * (a.x - c.x) + ny * (a.y - c.y)) / out);
  }
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** How far a point is from the outline (0 inside it). */
function distanceToHull(shape: VillaShape, p: P2): number {
  const { hull } = shape;
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ex = b.x - a.x, ey = b.y - a.y, len2 = ex * ex + ey * ey || 1e-12;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2));
    best = Math.min(best, Math.hypot(p.x - a.x - t * ex, p.y - a.y - t * ey));
  }
  return best;
}

/** The point at angle θ round the villa (0 = straight up, + = to the right)
 *  that is `d` AWAY FROM ITS OUTLINE — measured as a true distance, not along
 *  the ray. ⚠️ Pushed `d` along the ray, a ray crossing an edge at a shallow
 *  angle left the disc nearly touching the villa (the simulation, 2.496.304);
 *  scaling by that angle would jump at every corner. The distance to a convex
 *  outline only grows along an outgoing ray, so the point is found by halving,
 *  and it moves smoothly with θ. */
function aroundVilla(shape: VillaShape, theta: number, d: number): P2 {
  const ux = Math.sin(theta), uy = -Math.cos(theta);
  const t0 = exitDistance(shape, ux, uy);
  const at = (t: number): P2 => ({ x: shape.c.x + t * ux, y: shape.c.y + t * uy });
  let lo = t0, hi = t0 + d;
  for (let i = 0; i < 12 && distanceToHull(shape, at(hi)) < d; i++) hi = t0 + (hi - t0) * 2;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (distanceToHull(shape, at(mid)) < d) lo = mid; else hi = mid;
  }
  return at(hi);
}

/** How far round the villa (radians from straight up, ≤ π/2) a body on
 *  `side` (+1 right, −1 left) may go and stay on screen.
 *
 *  The path is the outline grown by `d` — convex — so, walked from straight
 *  up toward the side, its x goes out to one extreme and comes back. Near the
 *  frame's edge there is a band SQUEEZE_SOON wide: once the path reaches into
 *  it, the range ends where the path first enters the band, blended in from
 *  "no limit" by how far the path reaches in. ⚠️ Every input is continuous —
 *  the furthest VALUE the path reaches (never where: along a straight side of
 *  the outline that "where" hopped, and the body with it — the simulation),
 *  and the first crossing of the band's line, which is unique. */
function sideReach(shape: VillaShape, side: number, d: number, lo: number, hi: number): number {
  const half = Math.PI / 2;
  // The path is exactly `d` from the outline, so it never reaches past the
  // outline's own extent plus `d`: clear of the band, there is nothing to do
  // (most views — and the search below is the costly part).
  let reach = -Infinity;
  for (const v of shape.hull) reach = Math.max(reach, side * v.x);
  if (side > 0 ? reach + d <= hi - SQUEEZE_SOON : -reach - d >= lo + SQUEEZE_SOON) return half;
  // How far into the band (0 at its inner line, SQUEEZE_SOON at the edge).
  const into = (t: number) => (side > 0 ? aroundVilla(shape, t, d).x - (hi - SQUEEZE_SOON) : (lo + SQUEEZE_SOON) - aroundVilla(shape, -t, d).x);
  const N = 12;
  let best = 0, deepest = -Infinity;
  for (let i = 0; i <= N; i++) {
    const t = (half * i) / N, v = into(t);
    if (v > deepest) { deepest = v; best = t; }
  }
  let a = Math.max(0, best - half / N), b = Math.min(half, best + half / N);
  for (let i = 0; i < 14; i++) {
    const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
    if (into(m1) < into(m2)) a = m1; else b = m2;
  }
  const tDeep = (a + b) / 2;
  deepest = Math.max(deepest, into(tDeep));
  if (deepest <= 0) return half;
  // Where the path first enters the band: one crossing between straight up and its deepest point.
  let inn = 0, out = tDeep;
  if (into(0) >= 0) out = 0;
  else for (let i = 0; i < 18; i++) {
    const m = (inn + out) / 2;
    if (into(m) < 0) inn = m; else out = m;
  }
  const u = Math.min(1, deepest / SQUEEZE_SOON);
  return half - (half - out) * u * u * (3 - 2 * u);
}

/**
 * Where on the frame the body is drawn (frame units, y down): round the
 * villa's outline (see the header), kept on screen. `aspect` is the frame's
 * width over its height.
 */
export function placeAround(rel: number, alt: number, shape: VillaShape, aspect: number): { fx: number; fy: number } {
  const a0 = Math.max(0, alt);
  // ⚠️ THE FRONT HALF ONLY. A body behind the viewer is fading out
  // (aheadFade); while it does, it is drawn at its MIRROR on the front half —
  // same side, as far round — never below the villa's middle, where it would
  // be in front of the villa. It also cannot flip sides at 180°: the mirror
  // of ±180° is 0 from both sides.
  const front = Math.abs(rel) <= Math.PI / 2 ? rel : Math.sign(rel) * (Math.PI - Math.abs(rel));
  // Higher → turned toward straight up: noon is above the villa from any side.
  const theta = front * Math.cos(a0);
  // The rise for its altitude: RISE villa sizes at noon, but never past the
  // room above the villa (or every hour from mid-morning on would be pinned
  // to the top edge, and the height would stop saying anything).
  const room = Math.max(0, shape.top - EDGE - CLEAR);
  const d = CLEAR + Math.sin(a0) * Math.min(RISE * shape.size, room);
  // Kept on screen by NARROWING ITS RANGE ROUND THE VILLA, never by moving
  // it off its path: on a screen too narrow for the villa (a phone held
  // upright), the directions it may take are squeezed toward straight up just
  // enough that the path's furthest point that way is still on screen. On its
  // path it is always clear of the villa, and the hours keep their order.
  // (Stopping it at the edge and sliding it put it over or under the villa's
  // corner, or made it jump over it — the simulation, three tries.)
  const lo = EDGE, hi = aspect - EDGE;
  const side = theta >= 0 ? 1 : -1;
  const p = aroundVilla(shape, theta * (sideReach(shape, side, d, lo, hi) / (Math.PI / 2)), d);
  const x = Math.min(hi, Math.max(lo, p.x)), y = p.y;
  return { fx: x / aspect, fy: Math.min(1 - EDGE, Math.max(EDGE, y)) };
}

/**
 * Where a DIRECTION lands on screen through this camera (frame units, y down)
 * — the camera's own projection. Behind the camera is null.
 */
export function projectToFrame(x: number, y: number, z: number, cam: SkyCamera): { frameX: number; frameY: number } | null {
  const sa = Math.sin(cam.camAz), ca = Math.cos(cam.camAz), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
  const fwd = x * sa * cp - y * sp + z * ca * cp;
  if (!(fwd > 1e-9)) return null;
  const right = x * ca - z * sa;
  const up = x * sa * sp + y * cp + z * ca * sp;
  return {
    frameX: 0.5 + 0.5 * (right / fwd) / Math.tan(cam.hHalf),
    frameY: 0.5 - 0.5 * (up / fwd) / Math.tan(cam.halfFov),
  };
}

/** The direction from the camera through a frame point — projectToFrame's
 *  inverse, for a camera with no roll. */
export function frameToDirection(fx: number, fy: number, cam: SkyCamera): Vec3 {
  const sa = Math.sin(cam.camAz), ca = Math.cos(cam.camAz), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
  const cx = (2 * fx - 1) * Math.tan(cam.hHalf), cy = (1 - 2 * fy) * Math.tan(cam.halfFov);
  const v = { x: sa * cp + cx * ca + cy * sa * sp, y: -sp + cy * cp, z: ca * cp - cx * sa + cy * ca * sp };
  const n = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

/** The least depth an outline point is projected at, as a share of its
 *  distance (see villaShape). */
const NEAR = 0.15;

/** The villa's box corners for its world extents — the outline of last
 *  resort when no finer one is given (outlinePoints). */
export function boxCorners(min: Vec3, max: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) out.push({ x, y, z });
  return out;
}

/**
 * A small set of points that outlines the villa from any side: the extreme
 * point of `points` (every mesh's box corners, gathered once at load) along
 * 26 directions — the corners, edges and faces of a cube. Seen from any
 * camera, their projection hugs the villa's real silhouette far more closely
 * than its bounding box, whose top corners float in the air above the plot's
 * edge (2.496.304: that box made the arc too large for the frame).
 */
export function outlinePoints(points: Vec3[]): Vec3[] {
  if (points.length <= 26) return points.slice();
  const dirs: Vec3[] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) dirs.push({ x, y, z });
  const out = new Set<Vec3>();
  for (const d of dirs) {
    let best = points[0], bestDot = -Infinity;
    for (const p of points) {
      const t = p.x * d.x + p.y * d.y + p.z * d.z;
      if (t > bestDot) { bestDot = t; best = p; }
    }
    out.add(best);
  }
  return [...out];
}

/** The villa's outline on the frame (frame-height units): its outline points
 *  projected, their convex hull, clipped to the frame.
 *
 *  ⚠️ A point beside or behind the camera (zoomed right in) is projected at a
 *  minimum depth, never dropped: dropping it, or calling the view "full",
 *  made the outline — and the body — JUMP the moment a corner of the plot
 *  crossed the camera's plane (the simulation, 2.496.304). Clamped, the
 *  outline just runs off the frame on that side, smoothly; clipped to the
 *  frame, the body goes round what the viewer actually sees. */
export function villaShape(points: Vec3[], cam: SkyCamera): VillaShape | null {
  if (!cam.eye || points.length === 0) return null;
  const aspect = frameAspect(cam);
  const sa = Math.sin(cam.camAz), ca = Math.cos(cam.camAz), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
  const tx = Math.tan(cam.hHalf), ty = Math.tan(cam.halfFov);
  const pts: P2[] = points.map((c) => {
    const x = c.x - cam.eye!.x, y = c.y - cam.eye!.y, z = c.z - cam.eye!.z;
    const fwd = Math.max(x * sa * cp - y * sp + z * ca * cp, NEAR * Math.hypot(x, y, z), 1e-6);
    return {
      x: (0.5 + 0.5 * ((x * ca - z * sa) / fwd) / tx) * aspect,
      y: 0.5 - 0.5 * ((x * sa * sp + y * cp + z * ca * sp) / fwd) / ty,
    };
  });
  let hull = convexHull(pts);
  const clipped = clipToBox(hull, 0, aspect, 0, 1);
  if (clipped.length >= 3) hull = clipped;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of hull) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
  const { c, area } = areaCentroid(hull);
  return { hull, c, size: Math.max(x1 - x0, y1 - y0) / 2, top: y0, fill: area / aspect };
}

/** The centre the body is placed round — the outline's AREA centroid — and
 *  its area (how much of the frame it fills).
 *  ⚠️ Not the average of its corners — a corner appearing on an edge or
 *  leaving the hull as the camera moves made that average, and the body with
 *  it, jump (the simulation, 2.496.304). The area centroid moves smoothly and
 *  is always inside a convex outline. */
function areaCentroid(poly: P2[]): { c: P2; area: number } {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const w = p.x * q.y - q.x * p.y;
    a += w; cx += (p.x + q.x) * w; cy += (p.y + q.y) * w;
  }
  if (Math.abs(a) < 1e-12) {
    let x = 0, y = 0;
    for (const p of poly) { x += p.x; y += p.y; }
    return { c: { x: x / Math.max(1, poly.length), y: y / Math.max(1, poly.length) }, area: 0 };
  }
  return { c: { x: cx / (3 * a), y: cy / (3 * a) }, area: Math.abs(a) / 2 };
}

function convexHull(points: P2[]): P2[] {
  const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P2[] = [], upper: P2[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Sutherland–Hodgman against an axis-aligned box: a convex polygon stays
 *  convex. */
function clipToBox(poly: P2[], x0: number, x1: number, y0: number, y1: number): P2[] {
  const planes: [(p: P2) => number, (a: P2, b: P2) => P2][] = [
    [(p) => p.x - x0, (a, b) => ({ x: x0, y: a.y + ((b.y - a.y) * (x0 - a.x)) / (b.x - a.x) })],
    [(p) => x1 - p.x, (a, b) => ({ x: x1, y: a.y + ((b.y - a.y) * (x1 - a.x)) / (b.x - a.x) })],
    [(p) => p.y - y0, (a, b) => ({ x: a.x + ((b.x - a.x) * (y0 - a.y)) / (b.y - a.y), y: y0 })],
    [(p) => y1 - p.y, (a, b) => ({ x: a.x + ((b.x - a.x) * (y1 - a.y)) / (b.y - a.y), y: y1 })],
  ];
  let out = poly;
  for (const [inside, cut] of planes) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      const ia = inside(a) >= 0, ib = inside(b) >= 0;
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    if (out.length === 0) break;
  }
  return out;
}

/** The frame's width over its height, from the two half-angles. */
export function frameAspect(cam: SkyCamera): number {
  return Math.tan(cam.hHalf) / Math.tan(cam.halfFov);
}

/**
 * Where and how strongly a body at TRUE direction (x,y,z) is drawn: the ONE
 * placement both bodies go through (SkyDome's sun, NightSky's moon).
 *
 * Overview (`drop` > 0): round the villa's outline on the frame
 * (placeAround), kept on screen, faded out behind the viewer; `dir` is the
 * direction through that frame point (the disc is drawn at sky distance along
 * it, so the villa covers it wherever they meet). Walking (`drop` 0), or
 * before a model is known: the true direction. `dir` is null when the body
 * has set or is behind the viewer.
 */
export function placeBody(x: number, y: number, z: number, drop: number, cam: SkyCamera): {
  fade: number; dir: Vec3 | null; frame?: { fx: number; fy: number };
} {
  const { rel, alt } = relativeSky(x, y, z, cam.camAz);
  const set = horizonFade(alt);
  const shape = drop > 0 && cam.villa ? villaShape(cam.villa, cam) : null;
  if (!shape) return set > 0 ? { fade: set, dir: { x, y, z } } : { fade: 0, dir: null };
  const room = Math.max(0, Math.min(1, (FILL_GONE - shape.fill) / (FILL_GONE - FILL_FULL)));
  const fade = set * aheadFade(rel, alt) * room * room * (3 - 2 * room);
  if (!(fade > 0)) return { fade: 0, dir: null };
  const f = placeAround(rel, alt, shape, frameAspect(cam));
  return { fade, dir: frameToDirection(f.fx, f.fy, cam), frame: f };
}

/** How much the sun's disc warms toward the horizon, over the last 25° of
 *  TRUE altitude: 0 high (white core), 1 on the horizon (orange) — the same
 *  reddening the sky shader does behind it, so the two agree. */
export function sunWarmth(alt: number): number {
  return Math.max(0, 1 - alt / ((25 * Math.PI) / 180));
}
