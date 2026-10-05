// src/babylon/skyFraming.ts
// Where the overview draws a body of the sky — the sun or the moon — given its
// TRUE direction, the horizon drop and the camera: pure numbers, no Babylon.
//
// ⚠️ THE FRAMING WAS PRIVATE TO SkyDome, IN SHARED STATIC FIELDS (until
// 2.496.251). Nearly every sky release since 2.388 retuned it — the horizon
// drop, the altitude band, the azimuth dome, the fades — and each was checked
// by eye in a browser, because the maths read four mutable statics on the
// SkyDome class (pitch, halfFov, camAz, hHalf) and sat inside a method that
// also wrote meshes. Here the camera is an argument (SkyCamera), so
// tests/oracles/sky_framing.mjs asks "where does the sun land in the FRAME at
// every tilt the user can hold?" by value. SkyDome and NightSky are the
// Babylon adapters; the explanations of each rule live beside it below.

import { lerp } from "@/utils/geometry";

/** The camera, as the framing measures against it. `pitch` is radians BELOW
 *  horizontal (positive); `halfFov` half the vertical field of view; `camAz`
 *  the camera's own bearing; `hHalf` half the HORIZONTAL field of view (it
 *  follows the aspect ratio, so a portrait phone gets a narrower dome). */
export interface SkyCamera {
  pitch: number;
  halfFov: number;
  camAz: number;
  hHalf: number;
}

/** The pose before the first rendered frame reports the real one. */
export function defaultSkyCamera(): SkyCamera {
  return { pitch: 0, halfFov: 0.4, camAz: 0, hHalf: 0.7 };
}

/** The dome's radius, and the denominator the horizon drop's angle is measured
 *  against — one constant so the two cannot drift apart. */
export const SKY_RADIUS = 500;

/**
 * The angle, in radians, that a given horizon drop rotated the sky by — and
 * therefore the angle bodies must be moved DOWN by to stay in it. 0 in first
 * person, where the true sky is what the viewer is standing under and must
 * not be redrawn at all. (SkyDome.setHorizonDrop's units are world units
 * against SKY_RADIUS: 200 is about 22°.)
 */
export function liftFor(units: number): number {
  return units > 0 ? Math.atan(units / SKY_RADIUS) : 0;
}

/**
 * The dome the overview draws the sun and the moon on: a hemisphere centred on
 * the point the camera orbits (the villa), its radius DOME_SCALE times the
 * camera's distance from that point. Because the radius follows the distance,
 * zooming and panning leave the bodies where they are relative to the villa on
 * screen; because the dome is fixed in the WORLD, orbiting and tilting move
 * them exactly as they move the villa. It is a sun-path diagram drawn round the
 * house, not the sky at infinity — owner, 2026-10-05: "bring them closer to the
 * villa ... so they always appear, to indicate where to look in reality".
 * Under 1 so the point can never fall behind the camera.
 */
export const DOME_SCALE = 0.45;
/** The elevations a body is drawn at on the dome: the true 0–90° is spread
 *  over DOME_LOW..DOME_HIGH, so one on the horizon floats above the garden and
 *  one overhead still stands OFF to its side of the house.
 *
 *  ⚠️ LOW ON PURPOSE. 2.496.292 spread it up to 90°, and a sun at 65° (10:00
 *  in the tropics) was drawn nearly above the roof: over a full turn of the
 *  camera it moved only 0.41..0.58 across the frame, so it read as following
 *  the camera — owner: "if the sun is behind the east wall, turning the
 *  camera shall keep it behind the same wall". The BEARING is the message;
 *  the height is a hint. */
export const DOME_LOW = (10 * Math.PI) / 180;
export const DOME_HIGH = (35 * Math.PI) / 180;
/** Inside this part of the frame (in half-widths, and separately half-heights,
 *  from the centre) a body sits exactly where the dome puts it; beyond, that
 *  axis is eased toward the villa, reaching at most FRAME_REACH. */
export const FRAME_TRUE = 0.6;
export const FRAME_REACH = 0.9;

/** The twilight band a body fades over as it sets: −1°..3° of TRUE altitude. */
export const SET_LOW = (-1 * Math.PI) / 180;
export const SET_HIGH = (3 * Math.PI) / 180;

/**
 * The direction from the camera to where a body at TRUE direction (x,y,z) is
 * drawn in overview, as a unit vector — the ONE expression both bodies are
 * placed by. Depends only on the camera's heading, tilt and field of view:
 * never on its distance or its target, which is why zoom and pan cannot move
 * a body relative to the villa.
 *
 * ⚠️ Three placements were tried and each was reported:
 * - until 2.496.290 the bearing was squeezed toward the camera's heading and
 *   hung from its forward ray: TILTING slid the moon sideways;
 * - 2.496.290 parked an out-of-view body at the frame's edge: turning past
 *   "behind you" swapped it from the east edge to the west in one step;
 * - 2.496.291 drew the true sky at infinity: correct, but far from the villa
 *   and out of view half the time (owner: "too far from the villa").
 * - 2.496.292's dome drew a high sun above the roof and pulled it to the top
 *   centre: it seemed to follow the camera (DOME_HIGH, ease()).
 * This one is a dome round the villa (DOME_SCALE): the sun east of the house
 * is drawn east of the house from every angle, a sun behind you is drawn on
 * your side of the house (lower in the frame), and nothing ever jumps.
 */
export function lift(x: number, y: number, z: number, drop: number, cam: SkyCamera): { x: number; y: number; z: number } {
  if (drop <= 0) return { x, y, z };
  const alt = Math.max(0, Math.atan2(y, Math.hypot(x, z)));
  const e = lerp(DOME_LOW, DOME_HIGH, Math.min(1, alt / (Math.PI / 2)));
  // Straight overhead has no bearing; any will do.
  const az = Math.hypot(x, z) < 1e-9 ? 0 : Math.atan2(x, z);
  const sa = Math.sin(cam.camAz), ca = Math.cos(cam.camAz), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
  // camera → villa is the forward ray (unit), villa → body is DOME_SCALE·u.
  const k = DOME_SCALE, ce = Math.cos(e);
  const v = { x: sa * cp + k * Math.sin(az) * ce, y: -sp + k * Math.sin(e), z: ca * cp + k * Math.cos(az) * ce };
  const p = projectToFrame(v.x, v.y, v.z, cam);
  if (!p) return unit(v);                           // unreachable while DOME_SCALE < 1
  // Past FRAME_TRUE, ease each axis toward the villa so the body never leaves
  // the frame. ⚠️ PER AXIS, not along the line to the centre: a body above
  // the top edge must come DOWN, not also slide toward the middle — the
  // radial version (2.496.292) pulled the east sun to the top centre.
  const nx = ease(2 * p.frameX - 1), ny = ease(1 - 2 * p.frameY);
  if (nx === 2 * p.frameX - 1 && ny === 1 - 2 * p.frameY) return unit(v);
  const cx = nx * Math.tan(cam.hHalf), cy = ny * Math.tan(cam.halfFov);
  // forward + cx·right + cy·up, for a camera with no roll.
  return unit({
    x: sa * cp + cx * ca + cy * sa * sp,
    y: -sp + cy * cp,
    z: ca * cp - cx * sa + cy * ca * sp,
  });
}

function ease(n: number): number {
  const a = Math.abs(n);
  if (a <= FRAME_TRUE) return n;
  const span = FRAME_REACH - FRAME_TRUE;
  return Math.sign(n) * (FRAME_TRUE + span * Math.tanh((a - FRAME_TRUE) / span));
}

function unit(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const n = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

/**
 * Where a DIRECTION actually lands on screen through this camera — the
 * camera's own projection, not the design. The debug report and the oracle
 * measure the drawn disc with it. ⚠️ BOTH axes, because reporting only one is
 * how a whole round was spent on a disc perfectly placed vertically and off
 * the side of the screen. Behind the camera is null.
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

/**
 * How opaque a body at TRUE altitude `alt` should be, so it sets and rises
 * rather than blinking out.
 *
 * ⚠️ TRUE altitude, never the drawn one: in overview the drawn direction
 * points DOWN at the dome round the villa, below the horizon, so a test on
 * the lifted direction would hide the moon always. "Has it set?" is about
 * the real sky; "where do I paint it?" is about this camera.
 */
export function horizonFade(alt: number): number {
  const t = (alt - SET_LOW) / (SET_HIGH - SET_LOW);
  return Math.max(0, Math.min(1, t));
}

/** The opacity of a body at TRUE direction (x,y,z): it has set, or it is
 *  fully there — on the overview's dome it is never out of view. */
export function bodyFade(x: number, y: number, z: number): number {
  return horizonFade(Math.atan2(y, Math.hypot(x, z)));
}

/**
 * The depth test a body's disc uses: in overview (`drop` > 0) it is drawn OVER
 * the villa, never hidden by it — the disc sits on a dome round the house
 * (lift), and a body behind the viewer is drawn on the viewer's side, across
 * the garden or the roof, which would otherwise cover it. Walking (0), the
 * ordinary test, so the moon stays behind walls and ceilings. 0 is the
 * engine's default test; 519 is GL ALWAYS (Constants.ALWAYS, kept as a number
 * so this module stays free of Babylon).
 */
export function overDepth(drop: number): number {
  return drop > 0 ? 519 : 0;
}

/** How much the sun's disc warms toward the horizon, over the last 25° of
 *  TRUE altitude: 0 high (white core), 1 on the horizon (orange) — the same
 *  reddening the sky shader does behind it, so the two agree. */
export function sunWarmth(alt: number): number {
  return Math.max(0, 1 - alt / ((25 * Math.PI) / 180));
}
