// IS THIS DEVICE IN TROUBLE, IN USE OR AT REST: one answer, projected by every surface (architecture review,
// 2026-10-26). Six places answered it (BinarySensorClasses' alertStateFor / problemStateOf / alertIsFault / inUse /
// glowsRoom, deviceActivity's lock branch and its private inUseNow, a dead second filter in the Cockpit's alarms);
// config/deviceCondition answers it now, and this drives one table of class × state through it and through each
// surface the owner sees, by value:
//
//   the badge's corner mark, a linked entity's bottom-right pill, the 3D object (tint, pulse), the room's glow, the
//   room's number (groupLook → roomHealth), a line in the Cockpit's "Needs attention", and the window's red.
//
// ⚠️ THE ONE DIFFERENCE IS THE WINDOW'S (owner, 2026-10-26: "reserve the ! for devices that are really in error", then
// "keep red there"): in use is calm on the map and in the Cockpit, and red in its window and history bar. The table's
// `window` column says it for every row, beside the condition the map reads.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { conditionOf, glowsRoom } = await import("@/config/deviceCondition");
const { deviceLook, storeLookSource, readingOf, meshLookFor, groupLook } = await import("@/utils/deviceActivity");
const { roomHealth } = await import("@/babylon/summaryLook");
const { binaryLook } = await import("@/config/binaryLook");
const { statusKeyFor } = await import("@/utils/stateColors");
const { buildAttentionItems } = await import("@/config/attention");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { devicesOf } = await import("../consistency/devices.mjs");

// [type, entity id, device_class, state, condition (map, Cockpit), red in its window]
const TABLE = [
  ["binary_sensor", "binary_sensor.leak", "moisture", "on", "wrong", true],
  ["binary_sensor", "binary_sensor.leak", "moisture", "off", "rest", false],
  ["binary_sensor", "binary_sensor.smoke", "smoke", "on", "wrong", true],
  ["binary_sensor", "binary_sensor.batt", "battery", "on", "wrong", true],
  ["binary_sensor", "binary_sensor.ap", "connectivity", "off", "wrong", true],
  ["binary_sensor", "binary_sensor.ap", "connectivity", "on", "rest", false],
  ["binary_sensor", "binary_sensor.hall", "motion", "on", "inUse", true],
  ["binary_sensor", "binary_sensor.hall", "motion", "off", "rest", false],
  ["binary_sensor", "binary_sensor.desk", "occupancy", "on", "inUse", true],
  // a presence sensor has no problem state: in use on the map, never red in its window either
  ["binary_sensor", "binary_sensor.home", "presence", "on", "inUse", false],
  ["binary_sensor", "binary_sensor.door", "door", "on", "inUse", true],
  ["binary_sensor", "binary_sensor.door", "door", "off", "rest", false],
  ["binary_sensor", "binary_sensor.pane", "window", "on", "inUse", true],
  ["binary_sensor", "binary_sensor.bolt", "lock", "on", "inUse", true],
  // no class: its id names a detection ("…_pir") or nothing (a bare "on" is a problem, as ever)
  ["binary_sensor", "binary_sensor.garden_pir", undefined, "on", "inUse", true],
  ["binary_sensor", "binary_sensor.thing", undefined, "on", "wrong", true],
  ["binary_sensor", "binary_sensor.plug", "plug", "on", "rest", false],
  ["binary_sensor", "binary_sensor.leak", "moisture", "unavailable", "lost", false],
  ["binary_sensor", "binary_sensor.leak", "moisture", "unknown", "noValue", false],
  ["lock", "lock.front", undefined, "locked", "rest", false],
  ["lock", "lock.front", undefined, "unlocked", "inUse", true],
  ["lock", "lock.front", undefined, "open", "inUse", true],
  ["lock", "lock.front", undefined, "jammed", "wrong", true],
  ["lock", "lock.front", undefined, "locking", "rest", false],
  ["lock", "lock.front", undefined, "unavailable", "lost", false],
  ["lock", "lock.front", undefined, "unknown", "noValue", false],
  ["sensor", "sensor.alarm_panel", undefined, "triggered", "wrong", true],
  ["sensor", "sensor.temp", "temperature", "21", "rest", false],
  ["light", "light.lamp", undefined, "on", "rest", false],
];

// What each condition looks like on the map and in the Cockpit: the badge's top-right mark, the bottom-right pill of a
// device it is the linked entity of (null: on or off, its power, no mark), the room's number, a Cockpit alarm line.
// At rest a lock on its way ("locking") wears the teal "…" of a move, never a problem (MOVING below).
const MAP = {
  wrong:   { mark: "alarm", pill: "alarm", health: "alert", cockpit: true },
  inUse:   { mark: "active", pill: "on", health: "ok", cockpit: false },
  rest:    { mark: null, pill: null, health: "ok", cockpit: false },
  lost:    { mark: "lost", pill: "lost", health: "unavailable", cockpit: false },
  noValue: { mark: null, pill: null, health: "ok", cockpit: false },
};
const MOVING = new Set(["lock front locking"]);
const markWanted = (s) => (MOVING.has(s.row) ? "moving" : MAP[s.want].mark);

const seen = TABLE.map(([type, id, dc, state, want, windowRed]) => {
  const entity = { entity_id: id, state, attributes: dc ? { device_class: dc } : {} };
  const host = "switch.host";   // a device this one is the linked entity of
  const entities = { [id]: entity, [host]: { entity_id: host, state: "off", attributes: {} } };
  const entityMap = { [id]: { entityId: id, type }, [host]: { entityId: host, type: "switch", linkedEntityId: id } };
  const src = storeLookSource(entities, { entityMap, isHidden: () => false });
  const look = deviceLook(id, src);
  const mesh = meshLookFor(readingOf(id, src));
  const items = buildAttentionItems({ devices: devicesOf({ ids: [id] }), entities, entityMap, resolvedRooms: {},
    fmData: EMPTY_FM_DATA });
  const window = type === "binary_sensor" ? binaryLook(id, dc).danger(state) : statusKeyFor(state, type) === "alert";
  return {
    row: `${type}${dc ? `/${dc}` : ""} ${id.split(".")[1]} ${state}`, want, windowRed,
    condition: conditionOf(type, entity),
    mark: look.mark, pill: deviceLook(host, src).linkPill,
    health: roomHealth(groupLook([look], { showingDevices: false })),
    cockpit: items.some((i) => i.kind === "alarm" && i.entityId === id),
    mesh, window,
    glows: type === "binary_sensor" && state === "on" && glowsRoom(id, dc),
  };
});
const miss = (pred) => seen.filter((s) => !pred(s)).map((s) => ({ ...s, mesh: JSON.stringify(s.mesh) }));

console.log("  the condition, read once:");
ck("every row reads the condition the table says (a leak, smoke, a low battery, a lost link, a jammed lock are wrong; a "
   + "detection, a door, window or lock open are in use)", miss((s) => s.condition === s.want).length === 0,
   miss((s) => s.condition === s.want));

console.log("\n  the map and the Cockpit project it:");
const pillOk = (s) => (MOVING.has(s.row) ? s.pill === "moving"
  : MAP[s.want].pill === null ? s.pill === "on" || s.pill === "off" : s.pill === MAP[s.want].pill);
const meshOk = (s) => (s.mesh.kind === "pulse" ? s.mesh.on === (s.want === "wrong")
  : s.mesh.kind === "tint" ? (s.mesh.tone === "alert") === (s.want === "wrong") && (s.mesh.tone === "open") === (s.want === "inUse")
  : true);
ck("the badge's corner: the red \"!\" only when wrong, the plain dot in use, nothing at rest",
   miss((s) => s.mark === markWanted(s)).length === 0, miss((s) => s.mark === markWanted(s)));
ck("  ...a linked entity's pill: the same mark, in use the filled \"on\" dot; at rest only its power",
   miss(pillOk).length === 0, miss(pillOk));
ck("  ...the room's number: red only for what is wrong, never for a device in use",
   miss((s) => s.health === MAP[s.want].health).length === 0, miss((s) => s.health === MAP[s.want].health));
ck("  ...a line in \"Needs attention\" exactly when it is wrong",
   miss((s) => s.cockpit === MAP[s.want].cockpit).length === 0, miss((s) => s.cockpit === MAP[s.want].cockpit));
ck("  ...the 3D object: a sensor pulses, a lock is tinted red, only when wrong; a lock in use is tinted open",
   miss(meshOk).length === 0 && seen.some((s) => s.mesh.kind === "tint") && seen.some((s) => s.mesh.kind === "pulse"),
   miss(meshOk));
const glowWanted = seen.filter((s) => s.row.startsWith("binary_sensor") && s.row.endsWith(" on")
  && (s.want === "inUse" || s.want === "wrong")).map((s) => s.row);
ck("  ...a sensor's \"on\" glows its room when in use or wrong (someone there, a door open, a leak), never a plug",
   seen.filter((s) => s.glows).map((s) => s.row).join() === glowWanted.join() && glowWanted.length > 0,
   seen.filter((s) => s.glows).map((s) => s.row));

console.log("\n  the window keeps red (owner, 2026-10-26: \"keep red there\"):");
ck("its window and history bar are red for every row the table says, in use included",
   miss((s) => s.window === s.windowRed).length === 0, miss((s) => s.window === s.windowRed));
ck("  ...so the one difference with the map: in use, red in the window and calm on the map (a door, motion, a lock)",
   ["binary_sensor/door door on", "binary_sensor/motion hall on", "lock front unlocked"]
     .every((r) => { const s = seen.find((x) => x.row === r); return s && s.window && s.mark === "active" && s.health === "ok" && !s.cockpit; }));

done("✅ one condition per device, projected by every surface");
