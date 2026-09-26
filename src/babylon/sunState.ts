// src/babylon/sunState.ts
// Where the sun is and what the lights are at that moment — pure numbers, no
// Babylon: the sun's two directions and the twilight ramp from its altitude,
// and the key / ambient / fill levels for day or for a night dimmed by
// Settings' "Night dimming".
//
// ⚠️ THE NIGHT-DIMMING RULE WAS WRITTEN TWICE (round 11, 2.496.171): the
// same clamp-and-lerp in sceneLook.resolveLook (exposure, IBL strength) and
// in SunController.applyDayNight (key, ambient, fill), each with its own
// copy of "0 = the mild night, 1 = deep". Both read `nightLerp` now, and the
// light levels — inline in a method that also wrote Babylon lights — are a
// value here: tests/oracles/sun_state.mjs.

export type Rgb = readonly [number, number, number];

/**
 * A night value between its MILD setting (night dimming 0, the long-standing
 * look) and its DEEP one (1: a lit fixture's own light clearly dominates the
 * room), by Settings' night dimming — clamped to 0…1.
 */
export function nightLerp(nightDimming: number): (mild: number, deep: number) => number {
  const nd = Math.min(1, Math.max(0, nightDimming));
  return (mild, deep) => mild + (deep - mild) * nd;
}

/** Civil twilight: the night bake fades in as the sun sinks 0°→6° below. */
const TWILIGHT = (6 * Math.PI) / 180;

export interface SunGeometry {
  isDay: boolean;
  /** Direction the light travels (sun → scene), floored at 0.05 down so the
   *  lighting never goes edge-on after dark. */
  dir: readonly [number, number, number];
  /** The same direction UNCLAMPED, for the sky dome only — the floor kept
   *  its sun hovering over the horizon all night. */
  skyDir: readonly [number, number, number];
  /** 0 = day … 1 = full night, over civil twilight. */
  nightT: number;
}

const unit = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};

/** The sun at this altitude/azimuth (radians, azimuth already in model space). */
export function sunGeometry(altitude: number, azimuth: number): SunGeometry {
  const sx = -Math.sin(azimuth) * Math.cos(altitude);
  const sz = -Math.cos(azimuth) * Math.cos(altitude);
  return {
    isDay: altitude > 0,
    dir: unit(sx, -Math.max(0.05, Math.sin(altitude)), sz),
    skyDir: unit(sx, -Math.sin(altitude), sz),
    nightT: Math.min(1, Math.max(0, -altitude / TWILIGHT)),
  };
}

export interface SunLights {
  sunIntensity: number;
  sunColor: Rgb;
  ambient: Rgb;
  hemiIntensity: number;
  hemiDiffuse: Rgb;
  hemiGround: Rgb;
}

const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/**
 * The key light, ambient and interior fill for day or night. Night is WARM
 * and near-neutral (the cold blue night tinted white kitchens cyan — "the
 * blue kitchen"); a deep night dimming stays warm, which is what keeps it
 * reading as "cosy dim" rather than the old dead grey. Settings' multipliers
 * (sun, ambient, fill) apply on top of the day/night base.
 */
export function sunLights(
  isDay: boolean,
  r: { nightDimming: number; sunIntensity: number; ambientIntensity: number; hemiIntensity: number },
): SunLights {
  const lerp = nightLerp(isDay ? 0 : r.nightDimming);
  return {
    sunIntensity: (isDay ? 1.2 : lerp(0.32, 0.2)) * r.sunIntensity,
    sunColor: isDay ? [1.0, 0.95, 0.8] : [0.95, 0.85, 0.7],
    ambient: scale(isDay ? [0.4, 0.35, 0.3] : scale([0.26, 0.23, 0.19], lerp(1, 0.35)), r.ambientIntensity),
    hemiIntensity: r.hemiIntensity * (isDay ? 1 : lerp(0.7, 0.22)),
    hemiDiffuse: isDay ? [1, 1, 1] : [1.0, 0.92, 0.82],
    hemiGround: isDay ? [0.55, 0.54, 0.52] : [0.32, 0.30, 0.27],
  };
}
