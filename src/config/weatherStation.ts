// src/config/weatherStation.ts
// The villa's own weather station — RECOGNISED, never named — and what its
// readings mean. One owner, so the summary bar's Weather tile and the Weather
// modal can never disagree about what the station is.
//
// ⚠️ NOTHING HERE MAY NAME A STATION. The hard rule forbids an entity id, a
// device name or a model; the station is found by what only a weather station
// reports:
//   1. ANCHOR — sensors whose device_class is wind_speed, wind_direction,
//      precipitation, precipitation_intensity or irradiance. No room sensor
//      carries those.
//   2. GROUP  — the anchors' device, from Home Assistant's own device registry
//      (entityDeviceIds). The indoor pair of a console lives on the same
//      device, which a name rule keyed on "outdoor" would miss. Before the
//      registry has loaded, the anchors alone stand in, and the rest arrives
//      when it does.
//   3. ROLES  — each of the device's sensors filed by device_class and, where
//      one class holds several readings (outdoor, feels-like, dew point and
//      indoor are all `temperature`), by the words the integration names them
//      with: "dew", "feels", "indoor", "gust", "daily". Integration
//      vocabulary, identical on every install — not villa data.
//   4. NONE   — no anchor, no station, no tile. Absence is an answer.
//
// ⚠️ THE SCALES BELOW ARE NOT PER-SITE TUNING. Beaufort, the WHO UV index
// bands, the dew-point comfort bands and the 3-hour pressure tendency are
// published scales, the same at every villa on earth — no more site-specific
// than the freezing point of water. The hard rule forbids a threshold that is
// right here and wrong next door; these are right everywhere.
//
// Pure: tests/oracles/weather_station.mjs.

import type { HassEntity } from "@/types/ha.types";

export type WeatherRole =
  | "temperature" | "feelsLike" | "dewPoint" | "humidity"
  | "windSpeed" | "windGust" | "windGustToday" | "windDirection"
  | "rainRate" | "rainToday" | "rainMonth" | "rainYear"
  | "pressure" | "vapourDeficit" | "uv" | "solar"
  | "indoorTemperature" | "indoorHumidity" | "indoorDewPoint"
  | "battery";

export interface WeatherStation {
  /** The device, or null while only the anchors are known. */
  deviceId: string | null;
  /** role → entity_id; a role the station does not report is absent. */
  roles: Partial<Record<WeatherRole, string>>;
  /** Every entity on the station, for the Station tab. */
  entityIds: string[];
}

const ANCHOR_CLASSES = new Set(["wind_speed", "wind_direction", "precipitation", "precipitation_intensity", "irradiance"]);

const classOf = (e: HassEntity) => String(e.attributes.device_class ?? "");
const unitOf = (e: HassEntity) => String(e.attributes.unit_of_measurement ?? "");
/** The words a sensor is known by: its id and its name, lower-case, spaced. */
const wordsOf = (e: HassEntity) =>
  `${e.entity_id} ${String(e.attributes.friendly_name ?? "")}`.toLowerCase().replace(/[._]/g, " ");
const has = (words: string, re: RegExp) => re.test(words);

const INDOOR = /\bindoor|\binside\b/;
const DEW = /\bdew ?point|\bdewpoint/;
const FEELS = /\bfeels|\bapparent\b|\bheat index\b/;
const CHILL = /\bwind ?chill\b/;
const GUST = /\bgust/;
const PEAK = /\bmax\b|\bmaximum\b|\bpeak\b|\bdaily\b|\btoday\b/;
const AVERAGE = /\bavg\b|\baverage\b|\bmean\b/;
const DAILY = /\bdaily\b|\btoday\b/;
const MONTHLY = /\bmonthly\b|\bmonth\b/;
const YEARLY = /\byearly\b|\byear\b|\bannual\b/;
const RELATIVE = /\brelative\b|\bsea level\b|\bmsl\b/;
const NOT_AIR_PRESSURE = /\bdeficit\b|\bvpd\b/;
const BATTERY = /\bbattery\b/;
const UV = /\buv\b/;

/** File one sensor of the station. First match wins; the order is the rule. */
function roleOf(e: HassEntity): WeatherRole | null {
  if (!e.entity_id.startsWith("sensor.")) return null;
  const c = classOf(e), w = wordsOf(e);
  if (c === "temperature") {
    if (has(w, INDOOR)) return has(w, DEW) ? "indoorDewPoint" : "indoorTemperature";
    if (has(w, DEW)) return "dewPoint";
    if (has(w, FEELS)) return "feelsLike";
    if (has(w, CHILL)) return null;
    return "temperature";
  }
  if (c === "humidity") return has(w, INDOOR) ? "indoorHumidity" : "humidity";
  if (c === "wind_speed") return has(w, GUST) ? (has(w, PEAK) ? "windGustToday" : "windGust") : "windSpeed";
  if (c === "wind_direction") return has(w, AVERAGE) ? null : "windDirection";
  if (c === "precipitation_intensity") return "rainRate";
  if (c === "precipitation") {
    if (has(w, DAILY)) return "rainToday";
    if (has(w, MONTHLY)) return "rainMonth";
    if (has(w, YEARLY)) return "rainYear";
    return null;
  }
  if (c === "pressure" || c === "atmospheric_pressure") {
    // The vapour-pressure deficit shares the class; it is how much more water
    // the air can take up — what the laundry advice reads.
    if (has(w, NOT_AIR_PRESSURE)) return "vapourDeficit";
    return "pressure";
  }
  if (c === "irradiance") return "solar";
  if (c === "voltage" && has(w, BATTERY)) return "battery";
  // HA defines no device_class for UV; its unit and name are what it has.
  if (!c && (/uv/i.test(unitOf(e)) || has(w, UV))) return "uv";
  return null;
}

/** Of two sensors for one role, the one to show. Pressure prefers the
 *  sea-level (relative) reading; otherwise the lower entity id, so the answer
 *  does not depend on the order Home Assistant listed them in. */
function better(role: WeatherRole, a: HassEntity, b: HassEntity): HassEntity {
  if (role === "pressure") {
    const ra = has(wordsOf(a), RELATIVE), rb = has(wordsOf(b), RELATIVE);
    if (ra !== rb) return ra ? a : b;
  }
  return a.entity_id <= b.entity_id ? a : b;
}

function stationFrom(deviceId: string | null, members: readonly HassEntity[]): WeatherStation {
  const picked = new Map<WeatherRole, HassEntity>();
  for (const e of members) {
    const role = roleOf(e);
    if (!role) continue;
    const cur = picked.get(role);
    picked.set(role, cur ? better(role, cur, e) : e);
  }
  const roles: Partial<Record<WeatherRole, string>> = {};
  for (const [role, e] of picked) roles[role] = e.entity_id;
  return { deviceId, roles, entityIds: members.map((e) => e.entity_id).sort() };
}

/**
 * The villa's weather station, or null when it has none. Two stations: the
 * one reporting the most distinct roles, ties to the lower device id — the
 * same answer whatever order the entities arrive in.
 */
export function findWeatherStation(
  entities: Record<string, HassEntity>,
  entityDeviceIds: Record<string, string>,
): WeatherStation | null {
  const anchors = Object.values(entities)
    .filter((e) => e.entity_id.startsWith("sensor.") && ANCHOR_CLASSES.has(classOf(e)));
  if (anchors.length === 0) return null;
  const devices = new Set(anchors.map((e) => entityDeviceIds[e.entity_id]).filter((d): d is string => !!d));
  if (devices.size === 0) return stationFrom(null, anchors);
  let best: WeatherStation | null = null;
  for (const deviceId of [...devices].sort()) {
    const members = Object.values(entities).filter((e) => entityDeviceIds[e.entity_id] === deviceId);
    const s = stationFrom(deviceId, members);
    if (!best || Object.keys(s.roles).length > Object.keys(best.roles).length) best = s;
  }
  return best;
}

// ── What the readings mean — published scales, one each ─────────────────

/** Wind speed in km/h, from whatever unit the sensor reports. */
export function toKmh(value: number, unit: string): number {
  const u = unit.trim().toLowerCase();
  if (u === "m/s") return value * 3.6;
  if (u === "mph") return value * 1.609344;
  if (u === "kn" || u === "kt" || u === "knots") return value * 1.852;
  return value; // km/h
}

/** Beaufort force, in km/h — the upper bound of forces 0..11. */
const BEAUFORT: ReadonlyArray<readonly [number, string]> = [
  [1, "Calm"], [6, "Light air"], [12, "Light breeze"], [20, "Gentle breeze"],
  [29, "Moderate breeze"], [39, "Fresh breeze"], [50, "Strong breeze"], [62, "Near gale"],
  [75, "Gale"], [89, "Strong gale"], [103, "Storm"], [118, "Violent storm"],
];
export function beaufort(kmh: number): string {
  for (const [upTo, name] of BEAUFORT) if (kmh < upTo) return name;
  return "Hurricane force";
}

/** The WHO UV index bands — each from its lower edge, with the advice that
 *  goes with it and the key of the WHO colour it is drawn in (green, yellow,
 *  orange, red, violet: the published scale, not a theme choice). ONE table:
 *  the words (uvBand) and the Sun & UV tile's scale are both read from it. */
export const UV_BANDS: readonly { from: number; band: string; advice: string; key: string }[] = [
  { from: 0, band: "Low", advice: "no protection needed", key: "low" },
  { from: 3, band: "Moderate", advice: "shade around midday", key: "moderate" },
  { from: 6, band: "High", advice: "cover up, sunscreen", key: "high" },
  { from: 8, band: "Very high", advice: "avoid midday sun", key: "very-high" },
  { from: 11, band: "Extreme", advice: "stay indoors at midday", key: "extreme" },
];
/** Where the drawn UV scale ends. The index has no ceiling, but 11+ is one band;
 *  two units of it are enough to show a reading sits inside it. */
export const UV_SCALE_TOP = 13;

/** WHO UV index band, with the advice that goes with it. */
export function uvBand(uv: number): { band: string; advice: string; key: string } {
  let b = UV_BANDS[0];
  for (const x of UV_BANDS) if (uv >= x.from) b = x;
  return { band: b.band, advice: b.advice, key: b.key };
}

/** A UV reading's place along the drawn scale, 0–1 (the index is linear, so
 *  the scale is too); past its end, the end. */
export function uvScalePosition(uv: number): number {
  return Math.max(0, Math.min(1, uv / UV_SCALE_TOP));
}

/** Solar radiation on a horizontal surface under a clear sky with the sun
 *  high — roughly 1000 W/m² at sea level. What the Sun & UV tile measures
 *  "how much sunshine" against: a bar full at clear noon, never a claim that
 *  a reading is "low" or "high" for this place or season. */
export const CLEAR_SKY_WM2 = 1000;
export function sunshineFraction(wm2: number): number {
  return Math.max(0, Math.min(1, wm2 / CLEAR_SKY_WM2));
}

/** How humid it feels, from the dew point in °C (the usual comfort bands). */
export function dewComfort(dewC: number): string {
  if (dewC < 10) return "dry";
  if (dewC < 16) return "comfortable";
  if (dewC < 18) return "a little humid";
  if (dewC < 21) return "muggy";
  if (dewC < 24) return "oppressive";
  return "extremely oppressive";
}

/** The 3-hour pressure tendency (hPa over three hours), as a forecaster reads it. */
export function pressureTendency(delta3h: number): string {
  const a = Math.abs(delta3h);
  if (a < 0.1) return "Steady";
  const dir = delta3h > 0 ? "Rising" : "Falling";
  if (a <= 1.5) return `${dir} slowly`;
  if (a <= 3.5) return dir;
  if (a <= 6) return `${dir} quickly`;
  return `${dir} very rapidly`;
}

/** A compass point from degrees (16 points). */
export function compass(deg: number): string {
  const pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return pts[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Degrees Celsius, from a temperature sensor's reading and unit. */
export function toCelsius(value: number, unit: string): number {
  return /f/i.test(unit) ? (value - 32) * (5 / 9) : value;
}

/**
 * The one sentence a person can act on: how the air feels, and whether
 * opening up would help. Derived from readings the station already publishes —
 * no forecast, nothing fetched. Null when the readings it needs are missing.
 */
export function comfortInsight(r: {
  temperatureC?: number; feelsLikeC?: number; dewPointC?: number; indoorDewPointC?: number;
}): string | null {
  const parts: string[] = [];
  if (r.temperatureC !== undefined && r.feelsLikeC !== undefined) {
    const d = r.feelsLikeC - r.temperatureC;
    if (Math.abs(d) >= 1) parts.push(`Feels ${Math.abs(d).toFixed(1)}° ${d > 0 ? "warmer" : "cooler"} than it is.`);
  }
  if (r.dewPointC !== undefined) {
    parts.push(`Dew point ${r.dewPointC.toFixed(1)}° — ${dewComfort(r.dewPointC)}.`);
    if (r.indoorDewPointC !== undefined) {
      const diff = r.indoorDewPointC - r.dewPointC;
      parts.push(diff >= 2 ? "Indoors is more humid than outside — airing out would help."
        : diff <= -2 ? "Outside is more humid than indoors — keep the windows closed."
          : "Indoors is no drier, so opening up will not help.");
    }
  }
  return parts.length ? parts.join(" ") : null;
}


// ── The Weather window's words: the headline, the comfort scale, advice ──
//
// ⚠️ RULES, NOT A FORECAST, AND NOT A MODEL. Each is a fixed reading of the
// station's own values, so the same readings always give the same advice and
// every card can say why. The scales (Beaufort, WHO UV, dew-point comfort)
// are published; the window and laundry thresholds are physical rules of
// thumb, written once HERE — never tuned to one villa.

/** Gusts from this (Beaufort 6, "strong breeze") make open windows and the
 *  terrace a poor idea. */
export const STRONG_GUST_KMH = 39;
/** Window advice: outside must be at least this much cooler, and at most
 *  this much more humid (dew point), to open up; this much more humid
 *  outside and the windows stay shut. */
const COOLER_OUTSIDE_C = 1;
const DEW_TOLERANCE_C = 1;
const DEW_TOO_HUMID_C = 2;
/** Laundry: the vapour-pressure deficit (hPa) at which drying is slow, and
 *  good; sun and wind above these improve it one step each. */
const VPD_SLOW_HPA = 5;
const VPD_GOOD_HPA = 10;
const DRYING_SUN_WM2 = 200;
const DRYING_WIND_KMH = 6;

export type AdviceTone = "good" | "caution" | "bad" | "neutral";
export interface Advice { tone: AdviceTone; title: string; detail: string }

const f1 = (v: number) => v.toFixed(1);

/** "Warm, very humid and still." — temperature, the air's water, the wind. */
export function comfortHeadline(tC: number, dewC: number | undefined, windKmh: number | undefined): string {
  const t = tC < 10 ? "Cold" : tC < 18 ? "Cool" : tC < 24 ? "Mild" : tC < 30 ? "Warm" : "Hot";
  const band = dewC === undefined ? null : dewComfort(dewC);
  const h = band === null ? null
    : band === "oppressive" ? "very humid" : band === "extremely oppressive" ? "oppressively humid" : band;
  const w = windKmh === undefined ? null
    : windKmh < 6 ? "still" : windKmh < 20 ? "a light breeze" : windKmh < STRONG_GUST_KMH ? "breezy" : "windy";
  const parts = [h, w].filter((x): x is string => !!x);
  if (parts.length === 0) return `${t}.`;
  if (parts.length === 1) return `${t} and ${parts[0]}.`;
  return `${t}, ${parts[0]} and ${parts[1]}.`;
}

/** The comfort scale's five equal bands — Dry, Comfortable, Humid, Muggy,
 *  Oppressive — and where a dew point sits on it, 0..1. */
export const COMFORT_BANDS = ["Dry", "Comfortable", "Humid", "Muggy", "Oppressive"] as const;
export function comfortPosition(dewC: number): number {
  const edges = [0, 10, 16, 18, 21, 26]; // °C; the last band runs to 26, then holds
  const d = Math.max(edges[0], Math.min(edges[5], dewC));
  for (let i = 0; i < 5; i++) {
    if (d <= edges[i + 1]) return (i + (d - edges[i]) / (edges[i + 1] - edges[i])) / 5;
  }
  return 1;
}

/** Open the windows, or not. Null without an indoor reading to compare. */
export function windowAdvice(r: {
  outC?: number; inC?: number; outDewC?: number; inDewC?: number; raining?: boolean; gustKmh?: number;
}): Advice | null {
  if (r.outC === undefined || r.inC === undefined) return null;
  if (r.raining) return { tone: "bad", title: "Keep the windows closed", detail: "It is raining." };
  if (r.gustKmh !== undefined && r.gustKmh >= STRONG_GUST_KMH) {
    return { tone: "bad", title: "Keep the windows closed", detail: `Gusts of ${Math.round(r.gustKmh)} km/h outside.` };
  }
  const dewDiff = r.outDewC !== undefined && r.inDewC !== undefined ? r.outDewC - r.inDewC : undefined;
  if (dewDiff !== undefined && dewDiff >= DEW_TOO_HUMID_C) {
    return { tone: "bad", title: "Keep the windows closed",
      detail: `Outside is more humid (dew ${f1(r.outDewC!)}° against ${f1(r.inDewC!)}°) — opening up would bring the damp in.` };
  }
  const cooler = r.inC - r.outC;
  if (cooler >= COOLER_OUTSIDE_C && (dewDiff === undefined || dewDiff <= DEW_TOLERANCE_C)) {
    const drier = dewDiff !== undefined && dewDiff < 0 ? " and a little drier" : "";
    return { tone: "good", title: "Open the windows",
      detail: `${f1(cooler)}° cooler outside${drier} — the house cools without getting damper.` };
  }
  if (-cooler >= COOLER_OUTSIDE_C) {
    return { tone: "caution", title: "Keep the windows closed",
      detail: `It is warmer outside (${f1(r.outC)}°) than in (${f1(r.inC)}°).` };
  }
  return { tone: "neutral", title: "Windows: no difference", detail: "Inside and outside are much the same." };
}

/** Will laundry dry outside. Null without the vapour-pressure deficit. */
export function laundryAdvice(r: { vpdHpa?: number; solarWm2?: number; windKmh?: number; raining?: boolean }): Advice | null {
  if (r.raining) return { tone: "bad", title: "Laundry: not outside", detail: "It is raining." };
  if (r.vpdHpa === undefined) return null;
  const base = r.vpdHpa >= VPD_GOOD_HPA ? 2 : r.vpdHpa >= VPD_SLOW_HPA ? 1 : 0;
  const sun = (r.solarWm2 ?? 0) > DRYING_SUN_WM2, wind = (r.windKmh ?? 0) > DRYING_WIND_KMH;
  const level = Math.min(2, base + (sun ? 1 : 0) + (wind ? 1 : 0));
  const take = base === 2 ? "a lot of" : base === 1 ? "some" : "little";
  const help = sun && wind ? ", with sun and wind to help" : sun ? ", with sun to help" : wind ? ", with wind to help" : ", and there is no sun or wind";
  return {
    tone: level === 2 ? "good" : level === 1 ? "caution" : "bad",
    title: level === 2 ? "Laundry: good" : level === 1 ? "Laundry: slow" : "Laundry: poor",
    detail: `The air can take up ${take} more water (${f1(r.vpdHpa)} hPa)${help}.`,
  };
}

/** Is it a good time to be outside. */
export function outdoorsAdvice(r: { raining?: boolean; gustKmh?: number; windKmh?: number; uv?: number }): Advice | null {
  if (r.raining === undefined && r.gustKmh === undefined && r.uv === undefined) return null;
  if (r.raining) return { tone: "bad", title: "Outdoors: wet", detail: "It is raining." };
  if (r.gustKmh !== undefined && r.gustKmh >= STRONG_GUST_KMH) {
    return { tone: "caution", title: "Outdoors: windy", detail: `Gusts of ${Math.round(r.gustKmh)} km/h — ${beaufort(r.gustKmh).toLowerCase()}.` };
  }
  if (r.uv !== undefined && r.uv >= 3) {
    const b = uvBand(r.uv);
    return { tone: "caution", title: "Outdoors: sun protection", detail: `UV ${Math.round(r.uv)}, ${b.band.toLowerCase()} — ${b.advice}.` };
  }
  const bits = [r.raining === false ? "Dry" : null,
    r.windKmh !== undefined ? beaufort(r.windKmh).toLowerCase() : null,
    r.gustKmh !== undefined ? `gusts under ${Math.max(5, Math.ceil(r.gustKmh / 5) * 5)} km/h` : null]
    .filter(Boolean).join(", ");
  const uvText = r.uv !== undefined ? ` UV ${Math.round(r.uv)} — no sun protection.` : "";
  return { tone: "good", title: "Outdoors: fine", detail: `${bits ? bits.charAt(0).toUpperCase() + bits.slice(1) + "." : ""}${uvText}`.trim() };
}

/** A vapour-pressure deficit in hPa, from whatever unit the sensor reports. */
export function toHpa(value: number, unit: string): number {
  const u = unit.trim().toLowerCase();
  if (u === "kpa") return value * 10;
  if (u === "pa") return value / 100;
  if (u === "inhg") return value * 33.8639;
  return value;
}
