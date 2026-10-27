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
const { motionRouting, motionLit, motionChanges, NOTHING_LIT } = await import("@/babylon/motionRouting");
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
  ck("the map paints what every sensor's routing says, with the switch, in ONE place (relight)",
     /const route = motionRouting\(\{/.test(ev) && /enabled: this\.config\.roomGlowAndCones,/.test(ev)
     && /const change = motionChanges\(this\.motionPainted, lit\);/.test(ev)
     && /for \(const b of change\.beams\) this\.setBeamActive\(b\.cameraId, b\.on\);/.test(ev)
     && /for \(const r of change\.rooms\) this\.roomHighlight\.setActive\(r\.room, r\.on\);/.test(ev)
     && !/this\.roomHighlight\.setActive\(|this\.setBeamActive\(/.test(ev.replace(/for \(const [br] of change\.(beams|rooms)\)[^\n]*/g, "")));
  // every event that changes what can be lit asks relight: a report, the switch, the rooms known or rebuilt, the cones
  // built (architecture review O: each that forgot to replay was a bug)
  const calls = (name) => { const i = ev.indexOf(name); return ev.slice(i, ev.indexOf("\n  }\n", i)); };
  ck("every event that changes what can be lit asks for the lit set as it is now",
     /if \(config\.roomGlowAndCones !== prevGlows\) this\.relight\(\);/.test(ev) && /this\.relight\(entity\);/.test(calls("  apply(entity: HassEntity): void {"))
     && /this\.relight\("rooms"\);/.test(calls("setPlan(plan")) && /this\.relight\("rooms"\);/.test(calls("setRoomPoints(points"))
     && /this\.relight\(\);/.test(calls("setResolvedRooms(rooms")) && /this\.relight\("beams"\);/.test(calls("private buildCameraBeams("))
     && (ev.match(/this\.relight\("beams"\);/g) ?? []).length === 2 && !/applyMotionRouting|reapplyRoomGlows|replayBeamMotion/.test(ev));
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
    roomHighlight: rh, mapping: new Map(), lastState: new Map(), motionRoutes: new Map(), motionPainted: NOTHING_LIT, linkedEntityIndex: new Map(),
    beams: { has: () => false, setActive() {}, clearActive() {} }, requestRender() {},
    resolvedRooms: Object.fromEntries(Object.entries(sensors).map(([id, [, room]]) => [id, room])),
    config: { ...DEFAULT_CONFIG, entityMap: Object.fromEntries(Object.keys(sensors).map((id) => [id, { entityId: id, type: "binary_sensor" }])) },
  });
  const report = (id, state) => {                // EntityVisuals.apply: the cache first, then the routing
    const entity = { entity_id: id, state, attributes: { device_class: sensors[id][0] } };
    ev.lastState.set(id, entity);
    ev.relight(entity);
  };
  const lit = (key) => rh.active.has(key);
  const lit2 = lit;
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
  ev.relight("rooms");
  report("binary_sensor.lounge_door", "off");
  ck("after the rooms are fitted again, the same: the lounge glows while its motion reads on", lit("lounge"), [...rh.active]);
  delete ev.resolvedRooms["binary_sensor.lounge_motion"];
  ev.relight("rooms");
  ck("a sensor no longer in the room (its room cleared) stops lighting it", !lit("lounge"), [...rh.active]);
  const litOf = (rs) => motionLit(rs);
  ck("the lit set, as a value: a room any sensor lights is lit, matched as the rooms are (case, spaces)",
     J([...litOf([{ beams: [], rooms: [{ room: "Lounge", on: true }] }, { beams: [], rooms: [{ room: "lounge ", on: false }] }]).rooms.keys()])
       === J(["lounge"]));
  const A = litOf([{ beams: [{ cameraId: "camera.gate", on: true }, { cameraId: "camera.pool", on: true }], rooms: [{ room: "Hall", on: true }] }]);
  const B = litOf([{ beams: [{ cameraId: "camera.pool", on: true }], rooms: [{ room: "hall", on: true }, { room: "Lounge", on: true }] }]);
  ck("  ...what to switch: only what differs (the hall stays as painted, the gate's cone goes, the lounge comes)",
     J(motionChanges(A, B)) === J({ beams: [{ cameraId: "camera.gate", on: false }], rooms: [{ room: "Lounge", on: true }] })
       && J(motionChanges(B, B)) === J({ beams: [], rooms: [] }));

  // the load orders the glow was lost in (owner, 2026-10-22: a sensor on before its room was known; a cone built after
  // its sensor's report): whatever the order, what is lit is the sensors as they stand
  rh.active.clear(); glow.material.alpha = 0;
  for (const k of Object.keys(ev.resolvedRooms)) delete ev.resolvedRooms[k];
  ev.relight("rooms");
  report("binary_sensor.lounge_motion", "on");
  const darkBefore = !lit2("lounge");
  ev.resolvedRooms["binary_sensor.lounge_motion"] = "Lounge";
  ev.relight();                                   // EntityVisuals.setResolvedRooms
  ck("a sensor already on before its room is known: its room glows as soon as the room is known", darkBefore && lit2("lounge"), [...rh.active]);
  const beamsOn = new Set();
  const cams = new Map([["binary_sensor.gate_motion", ["camera.gate"]]]);
  let built = false;
  Object.assign(ev, {
    beams: { has: (c) => built && c === "camera.gate", setActive() {}, clearActive() {} },
    camerasWatchedBy: (id) => cams.get(id) ?? [],
    setBeamActive: (c, on) => { if (built) { if (on) beamsOn.add(c); else beamsOn.delete(c); } return built; },
  });
  rh.polyRooms.set("gate", { material: { alpha: 0 } });
  ev.resolvedRooms["camera.gate"] = "Gate";
  sensors["binary_sensor.gate_motion"] = ["motion", "Gate"];
  report("binary_sensor.gate_motion", "on");      // no cone yet: the camera's room glows meanwhile
  const roomMeanwhile = lit2("gate");
  built = true;
  ev.relight("beams");                            // EntityVisuals.buildCameraBeams
  ck("a cone built after its sensor reported: lit at once, and the camera's room glow it stood in for goes",
     roomMeanwhile && beamsOn.has("camera.gate") && !lit2("gate"), [[...beamsOn], [...rh.active]]);
  beamsOn.clear();                                // the cones built again (a re-fit): new meshes, dark
  ev.relight("beams");
  ck("  ...the cones built again while it reads on: lit again", beamsOn.has("camera.gate"), [...beamsOn]);
  ev.config = { ...ev.config, roomGlowAndCones: false };
  ev.relight();                                   // EntityVisuals.updateConfig, switched off
  const allOff = beamsOn.size === 0 && rh.active.size === 0;
  ev.config = { ...ev.config, roomGlowAndCones: true };
  ev.relight();
  ck("the switch off: every glow and cone out; on: lit again from the sensors as they stand",
     allOff && beamsOn.has("camera.gate") && lit2("lounge"), [[...beamsOn], [...rh.active]]);
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
