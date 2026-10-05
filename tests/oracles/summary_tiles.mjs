// The bottom bar's tiles (config/summaryTiles.ts), called by value — they
// lived in SummaryBar.tsx until 2.496.232, where five oracles could only
// match their source text.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { deriveTiles } = await import("@/config/summaryTiles");

const e = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });
const entities = {
  "lock.front": e("lock.front", "locked"), "lock.back": e("lock.back", "unlocked"),
  "light.a": e("light.a", "on"), "light.b": e("light.b", "off"),
  "climate.x": e("climate.x", "cool", { current_temperature: 23 }),
  "sensor.power": e("sensor.power", "3000", { unit_of_measurement: "W", device_class: "power" }),
  "sensor.out_t": e("sensor.out_t", "29.4", { unit_of_measurement: "°C", device_class: "temperature" }),
};
const entityMap = {};
const everything = () => true;
const noEnergy = (c) => c !== "energy";
const station = { roles: { temperature: "sensor.out_t" }, entityIds: ["sensor.out_t"] };
const tiles = (can = everything, st = null, ents = entities, unit = "°C") => deriveTiles(ents, entityMap, {}, can, {}, st, undefined, unit);
const byKind = (ts) => Object.fromEntries(ts.map((t) => [t.kind, t]));

console.log("  what each tile says:");
{
  const t = byKind(tiles(everything, station));
  ck("locks: the one number that matters — how many are open", t.locks?.value === "1 Unlocked" && t.locks.tone === "warn", t.locks?.value);
  ck("lights: the shared phrasing", t.lights?.value === "1 On" && t.lights.tone === "on", t.lights?.value);
  ck("AC: the running units' current temperature, in HA's unit (no assumed Celsius)",
     t.climate?.value.includes("23") && byKind(tiles(everything, null, entities, "°F")).climate.value.includes("°F"), t.climate?.value);
  ck("energy: 3000 W reads 3 kW", t.energy?.value === "3 kW", t.energy?.value);
  ck("weather: from the station, and only with one", t.weather?.value.startsWith("29") && !byKind(tiles()).weather);
  const allLocked = byKind(tiles(everything, null, { ...entities, "lock.back": e("lock.back", "locked") }));
  ck("every lock locked: \"Locked\", quiet", allLocked.locks.value === "Locked" && allLocked.locks.tone === "neutral");
  const lost = byKind(tiles(everything, null, { ...entities, "lock.back": e("lock.back", "unavailable") }));
  ck("a lost lock is \"Unknown\", never counted as unlocked", lost.locks.value === "1 Unknown", lost.locks.value);
}

console.log("\n  what a profile gets:");
{
  ck("a profile that may not see energy gets NO energy tile (and so no Energy window)", !byKind(tiles(noEnergy)).energy);
  ck("a profile's control rights follow its categories", byKind(tiles((c) => c !== "light")).lights.canControl === false);
}

console.log("\n  what a tap opens:");
{
  const t = byKind(tiles(everything, station));
  ck("every tile says what it opens (weather and energy open their windows)",
     Object.keys(t).sort().join() === "climate,energy,lights,locks,weather", Object.keys(t).join());
  ck("read-only tiles offer no control", t.weather.canControl === false && t.energy.canControl === false);
}

done("✅ the bar's tiles, called rather than read");
