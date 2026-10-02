// "Is this device active", "how many are on", a mixed list switched off, a
// category's members, and what kind of reading a sensor gives — by value
// (config/activeDevices.ts, villaVisibility.categoryMembers,
// sensorReading.ts; 2.496.229).
//
// The Cockpit counted a LOCKED lock, a CLOSED blind and a sensor reading as
// "on"; "Turn all off" sent the first row's domain to every row; an offline
// power sensor lost its chart in its own panel.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const A = await import("@/config/activeDevices");
// POWER ("is it switched on") is deviceActivity's since 2.496.245 — the module
// that owns both meanings of "on".
const { isSwitchedOn } = await import("@/utils/deviceActivity");
const V = await import("@/config/villaVisibility");
const S = await import("@/config/sensorReading");

const e = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });

console.log("  is it on:");
ck("a light that is on, an unlocked lock, an open blind, a heating A/C, a playing speaker: on",
   isSwitchedOn(e("light.a", "on"), "light.a") && isSwitchedOn(e("lock.d", "unlocked"), "lock.d")
   && isSwitchedOn(e("cover.b", "open"), "cover.b") && isSwitchedOn(e("climate.c", "heat"), "climate.c")
   && isSwitchedOn(e("media_player.m", "playing"), "media_player.m"));
ck("a LOCKED lock and a CLOSED blind are not on (the Cockpit counted both)",
   !isSwitchedOn(e("lock.d", "locked"), "lock.d") && !isSwitchedOn(e("cover.b", "closed"), "cover.b"));
ck("a motion or door sensor detecting is NOT on (only what a person can switch counts — 2.496.238)",
   !isSwitchedOn(e("binary_sensor.motion4_occupancy", "on", { device_class: "occupancy" }), "binary_sensor.motion4_occupancy")
   && !isSwitchedOn(e("binary_sensor.front_door", "on", { device_class: "door" }), "binary_sensor.front_door"));
ck("a sensor reading, a camera, a weather station are never on",
   !isSwitchedOn(e("sensor.t", "24"), "sensor.t") && !isSwitchedOn(e("camera.g", "recording"), "camera.g")
   && !isSwitchedOn(e("weather.home", "sunny"), "weather.home"));
ck("unavailable, unknown or missing is not on",
   !isSwitchedOn(e("light.a", "unavailable"), "light.a") && !isSwitchedOn(undefined, "light.a") && !isSwitchedOn(e("lock.d", "unlocking"), "lock.d"));

console.log("\n  how many are on, per category:");
{
  const entityMap = {
    "lock.front": { type: "lock", category: "access_control" }, "lock.back": { type: "lock", category: "access_control" },
    "light.a": { type: "light" }, "sensor.t": { type: "sensor", category: "comfort" },
  };
  const entities = { "lock.front": e("lock.front", "locked"), "lock.back": e("lock.back", "unlocked"),
    "light.a": e("light.a", "on"), "sensor.t": e("sensor.t", "24") };
  const counts = Object.fromEntries(A.categoryCounts(Object.keys(entityMap), entities, entityMap).map((c) => [c.category, c]));
  ck("two locks, one unlocked: 2 devices · 1 on (was 2 on)", counts.access_control.total === 2 && counts.access_control.onCount === 1, JSON.stringify(counts.access_control));
  ck("a temperature reading adds a device, not an 'on'", counts.comfort.total === 1 && counts.comfort.onCount === 0, JSON.stringify(counts.comfort));
  ck("an unmapped device is not counted", A.categoryCounts(["switch.x"], { "switch.x": e("switch.x", "on") }, {}).every((c) => c.total === 0));
}

console.log("\n  switching a mixed list:");
{
  const plan = A.bulkSwitchPlan(["light.a", "switch.pump", "light.b", "lock.d"], false, new Set(["light", "switch"]));
  ck("one call per domain, each with its own ids (the first row's domain went to all)",
     JSON.stringify(plan) === JSON.stringify([
       { domain: "light", service: "turn_off", entityIds: ["light.a", "light.b"] },
       { domain: "switch", service: "turn_off", entityIds: ["switch.pump"] }]), JSON.stringify(plan));
  ck("  ...a domain without a plain on/off (a lock) is left out", !plan.some((c) => c.domain === "lock"));
  ck("  ...and turning on asks turn_on", A.bulkSwitchPlan(["light.a"], true, new Set(["light"]))[0].service === "turn_on");
}

console.log("\n  a category's members:");
{
  const entityMap = { "sensor.ap_state": { type: "sensor", category: "network" }, "sensor.rssi": { type: "sensor", category: "network" },
    "camera.gate": { type: "camera", category: "network" }, "sensor.gone": { type: "sensor", category: "network" } };
  const entities = { "sensor.ap_state": e("sensor.ap_state", "connected"), "sensor.rssi": e("sensor.rssi", "-60"), "camera.gate": e("camera.gate", "idle") };
  const ctx = { entityMap, entities, dismissed: new Set(["sensor.gone"]), suppressed: new Set(["sensor.ap_state", "sensor.rssi"]), mapped: new Set(["sensor.ap_state", "camera.gate"]) };
  const owner = V.categoryMembers("owner", "network", ctx), guest = V.categoryMembers("guest", "network", ctx);
  ck("a diagnostic sensor ON THE MAP stays; an orphan one does not", owner.includes("sensor.ap_state") && !owner.includes("sensor.rssi"), owner.join());
  ck("a dismissed device is out", !owner.includes("sensor.gone"));
  // A camera is an Access Control device, which a guest's category list
  // covers — but a guest may not see the camera TYPE.
  const ownerAccess = V.categoryMembers("owner", "access_control", ctx), guestAccess = V.categoryMembers("guest", "access_control", ctx);
  ck("a type the profile may not see is out (a guest's camera)", ownerAccess.includes("camera.gate") && !guestAccess.includes("camera.gate"), `${ownerAccess} / ${guestAccess}`);
  ck("  ...and a device is listed under its own category only", !owner.includes("camera.gate"));
  ck("no profile: nothing", V.categoryMembers(null, "network", ctx).length === 0);
}

console.log("\n  what kind of reading:");
ck("a number is a measurement; words are text; a binary sensor is binary",
   S.readingKind(e("sensor.p", "120", { unit_of_measurement: "W" }), "sensor") === "measurement"
   && S.readingKind(e("sensor.ap", "connected"), "sensor") === "text"
   && S.readingKind(e("binary_sensor.door", "on"), "binary_sensor") === "binary");
ck("an OFFLINE power sensor is still a measurement — its chart stays (it became text)",
   S.readingKind(e("sensor.p", "unavailable", { unit_of_measurement: "W" }), "sensor") === "measurement");
ck("  ...an offline sensor with no unit is text, as before", S.readingKind(e("sensor.ap", "unavailable"), "sensor") === "text");
ck("alarm level: out of range is danger; a binary sensor in its alert state is danger; text never",
   S.readingLevel(e("sensor.t", "40"), "measurement", { max: 30 }, undefined) === "danger"
   && S.readingLevel(e("binary_sensor.leak", "on"), "binary", undefined, "on") === "danger"
   && S.readingLevel(e("sensor.ap", "down"), "text", { max: 1 }, undefined) === "normal");

console.log("\n  the Cockpit's tiles (rooms, floors, categories — one wording):");
{
  const { tileStats, tileLine } = await import("@/components/cockpit/cockpitData");
  const ents = { "lock.a": e("lock.a", "locked"), "lock.b": e("lock.b", "unlocked"), "sensor.t": e("sensor.t", "unavailable"), "light.x": e("light.x", "on") };
  const { storeLookSource } = await import("@/utils/deviceActivity");
  const src = storeLookSource(ents, { entityMap: {}, alertThresholds: {} });
  const s = tileStats(["lock.a", "lock.b", "sensor.t", "light.x"], src);
  ck("counts devices, those on (a locked lock is not), and those offline", s.total === 4 && s.onCount === 2 && s.offline === 1, JSON.stringify(s));
  ck("  ...worded once: \"4 devices · 2 on · 1 offline\"", tileLine(s) === "4 devices · 2 on · 1 offline", tileLine(s));
  ck("  ...a quiet room says only its size", tileLine(tileStats(["lock.a"], src)) === "1 device");
  ck("  ...and an empty one \"None\"", tileLine(tileStats([], src)) === "None");
  const counts = A.categoryCounts(["lock.a", "lock.b"], ents, { "lock.a": { type: "lock", category: "access_control" }, "lock.b": { type: "lock", category: "access_control" } });
  ck("a category tile knows its devices (it opens their list now)", counts.find((c) => c.category === "access_control").entityIds.join() === "lock.a,lock.b");
}

done("✅ one meaning of on; one call per domain; an offline measurement keeps its chart");
