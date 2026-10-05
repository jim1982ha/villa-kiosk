// What a GROUP of devices looks like — deviceActivity.groupLook (2.496.245).
//
// A room chip, a group card, a Cockpit tile and a device list's header each
// re-decided it: roomChips had its own bucket ring and summaryRingRed /
// summaryRingOn, the Cockpit's tiles their own isActive / isUnavailable loop,
// the device list its own isActive. And the two meanings of "on" lived in two
// modules, so which one a summary counted depended on which file it imported.
// groupLook answers all of it from the members' deviceLook, and names the two
// meanings: `onCount` is POWER (switched on), `activeCount` ACTIVITY (doing
// something). Driven by value through real looks.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { deviceLook, groupLook, storeLookSource } = await import("@/utils/deviceActivity");
const { tileStats } = await import("@/components/cockpit/cockpitData");

const ent = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });
const ENTITIES = {
  "light.on": ent("light.on", "on"), "light.off": ent("light.off", "off"),
  "lock.open": ent("lock.open", "unlocked"), "lock.shut": ent("lock.shut", "locked"),
  "camera.idle": ent("camera.idle", "idle"), "media_player.paused": ent("media_player.paused", "paused"),
  "binary_sensor.pir": ent("binary_sensor.pir", "on", { device_class: "motion" }),
  "light.lost": ent("light.lost", "unavailable"), "sensor.t": ent("sensor.t", "24"),
  "sensor.power": ent("sensor.power", "120"), "switch.pump": ent("switch.pump", "on"),
};
const CONFIG = { entityMap: { "sensor.power": { entityId: "sensor.power", type: "sensor", linkedEntityId: "switch.pump" } }, alertThresholds: {} };
const src = storeLookSource(ENTITIES, CONFIG);
const L = (id) => deviceLook(id, src);
const count = (ids, showingDevices = false) => groupLook(ids.map(L), { showingDevices });

console.log("  the two meanings of \"on\", one module, named:");
{
  ck("an idle camera is ACTIVE (connected, capturing) but not switched ON — it has no switch",
     L("camera.idle").active && L("camera.idle").power === "none" && count(["camera.idle"]).onCount === 0 && count(["camera.idle"]).activeCount === 1);
  ck("a paused TV is switched ON (its power button) but not ACTIVE (its badge rests until it plays)",
     L("media_player.paused").power === "on" && !L("media_player.paused").active);
  ck("a motion sensor detecting is ACTIVE, never ON (owner, 2.496.238: it is someone passing)",
     L("binary_sensor.pir").active && L("binary_sensor.pir").power === "none");
  ck("an unlocked lock is ON (POWER) and red (needs attention), not 'active'",
     L("lock.open").power === "on" && L("lock.open").alert && !L("lock.open").active);
  ck("a power sensor whose linked pump runs is ACTIVE (ringed), never ON",
     L("sensor.power").active && L("sensor.power").power === "none");
  const g = count(["light.on", "light.off", "lock.open", "lock.shut", "camera.idle", "media_player.paused", "binary_sensor.pir", "sensor.t"]);
  ck("a mixed group: onCount 3 (light, unlocked lock, paused TV), activeCount 3 (light, camera, PIR)",
     g.onCount === 3 && g.activeCount === 3, g);
}

console.log("\n  a COUNT summary's ring (room chip, count card):");
{
  ck("red when ANY member needs attention", count(["light.off", "lock.open"]).ringRed);
  ck("  ...and red wins over 'on' (no neutral ring beside a red one)", !count(["light.on", "lock.open"]).ringOn);
  ck("the neutral 'on' ring when a member is active and none alerts", count(["light.off", "light.on"]).ringOn && !count(["light.off", "light.on"]).ringRed);
  ck("  ...never red for 'on' (owner, 2026-10-01: red is \"Needs attention\")", !count(["light.on", "sensor.power"]).ringRed);
  ck("unavailable dims, never rings", count(["light.lost"]).unavailable && !count(["light.lost"]).ringRed && !count(["light.lost"]).ringOn);
  ck("all off: no ring", !count(["light.off", "lock.shut", "sensor.t"]).ringRed && !count(["light.off", "lock.shut", "sensor.t"]).ringOn);
  ck("a member the caller has no state for (null) rings nothing and counts nothing",
     !groupLook([null, L("light.off")], { showingDevices: false }).ringOn && groupLook([null], { showingDevices: false }).offline === 0);
}

console.log("\n  a card SHOWING its devices:");
{
  const lockA = L("lock.open");
  ck("red only when EVERY member's own ring is red", groupLook([lockA, lockA], { showingDevices: true }).ringRed
     && !groupLook([lockA, L("light.off")], { showingDevices: true }).ringRed);
  ck("  ...a member not reported is not alerting", !groupLook([lockA, null], { showingDevices: true }).ringRed);
  ck("  ...three merely-connected cameras do not ring it", !count(["camera.idle", "camera.idle", "camera.idle"], true).ringRed);
  ck("  ...and it has no 'on' ring (each cell carries its own)", !count(["light.on", "light.on"], true).ringOn);
  ck("  ...an empty card is not red", !groupLook([], { showingDevices: true }).ringRed);
}

console.log("\n  the Cockpit's tile counts ask it (POWER, and offline):");
{
  const s = tileStats(["light.on", "lock.open", "lock.shut", "camera.idle", "binary_sensor.pir", "light.lost", "light.never"], src);
  ck("\"N on\" is POWER: the light and the unlocked lock — not the camera, not the PIR",
     s.onCount === 2, s);
  ck("offline counts the lost AND the never-reported", s.offline === 2 && s.total === 7, s);
}

done("✅ a group looks like its members, and says which \"on\" it counts");
