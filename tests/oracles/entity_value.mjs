import { formatSensorParts, formatSensorValue, formatUnitValue, prettyState, compactValue,
  VALUE_CAPABLE_TYPES } from "../../src/utils/entityValue.ts";
import { readFileSync } from "node:fs";

const E = (state, unit, attrs = {}) => ({
  entity_id: "sensor.x", state: String(state),
  attributes: { ...(unit ? { unit_of_measurement: unit } : {}), ...attrs },
});
let fail = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};

console.log("  the reading that started this — 6570.989 W:");
eq("badge  (clamp+hideNominal)", compactValue("sensor", E(6570.989, "W")), "6.6 kW");
eq("panel  (no flags), value", formatSensorParts(E(6570.989, "W")).value, "6.6");
eq("panel  (no flags), unit",  formatSensorParts(E(6570.989, "W")).unit,  "kW");
eq("SummaryBar Energy tile", formatUnitValue(6570.989, "W"), "6.6 kW");
console.log("  => badge and panel now spell the same reading the same way\n");

console.log("  scaling and hugging units:");
eq("999 W stays watts",        formatSensorValue(E(999, "W")),      "999 W");
eq("1000 W becomes kW",        formatSensorValue(E(1000, "W")),     "1 kW");
eq("3000 W drops the zero",    formatUnitValue(3000, "W"),          "3 kW");
eq("Wh scales",                formatSensorValue(E(2500, "Wh")),    "2.5 kWh");
eq("percent hugs",             formatSensorValue(E(62.4, "%")),     "62%");
eq("degrees hug",              formatSensorValue(E(25.05, "°C")),   "25.1°C");
eq("lux reads whole",          formatSensorValue(E(431.7, "lx")),   "432 lx");
eq("negative power scales",    formatSensorValue(E(-2400, "W")),    "-2.4 kW");

console.log("\n  enum / text states:");
eq("not_home",                 prettyState("not_home"),             "Not home");
eq("leading underscore",       prettyState("_odd_state"),           "Odd state");
eq("badge hides a nominal",    compactValue("sensor", E("connected", "")), "");
eq("panel SHOWS the nominal",  formatSensorValue(E("connected", "")), "Connected");
eq("a non-nominal is shown on both",
   compactValue("sensor", E("wet", "")), "Wet");

console.log("\n  unavailable:");
eq("unavailable → empty",      formatSensorValue(E("unavailable", "W")), "");
eq("unknown → empty",          formatSensorValue(E("unknown", "W")),     "");

console.log("\n  the clamp is the badge's alone:");
const long = E("a_very_long_status_indeed_truly", "");
eq("badge clamps to 16",       compactValue("sensor", long).length <= 16, true);
eq("panel does not clamp",     formatSensorValue(long).length > 16, true);

console.log("\n  other domains the badge reads by attribute:");
eq("light brightness",  compactValue("light",   E("on",  "", { brightness: 128 })), "50%");
eq("cover position",    compactValue("cover",   E("open","", { current_position: 40 })), "40%");
eq("climate current",   compactValue("climate", E("heat","", { current_temperature: 21.6 })), "22°");

// ---------------------------------------------------------------------------
// ⚠️ EVERYTHING BELOW IS WHAT MADE THIS FILE LOAD-BEARING.
//
// For the whole time the assertions above were green, `compactValue` had NO
// production caller: the badge called a byte-identical PRIVATE copy inside
// EntityVisuals, and the export existed only for this oracle to read. A
// change to the text the screen actually draws could not have failed a line
// of it. These pins are what stop that coming back.
// ---------------------------------------------------------------------------
const EV = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");

console.log("\n  the badge reads THIS function, not a copy of it:");
eq("EntityVisuals imports compactValue",
   /import \{[^}]*\bcompactValue\b[^}]*\} from "@\/utils\/entityValue"/.test(EV), true);
eq("EntityVisuals declares no compactValue of its own",
   /(private|function|const)\s+compactValue\b/.test(EV), false);
eq("...and calls it as a free function, never as a method",
   /this\.compactValue\(/.test(EV), false);
eq("the badge has call sites for it",
   (EV.match(/(?<!\.)\bcompactValue\(/g) ?? []).length >= 2, true);

console.log("\n  the capability set agrees with the switch it describes:");
// Read the `case "x":` labels straight out of compactValue's body, so adding a
// domain to the switch and forgetting the set fails HERE rather than on the
// wall, where it shows as a value drawn into clearance nobody reserved.
const SRC = readFileSync(new URL("../../src/utils/entityValue.ts", import.meta.url), "utf8");
const body = SRC.slice(SRC.indexOf("export function compactValue"));
const cases = [...body.slice(0, body.indexOf("\n}")).matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]);
eq("the switch was found at all", cases.length >= 5, true);
for (const c of cases) eq(`case "${c}" is declared value-capable`, VALUE_CAPABLE_TYPES.has(c), true);
eq("and the set claims nothing the switch cannot serve",
   [...VALUE_CAPABLE_TYPES].every((t) => cases.includes(t)), true);
eq("no second copy of the set survives in the badge",
   /new Set<EntityType>\(\["light"/.test(EV), false);

process.exit(fail ? 1 : 0);
