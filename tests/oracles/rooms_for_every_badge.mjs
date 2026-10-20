// Every entity the kiosk shows gets a room, by ONE rule, read ONE way (config/devicePlace.ts) — 2.496.202,
// 2.496.382, architecture review 2026-10-16. By value: fake area names, a fake "which drawn room" lookup.
//
// The resolver walked the STORED mappings only. A device the model carries
// through a mesh binding has no stored mapping (its mapping is built on the
// fly), so it got no room: "Other", the one bucket the placement pass will
// not fold into a chip. The owner's TV — in the Living Room in Home Assistant
// through its device — sat drawn on top of the collapsed "Living Room 18".
// Then about fourteen readers cleaned the answer four ways, and the raw ones met the "" stored for "no room" with
// `??`: the Overview card read "Other" for a device whose own sensor had a room.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done, tsFiles } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const P = await import("@/config/devicePlace");
const { NO_ROOM_LABEL } = await import("@/config/roomKey");
const { buildAttentionItems, groupAttention } = await import("@/config/attention");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { devicesOf } = await import("../consistency/devices.mjs");

console.log("  the rule:");
{
  const areas = { "media_player.tv": "Living Room", "light.a": "Kitchen" };
  const geo = (id) => (id === "sensor.wall" ? "Bedroom 1" : null);
  const r = P.resolveRooms(["media_player.tv", "light.a", "sensor.wall", "switch.nowhere", "light.a"], areas, geo);
  ck("Home Assistant's Area wins", r["media_player.tv"] === "Living Room" && r["light.a"] === "Kitchen"
     && P.resolveEntityRoom("Kitchen", "Bedroom 1") === "Kitchen");
  ck("  ...else the room the anchor is in", r["sensor.wall"] === "Bedroom 1");
  ck("  ...else no room (empty, which reads as 'Other')", r["switch.nowhere"] === "");
  ck("an id given twice is resolved once", Object.keys(r).length === 4);
  // every entity is asked now (2026-10-15): the model is asked only for one Home Assistant gives no area
  const asked = [];
  P.resolveRooms(["media_player.tv", "sensor.wall"], areas, (id) => { asked.push(id); return null; });
  ck("  ...the model asked only where Home Assistant has no area", asked.join() === "sensor.wall", asked);
}

console.log("\n  the set:");
{
  const entities = { "sensor.relay_temp": { state: "21" }, "light.a": { state: "on" }, "media_player.tv": { state: "off" } };
  const key = P.entityIdsKey(entities);
  ck("the id key does not move on a state push that changes no id",
     key === P.entityIdsKey({ "media_player.tv": { state: "on" }, "light.a": { state: "off" }, "sensor.relay_temp": { state: "22" } }));
  ck("  ...and moves when an id appears", key !== P.entityIdsKey({ ...entities, "fan.new": {} }));
  const map = { "light.a": { linkedEntityId: "switch.pump", motionEntityId: "binary_sensor.m" }, "cover.stored": {} };
  const ids = P.roomIdSet(key, new Set(["camera.mesh_bound"]), map);
  // owner, 2026-10-15: a fault on a sensor the model does not draw had no room line — EVERY entity Home Assistant has
  ck("every entity Home Assistant has (one the model does not draw included)",
     Object.keys(entities).every((id) => ids.has(id)), [...ids]);
  ck("  ...the model's own (mesh-bound, no stored mapping)", ids.has("camera.mesh_bound"));
  ck("  ...the stored mappings", ids.has("cover.stored"));
  ck("  ...and every linked/motion target", ids.has("switch.pump") && ids.has("binary_sensor.m"));
  ck("  ...each once", ids.size === 7, [...ids]);
  ck("no entity at all: no empty id", !P.roomIdSet("", [], {}).has(""));
}

console.log("\n  the clean-up:");
{
  ck("blank is no room", P.cleanRoom("") === "" && P.cleanRoom("   ") === "" && P.cleanRoom(undefined) === "" && P.cleanRoom(null) === "");
  ck("  ...a room is trimmed", P.cleanRoom("  Kitchen ") === "Kitchen");
  ck("no room reads 'Other', a room reads as itself",
     P.roomLabel("") === NO_ROOM_LABEL && P.roomLabel("  ") === NO_ROOM_LABEL && P.roomLabel(undefined) === NO_ROOM_LABEL
     && P.roomLabel(" Pool ") === "Pool");
  const rooms = { "light.a": " Hall ", "light.b": "", "light.c": "  " };
  ck("a device's room, cleaned: '' for none, never undefined",
     P.deviceRoom(rooms, "light.a") === "Hall" && P.deviceRoom(rooms, "light.b") === "" && P.deviceRoom(rooms, "light.c") === ""
     && P.deviceRoom(rooms, "light.unknown") === "");
  ck("  ...as a label", P.deviceRoomLabel(rooms, "light.a") === "Hall" && P.deviceRoomLabel(rooms, "light.b") === NO_ROOM_LABEL
     && P.deviceRoomLabel(rooms, "light.unknown") === NO_ROOM_LABEL);
}

console.log("\n  the fallback chain (empty means absent):");
{
  const rooms = { "lock.door": "", "sensor.door_battery": "Entrance", "lock.back": "", "sensor.back_battery": "" };
  ck("the device's room first", P.deviceRoomOrRecord({ ...rooms, "lock.door": "Hall" }, "lock.door", "sensor.door_battery", "Garage") === "Hall");
  ck("  ...the device has none (''): its entity's", P.deviceRoomOrRecord(rooms, "lock.door", "sensor.door_battery", "Garage") === "Entrance");
  ck("  ...neither has one: the record's", P.deviceRoomOrRecord(rooms, "lock.back", "sensor.back_battery", "Garden") === "Garden");
  ck("  ...none at all: ''", P.deviceRoomOrRecord(rooms, "lock.back", "sensor.back_battery", "  ") === "");
  ck("first room: skips blanks, not only missing", P.firstRoom("", "  ", undefined, " Pool") === "Pool" && P.firstRoom() === "");

  // THE defect, end to end: a ticket on the battery sensor, folded under the lock the map draws. resolveRooms stored
  // "" for the lock; `??` stopped there and the Overview card read "Other".
  const ticket = { id: "t1", title: "Battery", status: "open", entityId: "sensor.door_battery", room: "Front",
    openedAt: "2026-10-16T00:00:00Z", photoIds: [], updates: [] };
  const opts = { devices: devicesOf({ folding: new Map([["sensor.door_battery", "lock.door"]]) }), entities: {}, entityMap: {},
    fmData: { ...EMPTY_FM_DATA, tickets: [ticket] } };
  const card = (resolvedRooms) => groupAttention(buildAttentionItems({ ...opts, resolvedRooms }))[0]?.room;
  ck("the Overview card: the device has no room → its sensor's", card(rooms) === "Entrance", card(rooms));
  const none = { "lock.door": "", "sensor.door_battery": "" };
  ck("  ...both have none → the room stored on the ticket", card(none) === "Front", card(none));
  ck("  ...and with no room anywhere, 'Other'", groupAttention(buildAttentionItems({ ...opts, resolvedRooms: none, fmData: { ...EMPTY_FM_DATA, tickets: [{ ...ticket, room: "" }] } }))[0]?.room === NO_ROOM_LABEL);
}

console.log("\n  the floor of a room:");
{
  const f = P.roomFloors({ "light.a": " Patio ", "light.b": "  " }, [{ name: "Patio", floor: 2 }], {});
  ck("a room's floor is read under its cleaned name, a blank room is 'Other' with no floor",
     P.floorOfRoom(f, "Patio") === 2 && f.has(NO_ROOM_LABEL) && P.floorOfRoom(f, NO_ROOM_LABEL) === null, [...f]);
}

console.log("\n  the callers:");
{
  // The wiring is React (an effect), not a value: pinned by its call, the module doing the rest.
  const dash = readFileSync(new URL("../../src/pages/Dashboard.tsx", import.meta.url), "utf8");
  ck("Dashboard runs the one rule over the one id set, the scene answering 'which drawn room'",
     /const ids = roomIdSet\(haIdsKey, mappedEntityIds, config\.entityMap\);\s*const resolved = resolveRooms\(ids, entityAreaNames, \(id\) => manager\.roomForEntity\(id\)\)/.test(dash)
     && /const haIdsKey = useMemo\(\(\) => entityIdsKey\(entities\), \[entities\]\);/.test(dash)
     && /\[manager, entityAreaNames, config\.entityMap, mappedEntityIds, haIdsKey, setResolvedRooms\]/.test(dash));
  // Nobody reads the table raw any more: a raw read is where `??` met "" (the defect above).
  const raw = tsFiles(new URL("../../src", import.meta.url).pathname)
    .filter((p) => !p.endsWith("config/devicePlace.ts"))
    .filter((p) => /[rR]esolvedRooms(?:Ref\.current)?\[/.test(readFileSync(p, "utf8")));
  ck("no reader indexes resolvedRooms by hand — devicePlace answers", raw.length === 0, raw);
}
done("✅ every badge has a room to fold into, read one way");
