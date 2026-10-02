// A state reads the same on every surface (2.496.252).
//
// The Cockpit's activity feed worded states by hand: any binary state but "on"
// took the OFF word, so a leak sensor that went OFFLINE read "No leak", and the
// rest was capitalised by hand ("not_home" → "Not_home"). Chart tooltips printed
// the raw number and unit ("6571W") beside a badge reading "6.6 kW". Both now
// ask the shared rules; this drives the feed by value and pins the tooltips'
// rule, the way one_reading_rule.mjs pins the badge's and the rows'.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { describeLogbookEntry } = await import("@/components/cockpit/cockpitData");
const { formatUnitValue } = await import("@/utils/entityValue");

const ent = (id, dc) => ({ entity_id: id, state: "x", attributes: dc ? { device_class: dc, friendly_name: id } : { friendly_name: id } });
const entities = { "binary_sensor.leak": ent("binary_sensor.leak", "moisture"), "person.guest": ent("person.guest") };
const say = (id, state) => describeLogbookEntry({ when: 1_790_000_000, entity_id: id, state }, entities, {})?.message;

console.log("  the activity feed:");
ck("a leak sensor that goes OFFLINE reads 'Unavailable' — never 'No leak'", say("binary_sensor.leak", "unavailable") === "Unavailable", say("binary_sensor.leak", "unavailable"));
ck("  ...a real leak reads as the sensor's class says it", say("binary_sensor.leak", "on") === "Leak detected");
ck("  ...and dry reads 'No leak'", say("binary_sensor.leak", "off") === "No leak");
ck("an enum state is tidied the shared way: 'not_home' → 'Not home'", say("person.guest", "not_home") === "Not home", say("person.guest", "not_home"));

console.log("\n  chart tooltips:");
ck("the shared rule reads 6570.989 W as the badge does", formatUnitValue(6570.989, "W") === "6.6 kW");
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
ck("the line chart's tooltip prints a reading through formatUnitValue, not the raw unit after the number",
   /formatUnitValue\(r\.v, l\.unit\.trim\(\)\)/.test(src("components/panels/LineChart.tsx"))
   && !/fmtChartValue\(r\.v\)\}\$\{l\.unit/.test(src("components/panels/LineChart.tsx")));
ck("  ...and so does the weather chart's", /formatUnitValue\(v, unit\)/.test(src("components/panels/WeatherPanel.tsx")));
ck("the feed hand-words nothing: no on/off branch, no hand capitalisation",
   !/raw\.state === "on" \? info\.onLabel/.test(src("components/cockpit/cockpitData.ts"))
   && !/raw\.state\.charAt\(0\)\.toUpperCase\(\)/.test(src("components/cockpit/cockpitData.ts")));

done("✅ a state reads the same on every surface");
