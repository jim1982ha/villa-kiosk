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
ck("unavailable stays unavailable, never green", binaryStatus("unavailable", "on") === "unavailable" && binaryStatus("unknown", "on") !== "active");
ck("the history bar paints the same meaning", binarySensorColor("off", "on") === STATUS_COLOR.active && binarySensorColor("on", "on") === STATUS_COLOR.alert);
const panel = readFileSync(new URL("../../src/components/panels/SensorPanel.tsx", import.meta.url), "utf8");
ck("the status pill reads the same rule as its history bar",
   /STATUS_PILL_CLASS\[binaryStatus\(entity\?\.state === "on" \? "on" : "off", alertState\)\]/.test(panel)
   && /colorFor=\{\(s\) => binarySensorColor\(s, alertState\)\}/.test(panel));
done("✅ a detector finding nothing wrong reads green, on its pill and its history");
