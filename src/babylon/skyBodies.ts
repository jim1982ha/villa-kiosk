// src/babylon/skyBodies.ts
// Where the sun and the moon are drawn, from their TRUE direction: pure
// numbers, no Babylon. SkyDome (the sun) and NightSky (the moon) draw them;
// tests/oracles/sky_bodies.mjs checks both through the real camera.
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
// ⚠️ 2.496.290–389 placed the body round the villa's SCREEN outline at a
// bearing relative to the camera's heading, so it went round the villa as the
// camera turned. 2.496.390 fixed that with a fixed sky direction per hour, but
// facing north the hour's side flipped at noon: the sun jumped from the right
// of the villa to the left between 12:00 and 13:00 (owner, 2026-10-16).

/** The dome's radius, and the denominator the horizon drop's angle is measured
 *  against — one constant so the two cannot drift apart. */
export const SKY_RADIUS = 500;

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
export const SET_LOW = (-1 * Math.PI) / 180;
export const SET_HIGH = (3 * Math.PI) / 180;

/** How opaque a body at TRUE altitude `alt` should be, so it sets and rises
 *  rather than blinking out. */
export function horizonFade(alt: number): number {
  const t = (alt - SET_LOW) / (SET_HIGH - SET_LOW);
  return Math.max(0, Math.min(1, t));
}

/** The overview's set/rise band: −2°..1°. The arc's ends sit beside the villa
 *  on the ground, so a sun just risen is already seen there rather than still
 *  fading in. */
export const ARC_SET_LOW = (-2 * Math.PI) / 180;
export const ARC_SET_HIGH = (1 * Math.PI) / 180;

export function arcFade(alt: number): number {
  const t = (alt - ARC_SET_LOW) / (ARC_SET_HIGH - ARC_SET_LOW);
  return Math.max(0, Math.min(1, t));
}

/** The arc's radius, in lengths of the villa's longest side. 1.1 is the
 *  owner's reference (2026-10-16): facing north and looking down, the sun goes
 *  round the house and never crosses it. */
export const ARC_SPANS = 1.1;

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
  const h = Math.hypot(x, z);
  const alt = Math.atan2(y, h);
  // Exactly overhead has no azimuth: north stands in (a single instant; the
  // azimuth either side of it is the true one).
  const side = h > 1e-9 ? { x: x / h, z: z / h } : { x: 0, z: 1 };
  const fade = arcFade(alt);
  if (!(fade > 0)) return { alt, fade: 0, side, at: null };
  const R = ARC_SPANS * villa.span, a = Math.max(0, alt);
  const c = Math.cos(a);
  return {
    alt, fade, side,
    at: { x: villa.cx + R * c * side.x, y: villa.ground + R * Math.sin(a), z: villa.cz + R * c * side.z },
  };
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

/** How far in from the screen's edges a body waits, as a share of the width
 *  and the height. */
export const EDGE_MARGIN = 0.07;

/** Where a body whose point lands at screen (x,y) — pixels, in a w×h view — is
 *  shown: there, or at the nearest place EDGE_MARGIN inside the edges. */
export function holdOnScreen(x: number, y: number, w: number, h: number): { x: number; y: number; held: boolean } {
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

export function drawnDepth(pointDist: number, villaDist: number, span: number): { depth: number; scale: number } {
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
export function skyDirection(x: number, y: number, z: number): {
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
