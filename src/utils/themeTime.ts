// src/utils/themeTime.ts
// Resolves the "auto" theme setting to a concrete data-theme value. The
// light/dark split follows the OS (prefers-color-scheme, as it always has);
// swapping a preferred-dark result to "night" additionally needs the real
// sun position, since CSS alone can't express "roughly an hour past sunset".
// Reuses the same NOAA-style altitude approximation SunController.ts already
// uses for the 3D scene's day/night lighting, driven by the villa's own
// lat/lng (sourced from HA's config, never hardcoded — see AppConfig).

import { getSunPosition } from "./sunCalc";

export type EffectiveTheme = "light" | "dark" | "night";
export type ThemeSetting = EffectiveTheme | "auto";

// SunController's own day/night lighting transition finishes at -6deg
// (its TWILIGHT constant). "Night" starts a bit past that, approximating
// "sunset + 1h" without needing HA's sun.sun next_setting timestamp.
const NIGHT_ALTITUDE_RAD = (-10 * Math.PI) / 180;

export function isDeepNight(latitude: number, longitude: number, date: Date = new Date()): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  const { altitude } = getSunPosition(date, latitude, longitude);
  return altitude < NIGHT_ALTITUDE_RAD;
}

export function resolveEffectiveTheme(
  theme: ThemeSetting,
  latitude: number,
  longitude: number,
  date: Date = new Date(),
): EffectiveTheme {
  if (theme !== "auto") return theme;
  const prefersDark = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
  if (!prefersDark) return "light";
  return isDeepNight(latitude, longitude, date) ? "night" : "dark";
}
