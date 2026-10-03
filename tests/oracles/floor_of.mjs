// Which floor a mesh is on, and the two questions asked of it
// (src/babylon/floorOf.ts, round 9, 2.496.140). FloorManager used a fixed
// 2.8 m height split for every non-structure mesh — the rule storeys.ts
// retired everywhere else — and three readers found its stamp three ways.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const F = await import("@/babylon/floorOf");
const { Storeys } = await import("@/babylon/storeys");

const sq = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const entity = { isStructure: false, level: 0 };

console.log("  a mesh's floor:");
ck("structure keeps its pipeline level (0-based → floor 1-based)", F.floorOf({ isStructure: true, level: 1 }, 0.5, null) === 2);
// A two-storey plan whose upper floor is LOW (2.2 m) and a three-storey one.
const low = new Storeys([
  { name: "a", floorY: 0, storey: 1, pts: sq(0, 5, 0, 5) }, { name: "b", floorY: 2.2, storey: 2, pts: sq(0, 5, 0, 5) },
]);
ck("upstairs over a 2.2 m slab: a table lamp at 2.7 m is on 2F (the fixed split said 1F)",
   F.floorOf(entity, 2.7, low) === 2 && F.floorOf(entity, 2.7, null) === 1);
ck("  ...a ceiling lamp at 2.1 m, centimetres under that slab, is still 1F", F.floorOf(entity, 2.1, low) === 1);
const three = new Storeys([
  { name: "a", floorY: 0, storey: 1, pts: sq(0, 5, 0, 5) }, { name: "b", floorY: 3, storey: 2, pts: sq(0, 5, 0, 5) },
  { name: "c", floorY: 6, storey: 3, pts: sq(0, 5, 0, 5) },
]);
ck("a third storey exists (the fixed split capped at 2F)", F.floorOf(entity, 7, three) === 3 && F.floorOf(entity, 7, null) === 2);
const one = new Storeys([{ name: "a", floorY: 0, storey: 1, pts: sq(0, 5, 0, 5) }]);
ck("a plan of ONE storey cannot say: the height split decides (upstairs stays upstairs)", F.floorOf(entity, 4, one) === 2);
ck("no plan, no structure levels: the height split", F.floorOf(entity, 2.9, null) === 2 && F.floorOf(entity, 2.7, null) === 1);

console.log("\n  no plan, but the model's own storeys (2.496.261 — no plan meant two floors):");
const struct = F.structureFloors([
  { role: { isStructure: true, level: 0 }, minY: -0.1 }, { role: { isStructure: true, level: 0 }, minY: 0 },
  { role: { isStructure: true, level: 1 }, minY: 3.1 }, { role: { isStructure: true, level: 2 }, minY: 6.2 },
  { role: { isStructure: false, level: 0 }, minY: 9 },
]);
ck("the structure's storeys, lowest point each, lowest first (non-structure ignored)",
   JSON.stringify(struct) === JSON.stringify([{ floor: 1, y: -0.1 }, { floor: 2, y: 3.1 }, { floor: 3, y: 6.2 }]), struct);
ck("a top-floor lamp is on 3F (the fixed split said 2F)", F.floorOf(entity, 7, null, struct) === 3 && F.floorOf(entity, 7, null) === 2);
ck("  ...with the plan's clearance: a ceiling lamp just under the 3F slab stays on 2F", F.floorOf(entity, 6.3, null, struct) === 2);
ck("  ...a plan of two storeys or more still decides first", F.floorOf(entity, 7, three, [{ floor: 1, y: 0 }, { floor: 2, y: 100 }]) === 3);
ck("  ...one structure level says nothing: the height split", F.floorOf(entity, 4, null, [{ floor: 1, y: 0 }]) === 2);
const { STOREY_MIN_MOUNT } = await import("@/babylon/storeys");
ck("  ...the clearance IS the plan's (import-free copy held equal)", F.FLOOR_MIN_MOUNT === STOREY_MIN_MOUNT);

console.log("\n  the stairs:");
ck("a stair trigger goes one floor up / down among the floors the model has, any number of them",
   F.stairTarget([1, 2, 3], 2, true) === 3 && F.stairTarget([1, 2, 3], 2, false) === 1 && F.stairTarget([3, 1, 2], 1, true) === 2);
ck("  ...and nowhere past the top or the bottom", F.stairTarget([1, 2], 2, true) === null && F.stairTarget([1, 2], 1, false) === null);

console.log("\n  finding the stamp:");
const stamped = (f, parent = null) => ({ metadata: f === undefined ? {} : { floorIndex: f }, parent });
ck("its own stamp", F.stampedFloor(stamped(2)) === 2);
ck("a split primitive's stamp is on its parent", F.stampedFloor(stamped(undefined, stamped(2))) === 2);
ck("the first node that has one wins: a fan's mesh before its unstamped anchor container",
   F.stampedFloor(stamped(2), stamped(undefined, stamped(undefined))) === 2
   && F.stampedFloor(stamped(undefined), stamped(1)) === 1);
ck("none anywhere: undefined (and null nodes are skipped)", F.stampedFloor(null, undefined, stamped(undefined)) === undefined);
ck("a non-number stamp is none", F.stampedFloor({ metadata: { floorIndex: "2" } }) === undefined);

console.log("\n  the two questions:");
ck("on the active floor: its own only; unstamped counts", F.onActiveFloor(1, 1) && !F.onActiveFloor(1, 2) && !F.onActiveFloor(2, 1) && F.onActiveFloor(undefined, 2));
ck("rendered: the active floor and every one below it", F.isRenderedFloor(1, 2) && F.isRenderedFloor(2, 2) && !F.isRenderedFloor(3, 2) && F.isRenderedFloor(undefined, 1));

console.log("\n  the callers:");
const src = (p) => readFileSync(new URL(`../../src/babylon/${p}`, import.meta.url), "utf8");
const fm = src("FloorManager.ts"), sm = src("SceneManager.ts");
ck("FloorManager decides through floorOf with the plan AND the structure's storeys, and holds no height constant of its own",
   /floorOf\(role, centreY, this\.plan, structure\)/.test(fm) && /const structure = structureFloors\(this\.indexed\);/.test(fm) && !/FLOOR_SPLIT_Y\s*=/.test(fm));
ck("the stair triggers go through stairTarget; no floor number is written into them",
   /stairTarget\(this\.floorsDetected, this\.currentFloor, true\)/.test(fm) && /stairTarget\(this\.floorsDetected, this\.currentFloor, false\)/.test(fm)
   && !/currentFloor === [12]/.test(fm) && !/switchToFloor\([12]\)/.test(fm));
ck("the pipeline's texture carriers are on no floor (the lightmap ones were filed under 2F)",
   /\/\^BAKED_\.\*Carrier\/\.test\(m\.name\)\) continue;/.test(fm));
ck("SceneManager hands FloorManager the plan it builds", /this\.floors\.setPlan\(plan\)/.test(sm));
const readers = ["EntityVisuals.ts", "SceneManager.ts", "fanRigs.ts", "structureSet.ts"];
const raw = readers.filter((f) => /metadata[^;\n]*\)\?\.floorIndex/.test(src(f)));
ck("no reader digs the stamp out of metadata itself", raw.length === 0, raw);
ck("the badges and outlines ask onActiveFloor; the fans ask isRenderedFloor",
   /onActiveFloor\(stampedFloor\(mesh, lbl\.anchor\)/.test(src("EntityVisuals.ts"))
   && /onActiveFloor\(stampedFloor\(m\)/.test(sm) && /isRenderedFloor\(stampedFloor\(rig\[0\]\.mesh\)/.test(src("fanRigs.ts")));

done("✅ one floor authority");
