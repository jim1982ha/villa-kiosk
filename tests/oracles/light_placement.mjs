// Where a light stands (src/babylon/lightPlacement.ts, round 7, 2.496.126):
// one pure answer the floor pool AND the lamp glow read. Every rule that used
// to live inside the pool module, testable only with a Babylon engine, is
// driven here with a scripted floor probe and the villa's storey shape.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const P = await import("@/babylon/lightPlacement");
const { Storeys } = await import("@/babylon/storeys");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const room = (name, floorY, x0, x1, z0, z1) => ({ name, floorY, pts: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }] });
const probe = (below, fresh = () => null) => ({ below, describeBelow: fresh });
// The villa's shape: a ground floor whose living room CONTAINS the stairwell
// (0.85 m: the tread at its centre, as the app measures it), a storey above.
const plan = new Storeys([
  room("Living Room", 0, -10, 10, -5, 5), room("Staircase", 0.85, 6, 9, -5, -2), room("Porch", 0, 2, 8, 5.5, 8),
  room("Corridor", 2.56, -10, 10, -5, 5), room("Bedroom", 2.56, -10, 0, 6, 9),
]);

console.log("  a ceiling lamp:");
{
  const at = P.placeLight(0, 0, 2.3, 0, probe(() => 0), plan);
  ck("its pool lies on the floor under it, in its room", at.surfaceY === 0 && at.room?.name === "Living Room" && !at.floorless);
  ck("  ...clipped to that room, at full reach", !!at.shape && at.radius === P.LIGHT_POOL_RADIUS && at.notes.includes("clipped"));
  ck("its glow is held back below the room's floor and stops at the storey above", at.glowFloorY === 0 && at.ceilingY === 2.56, at);
}
{
  const at = P.placeLight(0, 0, 2.3, 0, probe(() => 0.75), plan);
  ck("a probe answer on a table (0.75 m over a floor at 0) is lowered to the floor (2.496.72)", at.surfaceY === 0 && at.notes.includes("lowered"), at.surfaceY);
}
{
  const at = P.placeLight(0, 0, 2.3, 0, probe(() => 2.25, () => ({ y: 0 })), plan);
  ck("an answer stuck to the lamp's own ceiling is asked again, uncached, and the fresh one wins", at.surfaceY === 0 && at.notes.includes("corrected"), at);
}

console.log("\n  the stairs (2.496.116):");
{
  const at = P.placeLight(7.5, -3.5, 5.1, 0.85, probe(() => 0.85), plan);
  ck("a lamp over the staircase: its room is the staircase, not the living room around it", at.room?.name === "Staircase");
  ck("  ...which has no floor to lie on: no disc", at.floorless === true);
  ck("  ...its glow held back only below the STOREY's floor (every tread above it), stopping at 2.56", at.glowFloorY === 0 && at.ceilingY === 2.56, at);
  const step = P.placeLight(7.5, -3.5, 0.6, 0.46, probe(() => 0.46, () => ({ y: 0.46 })), plan);
  ck("a step light 14 cm over its tread: kept on the tread, the glow from the storey's floor", step.surfaceY === 0.46 && step.notes.includes("nearFixture") && step.glowFloorY === 0);
}

console.log("\n  outside every room:");
{
  const at = P.placeLight(10.5, 0, 2.3, 0, probe(() => 0), plan);
  ck("its reach is bounded by the nearest SAME-storey wall (0.5 m here)", at.room === null && Math.abs(at.radius - 0.5) < 1e-9 && at.notes.includes("bounded"), at.radius);
  const edge = P.placeLight(10.1, 0, 2.3, 0, probe(() => 0), plan);
  ck("  ...never below its minimum, so a lamp on a boundary still shows", edge.radius === P.POOL_MIN_RADIUS && edge.notes.includes("crushed"));
  const up = P.placeLight(10.5, 0, 5.0, 2.56, probe(() => 2.56), plan);
  ck("  ...upstairs, measured against upstairs walls only", Math.abs(up.radius - 0.5) < 1e-9);
  const over = P.placeLight(5, 9.5, 5.0, 2.56, probe(() => 2.56), plan);
  ck("  ...a ground-floor porch's wall 1.5 m below-beside an upstairs lamp in no room does not shrink it (the nearest upstairs wall is 4.5 m)",
     over.room === null && over.radius === P.LIGHT_POOL_RADIUS, { room: over.room?.name, radius: over.radius });
}
{
  // ⚠️ 2.496.139: over the porch's outline, upstairs, on a slab the plan draws
  // no room for. The porch was the only outline there and was named its room.
  const at = P.placeLight(5, 7, 5.0, 2.56, probe(() => 2.56), plan);
  ck("an upstairs lamp over a ground-floor room's outline is not in that room", at.room === null && at.notes.includes("bounded"), at.room?.name);
  ck("  ...its glow held back at ITS floor, not the porch's, and nothing above stops it (it was cut at 2.56, below the lamp)",
     at.glowFloorY === 2.56 && at.ceilingY === Infinity, { glowFloorY: at.glowFloorY, ceilingY: at.ceilingY });
}
{
  const at = P.placeLight(0, 0, 2.3, 0.02, probe(() => null), plan);
  ck("no floor found: the room by the lamp's height, the glow on the pool's first floor", at.surfaceY === null && at.room?.name === "Living Room" && at.glowFloorY === 0.02 && at.notes.includes("nofloor"), at);
}
{
  const at = P.placeLight(-5, 7, 5.0, 2.56, probe(() => 2.56), plan);
  ck("upstairs: its room is upstairs, and nothing above stops its glow", at.room?.name === "Bedroom" && at.ceilingY === Infinity, at);
}

console.log("\n  the callers:");
const src = (p) => readFileSync(new URL(`../../src/babylon/${p}`, import.meta.url), "utf8");
const set = src("lightPoolSet.ts");
ck("the pool set asks placement once a pool, and decides nothing itself", /placeLight\(/.test(set) && !/floorUnder\(|roomStandingOn\(|roomAt\(|isStairwell\(/.test(set));
ck("the glow's floor and ceiling are the placement's, not rebuilt from pool fields",
   /floorY: this\.placements\.get\(pool\)\?\.glowFloorY/.test(set) && /ceilingY: this\.placements\.get\(pool\)\?\.ceilingY/.test(set) && !/roomFloors/.test(set));
const bulbs = src("bulbSet.ts");
ck("BulbSet's pools are its own: tests go through lamps()", /private readonly pools: LightPoolSet;/.test(bulbs) && /lamps\(\)/.test(bulbs));
ck("the strength slider repaints the lights once — no second pool repaint, no shadow re-render",
   /this\.pools\.setStrength\(value\);\s*for \(const \{ meshes, reading \} of this\.readings\(\)\) this\.paintLights\(meshes, reading\);/.test(bulbs));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ where a light stands, answered once");
