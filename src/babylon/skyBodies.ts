// src/babylon/skyBodies.ts
// Where the sun and the moon are drawn in the sky, from their TRUE direction:
// pure numbers, no Babylon. SkyDome (the sun) and NightSky (the moon) draw
// them; tests/oracles/sky_bodies.mjs checks both through the real camera.
//
// ── THE ONE RULE (2.496.390): THE CAMERA IS NOT AN INPUT ───────────────────
// A body is drawn in a fixed direction of the sky, computed from its true
// azimuth and altitude and nothing else (skyDirection takes no camera). It is
// drawn at sky distance, behind everything, so the villa hides it where they
// meet and it can never hang in front of the house. Turning, tilting, zooming
// or panning only changes how that piece of sky is SEEN — exactly like the
// real sun: face east in the morning and it is over the villa's east side, turn
// away and it is behind you, turn back and it is where it was.
//
// The overview looks DOWN on the villa, where the real sky is out of frame,
// so there the sky from horizon to zenith is drawn SQUEEZED into the band that
// shows above the villa at the overview's usual tilts (OVERVIEW_HORIZON ..
// OVERVIEW_ZENITH, drawnAltitude). Still one fixed direction per hour, the
// same for every camera — the hour moves the body, the camera never does.
// Walking (lift 0) draws the true direction.
//
// The camera decides one thing only: whether the body is SHOWN. A lowered sky
// lies below eye level, so with the view tilted flat a body could land in the
// lower half of the view — under or in front of the villa the camera looks at.
// It fades out there instead (beyondFade): a sky body is drawn only above and
// beyond the villa, and never moved to stay in view.
//
// ⚠️ 2.496.290–389 PLACED the body by the camera: round the villa's outline as
// the screen showed it, at its bearing RELATIVE TO THE CAMERA'S HEADING. So it
// went round the villa whenever the camera turned (owner's recording,
// 2026-10-16). Never feed the camera into the direction again.

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

/** The twilight band a body fades over as it sets: −1°..3° of TRUE altitude. */
export const SET_LOW = (-1 * Math.PI) / 180;
export const SET_HIGH = (3 * Math.PI) / 180;

/** How opaque a body at TRUE altitude `alt` should be, so it sets and rises
 *  rather than blinking out. */
export function horizonFade(alt: number): number {
  const t = (alt - SET_LOW) / (SET_HIGH - SET_LOW);
  return Math.max(0, Math.min(1, t));
}

/** Where the overview draws the horizon and the zenith, radians from eye
 *  level. A fixed direction is seen only while the camera's tilt puts it in
 *  the upper half of the view — a window as tall as half the field of view
 *  (~23° at the overview's fov 0.8) — so the whole sky is squeezed into about
 *  that much, placed for the tilts the overview is used at: at 40–50° down
 *  every hour shows when facing it; steeper, the low sun; flatter, the high
 *  one. ⚠️ 2.496.390 first used the sky colours' own drop (horizon 54° down,
 *  zenith at eye level): rendered on the real villa, a morning sun then hid
 *  under the house at every tilt but the steepest. */
export const OVERVIEW_HORIZON = (-42 * Math.PI) / 180;
export const OVERVIEW_ZENITH = (-20 * Math.PI) / 180;

/** The altitude a body at TRUE altitude `alt` is drawn at: the true one when
 *  walking (`lift` 0); in the overview, horizon..zenith squeezed into
 *  OVERVIEW_HORIZON..OVERVIEW_ZENITH. Rising with the true altitude, so the
 *  hours keep their order. */
export function drawnAltitude(alt: number, lift: number): number {
  if (!(lift > 0)) return alt;
  const t = Math.max(0, alt) / (Math.PI / 2);
  return OVERVIEW_HORIZON + t * (OVERVIEW_ZENITH - OVERVIEW_HORIZON);
}

/**
 * Where a body whose TRUE direction is (x,y,z) is drawn: a unit direction of
 * the sky, its drawn altitude, and its set/rise fade. The azimuth is never
 * touched. `dir` is null once it has set.
 */
export interface Vec3 { x: number; y: number; z: number }

export function skyDirection(x: number, y: number, z: number, lift: number): {
  alt: number; fade: number; dir: Vec3 | null;
} {
  const h = Math.hypot(x, z);
  const alt = Math.atan2(y, h);
  const fade = horizonFade(alt);
  const drawnAlt = drawnAltitude(alt, lift);
  if (!(fade > 0)) return { alt, fade: 0, dir: null };
  const c = Math.cos(drawnAlt);
  // Exactly overhead has no azimuth: north stands in (a single instant; the
  // azimuth either side of it is the true one).
  const ux = h > 1e-9 ? x / h : 0, uz = h > 1e-9 ? z / h : 1;
  return { alt, fade, dir: { x: ux * c, y: Math.sin(drawnAlt), z: uz * c } };
}

/** Over how many radians above the middle of the view a body fades in
 *  (beyondFade). */
export const BEYOND_BAND = (6 * Math.PI) / 180;

/**
 * 1 when a body drawn in direction `dir` is in the UPPER half of the view —
 * above the point the camera looks at, the villa — 0 in the lower half, smooth
 * between. `camUp` is the camera's own up direction (unit). Only whether the
 * body is shown depends on it; where it is never does.
 */
export function beyondFade(dir: Vec3, camUp: Vec3): number {
  const up = dir.x * camUp.x + dir.y * camUp.y + dir.z * camUp.z;
  const t = Math.max(0, Math.min(1, up / Math.sin(BEYOND_BAND)));
  return t * t * (3 - 2 * t);
}

/** How much the sun's disc warms toward the horizon, over the last 25° of
 *  TRUE altitude: 0 high (white core), 1 on the horizon (orange) — the same
 *  reddening the sky shader does behind it, so the two agree. */
export function sunWarmth(alt: number): number {
  return Math.max(0, 1 - alt / ((25 * Math.PI) / 180));
}
