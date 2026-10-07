// The ceilings while walking (owner, 2026-10-07: "I see the sky above the visitor on 2F indoors … the roof must
// not appear in overview, nor when the person is outdoors on 2F"). Indoors is "a ceiling is over the eye", taken
// at once; outdoors only after OUTDOOR_DELAY_MS clear, so a doorway does not blink every lid. The pure rule as a
// table, then the REAL StructureSet on Babylon's NullEngine: a room with a lid beside an open terrace.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { Vector3 } = await import("@babylonjs/core/Maths/math.vector.js");
const { MeshBuilder } = await import("@babylonjs/core/Meshes/meshBuilder.js");
const { FreeCamera } = await import("@babylonjs/core/Cameras/freeCamera.js");
const C = await import("@/babylon/ceilingCover");
const { StructureSet } = await import("@/babylon/structureSet");

// ---- the rule, as a table ------------------------------------------------------------------------------
let s = C.START_COVER;
s = C.nextCover(s, false, 1000);
ck("one look with no ceiling over the eye is not outdoors yet (a doorway)", s.indoors && s.clearSince === 1000, s);
s = C.nextCover(s, true, 1200);
ck("  ...a ceiling again: indoors, the hold forgotten", s.indoors && s.clearSince === null, s);
s = C.nextCover(C.nextCover(s, false, 2000), false, 2000 + C.OUTDOOR_DELAY_MS);
ck("clear for the whole hold: outdoors", !s.indoors, s);
ck("  ...and one ceiling over the eye is indoors at once", C.nextCover(s, true, 2501).indoors);
ck("the overview never shows a lid, indoors or not",
   !C.ceilingsShown("overview", C.START_COVER) && C.ceilingsShown("first-person", C.START_COVER)
   && !C.ceilingsShown("first-person", { indoors: false, clearSince: null }));
ck("the ray is cast again after 20 cm or 250 ms, not every frame",
   !C.shouldRecheck({ x: 0, z: 0, at: 0 }, { x: 0.1, z: 0 }, 100) && C.shouldRecheck({ x: 0, z: 0, at: 0 }, { x: 0.25, z: 0 }, 100)
   && C.shouldRecheck({ x: 0, z: 0, at: 0 }, { x: 0, z: 0 }, 260));

// ---- the real StructureSet: a lidded room (x < 0) beside an open terrace (x > 0) ------------------------
const scene = new Scene(new NullEngine());
scene.activeCamera = new FreeCamera("c", new Vector3(0, 50, -50), scene);
const box = (name, x, y, z, w, h, d) => {
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z); m.computeWorldMatrix(true); return m;
};
box("Structure", 0, 3.0, 0, 20, 0.2, 10);                         // the 2F slab
const lid = box("room_ceiling", -5, 5.8, 0, 10, 0.05, 10);         // a lid over the room only
let renders = 0;
const set = new StructureSet({ requestRender: () => { renders += 1; }, worldExtents: () => ({ min: new Vector3(-10, 0, -5), max: new Vector3(10, 6, 5) }), eyeHeight: () => 1.6 });
set.apply(scene.meshes, "overview");
ck("the lid is a ceiling, hidden in the overview", set.ceilings.includes(lid) && !lid.isVisible, set.ceilings.map((m) => m.name));
set.setView("first-person");
ck("walking starts with the lid shown", lid.isVisible);
const eye = (x, now) => set.followEye({ x, y: 4.6, z: 0 }, now);
eye(-3, 0);
ck("in the room, under the lid: shown, indoors", lid.isVisible && set.indoors);
eye(3, 300);
ck("one step onto the terrace: still shown — the hold", lid.isVisible && set.indoors && renders > 0);
eye(3, 300 + C.OUTDOOR_DELAY_MS + 10);
ck("  ...clear for the hold: outdoors, the lid hidden (no roof seen from the terrace)", !lid.isVisible && !set.indoors);
eye(-3, 1500);
ck("back inside: the lid at once", lid.isVisible && set.indoors);
lid.setEnabled(false);
eye(-3.5, 2000); eye(-3.5, 2000 + C.OUTDOOR_DELAY_MS + 300);
ck("a storey switched off (above the active floor) is over nobody", !set.indoors);
lid.setEnabled(true);
set.setView("overview");
ck("back to the overview: no lid, whatever the walker was", !lid.isVisible);

done("✅ the ceilings follow the walker: over a room, never over a terrace, never in the overview");
