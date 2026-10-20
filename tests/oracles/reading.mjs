// A sensor's reading, the same in every window (config/reading, 2.496.305).
//
// The sensor window, the grouped device window and "Also on this device" each
// assembled a reading from the same pieces, differently: the grouped window
// coloured its rows its own way and dropped a detector's alarm capitals and icon.
// This drives the one answer by value, and pins that every window asks it and
// none assembles its own.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { readingOf, rowTone, historyOf } = await import("@/config/reading");
const { readingRows } = await import("@/config/readingRows");

const ent = (id, state, attributes = {}) => ({ entity_id: id, state, attributes, last_changed: "", last_updated: "" });

console.log("  on/off sensors");
{
  const ok = readingOf("binary_sensor.leak", ent("binary_sensor.leak", "off", { device_class: "moisture" }), "binary_sensor");
  const wet = readingOf("binary_sensor.leak", ent("binary_sensor.leak", "on", { device_class: "moisture" }), "binary_sensor");
  ck("a dry leak sensor: a green pill saying 'No leak', no alarm", ok.pill === "on" && ok.value === "No leak" && !ok.alarm && ok.level === "normal");
  ck("  ...a leak: a red pill SHOUTING 'LEAK DETECTED', with the warning icon", wet.pill === "danger" && wet.value === "LEAK DETECTED" && wet.alarm && wet.level === "danger");
  ck("  ...its history bar colours each state as its window does", wet.stateColor("on") !== wet.stateColor("off"));
  const gone = readingOf("binary_sensor.leak", ent("binary_sensor.leak", "unavailable", { device_class: "moisture" }), "binary_sensor");
  ck("offline wins: 'UNAVAILABLE' in an amber pill — never 'No leak', a reading never taken", gone.pill === "unavailable" && gone.value === "UNAVAILABLE" && gone.alarm);
  const pir = readingOf("binary_sensor.hall", ent("binary_sensor.hall", "on", { device_class: "motion" }), "binary_sensor");
  ck("a motion sensor seeing someone is not an alarm (its class colours it, it raises nothing)", pir.level === "normal" && !pir.alarm && pir.value === "Motion detected");
  // ⚠️ UNKNOWN IS NOT LOST CONTACT (owner, 2026-10-18; architecture review 2026-10-19): the window shouted UNAVAILABLE,
  // amber, with the warning icon, for a sensor whose device was answering with nothing to say
  const blank = readingOf("binary_sensor.leak", ent("binary_sensor.leak", "unknown", { device_class: "moisture" }), "binary_sensor");
  ck("no value ('unknown'): 'UNKNOWN' in the quiet pill — not 'UNAVAILABLE', not an alarm, contact kept",
     blank.value === "UNKNOWN" && blank.pill === "off" && !blank.alarm && blank.contact === "no-value" && blank.unavailable
     && gone.contact === "lost" && ok.contact === "ok", blank);
}

console.log("\n  measurements");
{
  const at = (v) => readingOf("sensor.cellar_temp", ent("sensor.cellar_temp", String(v), { unit_of_measurement: "°C", device_class: "temperature" }), "sensor");
  const hot = at(60), fine = at(20);
  ck("a measurement is never an alarm, whatever its value: normal, green", [hot, fine].every((m) => m.level === "normal" && m.color === "var(--status-on)" && !m.alarm && m.pill === null));
  ck("  ...the number and its unit, as the badge writes them (a temperature as one piece, 20°C)", (fine.value + fine.unit) === "20°C");
  const kw = readingOf("sensor.pump_power", ent("sensor.pump_power", "6570.989", { unit_of_measurement: "W", device_class: "power" }), "sensor");
  ck("  ...scaled as the badge does (6570.989 W reads in kW)", /kW/.test(kw.unit));
  const off = readingOf("sensor.cellar_temp", ent("sensor.cellar_temp", "unavailable", { unit_of_measurement: "°C" }), "sensor");
  ck("offline: still a measurement (its chart shades the outage), shown as an amber pill", off.kind === "measurement" && off.pill === "unavailable" && off.value === "UNAVAILABLE" && off.seriesColor === "var(--status-on)");
  const ap = readingOf("sensor.ap", ent("sensor.ap", "connected"), "sensor");
  ck("a sensor whose state is words: text, never coloured by a level", ap.kind === "text" && ap.pill === null && ap.color === "var(--text-primary)");
  const blank = readingOf("sensor.cellar_temp", ent("sensor.cellar_temp", "unknown", { unit_of_measurement: "°C" }), "sensor");
  ck("no value ('unknown'): 'UNKNOWN', quiet, plain, no alarm — the device is answering (owner, 2026-10-18)",
     blank.value === "UNKNOWN" && blank.pill === "off" && !blank.alarm && blank.color === "var(--text-primary)" && blank.contact === "no-value", blank);
  ck("  ...no entity at all is lost contact, as before", readingOf("sensor.gone", undefined, "sensor").contact === "lost");
}

console.log("\n  the device window's lost-contact notice and its linked row");
{
  // The notice ("Contact with this device is lost…") replaces a window's controls only for LOST contact
  // (stateColors.isOffline: "unavailable" or no entity) — an "unknown" device keeps its controls. Pinned on the
  // panels' source: UnavailableNotice and ControlFrame read the live store (useHA), which needs a browser to build.
  const { isOffline } = await import("@/utils/stateColors");
  ck("isOffline decides the notice: lost for 'unavailable' and a missing entity, not for 'unknown'",
     isOffline(ent("switch.x", "unavailable")) && isOffline(undefined) && !isOffline(ent("switch.x", "unknown")) && !isOffline(ent("switch.x", "on")));
  const src = (p) => readFileSync(new URL(`../../src/components/panels/${p}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const PANELS = ["ControlFrame.tsx", "GenericPanel.tsx"];
  ck("the control frame and the generic window show the notice on isOffline, never on isUnavailable",
     PANELS.every((p) => /isOffline\(entity\)[\s\S]*<UnavailableNotice/.test(src(p)) && !/isUnavailable/.test(src(p))),
     PANELS.filter((p) => !/isOffline\(entity\)/.test(src(p)) || /isUnavailable/.test(src(p))));
  ck("  ...and the grouped window only when every member's contact is lost",
     /rows\.every\(\(r\) => r\.reading\.contact === "lost"\)/.test(src("DeviceGroupPanel.tsx")));
  const { linkedStateWords } = await import("@/components/panels/panelHeader");
  const w = (contact, known = true, isOn = false) => linkedStateWords({ isOn, known, contact });
  ck("the linked row: 'Unavailable' only when contact is lost, 'Unknown' for no value (or a lock in motion), else On / Off",
     w("lost") === "Unavailable" && w("no-value") === "Unknown" && w("ok", false) === "Unknown" && w("ok", true, true) === "On" && w("ok") === "Off");
  ck("  ...and the window prints that word", /\{linkedStateWords\(linked\)\} · linked entity/.test(src("BasePanel.tsx")));
}

console.log("\n  the rows of 'Also on this device'");
{
  const E = {
    "sensor.cellar_temp": ent("sensor.cellar_temp", "30", { unit_of_measurement: "°C" }),
    "sensor.cellar_humidity": ent("sensor.cellar_humidity", "55", { unit_of_measurement: "%" }),
    "binary_sensor.det_smoke": ent("binary_sensor.det_smoke", "on", { device_class: "smoke" }),
  };
  const rows = Object.fromEntries(readingRows(Object.keys(E), E, {}).map((r) => [r.id, r]));
  ck("a measurement keeps the row's quiet colour", rows["sensor.cellar_temp"].tone === undefined && rows["sensor.cellar_humidity"].tone === undefined);
  ck("  ...a binary row takes its pill's tone", rows["binary_sensor.det_smoke"].tone === "danger");
  ck("rowTone: the pill's tone", rowTone(readingOf("x", ent("sensor.x", "unavailable", { unit_of_measurement: "W" }), "sensor")) === "unavailable");
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
     /historyOf\(r\)/.test(src("components/panels/ReadingHistory.tsx")) && /<ReadingHistory /.test(src("components/panels/SensorPanel.tsx")) && /historyOf\(r\.reading\) !== "numbers"/.test(g) && /LastDayTimeline entityId=\{r\.id\} legend/.test(g)
     && !/stateColor\)\.map/.test(g));
  ck("both windows draw a pill through ReadingPill", ["SensorPanel", "DeviceGroupPanel"].every((f) => /<ReadingPill /.test(src(`components/panels/${f}.tsx`)) && !/className=\{`status-pill/.test(src(`components/panels/${f}.tsx`))));
}
console.log("\n  an unknown stretch in a history bar (owner, 2026-10-19)");
{
  // ⚠️ "UNKNOWN" WAS PAINTED AS CONTACT LOST (to 2.496.427): every history bar drew an unknown stretch in the amber the
  // legend calls "Contact lost", under a quiet badge, and a lock reporting "unknown" wore an amber pill. Unknown is a
  // device answering with no value (stateColors.contactOf "no-value"): the quiet idle colour, the quiet pill.
  const { chartColours, lockPill } = await import("@/config/reading");
  const { STATUS_COLOR } = await import("@/utils/stateColors");
  const paint = chartColours(() => "green");
  ck("an unknown stretch is not the lost colour; an unavailable one is",
     paint("unknown") !== STATUS_COLOR.unavailable && paint("unavailable") === STATUS_COLOR.unavailable, [paint("unknown"), paint("unavailable")]);
  ck("  ...an unknown stretch is the idle colour, whatever the window's own colouring says", paint("unknown") === STATUS_COLOR.idle);
  ck("a lock reporting 'unknown' wears the quiet pill; a lost lock (or none at all) the amber one",
     lockPill("lock.x", "unknown").tone === "off" && lockPill("lock.x", "unavailable").tone === "unavailable" && lockPill("lock.x", undefined).tone === "unavailable");
}
done("✅ a reading is one answer in every window");
