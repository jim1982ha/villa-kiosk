// Three lamps on one wall switch (owner, 2026-11-25: Patio2F Bottom lit on the map, the Lights tile "All Off"). The
// villa's system files the switch's three relays as one device, so the villa's device list folds the three placed lamps
// into one device standing under the lamp placed first; the Lights tile and the Facility's "Lights off before arrival"
// read only that lamp. They now count each part of the villa's devices (VillaDevices.hasPart).
//
// Driven by value, built as the villa model builds it (deviceFolding → lookFacts → villaDevices), then the summary
// bar's tiles (deriveTiles) and the readiness report (buildReadiness). Invented ids.
import { ck, done } from "../consistency/check.mjs";
const { deviceFolding, villaDevices, lookFacts } = await import("@/config/deviceGroups");
const { deriveTiles } = await import("@/config/summaryTiles");
const { buildReadiness } = await import("@/fm/readiness");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");

const ent = (id, state) => ({ entity_id: id, state, attributes: { friendly_name: id },
  last_changed: "2026-11-25T08:00:00.000Z", last_updated: "2026-11-25T08:00:00.000Z" });
const TOP = "light.example_switch_top", CENTER = "light.example_switch_center", BOTTOM = "light.example_switch_bottom";
const GONE = "light.example_switch_spare";   // a fourth relay's lamp the owner dismissed
const placed = [TOP, CENTER, BOTTOM, GONE];
const entityMap = Object.fromEntries(placed.map((id) => [id, { entityId: id, type: "light", label: id }]));
const registry = Object.fromEntries(placed.map((id) => [id, "wall-switch"]));   // one device in the villa's system

function villa(states) {
  const entities = Object.fromEntries(states.map((e) => [e.entity_id, e]));
  const folding = deviceFolding(entityMap, [], registry, {});
  const input = { entityMap, deviceGroups: [], dismissed: new Set([GONE]), hidden: new Set(), suppressed: new Set(),
    batteries: new Set(), mappedEntityIds: new Set(placed), entities, entityDeviceIds: registry, deviceUnits: {}, folding };
  const devices = villaDevices({ ...input, facts: lookFacts(input, folding) });
  return { entities, devices };
}
const lightsTile = (entities, allowed) =>
  deriveTiles(entities, entityMap, {}, () => true, null, allowed).find((t) => t.kind === "lights")?.value;

const { entities, devices } = villa([ent(TOP, "off"), ent(CENTER, "off"), ent(BOTTOM, "on"), ent(GONE, "on")]);
ck("the three lamps are one device of the villa, standing under the lamp placed first",
   devices.ids.length === 1 && devices.deviceOf(BOTTOM) === TOP, { ids: devices.ids });
ck("  ...(the device alone read the first lamp, off: the tile said \"All Off\")", lightsTile(entities, devices) === "Off",
   lightsTile(entities, devices));
ck("the Lights tile counts each lamp: the bottom one is on", lightsTile(entities, { has: devices.hasPart }) === "1 On",
   lightsTile(entities, { has: devices.hasPart }));
ck("  ...and not the lamp the owner dismissed", !devices.hasPart(GONE));
const ready = buildReadiness(entities, EMPTY_FM_DATA, { devices, attentionItems: [] }, entityMap);
const lights = ready.checks.find((c) => c.id === "lights");
ck("\"Lights off before arrival\" names the lamp still on", lights?.detail === "1 still on." && lights.entityIds.join() === BOTTOM,
   lights);

done("✅ a wall switch's lamps are counted one by one, on the Lights tile and in the readiness report");
