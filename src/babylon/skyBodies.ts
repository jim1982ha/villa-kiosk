// src/babylon/skyBodies.ts
// Where the moon is drawn, from its TRUE direction — numbers only, no scene,
// no engine. placeMoon is the one place that decides where it is and whether
// it shows; NightSky only paints what it says. tests/oracles/sky_bodies.mjs
// drives it directly, and through the real SkyDome and NightSky on NullEngine.
//
// ── NO BODY IN THE OVERVIEW (owner, 2026-10-20) ─────────────────────────────
// The overview drew the sun and the moon as discs on an arc round the villa
// (2.496.390–446): at noon in Bali the sun passed straight over the house and,
// looking down, its orange disc hung over the living room like an object of
// the model ("this should be hidden completely"). Both were position markers of
// the same kind, so the overview now draws neither; the sky's colour, the
// light, the shadows and the stars still follow the hour. Walking, the sky
// material draws the real sun and the moon is drawn here, in its true
// direction.
//
// ── NIGHT THE MOON — BY THE REAL CLOCK (owner, 2026-10-17) ──────────────────
// Whether the moon shows follows the REAL time (moonT): Settings' day/night
// preview lights the villa and colours the sky, never moves a body.

export interface Vec3 { x: number; y: number; z: number }

/** The twilight band the moon fades over as it sets: −1°..3° of TRUE altitude
 *  (walking, where the real horizon is in view). */
const SET_LOW = (-1 * Math.PI) / 180;
const SET_HIGH = (3 * Math.PI) / 180;

/** How opaque a body at TRUE altitude `alt` should be, so it sets and rises
 *  rather than blinking out. */
function horizonFade(alt: number): number {
  const t = (alt - SET_LOW) / (SET_HIGH - SET_LOW);
  return Math.max(0, Math.min(1, t));
}

/** The moon in its TRUE direction (unit), at sky distance, `alpha` opaque. */
export interface InSky { dir: Vec3; alpha: number }

/**
 * Where the moon is drawn for this frame, and how opaque — null when it is not
 * drawn at all: in the overview (no body there, owner 2026-10-20), without a
 * moon, or below the real horizon. `moon` points FROM the villa TOWARD it
 * (skyMoment); `moonT` is its night fade by the real clock, 0..1. Placed even
 * while transparent by day: where it is is the hour's, whether it shows is
 * the night's.
 */
export function placeMoon(moon: Vec3 | null, moonT: number, overview: boolean): InSky | null {
  if (overview || !moon) return null;
  const h = Math.hypot(moon.x, moon.z);
  const alt = Math.atan2(moon.y, h);
  const fade = horizonFade(alt);
  if (!(fade > 0)) return null;
  const l = Math.hypot(moon.x, moon.y, moon.z) || 1;
  const t = Math.max(0, Math.min(1, moonT));
  return { dir: { x: moon.x / l, y: moon.y / l, z: moon.z / l }, alpha: t > 0 ? t * fade : 0 };
}
