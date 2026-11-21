// Search and quick control (config/quickSearch, owner-approved review P3-03, 2026-11-21): what a typed search lists,
// with each profile's real rights (auth/permissions.mayControlDevice over roles.json), by value.
import { ck, done } from "../consistency/check.mjs";
const { quickSearch } = await import("@/config/quickSearch");
const { mayControlDevice } = await import("@/auth/permissions");
const { matchesQuery } = await import("@/config/deviceRecord");

const ent = (id, name, attributes = {}) => ({ entity_id: id, state: "off", attributes: { friendly_name: name, ...attributes } });
const entities = Object.fromEntries([
  ent("light.master_ceiling", "Ceiling"),
  ent("climate.master_ac", "AC"),
  ent("climate.guest_ac", "AC"),
  ent("sensor.house_power", "House power", { device_class: "power", unit_of_measurement: "W" }),
  ent("siren.gate_siren", "Gate siren"),
  ent("lock.front_door", "Front door"),
].map((e) => [e.entity_id, e]));
const resolvedRooms = {
  "light.master_ceiling": "Master Bedroom", "climate.master_ac": "Master Bedroom", "climate.guest_ac": "Guest Room",
  "sensor.house_power": "Technical Room", "siren.gate_siren": "Entrance", "lock.front_door": "Entrance",
};
const src = { entityMap: {}, entities, resolvedRooms };
const scene = (entityId, name, memberEntityIds) => ({ entityId, name, memberEntityIds, rooms: [] });
const scenes = [
  scene("scene.evening", "Evening", ["light.master_ceiling"]),
  scene("scene.outdoor_pulse", "Outdoor lights", ["input_boolean.press_pulse"]),
  scene("scene.alarm_test", "Alarm test", ["siren.gate_siren", "light.master_ceiling"]),
  scene("scene.power_saving", "Power saving", ["sensor.house_power"]),
];
const rooms = [{ name: "Master Bedroom", floor: 2 }, { name: "Entrance", floor: 1 }];
const search = (role, q) => quickSearch(q, {
  devices: Object.keys(entities), src, rooms, scenes,
  mayControl: (id) => mayControlDevice(role, id, undefined, entities[id]),
});
const ids = (r) => r.devices.join();

ck("each typed word on its own: \"master AC\" finds the master bedroom's AC, not the guest room's",
   ids(search("owner", "master AC")) === "climate.master_ac", search("owner", "master AC"));
ck("  ...in either order", ids(search("owner", "AC master")) === "climate.master_ac");
ck("  ...one word finds every match", ids(search("owner", "ac")).split(",").sort().join() === "climate.guest_ac,climate.master_ac");
ck("  ...the rule every search box shares (matchesQuery): a word in one text, a word in another",
   matchesQuery("kitchen tap", "Tap", "Kitchen") && !matchesQuery("kitchen sink", "Tap", "Kitchen") && matchesQuery("", "x"));
ck("an empty search lists nothing", JSON.stringify(search("owner", "  ")) === JSON.stringify({ rooms: [], devices: [], scenes: [] }));

ck("a guest is offered only what it may switch: no energy device", ids(search("guest", "house")) === ""
   && ids(search("owner", "house")) === "sensor.house_power");
ck("  ...nor a scene of devices it may not switch", search("guest", "power").scenes.length === 0
   && search("owner", "power").scenes.map((s) => s.entityId).join() === "scene.power_saving");

ck("a siren is never listed, for any profile", ["owner", "ops", "guest"].every((r) => !ids(search(r, "siren")).includes("siren.")
   && !ids(search(r, "gate")).includes("siren.")), ids(search("owner", "gate")));
ck("  ...nor a scene that sets one", ["owner", "guest"].every((r) => search(r, "alarm").scenes.length === 0));
ck("a scene that only presses a helper (an automation's start) is not listed", search("owner", "outdoor").scenes.length === 0);
ck("a scene of switchable devices is listed, by its name", search("guest", "evening").scenes.map((s) => s.entityId).join() === "scene.evening");
ck("a room is found by its name, for the fly-to", search("guest", "master").rooms.map((r) => r.name).join() === "Master Bedroom");

done("✅ Search lists what each profile may switch, by every typed word, never a siren");
