// A detector finding nothing wrong is GREEN "on / active", not grey "off"
// (owner, 2026-10-05: "'no leak' shall show an 'on / active' colour, as the
// device works as expected"). Pill and history bar read one rule.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { binaryStatus, STATUS_COLOR } = await import("@/utils/stateColors");

ck("a leak/smoke/gas sensor (problem state on): off = active (green), on = alert", binaryStatus("off", "on") === "active" && binaryStatus("on", "on") === "alert");
ck("a connectivity sensor (problem state off): on = active, off = alert", binaryStatus("on", "off") === "active" && binaryStatus("off", "off") === "alert");
ck("a sensor with no problem state (presence, a plug): on = active, off = idle", binaryStatus("on") === "active" && binaryStatus("off") === "idle");
ck("unavailable stays unavailable, never green", binaryStatus("unavailable", "on") === "unavailable" && binaryStatus("unknown", "on") !== "active");
const panel = readFileSync(new URL("../../src/components/panels/SensorPanel.tsx", import.meta.url), "utf8");
const group = readFileSync(new URL("../../src/components/panels/DeviceGroupPanel.tsx", import.meta.url), "utf8");
const { binaryLook } = await import("@/config/binaryLook");
const { alertStateFor } = await import("@/config/BinarySensorClasses");
const { deviceLook, storeLookSource } = await import("@/utils/deviceActivity");
// the badge (deviceLook), for the window's own state: the same red for what is wrong; in use (owner, 2026-10-26: a door
// open, someone seen) is red in the window ("keep red there") and the plain dot on the badge
const badge = (dc, state) => deviceLook("binary_sensor.x", storeLookSource(
  { "binary_sensor.x": { entity_id: "binary_sensor.x", state, attributes: { device_class: dc } } }, { entityMap: {}, isHidden: () => false }));

console.log("\n  config/binaryLook, by value (2.496.285):");
const leak = binaryLook("binary_sensor.kitchen_leak", "moisture");
ck("a leak sensor: no leak = green pill 'No leak', a leak = danger pill 'Leak detected', red bar",
   leak.tone("off") === "on" && leak.word("off") === "No leak" && leak.tone("on") === "danger" && leak.word("on") === "Leak detected"
   && leak.color("on") === STATUS_COLOR.alert && leak.problem === "on");
const door = binaryLook("binary_sensor.door", "door");
// owner, 2026-10-05: a server door read grey while closed; 2026-10-21: "make sure the 'open' pill appears with the
// alarming style", then "the entity badge to follow the state of the entity"
ck("a door: closed green, open red in its window; on its badge open is the plain dot, never an alarm",
   door.tone("off") === "on" && door.tone("on") === "danger" && door.problem === "on" && door.danger("on")
   && badge("door", "on").mark === "active" && !badge("door", "on").alert && badge("door", "off").mark === null);
ck("  ...a window, a garage door, an opening and a binary lock alike",
   ["window", "garage_door", "opening", "lock"].every((c) => binaryLook("binary_sensor.x", c).tone("on") === "danger"
     && badge(c, "on").mark === "active" && !badge(c, "on").alert && alertStateFor(c) === "on"));
const pir = binaryLook("binary_sensor.hall", "motion");
ck("a motion or occupancy sensor: quiet green, a detection red in its window; the plain dot on its badge",
   pir.color("off") === STATUS_COLOR.active && pir.color("on") === STATUS_COLOR.alert && pir.problem === "on"
   && ["motion", "occupancy"].every((c) => alertStateFor(c) === "on" && badge(c, "on").mark === "active"
     && !badge(c, "on").alert && badge(c, "off").mark === null));
// the one rule: for EVERY class, the window's red state is the badge's red state
{
  const { binarySensorClassInfo } = await import("@/config/BinarySensorClasses");
  const classes = ["moisture", "smoke", "connectivity", "motion", "occupancy", "presence", "door", "window", "lock", "plug",
    "running", "update", undefined];
  // red in the window ⇔ red on the badge, or in use (the badge's plain dot) — the one exception, owner 2026-10-26
  const split = classes.flatMap((c) => ["on", "off"].filter((s) => {
    const red = binaryLook("binary_sensor.x", c).status(s) === "alert", b = badge(c, s);
    return b.alert ? !red : red && b.mark !== "active";   // a red badge is red here; red here is a red badge or in use
  }).map((s) => `${c}:${s}`));
  ck("for every class, a state is red in the window exactly when its badge is red or in use", split.length === 0
     && binarySensorClassInfo("door").alarmState === "on", split);
  ck("  ...in use is only a detection, a door, a window or a lock sensor: a leak, smoke, a lost link stay red on the badge",
     ["moisture", "smoke"].every((c) => badge(c, "on").mark === "alarm") && badge("connectivity", "off").mark === "alarm");
}
ck("unavailable stays unavailable, never green", leak.status("unavailable") === "unavailable" && leak.word("unavailable") === "Unavailable");

// Which windows ask binaryLook — and that none assembles a reading of its own —
// is tests/oracles/reading.mjs (config/reading, 2.496.305).

console.log("\n  \"Also on this device\" (config/readingRows, 2.496.297):");
const { readingRows } = await import("@/config/readingRows");
const ent = (id, state, dc) => ({ entity_id: id, state, attributes: dc ? { device_class: dc } : {}, last_changed: "", last_updated: "" });
const E = {
  "binary_sensor.det_smoke": ent("binary_sensor.det_smoke", "on", "smoke"),
  "binary_sensor.det_smoke_clear": ent("binary_sensor.det_smoke_clear", "off", "smoke"),
  "binary_sensor.det_battery": ent("binary_sensor.det_battery", "unavailable", "battery"),
  "binary_sensor.hall": ent("binary_sensor.hall", "off", "motion"),
  "binary_sensor.gate": ent("binary_sensor.gate", "on", "door"),
  "sensor.det_temperature": ent("sensor.det_temperature", "21", "temperature"),
};
const rows = Object.fromEntries(readingRows(Object.keys(E), E, {}, {}).map((r) => [r.id, r]));
ck("a grouped smoke detector's 'Smoke detected' is red in the list, as in its window",
   rows["binary_sensor.det_smoke"].text === "Smoke detected" && rows["binary_sensor.det_smoke"].tone === "danger");
ck("  ...'Clear' and a quiet motion sensor green, an offline battery amber, an open door red (as in its window)",
   rows["binary_sensor.det_smoke_clear"].tone === "on" && rows["binary_sensor.hall"].tone === "on"
   && rows["binary_sensor.det_battery"].tone === "unavailable" && rows["binary_sensor.gate"].tone === "danger");
ck("  ...a measurement inside its limits takes no tone (plain secondary text)", rows["sensor.det_temperature"].tone === undefined);
const list = readFileSync(new URL("../../src/components/panels/DeviceReadings.tsx", import.meta.url), "utf8");
const dash = readFileSync(new URL("../../src/pages/Dashboard.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../src/styles/04-modals.css", import.meta.url), "utf8");
ck("the list paints the tone, the page builds its rows here, and the tones have colours",
   /className=\{`panel-reading-value\$\{r\.tone \? ` \$\{r\.tone\}` : ""\}`\}/.test(list)
   // the open panel's actions live in components/panels/useOpenPanelActions since architecture review 11
   && /readingsOf: identity\.readingsOf/.test(dash) && /readingRows\(readingsOf\(activePanel\.entityId\)/.test(readFileSync(new URL("../../src/components/panels/useOpenPanelActions.ts", import.meta.url), "utf8"))
   && ["on", "danger", "unavailable"].every((t) => new RegExp(`\\.panel-reading-value\\.${t} \\{ color: var\\(--status-`).test(css)));
// owner, 2026-10-21: the laundry room glowed red on the map while its door sensor read Open — "keep it that way, it
// makes sense". The room glows for a detection and for a problem state "on" (an open door); never for an "on" that is
// good news (connected, plugged in). A detection is no fault (no line in Needs attention).
{
  const { detectsPresence } = await import("@/config/BinarySensorClasses");
  // a fault: the condition its problem state reads in (config/deviceCondition, owner 2026-10-26: alertIsFault is gone)
  const { conditionOf, glowsRoom } = await import("@/config/deviceCondition");
  const alertIsFault = (id, c) => { const p = alertStateFor(c);
    return p !== undefined && conditionOf("binary_sensor", { entity_id: id, state: p, attributes: { device_class: c } }) === "wrong"; };
  const { readFileSync } = await import("node:fs");
  const DETECT = ["motion", "moving", "occupancy", "presence"];
  const NOT = ["door", "window", "garage_door", "opening", "lock", "moisture", "smoke", "connectivity", "problem", undefined, "made_up"];
  const X = "binary_sensor.x";
  const det = (c) => detectsPresence(X, c), fault = (c) => alertIsFault(X, c), glows = (c) => glowsRoom(X, c);
  ck("a detection is a detection; a door, a window, a hazard or a bare sensor is not",
     DETECT.every(det) && !NOT.some(det), NOT.filter(det));
  // owner, 2026-10-26: in use is no fault either — a door, a window, a lock sensor open
  const USE = ["door", "window", "garage_door", "opening", "lock"];
  ck("  ...and a detection or a device in use is never a fault; everything else is",
     DETECT.every((c) => !fault(c)) && USE.every((c) => !fault(c)) && NOT.filter((c) => !USE.includes(c)).every(fault));
  ck("  ...its \"on\" glows its room: a detection, an open door or window, a leak — never connected, plugged, charging",
     [...DETECT, "door", "window", "opening", "moisture", undefined].every(glows)
     && !["connectivity", "plug", "battery_charging", "running"].some(glows));
  // architecture review, 2026-10-21: a sensor with no class named "…_pir" was the toast's motion AND a Cockpit fault
  ck("  ...with no class, its id names a detection — the same answer as the motion toast (isMotionSensor)",
     detectsPresence("binary_sensor.garden_pir", undefined) && !alertIsFault("binary_sensor.garden_pir", undefined)
     && glowsRoom("binary_sensor.garden_pir", undefined) && alertIsFault("binary_sensor.garden_door_x", undefined)
     && !detectsPresence("binary_sensor.garden_pir", "door"));
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  // the routing is babylon/motionRouting since 2026-10-22 (Advanced Settings' "Room glow and camera cones"), painted
  // by EntityVisuals.relight — room_glow_switch.mjs drives it by value
  const mr = readFileSync(new URL("../../src/babylon/motionRouting.ts", import.meta.url), "utf8");
  ck("  ...the map's room glow asks exactly that (motionRouting, painted by EntityVisuals.relight)",
     /if \(i\.type === "binary_sensor" && i\.room && glowsRoom\(i\.entityId, i\.deviceClass\)\) \{\s*return \{ beams: \[\], rooms: \[\{ room: i\.room, on: i\.on \}\] \};/.test(mr)
     // owner, 2026-10-22: an auto-detected sensor (its 3D object named after it, never saved) — its badge red, its room dark
     && /type: this\.mapping\.get\(entity\.entity_id\)\?\.type \?\? this\.config\.entityMap\[entity\.entity_id\]\?\.type,/.test(ev));
  // owner, 2026-10-22: a motion sensor already "on" when the map loaded never lit its room (rooms land after the
  // reveal; the glow only followed a CHANGE). Each time the rooms or their glows change, every glow is lit again from
  // the sensors as they stand now.
  const body = (name) => ev.slice(ev.indexOf(name), ev.indexOf("\n  }\n", ev.indexOf(name)));
  ck("  ...and lit again whenever the rooms are known or rebuilt, from the sensors as they stand now (room_glow_switch.mjs)",
     /for \(const entity of this\.lastState\.values\(\)\) this\.routeMotion\(entity\);/.test(ev)
     && ["setResolvedRooms(rooms", "setRoomPoints(points", "setPlan(plan"].every((m) => /this\.relight\((\"rooms\")?\);/.test(body(m))));
}

done("✅ a detector finding nothing wrong reads green, on its pill and its history");
