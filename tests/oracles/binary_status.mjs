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
ck("the status pill reads the same rule as its history bar",
   /STATUS_PILL_CLASS\[binaryStatus\(entity\?\.state === "on" \? "on" : "off", colourAlert, secureState\)\]/.test(panel)
   && /colorFor=\{\(s\) => binarySensorColor\(s, colourAlert, secureState\)\}/.test(panel));
// owner, 2026-10-05: an occupancy sensor quiet = green, a detection = red bars, as the camera's motion bar
const { detectionStateFor, alertStateFor } = await import("@/config/BinarySensorClasses");
ck("a motion or occupancy sensor: quiet = active (green), detecting = alert (red), in its window",
   ["motion", "occupancy"].every((c) => detectionStateFor(c) === "on")
   && binaryStatus("off", detectionStateFor("occupancy")) === "active" && binaryStatus("on", detectionStateFor("motion")) === "alert");
ck("  ...colours only: motion is still not a problem state for the map and alerts", alertStateFor("motion", undefined) === undefined
   && /const colourAlert = colourAlertStateFor\(/.test(panel) && /readingLevel\(entity, kind, threshold, alertState\)/.test(panel));
ck("  ...and only those two: a door, a leak sensor and a presence ('Home') are not detectors", ["door", "moisture", "presence", undefined].every((c) => detectionStateFor(c) === undefined));
const { secureStateFor } = await import("@/config/BinarySensorClasses");
ck("the secure state belongs to openings and locks only", ["door", "garage_door", "window", "opening", "lock"].every((c) => secureStateFor(c) === "off")
   && ["motion", "moisture", undefined].every((c) => secureStateFor(c) === undefined));
done("✅ a detector finding nothing wrong reads green, on its pill and its history");
