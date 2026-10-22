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
import { ck, done } from "../consistency/check.mjs";
const { isMotionSensor, MOTION_DEVICE_CLASSES } = await import("@/config/BinarySensorClasses");


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

// ── A CAMERA'S MOTION SENSOR IS ITS LINKED ENTITY (owner, 2026-10-22) ────────────────────────────────────────
// A camera had a field of its own for its motion sensor, beside "Linked entity" — and its long press toggled the
// linked entity. One field now: what it drives follows WHAT is linked (cameraMotionId — the rule above), and a long
// press opens the device's details, as on every other device.
console.log("\n  a camera's motion sensor is its linked entity:");
const { cameraMotionId } = await import("@/config/BinarySensorClasses");
{
  const dc = (map) => (id) => map[id];
  ck("a camera linked to a motion sensor watches with it (by its class, or its id with none)",
     cameraMotionId({ type: "camera", linkedEntityId: "binary_sensor.gate" }, dc({ "binary_sensor.gate": "motion" })) === "binary_sensor.gate"
     && cameraMotionId({ type: "camera", linkedEntityId: "binary_sensor.gate_pir" }, dc({})) === "binary_sensor.gate_pir");
  ck("  ...linked to a switch, or to a door contact: no motion", cameraMotionId({ type: "camera", linkedEntityId: "switch.cam_detect" }, dc({})) === undefined
     && cameraMotionId({ type: "camera", linkedEntityId: "binary_sensor.door" }, dc({ "binary_sensor.door": "door" })) === undefined);
  ck("  ...a light linked to a motion sensor is no camera: no beam", cameraMotionId({ type: "light", linkedEntityId: "binary_sensor.m" }, dc({ "binary_sensor.m": "motion" })) === undefined
     && cameraMotionId(undefined, dc({})) === undefined);
}
{
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const ev = strip(readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8"));
  const ph = strip(readFileSync(new URL("../../src/components/panels/panelHeader.ts", import.meta.url), "utf8"));
  const cp = strip(readFileSync(new URL("../../src/components/panels/CameraPanel.tsx", import.meta.url), "utf8"));
  ck("the beam and its room-glow fallback: the ONE link index, filtered by that rule — no second index (pin the callers)",
     /\.filter\(\(cam\) => cameraMotionId\(this\.config\.entityMap\[cam\], \(\) => deviceClass\) === sensorId\)/.test(ev)
     && /cameras: this\.camerasWatchedBy\(entity\.entity_id, deviceClass\),/.test(ev)
     && !/motionToCamera|buildMotionToCameraIndex/.test(ev));
  ck("the camera window's motion status, band and live dot: the header's motion, by the same rule",
     /const motionId = cameraMotionId\(\{ type: mapping\.type, linkedEntityId: linkedId \}/.test(ph)
     && /const motionActive = motion \? entities\[motion\.entityId\]\?\.state === "on" : false;/.test(cp) && /const motionId = motion\?\.entityId;/.test(cp));
  const db = strip(readFileSync(new URL("../../src/pages/Dashboard.tsx", import.meta.url), "utf8"));
  const long = /const onEntityLongPressed = useCallback\(([\s\S]*?)\n  \);/.exec(db)?.[1] ?? "";
  ck("a long press opens the device's details — a camera's too — and never switches anything",
     /go\(\{ type: "openDevice", panel: \{ entityId, mapping, detail: mapping\.type === "camera" \} \}\);/.test(long)
     && !/HAServices|callService|power\(|toggle/.test(long), long.length);
}

console.log("\n  the camera's bottom-right pill — someone passing is the camera at work, never its alarm:");
{
  const { deviceLook, storeLookSource } = await import("@/utils/deviceActivity");
  const ent = (id, state, dc) => ({ entity_id: id, state, attributes: dc ? { device_class: dc } : {} });
  const at = (state, dc = "motion", cfg = {}) => storeLookSource(
    { "camera.gate": ent("camera.gate", "idle"), "binary_sensor.gate": ent("binary_sensor.gate", state, dc) },
    { entityMap: { "camera.gate": { entityId: "camera.gate", type: "camera", linkedEntityId: "binary_sensor.gate" } }, isHidden: () => false, ...cfg });
  ck("motion on: a FILLED pill, not a red \"!\"; quiet: hollow — the camera's own corner clear",
     deviceLook("camera.gate", at("on")).linkPill === "on" && deviceLook("camera.gate", at("off")).linkPill === "off"
     && deviceLook("camera.gate", at("on")).mark === null);
  ck("  ...its other problems kept: lost, grey \"?\"; an open fault, amber \"!\" even while it sees someone",
     deviceLook("camera.gate", at("unavailable")).linkPill === "lost"
     && deviceLook("camera.gate", at("on", "motion", { hasFault: (id) => id === "binary_sensor.gate" })).linkPill === "fault");
  ck("  ...the sensor's own badge still reads someone passing as red (owner, 2026-10-21), a door's alarm still alarms the device",
     deviceLook("binary_sensor.gate", at("on")).mark === "alarm" && deviceLook("camera.gate", at("on", "door")).linkPill === "alarm");
}

console.log("\n  the saved setup's motion sensor moves into the linked entity (AppConfig.mergeMotionIntoLinked):");
{
  const { mergeMotionIntoLinked, normaliseConfig } = await import("@/config/AppConfig");
  const cfg = (entityMap) => ({ entityMap });
  const m = mergeMotionIntoLinked(cfg({
    "camera.a": { entityId: "camera.a", type: "camera", motionEntityId: "binary_sensor.a_motion" },
    "camera.b": { entityId: "camera.b", type: "camera", motionEntityId: "binary_sensor.b_motion", linkedEntityId: "switch.b_detect" },
    "light.c": { entityId: "light.c", type: "light", linkedEntityId: "switch.c", motionEntityId: "binary_sensor.c" },
    "camera.d": { entityId: "camera.d", type: "camera", linkedEntityId: "binary_sensor.d_motion" },
  })).entityMap;
  ck("a camera's motion sensor becomes its linked entity, the old key gone",
     m["camera.a"].linkedEntityId === "binary_sensor.a_motion" && !("motionEntityId" in m["camera.a"]));
  ck("  ...both set: the motion sensor wins, the switch link is dropped (owner, 2026-10-22)",
     m["camera.b"].linkedEntityId === "binary_sensor.b_motion" && !("motionEntityId" in m["camera.b"]));
  ck("  ...not a camera: the key dropped, its link untouched; a mapping without the key untouched",
     m["light.c"].linkedEntityId === "switch.c" && !("motionEntityId" in m["light.c"])
     && m["camera.d"].linkedEntityId === "binary_sensor.d_motion");
  const once = cfg(m);
  ck("  ...idempotent: a migrated setup comes back as it is (the same object)", mergeMotionIntoLinked(once) === once);
  const n = normaliseConfig({ entityMap: { "camera.e": { entityId: "camera.e", type: "camera", motionEntityId: "binary_sensor.e" },
    "camera.f": { entityId: "camera.f", type: "camera", linkedEntityId: "binary_sensor.f" } }, meshBindings: {} });
  ck("every config entering memory passes it (normaliseConfig — the store's pull too, which then pushes it back), and a camera's linked binary_sensor stays linked",
     n.entityMap["camera.e"].linkedEntityId === "binary_sensor.e" && !("motionEntityId" in n.entityMap["camera.e"])
     && n.entityMap["camera.f"].linkedEntityId === "binary_sensor.f");
}

done("✅ one motion rule; a camera's motion sensor is its linked entity");

