// A binary sensor reads in its class's words on EVERY surface — the row text,
// "Also on this device", the badge, the panel's pill (owner, 2026-10-05:
// "Kitchen leak2 Battery" read "Off" where Home Assistant says "Normal").
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { deviceRowText, formatSensorValue } = await import("@/utils/entityValue");
const { binaryWord, BINARY_WORDS } = await import("@/config/binarySensorWords");

const E = (id, state, dc, unit) => ({ entity_id: id, state, attributes: { device_class: dc, unit_of_measurement: unit } });
const row = (e) => deviceRowText(e, e.entity_id.split(".")[0]);
ck("a battery binary sensor: Normal / Low, as Home Assistant says", row(E("binary_sensor.leak_battery", "off", "battery")) === "Normal"
   && row(E("binary_sensor.leak_battery", "on", "battery")) === "Low");
ck("tamper, moisture, door read their own words", row(E("binary_sensor.t", "off", "tamper")) === "Clear"
   && row(E("binary_sensor.m", "on", "moisture")) === "Leak detected" && row(E("binary_sensor.d", "on", "door")) === "Open");
ck("a binary sensor with no class still reads On / Off", row(E("binary_sensor.x", "off")) === "Off");
ck("unknown is not 'Normal' either (only on and off take the class's words)", binaryWord("binary_sensor.b", "battery", "unknown") === null
   && row(E("binary_sensor.leak_battery", "unknown", "battery")) !== "Normal");
ck("unavailable stays Unavailable, never 'Normal'", row(E("binary_sensor.leak_battery", "unavailable", "battery")) === "Unavailable");
ck("a switch's off and a numeric battery are untouched", row(E("switch.pump", "off")) === "Off"
   && /^100\s?%$/.test(formatSensorValue(E("sensor.leak_battery", "100", "battery", "%"))), formatSensorValue(E("sensor.leak_battery", "100", "battery", "%")));
const cls = readFileSync(new URL("../../src/config/BinarySensorClasses.ts", import.meta.url), "utf8");
ck("the panel's class table holds no words at all (binarySensorWords is the one copy)",
   !/onLabel|offLabel/.test(cls));
ck("every class has two words", Object.values(BINARY_WORDS).every((w) => w.length === 2 && w[0] && w[1]) && binaryWord("sensor.x", "battery", "off") === null);
const picker = readFileSync(new URL("../../src/components/settings/EntityPicker.tsx", import.meta.url), "utf8");
ck("Settings' entity search words its states the same way", /deviceRowText\(e, domainOf\(e\.entity_id\)\)/.test(picker) && !/>\{e\.state\}</.test(picker));
done("✅ a binary sensor reads in its class's words everywhere");
