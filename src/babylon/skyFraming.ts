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

import { lerp, wrapAngle } from "@/utils/geometry";

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
 * Where the arc sits IN THE FRAME, as a fraction of the half field of view
 * above the camera's own forward ray: 0 is dead centre, 1 the top edge.
 *
 * ⚠️ THE UNIT IS THE FRAME, NOT THE SKY, and 2.396.0 is why. That release put
 * the arc at a fixed WORLD elevation, computed against the overview's DEFAULT
 * pitch of 61.4° — correct there, and wrong everywhere else, because the pitch
 * is a control the user holds. `beta` clamps to 0.05..1.4 rad, so the visible
 * cone travels with it; NO fixed elevation can be well framed at every tilt,
 * reported as "the sun appears but below the villa". Measuring from the
 * camera's forward ray removes the whole problem by construction.
 */
export const BAND_LOW = 0.35;
/** Where a sun directly overhead is drawn. BAND_LOW and this are the whole
 *  tuning surface if the arc wants to sit higher or flatter. */
export const BAND_HIGH = 0.85;

/** Inside this part of the frame's half-width the body sits EXACTLY where a
 *  real sky would put it: turning the camera moves it by the true amount, the
 *  way the landscape moves. Only beyond it does the edge pull it in. */
export const AZ_TRUE = 0.6;
/** How far out the saturation reaches, as a fraction of the frame's half
 *  width. Under 1 so a body to the side or behind still lands inside the frame
 *  — at the edge on its TRUE side — rather than exactly on the edge. */
export const AZ_REACH = 0.88;
/** Width of the fade at the cut directly behind the camera. */
export const AZ_FADE = (9 * Math.PI) / 180;

/** The twilight band a body fades over as it sets: −1°..3° of TRUE altitude. */
export const SET_LOW = (-1 * Math.PI) / 180;
export const SET_HIGH = (3 * Math.PI) / 180;

/**
 * Where a body of the sky is DRAWN in the frame, given its TRUE direction:
 * 0 is the left/top edge, 1 the right/bottom, 0.5 dead centre — where the
 * camera's target, the villa, sits. The overview decides the frame position
 * first and lift() turns it back into a direction, so the two cannot disagree.
 *
 * ⚠️ This is a diagram, not a photograph, and only in overview. A camera
 * looking DOWN at a villa cannot contain an overhead sun: at local noon the
 * real altitude is ~85°, behind the viewer.
 *
 * HEIGHT: the whole 0–90° range is squeezed into a band in the upper part of
 * the frame (BAND_LOW..BAND_HIGH), so the sun is visible in the middle of the
 * day — precisely when a sun is most expected.
 *
 * SIDE: the TRUE bearing relative to where the camera faces, and nothing else.
 * ⚠️ Until 2.496.290 the bearing was squeezed toward the camera's heading
 * (×0.45) and placed on a sphere hanging from the camera's forward ray, so
 * the moon's east/west in the frame depended on the VIEW: tilting from 20° to
 * 85° slid a moon 80° to the right from frameX 0.94 to 0.64 — reported as
 * "the east/west position of the moon changes with the angle of the camera"
 * (owner, 2026-10-05). Now tilting cannot move it sideways at all, and turning
 * moves it by the true amount while it is in the middle of the frame
 * (AZ_TRUE). Toward the sides it is eased into the edge on its TRUE side
 * (AZ_REACH) instead of leaving the frame — the old complaint was a sun
 * "simply behind you" — and directly behind it fades (azimuthFade).
 */
export function framePositionOf(x: number, y: number, z: number, cam: SkyCamera): { frameX: number; frameY: number } {
  const alt = Math.atan2(y, Math.hypot(x, z));
  const t = Math.max(0, Math.min(1, alt / (Math.PI / 2)));
  const ndcY = Math.tan(cam.halfFov * lerp(BAND_LOW, BAND_HIGH, t)) / Math.tan(cam.halfFov);
  const rel = wrapAngle(Math.atan2(x, z) - cam.camAz);
  // The true horizontal place of that bearing, in half-widths; beyond 90° to
  // the side there is none, so it is "past the edge" on its own side.
  const u = Math.abs(rel) < Math.PI / 2 ? Math.abs(Math.tan(rel)) / Math.tan(cam.hHalf) : Infinity;
  const span = AZ_REACH - AZ_TRUE;
  const eased = u <= AZ_TRUE ? u : AZ_TRUE + span * Math.tanh((u - AZ_TRUE) / span);
  return { frameX: 0.5 + 0.5 * Math.sign(rel) * eased, frameY: 0.5 - 0.5 * ndcY };
}

/**
 * A direction redrawn for this camera, as a unit vector — the ONE expression
 * both bodies are placed by, so the sun and the moon can never sit in skies
 * tilted differently from each other. It is the frame position of
 * framePositionOf turned back into the direction the camera sees there.
 */
export function lift(x: number, y: number, z: number, drop: number, cam: SkyCamera): { x: number; y: number; z: number } {
  if (Math.hypot(x, z) < 1e-6 || drop <= 0) return { x, y, z };
  const { frameX, frameY } = framePositionOf(x, y, z, cam);
  const cx = (2 * frameX - 1) * Math.tan(cam.hHalf);
  const cy = (1 - 2 * frameY) * Math.tan(cam.halfFov);
  const sa = Math.sin(cam.camAz), ca = Math.cos(cam.camAz), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
  // forward + cx·right + cy·up, for a camera with no roll.
  const vx = sa * cp + cx * ca + cy * sa * sp;
  const vy = -sp + cy * cp;
  const vz = ca * cp - cx * sa + cy * ca * sp;
  const n = Math.hypot(vx, vy, vz);
  return { x: vx / n, y: vy / n, z: vz / n };
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
 * ⚠️ TRUE altitude, never the drawn one: every drawn altitude in overview is
 * below the horizon (the band hangs from the camera's forward ray), so a test
 * on the lifted direction would hide the moon always. "Has it set?" is about
 * the real sky; "where do I paint it?" is about this camera.
 */
export function horizonFade(alt: number): number {
  const t = (alt - SET_LOW) / (SET_HIGH - SET_LOW);
  return Math.max(0, Math.min(1, t));
}

/** Cover the cut: 1 everywhere except within AZ_FADE of directly behind the
 *  camera, where it falls to 0 — the body dims out at one edge and back in at
 *  the other instead of teleporting across the frame. */
export function azimuthFade(x: number, z: number, drop: number, cam: SkyCamera): number {
  if (drop <= 0) return 1;
  const rel = Math.abs(wrapAngle(Math.atan2(x, z) - cam.camAz));
  return Math.max(0, Math.min(1, (Math.PI - rel) / AZ_FADE));
}

/** The opacity of a body at TRUE direction (x,y,z): it has set, or sits at
 *  the cut behind the camera, or is fully there. */
export function bodyFade(x: number, y: number, z: number, drop: number, cam: SkyCamera): number {
  return horizonFade(Math.atan2(y, Math.hypot(x, z))) * azimuthFade(x, z, drop, cam);
}

/** How much the sun's disc warms toward the horizon, over the last 25° of
 *  TRUE altitude: 0 high (white core), 1 on the horizon (orange) — the same
 *  reddening the sky shader does behind it, so the two agree. */
export function sunWarmth(alt: number): number {
  return Math.max(0, 1 - alt / ((25 * Math.PI) / 180));
}
