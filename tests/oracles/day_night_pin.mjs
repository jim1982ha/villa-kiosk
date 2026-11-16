// SETTINGS' VILLA LIGHTING PINS A WHOLE SIDE OF THE HORIZON (owner, 2026-11-16: Night set at sunset, the villa stayed in
// daylight): Night is the full night look and Day a clear day at every hour, sunset and dawn included; Auto follows the sun.
import { ck, done } from "../consistency/check.mjs";
const { skyMoment } = await import("@/babylon/skyMoment");
const { getSunPosition } = await import("@/utils/sunCalc");

const place = { latitude: -8.65, longitude: 115.14, northOffsetDeg: 0 };
const hours = [];
for (let m = 0; m < 24 * 60; m += 10) hours.push(new Date(Date.UTC(2026, 10, 16, 0, m)));
const atHorizon = hours.reduce((b, d) => Math.abs(getSunPosition(d, place.latitude, place.longitude).altitude)
  < Math.abs(getSunPosition(b, place.latitude, place.longitude).altitude) ? d : b);

const night = hours.map((d) => skyMoment(d, place, "night").light);
ck("Night: the whole night look at every hour of the day", night.every((l) => !l.isDay && l.nightT === 1),
   night.filter((l) => l.nightT !== 1).length);
const day = hours.map((d) => skyMoment(d, place, "day"));
ck("Day: a clear day at every hour (the sun at least 15° up)", day.every((m) => m.light.isDay && m.altitude >= (15 * Math.PI) / 180 - 1e-9));
ck("  ...at the moment the real sun is on the horizon too",
   skyMoment(atHorizon, place, "night").light.nightT === 1 && skyMoment(atHorizon, place, "day").light.isDay);
const auto = skyMoment(atHorizon, place, "auto");
ck("Auto follows the real sun", auto.altitude === auto.realAltitude);
done();
