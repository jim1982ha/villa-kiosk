// tests/oracles/villa_plan.mjs
// The villa's plan in the model's world (src/babylon/villaPlan.ts), on
// Babylon's NullEngine with the app's own floor probe and storeys
// (FloorProbe, FloorManager): a small two-storey house with a garden drawn
// round three sides of it, its devices at their plan points, mirrored and
// moved as a SweetHome export is.
//
// What a person sees: each room's highlight and viewpoint on its own floor;
// the garden's on the lawn, not on the house its middle lies on (2026-11-20:
// the rig read the garden at 2.1 m and terrace light stopped at the lawn);
// a curtain drawn aside or a row of lamps never moves the rooms.
import { ck, done } from "../consistency/check.mjs";
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { MeshBuilder } = await import("@babylonjs/core/Meshes/meshBuilder.js");
const { buildVillaPlan, flatFloorAt } = await import("@/babylon/villaPlan");
const { FloorProbe } = await import("@/babylon/floorProbe");
const { FloorManager } = await import("@/babylon/FloorManager");
const { pointInPolygon } = await import("@/utils/geometry");

// The plan (cm, y down) → the model (m): mirrored in x and moved, as the villa's export.
const toWorld = (px, py) => ({ x: 30 - px / 100, z: py / 100 - 5 });
const scene = new Scene(new NullEngine());
const structure = (mesh, level) => { mesh.metadata = { gltf: { extras: { vk_role: "structure", vk_level: level } } }; mesh.computeWorldMatrix(true); return mesh; };
/** A flat floor over the plan rectangle (cm), at height y. */
const floorAt = (name, px0, px1, py0, py1, y, level) => {
  const a = toWorld(px0, py0), b = toWorld(px1, py1);
  const g = MeshBuilder.CreateGround(name, { width: Math.abs(b.x - a.x), height: Math.abs(b.z - a.z) }, scene);
  g.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
  return structure(g, level);
};
// The house: plan x 200..800, y 0..600, its floor 0.3 m up on a plinth, the upper storey's at 3.2 m.
// The lawn round it, at 0, in three strips (nothing under the house but the house).
floorAt("lawn_w", 0, 200, 0, 800, 0, 0);
floorAt("lawn_e", 800, 1000, 0, 800, 0, 0);
floorAt("lawn_s", 200, 800, 600, 800, 0, 0);
floorAt("house", 200, 800, 0, 600, 0.3, 0);
floorAt("upper", 200, 800, 0, 600, 3.2, 1);
// A beam under the upper floor, across the house: never the house's floor.
const beam = MeshBuilder.CreateBox("beam", { width: 6, height: 0.3, depth: 0.3 }, scene);
beam.position.set(toWorld(500, 300).x, 2.9, toWorld(500, 300).z);
structure(beam, 0);

// Devices at their plan points, each a small mesh named by its id.
const entities = {};
const devices = new Map();
/** A mesh named `name` at the plan point (px, py) of its device (the name without its pose). */
const device = (name, px, py, y = 1, at = toWorld(px, py)) => {
  const id = name.replace(/__\w+$/, "");
  entities[id] ??= { x: px, y: py };
  const m = MeshBuilder.CreateBox(name, { size: 0.1 }, scene);
  m.position.set(at.x, y, at.z);
  devices.set(id, [...(devices.get(id) ?? []), m]);
  return m;
};
device("light.<room_a>", 300, 100); device("light.<room_b>", 700, 500); device("switch.<room_c>", 250, 550);
device("sensor.<garden>", 900, 700); device("light.<upper>", 400, 200, 4);
// A curtain drawn aside: its "__open" pose stands 3 m from its plan point.
device("cover.<curtain>__open", 600, 100, 1, toWorld(900, 100));
// A row of globes sharing a name, 5 m apart: averages to a point the plan never marked.
device("light.<globes>", 500, 700, 1, toWorld(300, 700));
device("light.<globes>", 500, 700, 1, toWorld(800, 700));

const rooms = [
  { name: "House", floor: 1, points: [{ x: 200, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 200, y: 600 }] },
  { name: "Upstairs", floor: 2, points: [{ x: 200, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 200, y: 600 }] },
  // Round three sides of the house: its middle (500, 470) lies on the house.
  { name: "Garden", floor: 1, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 600 }, { x: 800, y: 600 }, { x: 800, y: 0 },
    { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }] },
];
const floors = new FloorManager(scene, () => {});
floors.indexFloors(scene.meshes);
const probe = new FloorProbe(scene);
const villa = buildVillaPlan({ devices, entities, rooms, modelWidth: 10, modelDepth: 8, eyeHeight: 1.6 },
  { probe, storeyMeshes: (s) => floors.getFloorMeshes(s), hitsFloorAt: flatFloorAt(scene) });

const of = (name) => villa.rooms.find((r) => r.name === name);
ck("the fit is the devices' (an affine fit)", /^affine fit/.test(villa.strategy), villa.strategy);
ck("  ...from the devices that mark one place: not the curtain's pose, not the row of globes",
   villa.pairs.length === 5, villa.pairs.length);
const corner = of("House").pts.find((p) => Math.abs(p.x - toWorld(200, 0).x) < 0.01 && Math.abs(p.z - toWorld(200, 0).z) < 0.01);
ck("  ...so each room's outline lies where the model has it", !!corner, of("House").pts);
ck("the house's floor: its own, 0.3 m up, not the beam over it", Math.abs(of("House").floorY - 0.3) < 1e-6, of("House").floorY);
ck("upstairs: the upper storey's floor", Math.abs(of("Upstairs").floorY - 3.2) < 1e-6, of("Upstairs").floorY);
ck("the garden drawn round the house: on the lawn (0), not on the house its middle lies on", Math.abs(of("Garden").floorY) < 1e-6, of("Garden").floorY);
const S = villa.storeys;
const g = toWorld(900, 400), h = toWorld(500, 300);
ck("the storeys: standing on the lawn beside the house is the garden's", S.roomStandingOn(g.x, 0, g.z)?.name === "Garden", S.roomStandingOn(g.x, 0, g.z)?.name);
ck("  ...on the house's floor, the house's; on the upper floor, upstairs",
   S.roomStandingOn(h.x, 0.3, h.z)?.name === "House" && S.roomStandingOn(h.x, 3.2, h.z)?.name === "Upstairs",
   [S.roomStandingOn(h.x, 0.3, h.z)?.name, S.roomStandingOn(h.x, 3.2, h.z)?.name]);
ck("  ...two storeys", S.storeyStandingOn(0.3) === 1 && S.storeyStandingOn(3.2) === 2, [S.storeyStandingOn(0.3), S.storeyStandingOn(3.2)]);
const tp = villa.teleportPoints.find((p) => p.name === "Garden");
ck("each room's viewpoint stands in it, at eye height over its floor (the garden's on the lawn)",
   pointInPolygon(tp.position.x, tp.position.z, of("Garden").pts) && Math.abs(tp.position.y - 1.6) < 1e-6, tp.position);
done("✅ the villa's plan: every room on its own floor");
