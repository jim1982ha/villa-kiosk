// src/babylon/skyMoment.ts
// Everything the sky needs for one moment — pure numbers, no Babylon: how the
// villa is lit and the sky coloured (Settings' day/night preview included),
// and where the moon really is (the real clock, always).
//
// ⚠️ "REAL TIME OR PREVIEW TIME" WAS DECIDED IN THREE PLACES (until
// 2.496.401): SunController computed the sun twice and handed the real one
// over as a separate direction, the moon got a separate night value, and the
// sky dome and the night sky each fell back to the PREVIEW quietly when a
// caller left one out — the fallback behind "at 02:46 with the day preview the
// sun was drawn 46° up" (2.496.400). One function decides it now, and nothing
// downstream has a default to fall back on.
//
// One direction convention: every Vec3 here points FROM the villa TOWARD the
// body, in the model's axes, written by sunState.towardBody for the sun and
// the moon alike. (`light.dir` is the light's own, sun → scene, as a Babylon
// DirectionalLight takes it.)

import { getSunPosition, getMoonPosition, getMoonIllumination } from "@/utils/sunCalc";
import { sunGeometry, towardBody, unit, type SunGeometry } from "./sunState";
import type { Vec3 } from "./skyBodies";

export type DayNightPreview = "day" | "auto" | "night";

/** Where the villa is on the Earth, and which way its model faces. */
export interface SkyPlace { latitude: number; longitude: number; northOffsetDeg: number }

/** The real moon: where it is, and how it is lit. */
export interface MoonNow {
  dir: Vec3;
  /** 0 = new, 1 = full. */
  fraction: number;
  /** Negative = waxing (lit on the right in the northern convention). */
  angle: number;
  /** Radians; tilt of the lit limb for this latitude and hour. */
  parallacticAngle: number;
}

export interface SkyMoment {
  /** How the villa is lit — by Settings' preview: its isDay and nightT (0 day
   *  … 1 full night) also colour the sky and fade the stars. */
  light: SunGeometry;
  /** Toward the PREVIEW sun: the sky's colour and twilight. */
  skySun: Vec3;
  /** The real moon; null when no position is known (the villa's day/night
   *  state alone) — the moon and the stars are then left as they are. */
  moon: MoonNow | null;
  /** 0 by day … 1 at full night by the REAL clock: the moon's fade. */
  moonT: number;
  /** For the sky debug line: true and preview altitudes, model azimuth. */
  realAltitude: number;
  altitude: number;
  azimuth: number;
}

/**
 * The sky at `date` over `place`. `preview` "day"/"night" PINS the sun to that
 * side of the horizon for the villa's light and the sky's colour — Math.abs,
 * not a sign flip, so forcing "day" at 3am and at noon look the same — and
 * never moves a body: the moon follows the real clock (skyBodies — owner,
 * 2026-10-17).
 */
export function skyMoment(date: Date, place: SkyPlace, preview: DayNightPreview = "auto"): SkyMoment {
  const { latitude, longitude } = place;
  // sunCalc's azimuth (0 = south, toward west) turned into this model's axes,
  // for the sun AND the moon — one correction, or the two would disagree about
  // north. A body is drawn at model heading azimuth + offset, so the offset is
  // the model heading of true SOUTH (northOffsetFacing).
  const north = (place.northOffsetDeg * Math.PI) / 180;
  const s = getSunPosition(date, latitude, longitude);
  const azimuth = s.azimuth + north;
  const realAltitude = s.altitude;
  const altitude = preview === "day" ? Math.abs(realAltitude)
    : preview === "night" ? -Math.abs(realAltitude)
    : realAltitude;
  const light = sunGeometry(altitude, azimuth);

  const m = getMoonPosition(date, latitude, longitude);
  const ill = getMoonIllumination(date);
  // ⚠️ THE MOON WAS DRAWN ON THE OPPOSITE SIDE OF THE SKY (until 2.496.402):
  // its direction had its own formula, the sun's turned half way round, so
  // once the north offset made the sun right the moon was mirrored — measured
  // on 2026-10-10, sun and moon 3.7° apart in the real sky were drawn on
  // opposite sides of the villa. Both are towardBody now.
  const moon: MoonNow = {
    dir: towardBody(m.altitude, m.azimuth + north),
    fraction: ill.fraction,
    angle: ill.angle,
    parallacticAngle: m.parallacticAngle,
  };
  return {
    light, skySun: towardBody(altitude, azimuth), moon,
    moonT: sunGeometry(realAltitude, azimuth).nightT, realAltitude, altitude, azimuth,
  };
}

/**
 * The north offset that makes `headingDeg` — the way the 3D view looks
 * (SceneManager.viewHeadingDeg) — true north: what Settings' "Set North"
 * stores when the view faces the villa's real north. The offset is the model
 * heading of true SOUTH (see skyMoment), so it is the heading turned half way
 * round.
 *
 * ⚠️ "SET NORTH" STORED THE HEADING ITSELF (until 2.496.404): measured on a
 * fresh install, the morning sun was then drawn in the west — the whole sky
 * half way round — and only dragging the slider 180° put it right.
 */
export function northOffsetFacing(headingDeg: number): number {
  return (((Math.round(headingDeg) + 180) % 360) + 360) % 360;
}

/**
 * The sky when only the villa's day/night state is known (no coordinates):
 * a made-up sun near noon by day, mirrored below the horizon at night, the
 * preview honoured; no moon.
 */
export function guessedMoment(aboveHorizon: boolean, preview: DayNightPreview = "auto"): SkyMoment {
  const isDay = preview === "day" ? true : preview === "night" ? false : aboveHorizon;
  const dir = unit(-0.4, -1, -0.6), [x, y, z] = isDay ? unit(0.4, 1, 0.6) : unit(0.2, -1, 0.2);
  const nightT = isDay ? 0 : 1;
  const synth = Math.asin(Math.max(-1, Math.min(1, y)));
  return { light: { isDay, dir, nightT }, skySun: { x, y, z }, moon: null, moonT: nightT, realAltitude: synth, altitude: synth, azimuth: 0 };
}
