// One way to write a number with its unit, and one unit per screen (architecture review 11, 2026-10-09).
//
// ⚠️ THE SAME POWER WAS WRITTEN TWO WAYS: the top bar's tile said "3 kW", the Energy flow "3.00 kW" (3,456 W:
// "3.5 kW" vs "3.46 kW"), because energyModel kept a fourth copy of "W or kW". And on a °F weather station the live
// tiles were converted to °C while today's range and the history were not — both printed with a bare "°".
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { formatUnitValue, formatUnitParts } = await import("@/utils/entityValue");
const { fmtPower, fmtKwh } = await import("@/config/energyModel");
const { celsiusSeries, toCelsius, TEMPERATURE_ROLES } = await import("@/config/weatherStation");

console.log("  a power: the Energy window writes it as every badge and tile does");
const powers = [0.0004, 0.948, 0.9995, 1, 3, 3.456, 12.34, -0.5];
const powerDiffs = powers.filter((kw) => fmtPower(kw) !== formatUnitValue(kw * 1000, "W"));
ck("every power reads the same on the Energy window and on a badge", powerDiffs.length === 0, powerDiffs.map((kw) => [kw, fmtPower(kw), formatUnitValue(kw * 1000, "W")]));
ck("  ...3,000 W is \"3 kW\", never \"3.00 kW\"", fmtPower(3) === "3 kW", fmtPower(3));

console.log("\n  an energy: one rule, small days kept");
const kwhs = [0.05, 0.004, 3.456, 12.34, 123.4, 2];
const kwhDiffs = kwhs.filter((v) => fmtKwh(v) !== formatUnitParts(v, "kWh").value);
ck("every energy reads the same on the Energy window and on a badge", kwhDiffs.length === 0, kwhDiffs);
ck("  ...a 0.05 kWh day is 0.05, not 0.1; 3.456 is 3.46; 123.4 is 123", fmtKwh(0.05) === "0.05" && fmtKwh(3.456) === "3.46" && fmtKwh(123.4) === "123");
ck("  ...a meter in Wh past 1,000 follows the same rule", formatUnitValue(3456, "Wh") === "3.46 kWh", formatUnitValue(3456, "Wh"));

console.log("\n  a temperature: one unit on the Weather screen");
const s = { points: [{ t: 1, v: 68 }, { t: 2, v: 77 }], gaps: [], window: { from: 0, to: 3 } };
const c = celsiusSeries(s, "°F");
ck("a °F history is turned to °C, as the live readings are", Math.abs(c.points[0].v - 20) < 1e-9 && Math.abs(c.points[1].v - 25) < 1e-9 && c.points[0].v === toCelsius(68, "°F"));
ck("  ...a °C history is passed through untouched", celsiusSeries(s, "°C") === s);
ck("  ...every temperature role is converted (outside, feels, dew, inside, inside dew)", ["temperature", "feelsLike", "dewPoint", "indoorTemperature", "indoorDewPoint"].every((r) => TEMPERATURE_ROLES.has(r)) && !TEMPERATURE_ROLES.has("humidity"));
const wp = readFileSync(new URL("../../src/components/panels/WeatherPanel.tsx", import.meta.url), "utf8");
ck("the Weather screen converts its history and today's range (the caller, not just the helper)",
   /TEMPERATURE_ROLES\.has\(role\) \? celsiusSeries\(s,/.test(wp) && (wp.match(/seriesExtent\(celsiusSeries\(/g) || []).length === 2);

done("✅ a number is written one way, in one unit per screen");
