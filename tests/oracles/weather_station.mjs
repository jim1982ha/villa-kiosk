// The weather station: recognised, never named (src/config/weatherStation.ts),
// and the published scales behind the Weather modal's words.
//
// ⚠️ THE FIXTURE HAS A REAL STATION'S SHAPE, NOT A CONVENIENT ONE. Twenty green
// tests once described labels no property uses (feedback: fixtures must match
// the property). So: the classes, units and naming of an Ecowitt console as a
// villa actually reports it — indoor readings on the SAME device, three
// `temperature` sensors outdoors, a pressure-class vapour-pressure deficit,
// a UV sensor with no device_class, a 10-minute average direction, rain in
// seven windows — under generic ids that name no villa.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const W = await import("@/config/weatherStation");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const S = (id, name, state, device_class, unit) => ({
  entity_id: `sensor.${id}`, state: String(state),
  attributes: { friendly_name: name, ...(device_class ? { device_class } : {}), ...(unit ? { unit_of_measurement: unit } : {}) },
  last_updated: "2026-09-26T00:00:00Z",
});
const station = [
  S("console_indoor_temperature", "Console Indoor Temperature", 28.4, "temperature", "°C"),
  S("console_indoor_humidity", "Console Indoor Humidity", 72, "humidity", "%"),
  S("console_indoor_dewpoint", "Console Indoor Dewpoint", 22.9, "temperature", "°C"),
  S("garden_temperature", "Station Outdoor Temperature", 25.3, "temperature", "°C"),
  S("garden_feels_like_temperature", "Station Feels like Temperature", 27.1, "temperature", "°C"),
  S("garden_dewpoint", "Station Dewpoint", 21.8, "temperature", "°C"),
  S("garden_windchill", "Station Windchill", "unknown", "temperature", "°C"),
  S("garden_humidity", "Station Humidity", 81, "humidity", "%"),
  S("garden_wind_speed", "Station Wind Speed", 4.0, "wind_speed", "km/h"),
  S("garden_wind_gust", "Station Wind Gust", 5.0, "wind_speed", "km/h"),
  S("garden_max_daily_gust", "Station Max Daily Gust", 8.3, "wind_speed", "km/h"),
  S("garden_wind_direction", "Station Wind Direction", 357, "wind_direction", "°"),
  S("garden_wind_direction_10m_avg", "Station Wind Direction 10m Avg", 0, "wind_direction", "°"),
  S("garden_rain_rate_piezo", "Station Rain Rate Piezo", 0, "precipitation_intensity", "mm/h"),
  S("garden_daily_rain_piezo", "Station Daily Rain Piezo", 0, "precipitation", "mm"),
  S("garden_weekly_rain_piezo", "Station Weekly Rain Piezo", 0, "precipitation", "mm"),
  S("garden_monthly_rain_piezo", "Station Monthly Rain Piezo", 15.1, "precipitation", "mm"),
  S("garden_yearly_rain_piezo", "Station Yearly Rain Piezo", 20.7, "precipitation", "mm"),
  S("garden_24h_rain_piezo", "Station 24h Rain Piezo", 0, "precipitation", "mm"),
  S("garden_event_rain_piezo", "Station Event Rain Piezo", 0, "precipitation", "mm"),
  S("garden_absolute_pressure", "Station Absolute Pressure", 1007.9, "pressure", "hPa"),
  S("garden_relative_pressure", "Station Relative Pressure", 1008.1, "pressure", "hPa"),
  S("garden_vapour_pressure_deficit", "Station Vapour Pressure Deficit", 6.13, "pressure", "hPa"),
  S("garden_uv_index", "Station UV Index", 0, null, "UV index"),
  S("garden_solar_radiation", "Station Solar Radiation", 0, "irradiance", "W/m²"),
  S("garden_solar_lux", "Station Solar Lux", 0, "illuminance", "lx"),
  S("garden_sensor_battery", "Station Sensor Battery", 3.14, "voltage", "V"),
];
const room = S("bedroom_temperature", "Bedroom Temperature", 24, "temperature", "°C");
const byId = (list) => Object.fromEntries(list.map((e) => [e.entity_id, e]));
const devices = (list, dev) => Object.fromEntries(list.map((e) => [e.entity_id, dev]));
const entities = byId([...station, room]);
const registry = { ...devices(station, "dev-station"), [room.entity_id]: "dev-thermo" };

console.log("  finding it");
{
  const s = W.findWeatherStation(entities, registry);
  ck("found by what it reports, on its device", s?.deviceId === "dev-station", s?.deviceId);
  const r = s?.roles ?? {};
  const want = {
    temperature: "sensor.garden_temperature", feelsLike: "sensor.garden_feels_like_temperature",
    dewPoint: "sensor.garden_dewpoint", humidity: "sensor.garden_humidity",
    windSpeed: "sensor.garden_wind_speed", windGust: "sensor.garden_wind_gust",
    windGustToday: "sensor.garden_max_daily_gust", windDirection: "sensor.garden_wind_direction",
    rainRate: "sensor.garden_rain_rate_piezo", rainToday: "sensor.garden_daily_rain_piezo",
    rainMonth: "sensor.garden_monthly_rain_piezo", rainYear: "sensor.garden_yearly_rain_piezo",
    pressure: "sensor.garden_relative_pressure", uv: "sensor.garden_uv_index", solar: "sensor.garden_solar_radiation",
    indoorTemperature: "sensor.console_indoor_temperature", indoorHumidity: "sensor.console_indoor_humidity",
    indoorDewPoint: "sensor.console_indoor_dewpoint", battery: "sensor.garden_sensor_battery",
  };
  for (const [role, id] of Object.entries(want)) ck(`${role} is ${id.slice(7)}`, r[role] === id, r[role]);
  ck("the vapour-pressure deficit is NOT the pressure (both are device_class pressure)", r.pressure !== "sensor.garden_vapour_pressure_deficit");
  ck("  ...it is its own role — the laundry advice reads it", r.vapourDeficit === "sensor.garden_vapour_pressure_deficit", r.vapourDeficit);
  ck("the 10-minute average is not the direction", r.windDirection !== "sensor.garden_wind_direction_10m_avg");
  ck("the indoor pair is found although only the console's device links it", !!r.indoorTemperature && !!r.indoorHumidity);
  ck("a room thermometer on another device is not the station", !s.entityIds.includes(room.entity_id));
  ck("the Station tab lists every sensor on the device", s.entityIds.length === station.length, s.entityIds.length);
}
{
  ck("no anchor (a villa of room thermometers): no station, no tile",
     W.findWeatherStation(byId([room, S("hall_humidity", "Hall Humidity", 50, "humidity", "%")]), {}) === null);
  const early = W.findWeatherStation(entities, {});
  ck("before the registry loads: the anchors stand in, so the tile can show wind and rain",
     early?.deviceId === null && !!early.roles.windSpeed && !!early.roles.rainToday, early?.roles);
}
{
  const second = [S("roof_wind_speed", "Roof Wind Speed", 9, "wind_speed", "km/h")];
  const all = byId([...station, ...second]);
  const reg = { ...registry, ...devices(second, "dev-a-roof") };
  const a = W.findWeatherStation(all, reg);
  const reversed = Object.fromEntries(Object.entries(all).reverse());
  const b = W.findWeatherStation(reversed, reg);
  ck("two stations: the one reporting the most, whatever the order", a?.deviceId === "dev-station" && b?.deviceId === "dev-station", [a?.deviceId, b?.deviceId]);
}

{
  // Names that sort the OTHER way, so the lower-id tie-break cannot rescue a
  // wrong rule: the deficit and the averaged direction come first here.
  const odd = [
    S("deck_avg_wind_direction", "Deck Avg Wind Direction", 10, "wind_direction", "°"),
    S("deck_wind_direction", "Deck Wind Direction", 200, "wind_direction", "°"),
    S("deck_pressure_deficit", "Deck Vapour Pressure Deficit", 6, "pressure", "hPa"),
    S("deck_station_pressure", "Deck Station Pressure", 1009, "pressure", "hPa"),
    S("deck_wind_speed", "Deck Wind Speed", 3, "wind_speed", "km/h"),
  ];
  const r = W.findWeatherStation(byId(odd), devices(odd, "dev-deck"))?.roles ?? {};
  ck("the vapour-pressure deficit is never the pressure, whatever it is called", r.pressure === "sensor.deck_station_pressure", r.pressure);
  ck("an averaged direction is never the direction, whatever it is called", r.windDirection === "sensor.deck_wind_direction", r.windDirection);
}

console.log("\n  the scales — published, each boundary at its edge");
ck("Beaufort: 0 calm, 5.9 light air, 6 light breeze", W.beaufort(0) === "Calm" && W.beaufort(5.9) === "Light air" && W.beaufort(6) === "Light breeze");
ck("Beaufort: 117.9 violent storm, 118 hurricane force", W.beaufort(117.9) === "Violent storm" && W.beaufort(118) === "Hurricane force");
ck("wind units: 10 m/s is 36 km/h, 10 kn is 18.52", Math.abs(W.toKmh(10, "m/s") - 36) < 1e-9 && Math.abs(W.toKmh(10, "kn") - 18.52) < 1e-9);
ck("UV (WHO): 2.9 low, 3 moderate, 6 high, 8 very high, 11 extreme",
   ["Low", "Moderate", "High", "Very high", "Extreme"].every((b, i) => W.uvBand([2.9, 3, 6, 8, 11][i]).band === b));
ck("dew point: 9.9 dry, 10 comfortable, 21 oppressive, 24 extremely",
   W.dewComfort(9.9) === "dry" && W.dewComfort(10) === "comfortable" && W.dewComfort(21) === "oppressive" && W.dewComfort(24) === "extremely oppressive");
ck("pressure tendency: 0.05 steady, +1.0 rising slowly, -2 falling, +7 very rapidly",
   W.pressureTendency(0.05) === "Steady" && W.pressureTendency(1) === "Rising slowly" && W.pressureTendency(-2) === "Falling" && W.pressureTendency(7) === "Rising very rapidly");
ck("compass: 357° is N, 109° is ESE", W.compass(357) === "N" && W.compass(109) === "ESE");
ck("°F to °C", Math.abs(W.toCelsius(212, "°F") - 100) < 1e-9 && W.toCelsius(25, "°C") === 25);

console.log("\n  the insight — derived from the station's own readings");
{
  const t = W.comfortInsight({ temperatureC: 29.8, feelsLikeC: 33, dewPointC: 22, indoorDewPointC: 21.9 });
  ck("feels warmer, by how much", /Feels 3\.2° warmer/.test(t ?? ""), t);
  ck("the dew point's band", /oppressive/.test(t ?? ""), t);
  ck("indoors no drier: opening up will not help", /no drier/.test(t ?? ""), t);
  ck("indoors more humid: airing out would help", /airing out would help/.test(W.comfortInsight({ dewPointC: 18, indoorDewPointC: 21 }) ?? ""));
  ck("nothing to say without the readings", W.comfortInsight({}) === null);
}

console.log("\n  the window's words — fixed rules on the station's own readings");
{
  ck("headline: 25.3°, dew 21.8°, 4 km/h → 'Warm, very humid and still.'", W.comfortHeadline(25.3, 21.8, 4) === "Warm, very humid and still.", W.comfortHeadline(25.3, 21.8, 4));
  ck("headline without dew or wind still says the temperature", W.comfortHeadline(12, undefined, undefined) === "Cool.");
  ck("comfort scale: dew 21.8° sits in the fifth band, 22.9° further along", W.comfortPosition(21.8) > 0.8 && W.comfortPosition(22.9) > W.comfortPosition(21.8));
  ck("comfort scale: band edges — 10° starts band 2, 16° band 3, 18° band 4, 21° band 5",
     [[10, 0.2], [16, 0.4], [18, 0.6], [21, 0.8]].every(([d, p]) => Math.abs(W.comfortPosition(d) - p) < 1e-9));
  ck("comfort scale is clamped at both ends", W.comfortPosition(-5) === 0 && W.comfortPosition(40) === 1);
  const win = (o) => W.windowAdvice({ outC: 25.3, inC: 28.4, outDewC: 21.8, inDewC: 22.9, raining: false, gustKmh: 5, ...o });
  ck("windows: 3.1° cooler and a little drier outside → open", win({})?.tone === "good" && /3\.1° cooler outside and a little drier/.test(win({}).detail), win({}));
  ck("windows: raining → closed", win({ raining: true }).tone === "bad");
  ck("windows: only 0.5° cooler outside → no difference, not 'open'", win({ outC: 27.9 }).tone === "neutral", win({ outC: 27.9 }).tone);
  ck("windows: gusts at the strong-breeze line (39 km/h) → closed", win({ gustKmh: 39 }).tone === "bad" && win({ gustKmh: 38.9 }).tone === "good");
  ck("windows: outside 2° more humid (dew) → closed, even when cooler", win({ outDewC: 24.9 }).tone === "bad");
  ck("windows: warmer outside → closed (caution)", win({ outC: 30 }).tone === "caution");
  ck("windows: no indoor reading → no card", W.windowAdvice({ outC: 25 }) === null);
  const lau = (o) => W.laundryAdvice({ vpdHpa: 6.13, solarWm2: 0, windKmh: 4, raining: false, ...o });
  ck("laundry: 6.1 hPa, no sun or wind → slow", lau({}).title === "Laundry: slow", lau({}).title);
  ck("laundry: under 5 hPa → poor; from 10 → good", lau({ vpdHpa: 4.9 }).title === "Laundry: poor" && lau({ vpdHpa: 10 }).title === "Laundry: good");
  ck("laundry: sun over 200 W/m² lifts it one step", lau({ solarWm2: 201 }).title === "Laundry: good" && lau({ solarWm2: 200 }).title === "Laundry: slow");
  ck("laundry: rain → not outside", lau({ raining: true }).tone === "bad");
  ck("laundry: kPa is converted (0.61 kPa = 6.1 hPa)", Math.abs(W.toHpa(0.61, "kPa") - 6.1) < 1e-9);
  const out = (o) => W.outdoorsAdvice({ raining: false, gustKmh: 5, windKmh: 4, uv: 0, ...o });
  ck("outdoors: dry, light air, UV 0 → fine", out({}).tone === "good" && /UV 0 — no sun protection/.test(out({}).detail), out({}).detail);
  ck("outdoors: UV 3 → sun protection (WHO)", out({ uv: 3 }).title === "Outdoors: sun protection" && out({ uv: 2.9 }).tone === "good");
  ck("outdoors: gusts 39 → windy; rain → wet", out({ gustKmh: 39 }).title === "Outdoors: windy" && out({ raining: true }).title === "Outdoors: wet");
}

console.log("\n  the Sun & UV tile — the WHO scale (2026-09-26)");
{
  ck("the words and the scale read ONE band table", W.UV_BANDS.map((b) => b.from).join() === "0,3,6,8,11" && W.uvBand(8).key === "very-high" && W.uvBand(7.99).key === "high");
  ck("UV 8 sits 8/13 along the scale; past its end, at the end", Math.abs(W.uvScalePosition(8) - 8 / 13) < 1e-9 && W.uvScalePosition(20) === 1 && W.uvScalePosition(-1) === 0);
  ck("sunshine is read against a clear sky at noon (1000 W/m²), capped", Math.abs(W.sunshineFraction(935) - 0.935) < 1e-9 && W.sunshineFraction(1200) === 1);
  const { peakOf } = await import("@/utils/statisticsSeries");
  const pk = peakOf({ points: [{ t: 1, v: 3 }, { t: 2, v: 9 }, { t: 3, v: 9 }, { t: 4, v: 5 }], gaps: [], window: { from: 0, to: 5 } });
  ck("today's peak is the highest reading, when it was FIRST reached", pk?.v === 9 && pk.t === 2, pk);
  ck("  ...and none without readings", peakOf({ points: [], gaps: [], window: { from: 0, to: 1 } }) === null);
  const panel = readFileSync(new URL("../../src/components/panels/WeatherPanel.tsx", import.meta.url), "utf8");
  ck("the tile draws the band table, the reading's mark, the peak and the sunshine bar — and no decorative sun",
     /UV_BANDS\.map\(\(x, i\) =>/.test(panel) && /uvScalePosition\(r\.uv\)/.test(panel) && /Peak today/.test(panel)
       && /sunshineFraction\(r\.solar\)/.test(panel) && !/sun-dot|sun-path/.test(panel));
  const css = readFileSync(new URL("../../src/styles/03-panels.css", import.meta.url), "utf8");
  ck("the gauge is VERTICAL (the reading's height from the bottom) in the 'How it feels' palette — no WHO hexes",
     /bottom: `\$\{uvScalePosition\(r\.uv\) \* 100\}%`/.test(panel) && /\.uv-seg\.low \{ background: color-mix\(in srgb, var\(--accent\) 40%/.test(css) && !/\.uv-seg\.[\w-]+ \{ background: #/.test(css));
}

console.log("\n  the window: the approved boards 6 and 7");
{
  const panel = readFileSync(new URL("../../src/components/panels/WeatherPanel.tsx", import.meta.url), "utf8");
  ck("the same width as every other bottom-bar window", /className="summary-group-modal weather-modal"/.test(panel));
  ck("history reads the recorder's STATISTICS (5-minute / hourly), not raw history",
     /fetchStatistics\(ws, ids, range\.hours, range\.period, \["mean", "min", "max"\]/.test(panel));
  ck("the history view goes back from its title's arrow, with no second 'back' link", /aria-label="Back to Weather"/.test(panel) && !/Back to now/.test(panel));
  ck("'History and trends' is in the FOOTER, Settings' 'Advanced Settings' style (btn ghost, in the leading slot)",
     /footerLeading=\{view === "now" && \([\s\S]{0,120}className="btn ghost"[\s\S]{0,120}History and trends/.test(panel) && !/weather-link/.test(panel));
  const base = readFileSync(new URL("../../src/components/panels/BasePanel.tsx", import.meta.url), "utf8");
  ck("  ...and BasePanel's footer renders that slot", /<div className="panel-footer-left">\s*\{footerLeading\}/.test(base));
  ck("each screen opens at its top (the body scrolls back on every switch)",
     /useEffect\(\(\) => \{ topRef\.current\?\.closest\("\.panel-body"\)\?\.scrollTo\(\{ top: 0 \}\); \}, \[view\]\);/.test(panel));
  ck("every history chart has the app's hover tooltip — the lines and the rain bars",
     (panel.match(/<ChartTip /g) ?? []).length === 2 && (panel.match(/\{\.\.\.handlers\}/g) ?? []).length === 2);
  ck("the three advice cards are the rules above, fed the live readings",
     /windowAdvice\(\{/.test(panel) && /laundryAdvice\(\{/.test(panel) && /outdoorsAdvice\(\{/.test(panel));
}

console.log("\n  the bar");
{
  const bar = readFileSync(new URL("../../src/components/hud/SummaryBar.tsx", import.meta.url), "utf8");
  ck("the Weather tile is there, from the one station rule", /id: "__weather"/.test(bar) && /findWeatherStation\(entities, entityDeviceIds\)/.test(bar));
  ck("  ...and opens the Weather modal", /<WeatherPanel station=\{station\}/.test(bar));
  ck("the Pool tile is gone", !/"__pool"|label: "Pool"|Waves/.test(bar));
  const vs = readFileSync(new URL("../../src/config/villaSummary.ts", import.meta.url), "utf8");
  ck("  ...and so is the rule only it used", !/poolFacts|POOL_WORD/.test(vs));
}

console.log("\n  the charts do not re-fetch on every state push (2.496.86)");
{
  const bar = readFileSync(new URL("../../src/components/hud/SummaryBar.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../../src/components/panels/WeatherPanel.tsx", import.meta.url), "utf8");
  ck("the bar's station keeps its identity while the station is the same",
     /const station = useMemo\(\(\) => found, \[stationKey\]\);/.test(bar));
  ck("the history fetch is keyed by the sensors' ids and the range, not the station object",
     /useHistory<WeatherHistory>\(\s*`\$\{ids\.join\("\|"\)\}#\$\{rainId \?\? ""\}\|\$\{range\.hours\}`/.test(panel) && !/\], \[station\]\);/.test(panel));
  const spark = readFileSync(new URL("../../src/components/panels/Sparkline.tsx", import.meta.url), "utf8");
  ck("one reading over a known window is a line (0 mm all day), not 'not enough history'",
     /data\.length === 0 \|\| \(data\.length < 2 && !\(window && window\.to > window\.from\)\)/.test(spark));
}

if (fail) { console.log(`  ${fail} FAILED`); process.exit(1); }
console.log("  all passed");
