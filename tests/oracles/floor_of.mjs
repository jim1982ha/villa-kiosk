// Which floor a mesh is on, and the two questions asked of it
// (src/babylon/floorOf.ts, round 9, 2.496.140). FloorManager used a fixed
// 2.8 m height split for every non-structure mesh — the rule storeys.ts
// retired everywhere else — and three readers found its stamp three ways.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const F = await import("@/babylon/floorOf");
const { Storeys } = await import("@/babylon/storeys");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
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
ck("no plan: the height split", F.floorOf(entity, 2.9, null) === 2 && F.floorOf(entity, 2.7, null) === 1);

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
ck("FloorManager decides through floorOf with the plan, and holds no height constant of its own",
   /floorOf\(role, centreY, this\.plan\)/.test(fm) && !/FLOOR_SPLIT_Y\s*=/.test(fm));
ck("the pipeline's texture carriers are on no floor (the lightmap ones were filed under 2F)",
   /\/\^BAKED_\.\*Carrier\/\.test\(m\.name\)\) continue;/.test(fm));
ck("SceneManager hands FloorManager the plan it builds", /this\.floors\.setPlan\(plan\)/.test(sm));
const readers = ["EntityVisuals.ts", "SceneManager.ts", "fanRigs.ts", "structureSet.ts"];
const raw = readers.filter((f) => /metadata[^;\n]*\)\?\.floorIndex/.test(src(f)));
ck("no reader digs the stamp out of metadata itself", raw.length === 0, raw);
ck("the badges and outlines ask onActiveFloor; the fans ask isRenderedFloor",
   /onActiveFloor\(stampedFloor\(mesh, lbl\.anchor\)/.test(src("EntityVisuals.ts"))
   && /onActiveFloor\(stampedFloor\(m\)/.test(sm) && /isRenderedFloor\(stampedFloor\(rig\[0\]\.mesh\)/.test(src("fanRigs.ts")));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ one floor authority");
