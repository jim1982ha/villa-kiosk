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
ck("a sensor with no problem state (motion, a door nobody watches): on = active, off = idle", binaryStatus("on") === "active" && binaryStatus("off") === "idle");
// owner, 2026-10-05: a server door read grey while closed
ck("a door/window/lock with no alert state: closed (secure) = active, open = idle — not an alert",
   binaryStatus("off", undefined, "off") === "active" && binaryStatus("on", undefined, "off") === "idle");
ck("  ...and an alert state set on it wins: open = alert, closed still active",
   binaryStatus("on", "on", "off") === "alert" && binaryStatus("off", "on", "off") === "active");
ck("unavailable stays unavailable, never green", binaryStatus("unavailable", "on") === "unavailable" && binaryStatus("unknown", "on") !== "active");
const panel = readFileSync(new URL("../../src/components/panels/SensorPanel.tsx", import.meta.url), "utf8");
const group = readFileSync(new URL("../../src/components/panels/DeviceGroupPanel.tsx", import.meta.url), "utf8");
const { binaryLook } = await import("@/config/binaryLook");
const { detectionStateFor, alertStateFor, secureStateFor } = await import("@/config/BinarySensorClasses");

console.log("\n  config/binaryLook, by value (2.496.285):");
const leak = binaryLook("binary_sensor.kitchen_leak", "moisture", undefined);
ck("a leak sensor: no leak = green pill 'No leak', a leak = danger pill 'Leak detected', red bar",
   leak.tone("off") === "on" && leak.word("off") === "No leak" && leak.tone("on") === "danger" && leak.word("on") === "Leak detected"
   && leak.color("on") === STATUS_COLOR.alert && leak.problem === "on");
const door = binaryLook("binary_sensor.door", "door", undefined);
ck("a door: closed green, open grey — and no problem state", door.tone("off") === "on" && door.tone("on") === "off" && door.problem === undefined);
const watched = binaryLook("binary_sensor.door", "door", "on");
ck("  ...the owner's alert state wins: open is danger", watched.tone("on") === "danger" && watched.danger("on") && watched.tone("off") === "on");
const pir = binaryLook("binary_sensor.hall", "motion", undefined);
ck("a motion sensor: quiet green, detection red in its window — yet not a problem (the map keeps it as information)",
   pir.color("off") === STATUS_COLOR.active && pir.color("on") === STATUS_COLOR.alert && pir.problem === undefined && !pir.danger("on")
   && ["motion", "occupancy"].every((c) => detectionStateFor(c) === "on") && alertStateFor("motion", undefined) === undefined);
ck("  ...only motion and occupancy are detectors; openings and locks have a secure state",
   ["door", "moisture", "presence", undefined].every((c) => detectionStateFor(c) === undefined)
   && ["door", "garage_door", "window", "opening", "lock"].every((c) => secureStateFor(c) === "off")
   && ["motion", "moisture", undefined].every((c) => secureStateFor(c) === undefined));
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
ck("  ...'Clear' and a quiet motion sensor green, an offline battery amber, an open door plain grey",
   rows["binary_sensor.det_smoke_clear"].tone === "on" && rows["binary_sensor.hall"].tone === "on"
   && rows["binary_sensor.det_battery"].tone === "unavailable" && rows["binary_sensor.gate"].tone === "off");
ck("  ...a measurement inside its limits takes no tone (plain secondary text)", rows["sensor.det_temperature"].tone === undefined);
const owned = readingRows(["binary_sensor.hall"], { "binary_sensor.hall": ent("binary_sensor.hall", "off", "motion") }, {},
  { "binary_sensor.hall": { alertState: "off" } });
ck("  ...the owner's alert state wins here too", owned[0].tone === "danger");
const list = readFileSync(new URL("../../src/components/panels/DeviceReadings.tsx", import.meta.url), "utf8");
const dash = readFileSync(new URL("../../src/pages/Dashboard.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../src/styles/04-modals.css", import.meta.url), "utf8");
ck("the list paints the tone, the page builds its rows here, and the tones have colours",
   /className=\{`panel-reading-value\$\{r\.tone \? ` \$\{r\.tone\}` : ""\}`\}/.test(list)
   // the open panel's actions live in components/panels/useOpenPanelActions since architecture review 11
   && /readingsOf: identity\.readingsOf/.test(dash) && /readingRows\(readingsOf\(activePanel\.entityId\)/.test(readFileSync(new URL("../../src/components/panels/useOpenPanelActions.ts", import.meta.url), "utf8"))
   && ["on", "danger", "unavailable"].every((t) => new RegExp(`\\.panel-reading-value\\.${t} \\{ color: var\\(--status-`).test(css)));
done("✅ a detector finding nothing wrong reads green, on its pill and its history");
