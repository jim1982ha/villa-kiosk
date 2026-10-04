// A detector finding nothing wrong is GREEN "on / active", not grey "off"
// (owner, 2026-10-05: "'no leak' shall show an 'on / active' colour, as the
// device works as expected"). Pill and history bar read one rule.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { binaryStatus, binarySensorColor, STATUS_COLOR } = await import("@/utils/stateColors");

ck("a leak/smoke/gas sensor (problem state on): off = active (green), on = alert", binaryStatus("off", "on") === "active" && binaryStatus("on", "on") === "alert");
ck("a connectivity sensor (problem state off): on = active, off = alert", binaryStatus("on", "off") === "active" && binaryStatus("off", "off") === "alert");
ck("a sensor with no problem state (motion, a door nobody watches): on = active, off = idle", binaryStatus("on") === "active" && binaryStatus("off") === "idle");
// owner, 2026-10-05: a server door read grey while closed
ck("a door/window/lock with no alert state: closed (secure) = active, open = idle — not an alert",
   binaryStatus("off", undefined, "off") === "active" && binaryStatus("on", undefined, "off") === "idle");
ck("  ...and an alert state set on it wins: open = alert, closed still active",
   binaryStatus("on", "on", "off") === "alert" && binaryStatus("off", "on", "off") === "active");
ck("unavailable stays unavailable, never green", binaryStatus("unavailable", "on") === "unavailable" && binaryStatus("unknown", "on") !== "active");
ck("the history bar paints the same meaning", binarySensorColor("off", "on") === STATUS_COLOR.active && binarySensorColor("on", "on") === STATUS_COLOR.alert);
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

console.log("\n  every window asks it:");
ck("the sensor window takes its look from binaryLook (no combination of its own)",
   /const look = binaryLook\(/.test(panel) && /readingLevel\(entity, kind, threshold, look\.problem\)/.test(panel) && /colorFor=\{look\.color\}/.test(panel)
   && !/colourAlertStateFor|secureStateFor|binaryStatus\(/.test(panel));
ck("the grouped device window too: a binary member gets its pill and its history (it was grey text)",
   /binaryLook\(id, /.test(group) && /status-pill \$\{r\.look\.tone\(r\.value\)\}/.test(group) && /<LastDayTimeline entityId=\{r\.id\} colorFor=\{r\.look!\.color\} \/>/.test(group));
done("✅ a detector finding nothing wrong reads green, on its pill and its history");
