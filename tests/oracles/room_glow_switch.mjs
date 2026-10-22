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
const { motionRouting } = await import("@/babylon/motionRouting");
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
  ck("the map paints what the routing says, with the switch (pin the painter)",
     /const route = motionRouting\(\{/.test(ev) && /enabled: this\.config\.roomGlowAndCones,/.test(ev)
     && /for \(const b of route\.beams\) this\.setBeamActive\(b\.cameraId, b\.on\);/.test(ev)
     && /for \(const r of route\.rooms\) this\.roomHighlight\.setActive\(r\.room, r\.on\);/.test(ev)
     && !/this\.roomHighlight\.setActive\(|this\.setBeamActive\(/.test(ev.replace(/for \(const [br] of route\.(beams|rooms)\)[^\n]*/g, "")));
  ck("switched live: every cone and glow off, then lit again from the sensors as they stand",
     /if \(config\.roomGlowAndCones !== prevGlows\) \{\s+this\.beams\.clearActive\(\);\s+this\.reapplyRoomGlows\(\);/.test(ev));
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
