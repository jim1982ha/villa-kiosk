// "Is this a motion/presence sensor" — ONE answer
// (src/config/BinarySensorClasses.ts: isMotionSensor, MOTION_DEVICE_CLASSES).
//
// ⚠️ TWO COPIES TO 2.496.96: Dashboard's motion toast carried its own set of
// device_classes and its own id pattern under a comment claiming they were
// "the same id hints categoryForEntity uses" — they were not (the categoriser
// also read door/window/gate). And the toast accepted an id hint even when HA
// named another device_class, so a door contact called "pir_door" would have
// announced motion.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { isMotionSensor, MOTION_DEVICE_CLASSES } = await import("@/config/BinarySensorClasses");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

ck("by device_class: motion, presence, occupancy, moving", ["motion", "presence", "occupancy", "moving"].every((dc) => isMotionSensor("binary_sensor.x", dc)));
ck("a door contact is not motion", !isMotionSensor("binary_sensor.front_door", "door"));
ck("no device_class: the id names it (pir, occupancy)", isMotionSensor("binary_sensor.hall_pir", undefined) && isMotionSensor("binary_sensor.room_occupancy", undefined));
ck("a device_class wins over the id — 'pir_door' reported as a door is a door", !isMotionSensor("binary_sensor.pir_door", "door"));
ck("anchored: 'promotion_banner' is not motion", !isMotionSensor("binary_sensor.promotion_banner", undefined));
ck("only binary sensors", !isMotionSensor("sensor.motion_count", "motion"));

console.log("\n  the callers:");
const dash = readFileSync(new URL("../../src/pages/Dashboard.tsx", import.meta.url), "utf8");
const cats = readFileSync(new URL("../../src/config/EntityCategories.ts", import.meta.url), "utf8");
ck("the motion toast asks isMotionSensor", /if \(!isMotionSensor\(id, /.test(dash) && !/MOTION_DEVICE_CLASSES|motion\|presence/.test(dash));
ck("the categoriser reads the same list and hint", /MOTION_DEVICE_CLASSES\.has\(dc\)/.test(cats) && /MOTION_ID_HINT\.test\(id\)/.test(cats) && !/ACCESS_BINARY_DC/.test(cats));
ck("the list has one definition", MOTION_DEVICE_CLASSES.size === 4);

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one motion rule");
process.exit(fail ? 1 : 0);
