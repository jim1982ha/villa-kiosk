// Advanced Settings' "Room glow and camera cones" (owner, 2026-10-22): one switch, for every tablet, for what the map
// LIGHTS when presence is detected or a sensor triggers — a room's red floor glow (the camera's room-glow fallback
// included) and a camera's detection cone. Off: neither. On: today's map. The devices' own 3D objects keep their red
// pulse either way (owner's correction, 2026-10-22: "the 3D objects keep glowing red").
//
// Drives values through babylon/motionRouting (the routing EntityVisuals.applyMotionRouting paints), the device's mesh
// rule (meshLookFor), the config defaults and the shared store's row — then pins the painter to them.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { motionRouting, motionPaint } = await import("@/babylon/motionRouting");
const { EntityVisuals } = await import("@/babylon/EntityVisuals");
const { RoomHighlight } = await import("@/babylon/RoomHighlight");
const { meshLookFor, readingOf, storeLookSource } = await import("@/utils/deviceActivity");
const { DEFAULT_CONFIG, normaliseConfig } = await import("@/config/AppConfig");
const dc = await import("@/config/deviceConfig");
const J = JSON.stringify;

const base = {
  entityId: "binary_sensor.gate_motion", deviceClass: "motion", on: true, type: "binary_sensor", room: "Garden",
  cameras: [], hasBeam: () => true, cameraRoom: (c) => (c === "camera.yard" ? "Yard" : undefined), denied: false, enabled: true,
};
const route = (o) => motionRouting({ ...base, ...o });

console.log("  on (the default): today's map");
ck("a detector linked to a camera with a cone: the cone lights, its own room does not",
   J(route({ cameras: ["camera.gate"] })) === J({ beams: [{ cameraId: "camera.gate", on: true }], rooms: [] }));
ck("  ...a camera with no cone: the camera's room glows instead",
   J(route({ cameras: ["camera.yard"], hasBeam: () => false })) === J({ beams: [], rooms: [{ room: "Yard", on: true }] }));
ck("a sensor with a room: its room glows red; off: the glow goes",
   J(route({})) === J({ beams: [], rooms: [{ room: "Garden", on: true }] })
   && J(route({ on: false })) === J({ beams: [], rooms: [{ room: "Garden", on: false }] }));
ck("a door open glows its room too; a plain switch never", route({ entityId: "binary_sensor.d", deviceClass: "door" }).rooms.length === 1
   && route({ entityId: "switch.x", type: "switch", deviceClass: undefined }).rooms.length === 0);
ck("a profile denied motion sees neither", J(route({ denied: true, cameras: ["camera.gate"] })) === J({ beams: [], rooms: [] }));

console.log("\n  off: no floor glow, no cone — whatever triggered");
const OFF = [{}, { cameras: ["camera.gate"] }, { cameras: ["camera.yard"], hasBeam: () => false }, { deviceClass: "door" }, { on: false }];
ck("every case lights nothing", OFF.every((o) => J(route({ ...o, enabled: false })) === J({ beams: [], rooms: [] })));

console.log("\n  the devices themselves keep their red pulse, either way:");
{
  const entities = { "binary_sensor.leak": { entity_id: "binary_sensor.leak", state: "on", attributes: { device_class: "moisture" } } };
  const look = meshLookFor(readingOf("binary_sensor.leak", storeLookSource(entities, { entityMap: {}, isHidden: () => false })));
  ck("a triggered sensor's own 3D object pulses (meshLookFor reads no switch)", look.kind === "pulse" && look.on === true);
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const da = strip(readFileSync(new URL("../../src/utils/deviceActivity.ts", import.meta.url), "utf8"));
  const ev = strip(readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8"));
  const toMesh = /private applyToMesh\([\s\S]*?\n  \}\n/.exec(ev)?.[0] ?? "";
  ck("  ...neither the mesh rule nor the mesh painter reads the switch", !/roomGlowAndCones/.test(da) && toMesh.length > 0 && !/roomGlowAndCones/.test(toMesh));
  ck("the map paints what every sensor's routing says, with the switch (pin the painter)",
     /const route = motionRouting\(\{/.test(ev) && /enabled: this\.config\.roomGlowAndCones,/.test(ev)
     && /const paint = motionPaint\(this\.motionRoutes\.values\(\), \[before, route\]\);/.test(ev)
     && /for \(const b of paint\.beams\) this\.setBeamActive\(b\.cameraId, b\.on\);/.test(ev)
     && /for \(const r of paint\.rooms\) this\.roomHighlight\.setActive\(r\.room, r\.on\);/.test(ev)
     && !/this\.roomHighlight\.setActive\(|this\.setBeamActive\(/.test(ev.replace(/for \(const [br] of paint\.(beams|rooms)\)[^\n]*/g, "")));
  ck("switched live: every cone and glow off, then lit again from the sensors as they stand",
     /if \(config\.roomGlowAndCones !== prevGlows\) \{\s+this\.beams\.clearActive\(\);\s+this\.reapplyRoomGlows\(\);/.test(ev));
}

console.log("\n  two sensors in one room (2.496.501: the last one to report won):");
{
  // the map's real painter (EntityVisuals.applyMotionRouting, reapplyRoomGlows) on the real RoomHighlight, its meshes faked
  const rh = Object.create(RoomHighlight.prototype);
  const glow = { material: { alpha: 0 } }, hall = { material: { alpha: 0 } };
  Object.assign(rh, { polyRooms: new Map([["lounge", glow], ["hall", hall]]), pointRooms: new Map(), active: new Set(), requestRender() {} });
  const ev = Object.create(EntityVisuals.prototype);
  const sensors = { "binary_sensor.lounge_motion": ["motion", "Lounge"], "binary_sensor.lounge_door": ["door", "lounge "],
    "binary_sensor.hall_motion": ["motion", "Hall"] };
  Object.assign(ev, {
    roomHighlight: rh, mapping: new Map(), lastState: new Map(), motionRoutes: new Map(), linkedEntityIndex: new Map(),
    beams: { has: () => false, setActive() {}, clearActive() {} }, requestRender() {},
    resolvedRooms: Object.fromEntries(Object.entries(sensors).map(([id, [, room]]) => [id, room])),
    config: { ...DEFAULT_CONFIG, entityMap: Object.fromEntries(Object.keys(sensors).map((id) => [id, { entityId: id, type: "binary_sensor" }])) },
  });
  const report = (id, state) => {                // EntityVisuals.apply: the cache first, then the routing
    const entity = { entity_id: id, state, attributes: { device_class: sensors[id][0] } };
    ev.lastState.set(id, entity);
    ev.applyMotionRouting(entity);
  };
  const lit = (key) => rh.active.has(key);
  report("binary_sensor.lounge_motion", "on");
  ck("someone walks in: the lounge glows", lit("lounge"));
  report("binary_sensor.lounge_door", "on");
  report("binary_sensor.lounge_door", "off");
  ck("the door opens and closes while they are there: the lounge still glows (it went dark)", lit("lounge"), [...rh.active]);
  report("binary_sensor.hall_motion", "on");
  report("binary_sensor.hall_motion", "off");
  ck("  ...a sensor of another room changes nothing here", lit("lounge") && !lit("hall"), [...rh.active]);
  report("binary_sensor.lounge_door", "on");
  report("binary_sensor.lounge_motion", "off");
  ck("one of two clears first: the room glows while the other still reads on", lit("lounge"), [...rh.active]);
  report("binary_sensor.lounge_door", "off");
  ck("  ...and goes dark once both read off", !lit("lounge") && glow.material.alpha === 0, [...rh.active]);
  report("binary_sensor.lounge_motion", "on");
  report("binary_sensor.lounge_door", "on");
  ev.reapplyRoomGlows();
  report("binary_sensor.lounge_door", "off");
  ck("after the rooms are fitted again, the same: the lounge glows while its motion reads on", lit("lounge"), [...rh.active]);
  delete ev.resolvedRooms["binary_sensor.lounge_motion"];
  ev.reapplyRoomGlows();
  ck("a sensor no longer in the room (its room cleared) stops lighting it", !lit("lounge"), [...rh.active]);
  ck("the paint, as a value: a room any sensor lights stays lit, matched as the rooms are (case, spaces)",
     J(motionPaint([{ beams: [], rooms: [{ room: "Lounge", on: true }] }], [{ beams: [], rooms: [{ room: "lounge ", on: false }] }]))
       === J({ beams: [], rooms: [{ room: "lounge ", on: true }] }));
}

console.log("\n  the villa's switch, on by default:");
ck("on by default; a stored setup without the key reads on",
   DEFAULT_CONFIG.roomGlowAndCones === true && normaliseConfig({ entityMap: {}, meshBindings: {} }).roomGlowAndCones === true);
ck("shared with every tablet: a key of the central store, on when the store has never held it",
   dc.SHARED_CONFIG_KEYS.includes("roomGlowAndCones") && dc.baselineFromServer({}).roomGlowAndCones === true
   && dc.parseSharedConfig({ roomGlowAndCones: false }).roomGlowAndCones === false);

console.log("\n  where it is set (owner, 2026-10-22: in Settings, on the Map look row — no longer in Advanced Settings):");
{
  const st = readFileSync(new URL("../../src/components/settings/SettingsModal.tsx", import.meta.url), "utf8");
  const adv = readFileSync(new URL("../../src/components/settings/ConfigEditorModal.tsx", import.meta.url), "utf8");
  const row = /<div className="row badge-style-row"[\s\S]*?\n {8}<\/div>/.exec(st)?.[0] ?? "";
  ck("one more toggle on the Map look row, through Settings' one draft (Save keeps it, Cancel writes it back)",
     /"roomGlowAndCones",[^\]]*?\] as const;/.test(st) && /ariaLabel="Room glow and camera cones"/.test(row)
     && /slice\.set\(\{ roomGlowAndCones: !v\.roomGlowAndCones \}, \{ now: true \}\)/.test(row)
     && /\{can\("editConfig"\) && \(\s*<SegmentedGroup ariaLabel="Room glow and camera cones"/.test(row));
  ck("  ...its (i) says it applies to every tablet; Advanced Settings no longer has it",
     /It applies to every tablet\./.test(st) && !/roomGlowAndCones|Room glow/.test(adv));
}

done("✅ one switch for the room glow and the camera cones; the devices keep their own glow");
