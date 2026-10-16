// The lists read their words from config/reading, and say exactly what they
// said before (architecture review 2026-10-16, step 1).
//
// The device lists (SummaryGroupPanel), "Also on this device" (readingRows),
// the Cockpit's alarm line (attention) and Recent activity (cockpitData) each
// reached past config/reading into entityValue.deviceRowText and
// BinarySensorClasses.stateLabelFor. They now ask reading's rowText,
// alarmText and stateWords. NOTHING VISIBLE WAS TO CHANGE, so this drives a
// broad set of entities — every binary class, locks, covers, climates,
// measurements in every unit the formatter knows, words, offline — through
// the new path AND through the old helpers, on the same inputs, and asks for
// the same words; then pins that each surface calls reading and nothing lower.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { rowText, alarmText, stateWords } = await import("@/config/reading");
const { readingRows } = await import("@/config/readingRows");
const { buildAttentionItems } = await import("@/config/attention");
const { describeLogbookEntry } = await import("@/components/cockpit/cockpitData");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { BINARY_WORDS } = await import("@/config/binarySensorWords");
// THE OLD PATH — what each surface called until this release.
const { deviceRowText } = await import("@/utils/entityValue");
const { stateLabelFor } = await import("@/config/BinarySensorClasses");
const domainOf = (id) => id.split(".")[0];
const oldRow = (id, e) => deviceRowText(e, domainOf(id));
const oldAlarm = (id, e) => domainOf(id) === "binary_sensor"
  ? stateLabelFor(id, e.attributes.device_class)(e.state)
  : deviceRowText(e, domainOf(id));
const oldActivity = (id, e, state) => stateLabelFor(id, e?.attributes.device_class)(state);

// ── the fixtures ──────────────────────────────────────────────────────────
const E = {};
const add = (id, state, attributes = {}) => { E[id] = { entity_id: id, state, attributes, last_changed: "", last_updated: "" }; };
const OFFLINE = ["unavailable", "unknown", ""];
for (const dc of [...Object.keys(BINARY_WORDS), "not_a_class", undefined])
  for (const s of ["on", "off", ...OFFLINE]) add(`binary_sensor.${dc ?? "bare"}_${s || "blank"}`, s, dc ? { device_class: dc } : {});
for (const s of ["locked", "unlocked", "jammed", "locking", "unlocking", "open", "opening", ...OFFLINE]) add(`lock.l_${s || "blank"}`, s);
for (const [s, pos] of [["open", 100], ["closed", 0], ["opening", 40], ["closing", 60], ["stopped", 37.4], ["open", undefined], ...OFFLINE.map((o) => [o, undefined])])
  add(`cover.c_${s || "blank"}_${pos ?? "x"}`, s, pos == null ? {} : { current_position: pos });
for (const [s, cur, tgt] of [["heat", 24.4, 22], ["cool", 26.6, 21.5], ["heat", null, 22], ["off", 19.2, null], ["off", null, null], ["heat", 21.5, 21.5], ["unavailable", 20, 21], ["unknown", null, null]])
  add(`climate.c_${s}_${cur}_${tgt}`, s, { current_temperature: cur, temperature: tgt, unit_of_measurement: "°C" });
const NUMBERS = ["0", "-3.25", "7", "21.45", "999.9", "1000", "6570.989", "123456.7"];
for (const [u, unit] of ["W", "kW", "Wh", "kWh", "VA", "%", "°C", "°F", "°", "lx", "ppm", "ppb", "V", "A", "dB", "", " W "].entries())
  for (const s of [...NUMBERS, ...OFFLINE]) add(`sensor.unit${u}_${s || "blank"}`, s, unit === "" ? {} : { unit_of_measurement: unit });
for (const s of ["connected", "not_home", "_odd_start", "fault", "ok", "Normal", "partlycloudy", "a_very_long_status_indeed_truly"])
  add(`sensor.words_${s}`, s, { device_class: "enum" });
add("sensor.cellar_temp", "30", { unit_of_measurement: "°C", device_class: "temperature" });   // past the limit below
add("sensor.cellar_cold", "2", { unit_of_measurement: "°C", device_class: "temperature" });
for (const [d, s] of [["light", "on"], ["light", "off"], ["switch", "on"], ["fan", "off"], ["person", "not_home"], ["device_tracker", "home"],
  ["camera", "idle"], ["input_number", "3.0"], ["weather", "partlycloudy"], ["media_player", "playing"], ["alarm_control_panel", "armed_away"]])
  add(`${d}.x_${s}`, s);
const ids = Object.keys(E);
// The owner's limits and alert overrides, as used: a measurement past its max
// or under its min, a detector made an alarm, a hazard made quiet.
const alertThresholds = {
  "sensor.cellar_temp": { max: 28 }, "sensor.cellar_cold": { min: 5 },
  "binary_sensor.motion_on": { alertState: "on" }, "binary_sensor.moisture_on": { alertState: "none" },
};
console.log(`  ${ids.length} fixture entities\n`);

const diff = (f) => ids.filter((id) => !f(id)).map((id) => `${id}: ${JSON.stringify(E[id].state)}`);

const BRANCHES = ["6.6 kW", "123 kWh", "0%", "-3.3°C", "24° → 22°", "→ 22°", "--", "Leak detected", "Unavailable", "Not home", "Unlocked"];
console.log("  a list row (the device lists, \"Also on this device\")");
{
  const bad = diff((id) => rowText(id, E[id]) === oldRow(id, E[id]));
  ck("rowText writes exactly what deviceRowText wrote, for every fixture", bad.length === 0, bad.slice(0, 5));
  const rows = readingRows(ids, E, {}, alertThresholds);
  const badRows = rows.filter((r) => r.text !== oldRow(r.id, E[r.id])).map((r) => r.id);
  ck("  ...and so do the rows of \"Also on this device\"", rows.length === ids.length && badRows.length === 0, badRows.slice(0, 5));
  ck("  (the set reaches every branch: scaled, climate arrow, class words, offline)",
     BRANCHES.filter((w) => !ids.some((id) => rowText(id, E[id]) === w)).length === 0,
     BRANCHES.filter((w) => !ids.some((id) => rowText(id, E[id]) === w)));
}

console.log("\n  the Cockpit's alarm line");
{
  const bad = diff((id) => alarmText(id, E[id]) === oldAlarm(id, E[id]));
  ck("alarmText says what the alarm line said, for every fixture (alarm or not)", bad.length === 0, bad.slice(0, 5));
  const entityMap = Object.fromEntries(ids.map((id) => [id, { entityId: id, type: domainOf(id) }]));
  const items = buildAttentionItems({ unavailableIds: [], entities: E, entityMap, alertThresholds, resolvedRooms: {},
    fmData: EMPTY_FM_DATA, selectableIds: ids, folding: new Map() }).filter((i) => i.kind === "alarm");
  const badItems = items.filter((i) => i.detail !== oldAlarm(i.entityId, E[i.entityId])).map((i) => `${i.entityId}: ${i.detail}`);
  ck(`every alarm Needs attention lists (${items.length}) is worded as before`, badItems.length === 0, badItems.slice(0, 5));
  const listed = new Set(items.map((i) => i.entityId));
  ck("  (the alarms include a hazard, an override, a lost connection, a lock and a fault word)",
     ["binary_sensor.smoke_on", "binary_sensor.motion_on", "binary_sensor.connectivity_off", "lock.l_unlocked", "lock.l_jammed", "sensor.words_fault"]
       .every((id) => listed.has(id)), [...listed]);
  // ⚠️ TODAY'S BEHAVIOUR, KEPT (the owner decides): a reading past the owner's
  // limit is red in its window (config/reading) but is not an alarm here —
  // the map's rule (deviceLook) reads only alert STATES, never min/max.
  ck("  (a reading past the owner's limit is not listed, as before)", !listed.has("sensor.cellar_temp") && !listed.has("sensor.cellar_cold"));
}

console.log("\n  Recent activity");
{
  const STATES = ["on", "off", "unavailable", "unknown", "", "locked", "unlocked", "jammed", "open", "closed", "heat",
    "not_home", "home", "21.5", "6570.989", "connected", "_odd_start", "armed_away"];
  const bad = [];
  for (const id of ids) for (const s of STATES) {
    const said = describeLogbookEntry({ when: 1_790_000_000, entity_id: id, state: s }, E, {})?.message;
    if (said !== oldActivity(id, E[id], s) || stateWords(id, E[id].attributes.device_class)(s) !== said) bad.push(`${id} ${s}: ${said}`);
  }
  // An entity the villa no longer has still has its history line.
  const gone = describeLogbookEntry({ when: 1_790_000_000, entity_id: "binary_sensor.removed", state: "on" }, E, {})?.message;
  if (gone !== oldActivity("binary_sensor.removed", undefined, "on")) bad.push(`removed: ${gone}`);
  ck(`every (entity, state) pair (${ids.length * STATES.length + 1}) is worded as before`, bad.length === 0, bad.slice(0, 5));
}

console.log("\n  each surface asks config/reading, and nothing lower");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const src = (p) => strip(readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8"));
  const LOWER = /\b(deviceRowText|stateLabelFor|formatSensorValue|formatSensorParts|binaryWord|prettyState)\b/;
  for (const [name, file, call] of [
    ["the device lists", "components/panels/SummaryGroupPanel.tsx", /\browText\(id, e\)/],
    ["\"Also on this device\"", "config/readingRows.ts", /\browText\(id, e\)/],
    ["the alarm line", "config/attention.ts", /detail: alarmText\(id, entity\)/],
    ["Recent activity", "components/cockpit/cockpitData.ts", /message: stateWords\(raw\.entity_id,/],
    ["a history bar's tooltip", "components/panels/LastDayTimeline.tsx", /labelFor=\{stateWords\(entityId,/],
  ]) {
    const t = src(file);
    ck(`${name} calls reading`, call.test(t) && /from "(@\/config|\.)\/reading"/.test(t));
    ck("  ...and none of the helpers under it", !LOWER.test(t), t.match(LOWER)?.[0]);
  }
}

done("✅ every list reads its words from config/reading, unchanged");
