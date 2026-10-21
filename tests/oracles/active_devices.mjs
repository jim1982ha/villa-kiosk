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
  // "On" per category is groupLook's POWER count over the category's members — the one rule
  // (which devices a category holds is villaVisibility.categoryMembers, driven below).
  const { storeLookSource, deviceLook, groupLook } = await import("@/utils/deviceActivity");
  const src = storeLookSource(entities, { entityMap, isHidden: () => false });
  const members = { access_control: ["lock.front", "lock.back"], comfort: ["sensor.t"] };
  const on = (ids) => groupLook(ids.map((id) => deviceLook(id, src)), { showingDevices: false }).onCount;
  ck("two locks, one unlocked: 1 on (was 2 on)", members.access_control.length === 2 && on(members.access_control) === 1);
  ck("a temperature reading adds a device, not an 'on'", members.comfort.length === 1 && on(members.comfort) === 0);
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
  // architecture review A, 2026-10-22: the list had filters of its own — the counts and the Cockpit never listed these
  {
    const map2 = { ...entityMap, "sensor.off": { type: "sensor", category: "network", disabled: true },
      "sensor.hidden": { type: "sensor", category: "network" }, "sensor.combo_h": { type: "sensor", category: "network" } };
    const ctx2 = { ...ctx, entityMap: map2, mapped: new Set([...ctx.mapped, "sensor.hidden"]),
      isHidden: (id) => id === "sensor.hidden", deviceOf: (id) => (id === "sensor.combo_h" ? "camera.gate" : id) };
    const got = V.categoryMembers("owner", "network", ctx2);
    ck("  ...a device switched off, one hidden in the villa's system (even on the map), a group's member: never listed",
       !got.includes("sensor.off") && !got.includes("sensor.hidden") && !got.includes("sensor.combo_h") && got.includes("sensor.ap_state"), got.join());
    const { readFileSync } = await import("node:fs");
    ck("  ...and the category list the top bar opens is given them (Dashboard)",
       /isHidden, deviceOf: \(id\) => deviceOf\(identity\.folding, id\),/.test(readFileSync(new URL("../../src/pages/Dashboard.tsx", import.meta.url), "utf8")));
  }
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
ck("alarm level: a binary sensor in its alert state is danger; a measurement and text never (no per-sensor limits since 2.496.450)",
   S.readingLevel(e("binary_sensor.leak", "on"), "binary", "on") === "danger"
   && S.readingLevel(e("binary_sensor.leak", "off"), "binary", "on") === "normal"
   && S.readingLevel(e("sensor.t", "40"), "measurement", undefined) === "normal"
   && S.readingLevel(e("sensor.ap", "down"), "text", undefined) === "normal");

console.log("\n  what a bulk switch says it will do (owner, 2026-10-20):");
{
  ck("one device: \"Turn off 1 fan\"", A.bulkWords(["fan.vmc"], false) === "Turn off 1 fan", A.bulkWords(["fan.vmc"], false));
  ck("  ...by kind, plural, \"and\" before the last: \"Turn on 4 lights and 2 fans\"",
     A.bulkWords(["light.a", "fan.b", "light.c", "light.d", "fan.e", "light.f"], true) === "Turn on 4 lights and 2 fans");
  ck("  ...a switch and an on/off helper are both switches; what it never touches is never counted",
     A.bulkWords(["switch.p", "input_boolean.q", "sensor.t", "cover.c"], false) === "Turn off 2 switches");
  ck("locks lock and unlock (owner, 2026-10-20: Access Control had none): \"Lock 1 lock\", \"Unlock 4 locks\"",
     A.bulkWords(["lock.a"], false) === "Lock 1 lock" && A.bulkWords(["lock.a", "lock.b", "lock.c", "lock.d"], true) === "Unlock 4 locks");
  ck("  ...a mixed heading says both: \"Turn off 2 lights and lock 1 lock\"",
     A.bulkWords(["light.a", "lock.b", "light.c"], false) === "Turn off 2 lights and lock 1 lock", A.bulkWords(["light.a", "lock.b", "light.c"], false));
  const plan = A.bulkSwitchPlan(["lock.a", "light.b"], false, new Set(["lock", "light"]));
  ck("  ...and a lock is locked (lock.lock), never sent turn_off; turning on unlocks",
     plan.find((c) => c.domain === "lock").service === "lock" && plan.find((c) => c.domain === "light").service === "turn_off"
     && A.bulkSwitchPlan(["lock.a"], true, new Set(["lock"]))[0].service === "unlock", plan);
  const { ROW_SWITCH_DOMAINS } = await import("@/utils/quickAction");
  const { summaryRows } = await import("@/config/summaryRows");
  const ents = { "lock.a": e("lock.a", "locked"), "switch.s": e("switch.s", "off"), "sensor.t": e("sensor.t", "21") };
  const r = summaryRows(Object.keys(ents), { entities: ents, mapped: new Set(Object.keys(ents)), suppressed: new Set(), filterSuppressed: true, mayListUnmapped: true });
  ck("a heading's switch addresses every device a row switches — a lock and a lone switch included, a reading never",
     ROW_SWITCH_DOMAINS.has("lock") && r.toggleables.map((x) => x.entity_id).sort().join() === "lock.a,switch.s", r.toggleables.map((x) => x.entity_id));
}

done("✅ one meaning of on; one call per domain; an offline measurement keeps its chart");
