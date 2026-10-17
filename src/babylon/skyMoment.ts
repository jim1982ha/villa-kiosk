// src/babylon/skyMoment.ts
// Everything the sky needs for one moment — pure numbers, no Babylon: how the
// villa is lit and the sky coloured (Settings' day/night preview included),
// and where the sun and the moon really are (the real clock, always).
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
// body, in the model's axes. (`light.dir`/`light.skyDir` are the light's own,
// sun → scene, as a Babylon DirectionalLight takes it — sunState.)

import { getSunPosition, getMoonPosition, getMoonIllumination } from "@/utils/sunCalc";
import { sunGeometry, type SunGeometry } from "./sunState";
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
  /** Toward the REAL sun: where its disc is drawn. */
  sun: Vec3;
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

const toward = (d: readonly [number, number, number]): Vec3 => ({ x: -d[0], y: -d[1], z: -d[2] });

/**
 * The sky at `date` over `place`. `preview` "day"/"night" PINS the sun to that
 * side of the horizon for the villa's light and the sky's colour — Math.abs,
 * not a sign flip, so forcing "day" at 3am and at noon look the same — and
 * never moves a body: the sun's disc and the moon follow the real clock
 * (skyBodies, "day the sun, night the moon" — owner, 2026-10-17).
 */
export function skyMoment(date: Date, place: SkyPlace, preview: DayNightPreview = "auto"): SkyMoment {
  const { latitude, longitude } = place;
  // A true compass bearing turned into this model's axes, for the sun AND the
  // moon — one correction, or the two would disagree about north.
  const north = (place.northOffsetDeg * Math.PI) / 180;
  const s = getSunPosition(date, latitude, longitude);
  const azimuth = s.azimuth + north;
  const realAltitude = s.altitude;
  const altitude = preview === "day" ? Math.abs(realAltitude)
    : preview === "night" ? -Math.abs(realAltitude)
    : realAltitude;
  const light = sunGeometry(altitude, azimuth);
  const real = sunGeometry(realAltitude, azimuth);

  const m = getMoonPosition(date, latitude, longitude);
  const mAz = m.azimuth + north;
  const ill = getMoonIllumination(date);
  // The moon points the way the sun does: (sin az, cos az) of its sunCalc
  // azimuth (0 = south, toward west), in the same model axes.
  //
  // ⚠️ THE MOON WAS DRAWN ON THE OPPOSITE SIDE OF THE SKY (until 2.496.402):
  // its direction was (−sin az, −cos az), the sun's turned half way round, so
  // once the north offset made the sun right the moon was mirrored — measured
  // on 2026-10-10, sun and moon 3.7° apart in the real sky were drawn on
  // opposite sides of the villa; at 19:00 on 2026-10-16 the real moon was in
  // the south-west and was drawn in the north-east.
  const moon: MoonNow = {
    dir: unit(Math.sin(mAz) * Math.cos(m.altitude), Math.sin(m.altitude), Math.cos(mAz) * Math.cos(m.altitude)),
    fraction: ill.fraction,
    angle: ill.angle,
    parallacticAngle: m.parallacticAngle,
  };
  return { light, skySun: toward(light.skyDir), sun: toward(real.skyDir), moon, moonT: real.nightT, realAltitude, altitude, azimuth };
}

/**
 * The sky when only the villa's day/night state is known (no coordinates):
 * a made-up sun near noon by day, mirrored below the horizon at night, the
 * preview honoured; no moon.
 */
export function guessedMoment(aboveHorizon: boolean, preview: DayNightPreview = "auto"): SkyMoment {
  const isDay = preview === "day" ? true : preview === "night" ? false : aboveHorizon;
  const dir = unit(-0.4, -1, -0.6), skyDir = isDay ? dir : unit(-0.2, 1, -0.2);
  const nightT = isDay ? 0 : 1;
  const synth = Math.asin(Math.max(-1, Math.min(1, skyDir.y)));
  const d: [number, number, number] = [dir.x, dir.y, dir.z], sd: [number, number, number] = [skyDir.x, skyDir.y, skyDir.z];
  const sun = toward(sd);
  return { light: { isDay, dir: d, skyDir: sd, nightT }, skySun: sun, sun, moon: null, moonT: nightT, realAltitude: synth, altitude: synth, azimuth: 0 };
}

/** Babylon's Vector3.normalize, to the last bit (×(1/length), and a length of
 *  exactly 1 left alone) — so the moved code draws the same pixels. */
function unit(x: number, y: number, z: number): Vec3 {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len === 0 || len === 1.0) return { x, y, z };
  const k = 1.0 / len;
  return { x: x * k, y: y * k, z: z * k };
}
