// ONE PHYSICAL DEVICE, TWO OF THE OWNER'S GROUPS (architecture review item 7, 2026-11-13). A weather station is one
// device in the villa's registry; the owner shows its indoor and its outdoor readings as two groups on the map. Its
// parts nobody placed (a battery filed as diagnostic, a rain gauge) went to whichever placed reading's id sorted first,
// so its rain gauge's dead part was the indoor card's, and a rename moved it. deviceGroups.deviceFolding follows the
// registry's closest link, then the owner's own group order, never the alphabet.
//
// Driven by value through the shipped modules, built as the villa model builds them (VillaModel): the fold
// (deviceFolding, with the registry's sub-devices) → lookFacts → villaDevices → the Cockpit's cards (attentionOf →
// attentionFor), each window's warning sign (issueSeverity), its "Also on this device" (deviceReadings → readingRows),
// and each badge (deviceLook). Invented ids.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { deviceFolding, villaDevices, lookFacts, deviceReadings } = await import("@/config/deviceGroups");
const { attentionOf, attentionFor, issueSeverity } = await import("@/config/attention");
const { readingRows } = await import("@/config/readingRows");
const { deviceLook, storeLookSource, lookMarks, marksOf } = await import("@/utils/deviceActivity");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");

const ent = (id, state, name, attrs = {}) => ({ entity_id: id, state, attributes: { friendly_name: name, ...attrs },
  last_changed: "2026-11-13T08:00:00.000Z", last_updated: "2026-11-13T08:00:00.000Z" });

// indoor ids sort before outdoor ones: the alphabet would give every unplaced part to the indoor card
const IN_T = "sensor.station_a_indoor_temperature", IN_H = "sensor.station_a_indoor_humidity";
const OUT_T = "sensor.station_b_outdoor_temperature", OUT_H = "sensor.station_b_outdoor_humidity";
const BATTERY = "sensor.station_battery", RAIN = "sensor.station_rain", GUST = "sensor.station_gust";
const placed = [IN_T, IN_H, OUT_T, OUT_H];
const entityMap = Object.fromEntries(placed.map((id) => [id, { entityId: id, type: "sensor", label: id }]));
const INDOOR = { id: "g-in", primaryEntityId: IN_T, memberEntityIds: [IN_H] };
const OUTDOOR = { id: "g-out", primaryEntityId: OUT_T, memberEntityIds: [OUT_H] };

function villa({ groups, registry, deviceUnits = {}, critical, states }) {
  const entities = Object.fromEntries(states.map((e) => [e.entity_id, e]));
  const suppressed = new Set([BATTERY]), hidden = new Set();
  const folding = deviceFolding(entityMap, groups, registry, deviceUnits);
  const input = { entityMap, deviceGroups: groups, dismissed: new Set(), hidden, suppressed, batteries: new Set([BATTERY]), mappedEntityIds: new Set(placed),
    entities, entityDeviceIds: registry, deviceUnits, critical, folding };
  const facts = lookFacts(input, folding);
  const devices = villaDevices({ ...input, facts });
  const view = attentionFor({ devices, attentionItems: attentionOf({ devices, entities, entityMap,
    resolvedRooms: { [IN_T]: "Hall", [OUT_T]: "Garden" }, fmData: EMPTY_FM_DATA }).attentionItems }, () => true);
  const source = storeLookSource(entities, { entityMap, ...lookMarks(marksOf(facts, new Set())) });
  // what each group's window shows: its sign, its badge, and its "Also on this device" rows with their pill tones
  const win = (rep) => {
    const look = deviceLook(rep, source);
    const ids = deviceReadings(rep, folding, facts.partsOf, entities);
    return { sign: issueSeverity(view.attentionGroups, [rep], devices.deviceOf), mark: look.mark,
      rows: Object.fromEntries(readingRows(ids, entities, entityMap, look.statusRule).map((r) => [r.id, r.tone ?? ""])) };
  };
  return { devices, view, indoor: win(IN_T), outdoor: win(OUT_T) };
}

const states = (rain = "2.1") => [ent(IN_T, "21", "Indoor temperature"), ent(IN_H, "40", "Indoor humidity"),
  ent(OUT_T, "12", "Outdoor temperature"), ent(OUT_H, "80", "Outdoor humidity"),
  ent(BATTERY, "64", "Station battery", { device_class: "battery" }), ent(RAIN, rain, "Station rain"), ent(GUST, "9", "Station gust")];
const oneDevice = Object.fromEntries([...placed, BATTERY, RAIN, GUST].map((id) => [id, "dev-station"]));

console.log("  one device in the registry, the outdoor group listed first in Settings, its rain gauge unavailable:");
{
  const v = villa({ groups: [OUTDOOR, INDOOR], registry: oneDevice, states: states("unavailable") });
  ck("the unplaced parts are the outdoor group's (the owner's group listed first), not the indoor one's that sorts first",
     [BATTERY, RAIN, GUST].every((id) => v.devices.deviceOf(id) === OUT_T), [BATTERY, RAIN, GUST].map(v.devices.deviceOf));
  ck("  ...ONE card, the outdoor station's, in the garden; the indoor one has none",
     v.view.attentionGroups.length === 1 && v.view.attentionGroups[0].entityId === OUT_T && v.view.attentionGroups[0].room === "Garden",
     v.view.attentionGroups.map((g) => [g.entityId, g.room]));
  ck("  ...the outdoor window's sign and its badge's corner the grey of a lost part; the indoor window quiet",
     v.outdoor.sign === "lost" && v.outdoor.mark === "lost" && v.indoor.sign === null && v.indoor.mark === null,
     { outdoor: v.outdoor, indoor: v.indoor });
  ck("  ...the outdoor window lists its battery, its rain gauge (grey: lost) and its gust; the indoor one none of them",
     v.outdoor.rows[BATTERY] !== undefined && v.outdoor.rows[RAIN] === "unavailable" && v.outdoor.rows[GUST] !== undefined
       && [BATTERY, RAIN, GUST].every((id) => !(id in v.indoor.rows)), { outdoor: v.outdoor.rows, indoor: v.indoor.rows });
}

console.log("  the same villa, the indoor group listed first:");
{
  const v = villa({ groups: [INDOOR, OUTDOOR], registry: oneDevice, states: states("unavailable") });
  ck("the parts follow the owner's order: now the indoor group's card and window",
     [BATTERY, RAIN, GUST].every((id) => v.devices.deviceOf(id) === IN_T)
       && v.view.attentionGroups.map((g) => g.entityId).join() === IN_T && v.indoor.sign === "lost" && v.outdoor.sign === null,
     { deviceOf: [BATTERY, RAIN, GUST].map(v.devices.deviceOf), cards: v.view.attentionGroups.map((g) => g.entityId) });
}

console.log("  the registry says more: the outdoor readings and the rain gauge on the station's outdoor module (a sub-device):");
{
  const registry = { ...oneDevice, [OUT_T]: "dev-outdoor", [OUT_H]: "dev-outdoor", [RAIN]: "dev-outdoor" };
  const v = villa({ groups: [INDOOR, OUTDOOR], registry, deviceUnits: { "dev-outdoor": "dev-station" }, states: states("unavailable") });
  ck("the rain gauge goes to the group on its own module, whatever the order; the station's own parts to the group on the station",
     v.devices.deviceOf(RAIN) === OUT_T && v.devices.deviceOf(BATTERY) === IN_T && v.devices.deviceOf(GUST) === IN_T,
     [RAIN, BATTERY, GUST].map(v.devices.deviceOf));
  ck("  ...its dead part on the outdoor card and window, never the indoor one's",
     v.view.attentionGroups.map((g) => g.entityId).join() === OUT_T && v.outdoor.sign === "lost" && v.indoor.sign === null);
}

console.log("  the station on the critical list (its outdoor reading named), its rain gauge unavailable:");
{
  const v = villa({ groups: [OUTDOOR, INDOOR], registry: oneDevice, critical: new Set([OUT_T]), states: states("unavailable") });
  ck("the outdoor window's lost rain gauge is red, as its badge says a critical device needs a look",
     v.outdoor.rows[RAIN] === "danger", v.outdoor.rows);
  // architecture review item 5, 2026-11-14: the badge wore the grey "?" and the card was grey beside the red row
  ck("  ...its badge's corner the RED \"?\", its card and its window's sign red, the villa's health danger",
     v.outdoor.mark === "critical" && v.outdoor.sign === "danger" && v.view.health.level === "danger",
     { mark: v.outdoor.mark, sign: v.outdoor.sign, health: v.view.health });
}

console.log("  everything reporting:");
{
  const v = villa({ groups: [OUTDOOR, INDOOR], registry: oneDevice, states: states() });
  ck("no card, no sign, no mark on either window",
     v.view.attentionGroups.length === 0 && v.outdoor.sign === null && v.indoor.sign === null
       && v.outdoor.mark === null && v.indoor.mark === null, { outdoor: v.outdoor, indoor: v.indoor });
}

done("✅ a device split by the owner's groups: its unplaced parts follow the registry, then the owner's order");
