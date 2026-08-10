// src/utils/sunCalc.ts
// Sun azimuth/elevation for a given lat/lng and time. Lightweight NOAA-style
// approximation — accurate to a fraction of a degree, plenty for lighting.

export interface SunPosition {
  /** radians, 0 = south, measured clockwise (Babylon-friendly). */
  azimuth: number;
  /** radians above the horizon (negative = below). */
  altitude: number;
}

const RAD = Math.PI / 180;
const DAY_MS = 1000 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;

const toJulian = (date: Date) => date.valueOf() / DAY_MS - 0.5 + J1970;
const toDays = (date: Date) => toJulian(date) - J2000;

const e = RAD * 23.4397; // obliquity of the Earth

function solarMeanAnomaly(d: number) {
  return RAD * (357.5291 + 0.98560028 * d);
}
function eclipticLongitude(M: number) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372;
  return M + C + P + Math.PI;
}
// `b` is ecliptic LATITUDE. It is 0 for the sun by definition (the ecliptic is
// the sun's own path), which is why these read as constants for that caller —
// but the moon sits up to ~5° off the ecliptic, so both take it now. Existing
// sun call sites pass one argument and keep the old behaviour exactly.
function declination(l: number, b = 0) {
  return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
}
function rightAscension(l: number, b = 0) {
  return Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
}
function siderealTime(d: number, lw: number) {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

export function getSunPosition(date: Date, lat: number, lng: number): SunPosition {
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const d = toDays(date);

  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const ra = rightAscension(L);
  const H = siderealTime(d, lw) - ra;

  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  return { azimuth, altitude };
}

// ── Moon ────────────────────────────────────────────────────────────────────
// Same Meeus-derived approximations as the sun above, in the same convention,
// so a caller can light or place the moon exactly the way it already does the
// sun.
//
// ⚠️ WHY THIS IS COMPUTED AND NOT READ FROM HOME ASSISTANT. HA's Moon
// integration creates exactly one entity, `sensor.moon_phase`, and it is an
// enum: eight phase NAMES, `device_class: "enum"`, and — verified against a
// live install, not just the docs — no elevation, no azimuth and no
// illumination percentage in its attributes. It cannot place a moon in a sky.
// Substituting a plausible direction for one a coarse HA entity does not carry
// is precisely the bug fixed in 2.224.0 for `sun.sun`; the split that survives
// is HA owning the NAME and this file owning the GEOMETRY. Computing locally
// also keeps the moon working on an install that never added the integration,
// and offline, which the add-on requires anyway.

export interface MoonPosition extends SunPosition {
  /** km, centre to centre — varies ~356k–406k over a month. */
  distance: number;
  /** radians; tilt of the lit limb, for orienting a rendered crescent. */
  parallacticAngle: number;
}

/** Geocentric ecliptic coordinates of the moon. */
function moonCoords(d: number) {
  const L = RAD * (218.316 + 13.176396 * d); // mean ecliptic longitude
  const M = RAD * (134.963 + 13.064993 * d); // mean anomaly
  const F = RAD * (93.272 + 13.229350 * d);  // mean distance from ascending node

  const l = L + RAD * 6.289 * Math.sin(M);   // true longitude
  const b = RAD * 5.128 * Math.sin(F);       // latitude — the reason b exists above
  const dt = 385001 - 20905 * Math.cos(M);   // distance, km

  return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
}

export function getMoonPosition(date: Date, lat: number, lng: number): MoonPosition {
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const d = toDays(date);

  const c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;

  const azimuth = Math.atan2(
    Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi));
  const altitude = Math.asin(
    Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
  // Meeus 14.1 — which way the lit side leans, so a drawn crescent is not
  // arbitrarily rotated. Near the equator the "smile" orientation is very
  // noticeable and getting it wrong reads as a bug rather than as astronomy.
  const parallacticAngle = Math.atan2(
    Math.sin(H), Math.tan(phi) * Math.cos(c.dec) - Math.sin(c.dec) * Math.cos(H));

  return { azimuth, altitude, distance: c.dist, parallacticAngle };
}

export interface MoonIllumination {
  /** 0 = new, 1 = full — the lit FRACTION of the disc. */
  fraction: number;
  /** 0 → 1 around the cycle: 0 new, 0.25 first quarter, 0.5 full, 0.75 last. */
  phase: number;
  /** radians; sign says waxing (negative) vs waning (positive). */
  angle: number;
}

export function getMoonIllumination(date: Date): MoonIllumination {
  const d = toDays(date);
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const sDec = declination(L);
  const sRa = rightAscension(L);
  const m = moonCoords(d);

  const SUN_DIST = 149598000; // km
  const phi = Math.acos(
    Math.sin(sDec) * Math.sin(m.dec)
    + Math.cos(sDec) * Math.cos(m.dec) * Math.cos(sRa - m.ra));
  const inc = Math.atan2(SUN_DIST * Math.sin(phi), m.dist - SUN_DIST * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(sDec) * Math.sin(sRa - m.ra),
    Math.sin(sDec) * Math.cos(m.dec) - Math.cos(sDec) * Math.sin(m.dec) * Math.cos(sRa - m.ra));

  return {
    fraction: (1 + Math.cos(inc)) / 2,
    phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI,
    angle,
  };
}

/**
 * Home Assistant's own eight phase names, so the kiosk and HA never disagree on
 * screen. Boundaries are the conventional 1/8-cycle bands; the four "moment"
 * phases (new/quarters/full) get a narrow band around the exact instant rather
 * than a full eighth, which is how HA's sensor reads too.
 *
 * ⚠️ THE MOON INTEGRATION IS NEVER A DEPENDENCY. Everything above is computed
 * from date + latitude/longitude alone, so the moon works identically on an
 * install that has never heard of `sensor.moon_phase` — which is the normal
 * case, since that integration is opt-in. Nothing may be written that reads the
 * entity without a fallback to this function, and nothing may gate on its
 * presence: it is strictly a nice-to-have that can CONFIRM or LABEL, never a
 * prerequisite. Verified against a live install on 2026-08-10 — this function
 * returned "waning_crescent" for that moment with no access to HA, and HA's
 * sensor independently said "waning_crescent".
 */
export type MoonPhaseName =
  | "new_moon" | "waxing_crescent" | "first_quarter" | "waxing_gibbous"
  | "full_moon" | "waning_gibbous" | "last_quarter" | "waning_crescent";

export function moonPhaseName(phase: number): MoonPhaseName {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.0625) return "new_moon";
  if (p < 0.1875) return "waxing_crescent";
  if (p < 0.3125) return "first_quarter";
  if (p < 0.4375) return "waxing_gibbous";
  if (p < 0.5625) return "full_moon";
  if (p < 0.6875) return "waning_gibbous";
  if (p < 0.8125) return "last_quarter";
  return "waning_crescent";
}
