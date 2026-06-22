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
function declination(l: number) {
  return Math.asin(Math.sin(0) * Math.cos(e) + Math.cos(0) * Math.sin(e) * Math.sin(l));
}
function rightAscension(l: number) {
  return Math.atan2(Math.sin(l) * Math.cos(e), Math.cos(l));
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

/** True when the sun centre is above the horizon (matches HA sun.sun). */
export function isDaylight(date: Date, lat: number, lng: number): boolean {
  return getSunPosition(date, lat, lng).altitude > 0;
}
