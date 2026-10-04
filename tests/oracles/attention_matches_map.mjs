// A red badge on the map is always in "Needs attention" — and nothing else is
// listed as an alarm (2.496.245).
//
// config/attention (then cockpitData) built its alarm items from binary_sensors and their
// device_class only, blind to config.alertThresholds and to every other red
// the map paints: an UNLOCKED door, a sensor reporting a fault word
// (statusKeyFor), a binary_sensor the villa had overridden. Red on the map,
// absent from the list the top-bar count opens. The items are now derived from
// the map's own rule (deviceLook: `alert` = its face is red); this drives a set
// of states through the MAP's adapter and through buildAttentionItems and
// asserts red ⇔ listed, then that every count of attention reads that list.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { deviceLook, mapLookSource } = await import("@/utils/deviceActivity");
const { buildAttentionItems, attentionFor, villaHealthFrom, groupAttention } = await import("@/config/attention");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");

const ent = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });
const STATES = [
  ["lock.front", "unlocked"], ["lock.back", "locked"], ["lock.side", "locking"], ["lock.shed", "jammed"],
  ["binary_sensor.leak", "on", "moisture"], ["binary_sensor.dry", "off", "moisture"],
  ["binary_sensor.pir", "on", "motion"], ["binary_sensor.pir_flagged", "on", "motion"],
  ["binary_sensor.ap", "off", "connectivity"], ["binary_sensor.ap_up", "on", "connectivity"],
  ["binary_sensor.leak_quiet", "on", "moisture"],
  ["binary_sensor.bare", "on"],
  ["sensor.pump_status", "fault"], ["sensor.temp", "24"], ["sensor.weather", "sunny"],
  ["light.hall", "on"], ["switch.pump", "on"], ["camera.gate", "idle"], ["cover.blind", "open"],
  ["light.lost", "unavailable"], ["lock.lost", "unavailable"],
  ["sensor.linked_power", "50"],
];
const entities = Object.fromEntries(STATES.map(([id, s, dc]) => [id, ent(id, s, dc ? { device_class: dc } : {})]));
const entityMap = Object.fromEntries(STATES.map(([id]) => [id, { entityId: id, type: id.split(".")[0] }]));
entityMap["sensor.linked_power"].linkedEntityId = "switch.pump";
// The villa's overrides: a PIR whose "on" IS a fault here, a leak sensor whose "on" is not.
const alertThresholds = { "binary_sensor.pir_flagged": { alertState: "on" }, "binary_sensor.leak_quiet": { alertState: "none" } };
const selectableIds = STATES.map(([id]) => id);
const unavailableIds = ["light.lost", "lock.lost"];
const resolvedRooms = {};

const map = mapLookSource(new Map(Object.entries(entities)), new Map(Object.entries(entityMap)), () => ({ entityMap, alertThresholds }));
const redOnMap = selectableIds.filter((id) => deviceLook(id, map).face === "alert").sort();
const items = buildAttentionItems({ unavailableIds, entities, entityMap, alertThresholds, resolvedRooms, fmData: EMPTY_FM_DATA, selectableIds, folding: new Map() });
const listed = items.filter((i) => i.kind === "alarm").map((i) => i.entityId).sort();

console.log(`  red on the map: ${redOnMap.join(", ")}`);
console.log(`  listed alarms : ${listed.join(", ")}`);
ck("red on the map ⇔ an alarm in Needs attention", redOnMap.join() === listed.join(), { redOnMap, listed });
ck("  ...including the cases the old rule missed: an unlocked door, a jammed lock, a fault-word sensor, the villa's override",
   ["lock.front", "lock.shed", "sensor.pump_status", "binary_sensor.pir_flagged"].every((id) => listed.includes(id)), listed);
// What the OLD rule (binary_sensor + its class's alarmState only) listed — to show the test discriminates.
const { binarySensorClassInfo } = await import("@/config/BinarySensorClasses");
const oldRule = selectableIds.filter((id) => {
  if (!id.startsWith("binary_sensor.")) return false;
  const info = binarySensorClassInfo(entities[id].attributes.device_class);
  return info.alarmState !== "none" && entities[id].state === info.alarmState;
}).sort();
ck("  ...(the old rule disagreed with the map on this set)", oldRule.join() !== redOnMap.join(), oldRule);
ck("  ...and the villa's 'never a fault' override keeps a sensor off the list", !listed.includes("binary_sensor.leak_quiet"));
ck("a device merely on, active, linked or in motion is never an alarm",
   ["light.hall", "switch.pump", "camera.gate", "cover.blind", "lock.side", "binary_sensor.pir", "sensor.linked_power"].every((id) => !listed.includes(id)));
ck("an unavailable device is listed ONCE, as unavailable — never also as an alarm",
   unavailableIds.every((id) => items.filter((i) => i.entityId === id).map((i) => i.kind).join() === "unavailable"));
ck("only selectable devices are listed (never a raw domain scan)",
   buildAttentionItems({ unavailableIds: [], entities, entityMap, alertThresholds, resolvedRooms, fmData: EMPTY_FM_DATA, selectableIds: ["lock.back"], folding: new Map() }).length === 0);
const word = (id) => items.find((i) => i.entityId === id)?.detail;
ck("the detail reads as the device says it: a leak \"Leak detected\", a lost link \"Disconnected\", a door \"Unlocked\"",
   word("binary_sensor.leak") === "Leak detected" && word("binary_sensor.ap") === "Disconnected" && word("lock.front") === "Unlocked", items.map((i) => [i.entityId, i.detail]));

console.log("\n  every count of attention reads this one list:");
const att = { unavailableIds, selectableIds, attentionItems: items };
const all = attentionFor(att, () => true);
ck("a profile that may open everything sees every item; the health line says so",
   all.attentionItems.length === items.length && all.health.level === "danger" && all.health.summary.startsWith(`${all.attentionGroups.length} things`));
const some = attentionFor(att, (id) => id !== "lock.front");
ck("  ...a profile that may not open a device does not count it", some.attentionItems.length === items.length - 1 && !some.attentionItems.some((i) => i.entityId === "lock.front"));
ck("an unlocked door alone is 'danger' (red on the map, red here)",
   villaHealthFrom(groupAttention(items.filter((i) => i.entityId === "lock.front"))).level === "danger");
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
const hud = src("components/hud/HUD.tsx"), cockpit = (src("components/cockpit/CockpitModal.tsx") + src("components/cockpit/CockpitOverview.tsx")), vm = src("config/VillaModel.tsx");
ck("the top-bar badge, the phone menu's \"Cockpit (N)\" and the Cockpit list all read useVillaAttention's attentionGroups (one row per device, 2.496.246)",
   /const \{ attentionGroups, health \} = useVillaAttention\(\);/.test(hud) && /formatCountBadge\(attentionGroups\.length\)\}/.test(hud)
   && /Cockpit\{attentionGroups\.length > 0 \? ` \(\$\{formatCountBadge\(attentionGroups\.length\)\}\)` : ""\}/.test(hud)
   && !/attentionItems/.test(hud)
   && /const \{ selectableIds, attentionGroups \} = useVillaAttention\(\);/.test(cockpit) && /Needs attention \(\{attentionGroups\.length\}\)/.test(cockpit));
ck("  ...and the villa model hands buildAttentionItems the alert overrides the map paints from",
   /alertThresholds: config\.alertThresholds/.test(vm));

done("✅ a red badge is always in Needs attention");
