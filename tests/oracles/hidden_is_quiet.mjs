// Where a device stands, the same on every surface (architecture review, 2026-10-21).
//
// Since 2.496.457 an entity hidden in the villa's system is no device: the Cockpit, its counts and the update pill
// leave it out. Its map badge, its room chip and its room-list row still painted it red ("Unlocked") or amber, so
// the map showed a red badge "Needs attention" had no line for — the rule "a red badge is always here"
// (config/attention) broken by a surface that never asked whether the device was hidden. Every look now reads one
// predicate (deviceGroups.hiddenIn → VillaDevices.isHidden → LookSource.config.isHidden); this drives values through
// the store's look, the map's look, the villa's device list and "Needs attention" together.
//
// And a device the villa's system no longer has ("Missing"): a ticket on one of its entities deleted with it stood
// as a second line under the device's own "Missing" line — only a ticket on an entity the system still had counted
// as offline. One device, one line.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { deviceLook, storeLookSource, mapLookSource } = await import("@/utils/deviceActivity");
const { villaDevices, hiddenIn } = await import("@/config/deviceGroups");
const { buildAttentionItems, groupAttention } = await import("@/config/attention");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { devicesOf } = await import("../consistency/devices.mjs");

const ent = (id, state, attrs = {}) => ({ entity_id: id, state, attributes: { friendly_name: id, ...attrs } });
const entities = {
  "lock.old": ent("lock.old", "unlocked"),                 // hidden, still placed on the map
  "light.gone": ent("light.gone", "unavailable"),          // hidden, lost
  "lock.door": ent("lock.door", "unlocked"),               // a real door, unlocked
  "light.hall": ent("light.hall", "unavailable"),          // a real lamp, lost
};
const entityMap = Object.fromEntries(Object.keys(entities).map((id) => [id, { entityId: id, type: id.split(".")[0] }]));
const hidden = new Set(["lock.old", "light.gone"]);
const devices = villaDevices({ entityMap, deviceGroups: [], dismissed: new Set(), hidden,
  mappedEntityIds: new Set(Object.keys(entities)), entities, entityDeviceIds: {}, critical: new Set(["light.gone"]) });
const config = { entityMap, isCritical: devices.isCritical, isHidden: devices.isHidden };
const store = storeLookSource(entities, config);
const map = mapLookSource(new Map(Object.entries(entities)), new Map(Object.entries(entityMap)), () => config);

console.log("  a hidden device:");
ck("it is no device: never in the villa's list, never counted unavailable",
   !devices.has("lock.old") && !devices.unavailable.includes("light.gone") && devices.has("lock.door"), devices.ids);
for (const [name, src] of [["the room list (store)", store], ["the map", map]]) {
  const old = deviceLook("lock.old", src), gone = deviceLook("light.gone", src);
  ck(`${name}: a hidden unlocked lock is never red, a hidden lost lamp never amber nor critical`,
     !old.alert && old.face !== "alert" && old.ring !== "alert"
     && !gone.unavailable && gone.face !== "unavailable" && !gone.critical, { old, gone });
}
ck("a device that is not hidden still alarms and still reads lost",
   deviceLook("lock.door", map).alert && deviceLook("light.hall", map).unavailable);
ck("the predicate stands for the whole device: an entity whose device's entity is hidden is hidden",
   hiddenIn(new Set(["switch.relay"]), new Map([["sensor.relay_power", "switch.relay"]]))("sensor.relay_power"));

// ⚠️ THE RULE THE MAP BROKE: every entity the map paints red — hidden or not — has its line in "Needs attention"
const items = buildAttentionItems({ devices, entities, entityMap, resolvedRooms: {}, fmData: EMPTY_FM_DATA });
const listed = new Set(items.map((i) => i.entityId));
const redOnMap = Object.keys(entities).filter((id) => deviceLook(id, map).alert);
ck("every red badge on the map has its line in Needs attention", redOnMap.every((id) => listed.has(id)),
   { redOnMap, listed: [...listed] });
const amberOnMap = Object.keys(entities).filter((id) => deviceLook(id, map).unavailable);
ck("every amber badge on the map has its line too", amberOnMap.every((id) => listed.has(id)), { amberOnMap });

console.log("  a device the villa's system no longer has:");
{
  // the relay and its power sensor both deleted from the villa's system; the 3D object still names the relay
  const ents = { "lock.door": ent("lock.door", "locked") };
  const folding = new Map([["sensor.relay_power", "switch.relay"]]);
  const devs = devicesOf({ ids: ["switch.relay", "lock.door"], unavailable: ["switch.relay"], folding });
  const ticket = { id: "va-7", title: "Relay power has been offline for 3 h.", status: "open",
    openedAt: "2026-10-20T10:00:00Z", photoIds: [], updates: [], entityId: "sensor.relay_power" };
  const groups = groupAttention(buildAttentionItems({ devices: devs, entities: ents, entityMap: {}, resolvedRooms: {},
    fmData: { ...EMPTY_FM_DATA, tickets: [ticket] } }));
  const relay = groups.find((g) => g.entityId === "switch.relay");
  ck("its ticket rides on the device's Missing line: one line, its Close kept",
     relay?.items.length === 1 && relay.items[0].detail === "Missing" && relay.items[0].fault?.ticketId === "va-7",
     relay?.items);
}

done("✅ a hidden device is quiet everywhere, a missing one is one line");
