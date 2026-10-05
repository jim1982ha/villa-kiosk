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
 * Where the overview anchors the sun and the moon: a spot ON THE GROUND beside
 * the villa, in the body's true direction, DOME_SCALE times the camera's
 * distance from the point it orbits. Because the distance follows the camera,
 * zooming and panning leave the bodies where they are relative to the villa;
 * because the spot is fixed on the ground, turning and tilting move it exactly
 * as they move the villa. A sun-path diagram drawn round the house, not the
 * sky at infinity — owner, 2026-10-05: "bring them closer to the villa ... so
 * they always appear, to indicate where to look in reality". Under 1 so the
 * spot can never fall behind the camera.
 */
export const DOME_SCALE = 0.45;
/** How far the disc is drawn straight UP THE SCREEN from its ground spot, in
 *  half-heights of the frame: LIFT_LOW for a body on the horizon, LIFT_HIGH
 *  for one overhead. The height is a hint; the bearing is the message.
 *
 *  ⚠️ IN THE FRAME, NOT IN THE WORLD. 2.496.292–294 raised the body into the
 *  air above its spot (a dome, 10°–35° up). A raised point lines up with
 *  different ground as the view tilts — parallax — so tilting slid the sun
 *  from beside the pool to above it (owner, 2026-10-05: "the sun is still
 *  changing position when tilting"). An offset on the screen does not depend
 *  on the tilt, so the disc stays over the same patch of ground. */
export const LIFT_LOW = 0.25;
export const LIFT_HIGH = 0.55;
/** Inside this part of the frame (in half-widths, and separately half-heights,
 *  from the centre) a body sits exactly where its spot and lift put it; beyond, that
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
 *   centre: it seemed to follow the camera (ease());
 * - 2.496.293's dome kept the body up in the air: TILTING moved it from
 *   beside the pool to above it, by parallax (LIFT_LOW).
 * This one is a ground spot round the villa (DOME_SCALE) with the disc drawn
 * straight up the screen from it: the sun east of the house
 * is drawn east of the house from every angle, a sun behind you is drawn on
 * your side of the house (lower in the frame), and nothing ever jumps. The
 * disc is still drawn at SKY distance, so wherever it overlaps the villa the
 * villa covers it (owner, 2026-10-05: "never displayed over the villa").
 */
export function lift(x: number, y: number, z: number, drop: number, cam: SkyCamera): { x: number; y: number; z: number } {
  if (drop <= 0) return { x, y, z };
  const alt = Math.max(0, Math.atan2(y, Math.hypot(x, z)));
  // Straight overhead has no bearing; any will do.
  const az = Math.hypot(x, z) < 1e-9 ? 0 : Math.atan2(x, z);
  const sa = Math.sin(cam.camAz), ca = Math.cos(cam.camAz), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
  // camera → villa is the forward ray (unit); villa → ground spot is
  // DOME_SCALE along the bearing, level.
  const k = DOME_SCALE;
  const v = { x: sa * cp + k * Math.sin(az), y: -sp, z: ca * cp + k * Math.cos(az) };
  const p = projectToFrame(v.x, v.y, v.z, cam);
  if (!p) return unit(v);                           // unreachable while DOME_SCALE < 1
  const up = lerp(LIFT_LOW, LIFT_HIGH, Math.min(1, alt / (Math.PI / 2)));
  // Past FRAME_TRUE, ease each axis toward the villa so the body never leaves
  // the frame. ⚠️ PER AXIS, not along the line to the centre: a body above
  // the top edge must come DOWN, not also slide toward the middle — the
  // radial version (2.496.292) pulled the east sun to the top centre.
  const nx = ease(2 * p.frameX - 1), ny = ease(1 - 2 * p.frameY + up);
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

/** How much the sun's disc warms toward the horizon, over the last 25° of
 *  TRUE altitude: 0 high (white core), 1 on the horizon (orange) — the same
 *  reddening the sky shader does behind it, so the two agree. */
export function sunWarmth(alt: number): number {
  return Math.max(0, 1 - alt / ((25 * Math.PI) / 180));
}
