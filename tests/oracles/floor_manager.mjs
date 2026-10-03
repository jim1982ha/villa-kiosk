// The REAL FloorManager on Babylon's NullEngine (2.496.262) — the wiring the
// floor_of oracle could only check by spelling. A three-storey model with
// stair triggers and no room plan: every mesh is stamped from the model's own
// storeys, and walking into the "up" trigger climbs 1 → 2 → 3 (the triggers
// were written as 1 → 2 and 2 → 1, so a third storey could never be reached,
// and with no plan a top-floor lamp was filed under 2F).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { Vector3 } = await import("@babylonjs/core/Maths/math.vector.js");
const { MeshBuilder } = await import("@babylonjs/core/Meshes/meshBuilder.js");
const { FreeCamera } = await import("@babylonjs/core/Cameras/freeCamera.js");
const { FloorManager } = await import("@/babylon/FloorManager");
const { stampedFloor } = await import("@/babylon/floorOf");

const scene = new Scene(new NullEngine());
scene.activeCamera = new FreeCamera("c", new Vector3(0, 50, -50), scene);
const box = (name, x, y, z, w = 20, h = 0.2, d = 20) => {
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z); m.computeWorldMatrix(true); return m;
};
// Three slabs, legacy structure names (Structure = level 0, Structure_L1, Structure_L2).
box("Structure", 0, 0.1, 0); box("Structure_L1", 0, 3.1, 0); box("Structure_L2", 0, 6.1, 0);
const lampTop = box("lamp_top", 2, 7.2, 2, 0.4, 0.4, 0.4);
const lampMid = box("lamp_mid", 2, 4.0, 2, 0.4, 0.4, 0.4);
const ceilingLamp = box("lamp_under_3f", 2, 5.95, 2, 0.4, 0.2, 0.4);   // hangs just under the 3F slab
box("trigger_stair_up", -8, 1, -8, 2, 2, 2);
box("trigger_stair_down", 8, 1, 8, 2, 2, 2);

const changes = [];
const fm = new FloorManager(scene, (f) => changes.push(f));
const pos = new Vector3(0, 1.7, 0);
fm.setCamera({ getPosition: () => pos, getFeetY: () => pos.y - 1.7 });
fm.indexFloors(scene.meshes);

ck("three storeys detected from the model alone (no plan)", fm.getFloorsDetected().join() === "1,2,3", fm.getFloorsDetected());
ck("a top-floor lamp is stamped 3F, a middle one 2F (no plan used to mean two floors)",
   stampedFloor(lampTop) === 3 && stampedFloor(lampMid) === 2, [stampedFloor(lampTop), stampedFloor(lampMid)]);
ck("  ...a ceiling lamp just under the 3F slab stays on 2F (the plan's clearance)", stampedFloor(ceilingLamp) === 2, stampedFloor(ceilingLamp));

const step = (x, z) => { fm.cooldownUntil = 0; pos.x = x; pos.z = z; scene.render(); };
step(-8, -8);
ck("walking into the UP trigger on 1F climbs to 2F", fm.getCurrentFloor() === 2, { now: fm.getCurrentFloor(), changes });
step(-8, -8);
ck("  ...and again to 3F — the old 1 → 2 / 2 → 1 triggers could never reach it", fm.getCurrentFloor() === 3, { now: fm.getCurrentFloor(), changes });
step(-8, -8);
ck("  ...and no further than the top", fm.getCurrentFloor() === 3);
step(8, 8);
ck("the DOWN trigger goes one floor down", fm.getCurrentFloor() === 2, { now: fm.getCurrentFloor(), changes });
step(0, 0);
ck("standing in neither changes nothing", fm.getCurrentFloor() === 2);
ck("3F hidden on 2F, 1F and 2F shown (cumulative downward)",
   !lampTop.isEnabled(false) && lampMid.isEnabled(false), [lampTop.isEnabled(false), lampMid.isEnabled(false)]);

done("✅ the floor manager, driven for real");
