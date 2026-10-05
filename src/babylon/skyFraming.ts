// src/babylon/skyFraming.ts
// Where the overview draws a body of the sky — the sun or the moon — given its
// TRUE direction: pure numbers, no Babylon. SkyDome and NightSky are the
// Babylon adapters; tests/oracles/sky_framing.mjs and sky_bodies.mjs pin it.
//
// ── ONE RULE: A SUN-PATH DIAGRAM ROUND THE VILLA (2.496.302) ────────────────
// A body is a FIXED POINT IN THE WORLD: the villa's centre plus SUN_PATH_SCALE
// times the villa's radius, along the body's true direction — the 3D sun-path
// diagram architecture tools draw round a model (Revit shows it at 150 % of
// the model's radius by default; Ladybug's has a centre and a radius). The
// disc is drawn in the direction from the camera to that point. Every camera
// motion — orbit, tilt, pan, zoom, a phone's narrow frame — therefore moves it
// exactly as it moves the villa, because it is the same projection, with no
// rule per motion.
//
// ⚠️ WHAT THIS REPLACED, AND WHY IT COULD NOT BE FIXED. 2.496.290–301 drew the
// body by SCREEN rules: a ground spot, a lift up the screen, a pull-in at the
// frame edges, a fade behind the viewer, then scale factors for pan and zoom.
// Each rule answered one camera motion and moved the body under another, so
// every release fixed one motion (orbit, tilt, pan, zoom) and the owner's next
// recording showed the next (2.496.301: "still moving up/down with the camera
// position"). A fixed point cannot do that.
//
// The trade-off, accepted by the owner on 2026-10-05: a point ABOVE the ground
// shows ordinary 3D parallax against the lawn when tilting (only a point ON the
// ground has none), and it leaves the frame when its point is out of view —
// exactly as a palm tree beside the pool does.

/** The camera, as the framing measures against it. `pitch` is radians BELOW
 *  horizontal (positive); `halfFov` half the vertical field of view; `camAz`
 *  the camera's own bearing; `hHalf` half the HORIZONTAL field of view. Used
 *  by projectToFrame (the debug report and the oracles). `eye` is the camera's
 *  position in the world; `path` the sun-path diagram (sunPathOf) — both null
 *  until a camera and a model are known. */
export interface SkyCamera {
  pitch: number;
  halfFov: number;
  camAz: number;
  hHalf: number;
  eye: Vec3 | null;
  path: SunPath | null;
}

export interface Vec3 { x: number; y: number; z: number }

/** The sun-path diagram: its centre (the villa's, on its ground) and radius. */
export interface SunPath { centre: Vec3; radius: number }

/** The pose before the first rendered frame reports the real one. */
export function defaultSkyCamera(): SkyCamera {
  return { pitch: 0, halfFov: 0.4, camAz: 0, hHalf: 0.7, eye: null, path: null };
}

/** The dome's radius, and the denominator the horizon drop's angle is measured
 *  against — one constant so the two cannot drift apart. */
export const SKY_RADIUS = 500;

/**
 * The angle, in radians, that a given horizon drop rotated the sky by. 0 in
 * first person, where the true sky is what the viewer is standing under and
 * must not be redrawn at all — so `drop > 0` is also "this is the overview".
 * (SkyDome.setHorizonDrop's units are world units against SKY_RADIUS: 200 is
 * about 22°.)
 */
export function liftFor(units: number): number {
  return units > 0 ? Math.atan(units / SKY_RADIUS) : 0;
}

/** The sun-path radius, in the villa's radii — Revit's default display size
 *  (150 % of the model's radius). */
export const SUN_PATH_SCALE = 1.5;

/**
 * The sun-path diagram for a model's world extents: centred on the model, on
 * the ground it stands on, with SUN_PATH_SCALE times its radius (half the
 * diagonal of its footprint). From the model itself — no villa dimension
 * ships.
 */
export function sunPathOf(min: Vec3, max: Vec3, groundY: number): SunPath {
  const radius = Math.hypot(max.x - min.x, max.z - min.z) / 2;
  return {
    centre: { x: (min.x + max.x) / 2, y: groundY, z: (min.z + max.z) / 2 },
    radius: Math.max(radius, 1) * SUN_PATH_SCALE,
  };
}

/** The twilight band a body fades over as it sets: −1°..3° of TRUE altitude. */
export const SET_LOW = (-1 * Math.PI) / 180;
export const SET_HIGH = (3 * Math.PI) / 180;

/**
 * How opaque a body at TRUE altitude `alt` should be, so it sets and rises
 * rather than blinking out.
 */
export function horizonFade(alt: number): number {
  const t = (alt - SET_LOW) / (SET_HIGH - SET_LOW);
  return Math.max(0, Math.min(1, t));
}

/** The body's fixed point in the world: on the sun-path diagram, along its
 *  TRUE direction (x,y,z — a unit vector toward the body). */
export function bodyPoint(x: number, y: number, z: number, path: SunPath): Vec3 {
  return {
    x: path.centre.x + path.radius * x,
    y: path.centre.y + path.radius * y,
    z: path.centre.z + path.radius * z,
  };
}

/**
 * Where and how strongly a body at TRUE direction (x,y,z) is drawn: the ONE
 * placement both bodies go through (SkyDome's sun, NightSky's moon).
 *
 * Overview (`drop` > 0): the direction from the camera to the body's fixed
 * point (bodyPoint). The disc is drawn at SKY distance along it (SkyDome), so
 * it lands exactly where that point projects AND the villa still covers it —
 * never painted over the house (owner, 2026-10-05). Walking (`drop` 0): the
 * true direction — the viewer is standing under the real sky. `dir` is null
 * when the body has set; one whose point is behind the camera is drawn behind
 * the camera, which shows nothing, as for any object there.
 */
export function placeBody(x: number, y: number, z: number, drop: number, cam: SkyCamera): {
  fade: number; dir: Vec3 | null;
} {
  const fade = horizonFade(Math.atan2(y, Math.hypot(x, z)));
  if (!(fade > 0)) return { fade, dir: null };
  if (drop <= 0 || !cam.eye || !cam.path) return { fade, dir: { x, y, z } };
  const p = bodyPoint(x, y, z, cam.path);
  const v = { x: p.x - cam.eye.x, y: p.y - cam.eye.y, z: p.z - cam.eye.z };
  const n = Math.hypot(v.x, v.y, v.z);
  // The camera standing ON the point (never in practice): nowhere to look.
  if (!(n > 1e-9)) return { fade: 0, dir: null };
  return { fade, dir: { x: v.x / n, y: v.y / n, z: v.z / n } };
}

/**
 * Where a DIRECTION actually lands on screen through this camera — the
 * camera's own projection. The debug report and the oracle measure the drawn
 * disc with it. Behind the camera is null.
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

/** How much the sun's disc warms toward the horizon, over the last 25° of
 *  TRUE altitude: 0 high (white core), 1 on the horizon (orange) — the same
 *  reddening the sky shader does behind it, so the two agree. */
export function sunWarmth(alt: number): number {
  return Math.max(0, 1 - alt / ((25 * Math.PI) / 180));
}
