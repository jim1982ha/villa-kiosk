// A sensor's reading, the same in every window (config/reading, 2.496.305).
//
// The sensor window, the grouped device window and "Also on this device" each
// assembled a reading from the same pieces, differently: the grouped window
// never asked for the owner's thresholds (a temperature over its limit red
// alone, plain in its group) and dropped a detector's alarm capitals and icon.
// This drives the one answer by value, and pins that every window asks it and
// none assembles its own.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { readingOf, rowTone, historyOf } = await import("@/config/reading");
const { readingRows } = await import("@/config/readingRows");

const ent = (id, state, attributes = {}) => ({ entity_id: id, state, attributes, last_changed: "", last_updated: "" });
const T = { "sensor.cellar_temp": { max: 28 }, "binary_sensor.hall": { alertState: "on" } };

console.log("  on/off sensors");
{
  const ok = readingOf("binary_sensor.leak", ent("binary_sensor.leak", "off", { device_class: "moisture" }), "binary_sensor", T);
  const wet = readingOf("binary_sensor.leak", ent("binary_sensor.leak", "on", { device_class: "moisture" }), "binary_sensor", T);
  ck("a dry leak sensor: a green pill saying 'No leak', no alarm", ok.pill === "on" && ok.value === "No leak" && !ok.alarm && ok.level === "normal");
  ck("  ...a leak: a red pill SHOUTING 'LEAK DETECTED', with the warning icon", wet.pill === "danger" && wet.value === "LEAK DETECTED" && wet.alarm && wet.level === "danger");
  ck("  ...its history bar colours each state as its window does", wet.stateColor("on") !== wet.stateColor("off"));
  const gone = readingOf("binary_sensor.leak", ent("binary_sensor.leak", "unavailable", { device_class: "moisture" }), "binary_sensor", T);
  ck("offline wins: 'UNAVAILABLE' in an amber pill — never 'No leak', a reading never taken", gone.pill === "unavailable" && gone.value === "UNAVAILABLE" && gone.alarm);
  const pir = readingOf("binary_sensor.hall", ent("binary_sensor.hall", "on", { device_class: "motion" }), "binary_sensor", T);
  ck("the owner's alert state makes a motion sensor an alarm", pir.level === "danger" && pir.alarm && pir.pill === "danger");
}

console.log("\n  measurements");
{
  const at = (v) => readingOf("sensor.cellar_temp", ent("sensor.cellar_temp", String(v), { unit_of_measurement: "°C", device_class: "temperature" }), "sensor", T);
  const hot = at(30), near = at(27), fine = at(20);
  ck("over the owner's limit: danger, coloured red, an alarm", hot.level === "danger" && hot.color === "var(--status-danger)" && hot.alarm && hot.pill === null);
  ck("  ...within 10 % of it: a warning, amber", near.level === "warning" && near.color === "var(--status-warning)" && !near.alarm);
  ck("  ...comfortably inside: normal, green", fine.level === "normal" && fine.color === "var(--status-on)");
  ck("  ...the number and its unit, as the badge writes them (a temperature as one piece, 20°C)", (fine.value + fine.unit) === "20°C");
  const kw = readingOf("sensor.pump_power", ent("sensor.pump_power", "6570.989", { unit_of_measurement: "W", device_class: "power" }), "sensor", {});
  ck("  ...scaled as the badge does (6570.989 W reads in kW)", /kW/.test(kw.unit));
  const off = readingOf("sensor.cellar_temp", ent("sensor.cellar_temp", "unavailable", { unit_of_measurement: "°C" }), "sensor", T);
  ck("offline: still a measurement (its chart shades the outage), shown as an amber pill", off.kind === "measurement" && off.pill === "unavailable" && off.value === "UNAVAILABLE" && off.seriesColor === "var(--status-on)");
  const ap = readingOf("sensor.ap", ent("sensor.ap", "connected"), "sensor", {});
  ck("a sensor whose state is words: text, never coloured by a level", ap.kind === "text" && ap.pill === null && ap.color === "var(--text-primary)");
}

console.log("\n  the rows of 'Also on this device'");
{
  const E = {
    "sensor.cellar_temp": ent("sensor.cellar_temp", "30", { unit_of_measurement: "°C" }),
    "sensor.cellar_humidity": ent("sensor.cellar_humidity", "55", { unit_of_measurement: "%" }),
    "binary_sensor.det_smoke": ent("binary_sensor.det_smoke", "on", { device_class: "smoke" }),
  };
  const rows = Object.fromEntries(readingRows(Object.keys(E), E, {}, T).map((r) => [r.id, r]));
  ck("a measurement past the owner's limit is red in the list too (it was plain)", rows["sensor.cellar_temp"].tone === "danger");
  ck("  ...a normal one keeps the row's quiet colour", rows["sensor.cellar_humidity"].tone === undefined);
  ck("  ...a binary row takes its pill's tone", rows["binary_sensor.det_smoke"].tone === "danger");
  ck("rowTone: the pill first, then an out-of-bounds level", rowTone(readingOf("x", ent("sensor.x", "unavailable", { unit_of_measurement: "W" }), "sensor", {})) === "unavailable");
}

console.log("\n  every window asks it, and none assembles its own");
{
  const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
  for (const [name, file] of [["the sensor window", "components/panels/SensorPanel.tsx"], ["the grouped device window", "components/panels/DeviceGroupPanel.tsx"], ["the rows", "config/readingRows.ts"]]) {
    const t = src(file);
    ck(`${name} asks readingOf, and imports none of the pieces it replaces`,
       /readingOf\(/.test(t) && !/from "@\/config\/(binaryLook|sensorReading)"|from "\.\/(binaryLook|sensorReading)"|formatSensorParts/.test(t));
  }
}
console.log("\n  which history goes under it (architecture review 11)");
{
  const of = (id, state, attrs, type) => historyOf(readingOf(id, ent(id, state, attrs), type, {}));
  ck("an on/off sensor: its states", of("binary_sensor.leak", "on", { device_class: "moisture" }, "binary_sensor") === "states");
  ck("a words sensor ('connected'): its words, never a numeric chart that drops every row", of("sensor.ap", "connected", {}, "sensor") === "words");
  ck("a measurement: its numbers", of("sensor.t", "21.4", { unit_of_measurement: "°C" }, "sensor") === "numbers");
  ck("  ...offline too — its chart shades the outage", of("sensor.t", "unavailable", { unit_of_measurement: "°C" }, "sensor") === "numbers");
  const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
  const g = src("components/panels/DeviceGroupPanel.tsx");
  ck("both windows choose by historyOf, and the group draws a words member's timeline (the caller)",
     /historyOf\(r\)/.test(src("components/panels/SensorPanel.tsx")) && /historyOf\(r\.reading\) !== "numbers"/.test(g) && /LastDayTimeline entityId=\{r\.id\} legend/.test(g)
     && !/stateColor\)\.map/.test(g));
  ck("both windows draw a pill through ReadingPill", ["SensorPanel", "DeviceGroupPanel"].every((f) => /<ReadingPill /.test(src(`components/panels/${f}.tsx`)) && !/className=\{`status-pill/.test(src(`components/panels/${f}.tsx`))));
}
done("✅ a reading is one answer in every window");
