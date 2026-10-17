// src/babylon/skyBodies.ts
// Where the sun and the moon are drawn, from their TRUE direction, for a
// camera given as numbers — Babylon's vector maths only, no scene, no engine.
// placeBodies is the one place that decides, for BOTH bodies, where each is
// and whether it shows; SkyDome (the sun) and NightSky (the moon) only paint
// what it says. tests/oracles/sky_bodies.mjs drives it directly at thousands
// of camera poses, and through the real SkyDome and NightSky on NullEngine.
//
// ── THE OVERVIEW: AN ARC ROUND THE VILLA (owner, 2026-10-16) ───────────────
// In the overview a body is a POINT in the world, on its real path drawn as an
// arc round the villa: its true compass side and its true height, on a
// half-sphere centred on the villa's ground (arcPoint). Facing north, the sun
// rises on the right at 06:00, climbs one step per hour, passes over the top
// at noon and sets on the left — and where the real sun goes nearly overhead
// (this villa's latitude, in October) it passes OVER the villa from east to
// west instead of jumping sides. Turning, tilting or zooming never moves the
// point: it turns with the villa.
//
// The arc's size is the villa's own (ARC_SPANS times its longest side, from the
// model's extents — never a number of metres): big enough that, looking down
// at the villa, the sun goes round the house and never crosses it (the owner's
// reference view).
//
// The camera decides two things, never the point itself:
//   · whether the body is SHOWN — hidden only when it is really behind the
//     viewer (behindFade); the house hides it by ordinary depth where they meet;
//   · where it WAITS when its point is off screen — at the screen edge on its
//     true side (holdOnScreen), so zooming in never loses it. Almost flat, the
//     midday sun therefore runs along the top edge in a straight line (owner:
//     "I like that").
//
// Walking (lift 0) draws the TRUE direction, at sky distance.
//
// ── DAY THE SUN, NIGHT THE MOON — BY THE REAL CLOCK (owner, 2026-10-17) ────
// The owner drew the 24 hours as a circle round the villa: the day hours over
// it, the night hours under it. By day the sun is drawn on its real path; at
// night the MOON is drawn where it really is — over the villa when it is up,
// under it once it has set (spherePoint). Which one shows, and where, follows
// the REAL time: Settings' day/night preview lights the villa and colours the
// sky, never moves a body (at 02:46 with "day" it drew a sun 46° up, the real
// one mirrored over the horizon — high in the sky looking almost flat, below
// the house looking down).
//
// ⚠️ THE SUN AND THE MOON WERE PLACED BY TWO COPIES OF THESE STEPS (until
// 2.496.401) — SkyDome's for the sun, NightSky's for the moon, a flag between
// them, and the moon re-placed a second time every frame by replaying its last
// update. Every fix of October was in how the steps fitted together, never in
// a step. Two rule sets in one function now (sunOnArc, moonOnArc).
//
// ⚠️ 2.496.290–389 placed the body round the villa's SCREEN outline at a
// bearing relative to the camera's heading, so it went round the villa as the
// camera turned. 2.496.390 fixed that with a fixed sky direction per hour, but
// facing north the hour's side flipped at noon: the sun jumped from the right
// of the villa to the left between 12:00 and 13:00 (owner, 2026-10-16).

import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Viewport } from "@babylonjs/core/Maths/math.viewport";

/** The dome's radius, and the denominator the horizon drop's angle is measured
 *  against — one constant so the two cannot drift apart. */
const SKY_RADIUS = 500;

/**
 * The angle, in radians, that a given horizon drop rotated the sky by. 0 in
 * first person, where the true sky is what the viewer is standing under and
 * must not be redrawn at all — so `lift > 0` is also "this is the overview".
 */
export function liftFor(units: number): number {
  return units > 0 ? Math.atan(units / SKY_RADIUS) : 0;
}

export interface Vec3 { x: number; y: number; z: number }

/** The twilight band a body fades over as it sets: −1°..3° of TRUE altitude
 *  (walking, where the real horizon is in view). */
const SET_LOW = (-1 * Math.PI) / 180;
const SET_HIGH = (3 * Math.PI) / 180;

/** How opaque a body at TRUE altitude `alt` should be, so it sets and rises
 *  rather than blinking out. */
function horizonFade(alt: number): number {
  const t = (alt - SET_LOW) / (SET_HIGH - SET_LOW);
  return Math.max(0, Math.min(1, t));
}

/** The overview's set/rise band: −2°..1°. The arc's ends sit beside the villa
 *  on the ground, so a sun just risen is already seen there rather than still
 *  fading in. */
const ARC_SET_LOW = (-2 * Math.PI) / 180;
const ARC_SET_HIGH = (1 * Math.PI) / 180;

function arcFade(alt: number): number {
  const t = (alt - ARC_SET_LOW) / (ARC_SET_HIGH - ARC_SET_LOW);
  return Math.max(0, Math.min(1, t));
}

/** The arc's radius, in lengths of the villa's longest side. 1.1 is the
 *  owner's reference (2026-10-16): facing north and looking down, the sun goes
 *  round the house and never crosses it. */
const ARC_SPANS = 1.1;

/** The villa as the arc needs it: the centre of its ground and its longest
 *  side, from the model's extents. */
export interface VillaBox { cx: number; cz: number; ground: number; span: number }

export function villaBox(min: Vec3, max: Vec3): VillaBox {
  return {
    cx: (min.x + max.x) / 2, cz: (min.z + max.z) / 2, ground: min.y,
    span: Math.max(max.x - min.x, max.z - min.z),
  };
}

/**
 * Where a body whose TRUE direction is (x,y,z) sits on the arc round `villa`:
 * a world point, its true altitude, its compass direction (unit, horizontal)
 * and its set/rise fade. `at` is null once it has set. No camera in it.
 */
export function arcPoint(x: number, y: number, z: number, villa: VillaBox): {
  alt: number; fade: number; side: { x: number; z: number }; at: Vec3 | null;
} {
  const { alt, side } = spherePoint(x, y, z, villa);
  const fade = arcFade(alt);
  if (!(fade > 0)) return { alt, fade: 0, side, at: null };
  return { alt, fade, side, at: onSphere(villa, side, Math.max(0, alt)) };
}

/**
 * The moon's point: the same sphere round the villa as arcPoint, but the WHOLE
 * of it — once the moon has set it carries on below the villa, on its true
 * side, rather than vanishing (owner's 24-hour drawing, 2026-10-17: the night
 * hours go round UNDER the house). No fade: a point always.
 */
export function spherePoint(x: number, y: number, z: number, villa: VillaBox): {
  alt: number; side: { x: number; z: number }; at: Vec3;
} {
  const h = Math.hypot(x, z);
  const alt = Math.atan2(y, h);
  // Exactly overhead has no azimuth: north stands in (a single instant; the
  // azimuth either side of it is the true one).
  const side = h > 1e-9 ? { x: x / h, z: z / h } : { x: 0, z: 1 };
  return { alt, side, at: onSphere(villa, side, alt) };
}

/** The point at altitude `a` on `side` of the sphere round the villa. */
function onSphere(villa: VillaBox, side: { x: number; z: number }, a: number): Vec3 {
  const R = ARC_SPANS * villa.span, c = Math.cos(a);
  return { x: villa.cx + R * c * side.x, y: villa.ground + R * Math.sin(a), z: villa.cz + R * c * side.z };
}

/**
 * 1 unless the body is really BEHIND the viewer, 0 when it is, smooth between.
 * `side` is its compass direction, `alt` its true altitude, `camFwd` the
 * camera's forward direction. A high body counts as beyond the villa from
 * every side (it is over the roof), so only a low one on the viewer's side is
 * hidden — never one merely beside the villa.
 */
export function behindFade(side: { x: number; z: number }, alt: number, camFwd: Vec3): number {
  const fl = Math.hypot(camFwd.x, camFwd.z);
  if (fl < 1e-9) return 1;
  const v = (side.x * camFwd.x + side.z * camFwd.z) / fl;   // +1 beyond the villa, −1 on the viewer's side
  const c = Math.cos(Math.max(0, alt));
  const t = Math.max(0, Math.min(1, (v * c + (1 - c) + 0.6) / 0.3));
  return t * t * (3 - 2 * t);
}

/**
 * How much of a body to show while it waits at the TOP edge, `above` screens
 * above it (its point is off the top of the screen): all of it when the point
 * is beyond the villa or beside it, none of it once the point is on the
 * viewer's side. That point is up in the air between the viewer and the house,
 * above the viewer — out of view; tilting down brings it in from the top and
 * on down to where it really is, in front of the house.
 *
 * ⚠️ ALMOST FLAT IT WAS HIGH IN THE SKY BEYOND THE HOUSE, LOOKING DOWN IT WAS
 * BELOW THE HOUSE (owner's two screenshots, 2026-10-17, 2.496.398; the moon at
 * 19:00–20:00 the same). Waiting at the top edge drew a point that is in
 * front of the house as if it were in the sky beyond it. Owner: hide it there.
 * A point beyond or beside the villa still waits at the top (the midday line
 * facing north), and the night hours waiting along the BOTTOM stay — they are
 * below the villa from every angle. Turning the point over to the far side
 * instead (2.496.399) was REJECTED: the sun changed side of the villa as the
 * camera turned.
 */
const NEAR_SIDE = { from: 0.15, to: 0.35 };   // villa lengths from the centre toward the viewer (the sun runs within 0.1 at this villa in October; the 19:00 moon is at 0.39)
export const HOLD_FADE = 0.15;                      // screens above the top over which it fades out

export function nearSideHold(at: Vec3, villa: VillaBox, camFwd: Vec3, above: number): number {
  const fl = Math.hypot(camFwd.x, camFwd.z);
  if (fl < 1e-9 || !(above > 0)) return 1;
  const toward = -((at.x - villa.cx) * camFwd.x + (at.z - villa.cz) * camFwd.z) / fl / villa.span;
  return 1 - smooth((toward - NEAR_SIDE.from) / (NEAR_SIDE.to - NEAR_SIDE.from)) * smooth(above / HOLD_FADE);
}

function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** How far in from the screen's edges a body waits, as a share of the width
 *  and the height. */
export const EDGE_MARGIN = 0.07;

/** Where a body whose point lands at screen (x,y) — pixels, in a w×h view — is
 *  shown: there, or at the nearest place EDGE_MARGIN inside the edges. */
function holdOnScreen(x: number, y: number, w: number, h: number): { x: number; y: number; held: boolean } {
  const mx = EDGE_MARGIN * w, my = EDGE_MARGIN * h;
  const hx = Math.max(mx, Math.min(w - mx, x)), hy = Math.max(my, Math.min(h - my, y));
  return { x: hx, y: hy, held: hx !== x || hy !== y };
}

/**
 * How a body is drawn for a camera `pointDist` from its point and `villaDist`
 * from the villa's centre: at what DEPTH along its own line of sight, and how
 * much its size in the world is scaled.
 *
 * ⚠️ ZOOMED IN, THE SUN WASHED OVER THE VILLA (owner's recording,
 * 2026-10-16, 2.496.391). The point is near the villa, so a camera that zooms
 * in gets close to it: the disc and its glow grew to fill the screen, and a
 * point between the camera and the house was drawn over the house. So:
 *   · it is drawn on the same line of sight but never nearer than just beyond
 *     the villa (villaDist + one villa length): the house always hides it
 *     where they meet, and where it shows on screen does not change;
 *   · it never looks bigger than from NEAREST_SPANS villa lengths away — about
 *     the overview's usual zoom, where its size was chosen.
 */
export const NEAREST_SPANS = 1.9;

function drawnDepth(pointDist: number, villaDist: number, span: number): { depth: number; scale: number } {
  const depth = Math.max(pointDist, villaDist + span);
  return { depth, scale: depth / Math.max(pointDist, NEAREST_SPANS * span) };
}

/** The bodies' sizes in the overview, and their sky glow's, in lengths of the
 *  villa's longest side. */
export const SUN_SPANS = 0.13;
export const MOON_SPANS = 0.09;
export const GLOW_SPANS = 1.1;

/**
 * Walking: where a body whose TRUE direction is (x,y,z) is drawn — that
 * direction, unit — and its set/rise fade. `dir` is null once it has set.
 */
function skyDirection(x: number, y: number, z: number): {
  alt: number; fade: number; dir: Vec3 | null;
} {
  const h = Math.hypot(x, z);
  const alt = Math.atan2(y, h);
  const fade = horizonFade(alt);
  if (!(fade > 0)) return { alt, fade: 0, dir: null };
  const l = Math.hypot(x, y, z) || 1;
  return { alt, fade, dir: { x: x / l, y: y / l, z: z / l } };
}

/** How much the sun's disc warms toward the horizon, over the last 25° of
 *  TRUE altitude: 0 high (white core), 1 on the horizon (orange) — the same
 *  reddening the sky shader does behind it, so the two agree. */
export function sunWarmth(alt: number): number {
  return Math.max(0, 1 - alt / ((25 * Math.PI) / 180));
}

// ── PLACING BOTH BODIES FOR ONE FRAME ───────────────────────────────────────

/** The camera, as numbers: where the eye is, which way it looks, its view and
 *  projection matrices and its viewport in pixels. skyArc.viewOf reads one
 *  from a Babylon camera; a test builds one with Matrix.LookAtLH. */
export interface SkyView {
  eye: Vector3;
  forward: Vector3;
  view: Matrix;
  projection: Matrix;
  /** In pixels (Viewport.toGlobal). */
  viewport: Viewport;
}

/** Where the bodies really are this moment (skyMoment): each a direction FROM
 *  the villa TOWARD the body; `moonT` the moon's night fade, 0..1. */
export interface BodiesNow { sun: Vec3; moon: Vec3 | null; moonT: number }

/** A body on the overview's arc round the villa: drawn at `at` (a world
 *  point on its line of sight — the point itself, or where it waits at the
 *  screen edge), `scale` times its usual size, `alpha` opaque; `screen` where
 *  it lands (0..1 across and down), `held` when waiting at the edge; `alt` and
 *  `side` its true altitude and compass direction. */
export interface OnArc {
  onArc: true;
  at: Vector3; scale: number; alpha: number;
  screen: { x: number; y: number }; held: boolean;
  alt: number; side: { x: number; z: number };
}
/** Walking: a body in its TRUE direction, at sky distance. */
export interface InSky { onArc: false; dir: Vec3; alpha: number }

/**
 * Where the sun and the moon are drawn for this frame, and how opaque. Null
 * for a body that is not drawn at all (set, behind the camera, no villa yet).
 * `overview` is the sky's drop being on (liftFor > 0); walking, the sun's
 * disc is off (the sky material draws the real one) and the moon is in its
 * true direction.
 */
export function placeBodies(now: BodiesNow, frame: { overview: boolean; villa: VillaBox | null; view: SkyView | null }):
  { sun: OnArc | null; moon: OnArc | InSky | null } {
  const moonT = Math.max(0, Math.min(1, now.moonT));
  if (!frame.overview) return { sun: null, moon: now.moon ? moonInSky(now.moon, moonT) : null };
  const { villa, view } = frame;
  if (!villa || !view) return { sun: null, moon: null };
  return { sun: sunOnArc(now.sun, villa, view), moon: now.moon ? moonOnArc(now.moon, moonT, villa, view) : null };
}

/** THE SUN: on the arc while it is up (fading in and out at the horizon),
 *  hidden when really behind the viewer. */
function sunOnArc(d: Vec3, villa: VillaBox, view: SkyView): OnArc | null {
  const arc = arcPoint(d.x, d.y, d.z, villa);
  const shown = arc.at ? onScreen(view, arc.at, arc.side, arc.alt, villa, true) : null;
  return shown ? { onArc: true, ...shown, alpha: arc.fade * shown.alpha, alt: arc.alt, side: arc.side } : null;
}

/** THE MOON: on the WHOLE sphere — under the villa once set (the night hours
 *  of the owner's 24-hour drawing, 2026-10-17), so never hidden for being on
 *  the viewer's side; shown at night by the real clock. */
function moonOnArc(d: Vec3, moonT: number, villa: VillaBox, view: SkyView): OnArc | null {
  const pt = spherePoint(d.x, d.y, d.z, villa);
  const shown = onScreen(view, pt.at, pt.side, pt.alt, villa, false);
  return shown ? { onArc: true, ...shown, alpha: moonT > 0 ? moonT * shown.alpha : 0, alt: pt.alt, side: pt.side } : null;
}

/** Walking: the moon in its true direction, setting at the real horizon
 *  (there is a ground under the viewer). Placed even while hidden: where it
 *  is is the hour's, whether it shows is the view's. */
function moonInSky(d: Vec3, moonT: number): InSky | null {
  const { fade, dir } = skyDirection(d.x, d.y, d.z);
  return dir ? { onArc: false, dir, alpha: moonT > 0 ? moonT * fade : 0 } : null;
}

/**
 * Show `point` (arcPoint's or spherePoint's `at`) for `view`: how opaque the
 * body is from the viewer's side (0 when really behind — the sun only,
 * `hideBehind`), where it shows on screen — the point, or, when that is off
 * screen, the screen edge on its side — and where it is drawn in the world:
 * on that line of sight, never nearer than just beyond the villa, with the
 * scale its size takes there (drawnDepth). Null when the point is behind the
 * camera and below the eye.
 */
function onScreen(view: SkyView, point: Vec3, side: { x: number; z: number }, alt: number, villa: VillaBox, hideBehind: boolean):
  { at: Vector3; scale: number; alpha: number; screen: { x: number; y: number }; held: boolean } | null {
  const vp = view.viewport, fwd = view.forward;
  const p = new Vector3(point.x, point.y, point.z);
  let s = Vector3.Project(p, Matrix.Identity(), view.view.multiply(view.projection), vp);
  if (!(s.z > 0 && s.z < 1)) {
    // Behind the camera's plane — zoomed in close under a high sun, the point
    // is above and behind the eye. Its projection lands mirrored, so the side
    // it is on is read in the camera's own frame instead, and it waits at the
    // screen edge there (holdOnScreen) rather than vanishing.
    // Only a body ABOVE the eye waits (at the top or a side): one below and
    // behind it would wait along the bottom, over the ground in front of the
    // house, so it is simply not seen.
    const v = Vector3.TransformCoordinates(p, view.view);
    const l = Math.hypot(v.x, v.y);
    if (l < 1e-9 || !(v.y > 0)) return null;
    const far = 4 * Math.max(vp.width, vp.height);
    s = new Vector3(vp.x + vp.width / 2 + (v.x / l) * far, vp.y + vp.height / 2 - (v.y / l) * far, 0.5);
  }
  const h = holdOnScreen(s.x - vp.x, s.y - vp.y, vp.width, vp.height);
  const above = Math.max(0, (h.y - (s.y - vp.y)) / vp.height);
  const alpha = (hideBehind ? behindFade(side, alt, fwd) : 1) * nearSideHold(point, villa, fwd, above);
  const onSight = h.held
    ? Vector3.Unproject(new Vector3(h.x, h.y, s.z), vp.width, vp.height, Matrix.Identity(), view.view, view.projection)   // viewport-relative pixels
    : p;
  const eye = view.eye;
  const d = drawnDepth(Vector3.Distance(eye, p),
    Vector3.Distance(eye, new Vector3(villa.cx, villa.ground, villa.cz)), villa.span);
  const at = eye.add(onSight.subtract(eye).normalize().scale(d.depth));
  return { at, scale: d.scale, alpha, screen: { x: h.x / vp.width, y: h.y / vp.height }, held: h.held };
}
