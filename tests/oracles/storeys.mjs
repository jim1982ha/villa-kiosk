// Which storey a room, a height or a point is on (src/babylon/storeys.ts).
//
// ⚠️ THE VILLA'S OWN ROOMS, AS THE APP MEASURES THEM. A room's floor is one
// ray at its outline's centre (SceneManager.estimateFloorY), and a staircase's
// centre is a tread: measured on the villa GLB, the ground-floor staircase is
// 0.85 m, the upper one 1.11 m, the upstairs terrace 2.21 m. Height-only rules
// broke on exactly these (2.496.79: every ground-floor bulb cut off at the
// tread; the clearance rule sent a 2.3 m ceiling lamp to the staircase's storey
// and to no room at all). Replayed with and without the plan's storey numbers.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { Storeys, isStairwell } = await import("@/babylon/storeys");
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const sq = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const villa = (numbered) => [
  ["Living Room", 0, 1, sq(0, 10, 0, 10)], ["Kitchen", 0, 1, sq(10, 14, 0, 10)], ["Bedroom 1", 0, 1, sq(-6, 0, 0, 6)],
  ["Staircase", 0.85, 1, sq(-6, 0, 6, 10)], ["Gym Room", 2.56, 2, sq(0, 10, 0, 10)], ["Bedroom 3", 2.56, 2, sq(-6, 0, 0, 6)],
  ["Staircase", 1.11, 2, sq(-6, 0, 6, 10)], ["Tearrace 2F", 2.21, 2, sq(10, 14, 0, 10)],
].map(([name, floorY, storey, pts]) => ({ name, floorY, pts, ...(numbered ? { storey } : {}) }));

for (const numbered of [true, false]) {
  console.log(`\n  the villa's measured rooms, ${numbered ? "WITH the plan's storey numbers" : "with NO storey numbers (grouped by height)"}:`);
  const rooms = villa(numbered);
  const s = new Storeys(rooms);
  const byName = (n, i = 0) => rooms.filter((r) => r.name === n)[i];
  const g = s.storeyOf(byName("Living Room")), up = s.storeyOf(byName("Gym Room"));
  ck("two storeys", s.count === 2, s.count);
  ck("the ground-floor staircase (0.85 m) is on the ground storey", s.storeyOf(byName("Staircase", 0)) === g);
  ck("the terrace (2.21 m) is upstairs", s.storeyOf(byName("Tearrace 2F")) === up);
  // The upper staircase's tread at 1.11 m is between the storeys by height;
  // only the plan's number can place it, which is why the numbers win.
  if (numbered) ck("  ...and, by the plan's number, so is the upper staircase (1.11 m)", s.storeyOf(byName("Staircase", 1)) === up);
  ck("a storey's floor is what its rooms agree on — 0 and 2.56, not a tread",
     s.floorOf(g) === 0 && s.floorOf(up) === 2.56, [s.floorOf(g), s.floorOf(up)]);
  ck("above the ground storey: 2.56 (not the staircase's 0.85)", s.floorAbove(g) === 2.56, s.floorAbove(g));
  ck("above the top storey: nothing", s.floorAbove(up) === Infinity);
  ck("a ceiling lamp at 2.3 m is on the GROUND storey", s.storeyAt(2.3) === g, s.storeyAt(2.3));
  ck("  ...and in the room under it — it used to resolve to none",
     s.roomAt(5, 2.3, 5)?.name === "Living Room", s.roomAt(5, 2.3, 5)?.name ?? null);
  ck("a ground-floor lamp whose anchor sits at 2.60 m, just over the 2.56 slab, is still downstairs (the clearance)",
     s.storeyAt(2.6) === g, s.storeyAt(2.6));
  ck("an upstairs ceiling lamp at 4.9 m is upstairs, in the room above", s.roomAt(5, 4.9, 5)?.name === "Gym Room", s.roomAt(5, 4.9, 5)?.name ?? null);
  ck("a surface stood on at 0.02 m is the ground storey; at 2.58 upstairs",
     s.storeyStandingOn(0.02) === g && s.storeyStandingOn(2.58) === up);
  ck("the floor under a point on the stairs at 1 m is the staircase's", s.floorUnder(-3, 1, 8) === 0.85, s.floorUnder(-3, 1, 8));
  ck("the ground storey's rooms, for bounding a pool, exclude every upstairs room",
     s.roomsOn(g).every((r) => r.floorY < 2) && !s.roomsOn(g).some((r) => ["Gym Room", "Bedroom 3", "Tearrace 2F"].includes(r.name)),
     s.roomsOn(g).map((r) => r.name));
}

console.log("\n  the plan's other answers (one villa plan, 2.496.91):");
{
  // A split-level ground room — a lounge two steps up, on storey 1 in the plan.
  const rooms = [...villa(true), { name: "Lounge", floorY: 0.4, storey: 1, pts: sq(14, 20, 0, 10) }];
  const s = new Storeys(rooms);
  const oldGround = (() => {
    let gy = Infinity; for (const r of rooms) gy = Math.min(gy, r.floorY);
    return rooms.filter((r) => r.floorY <= gy + 0.30 && !isStairwell(r.name));
  })();
  ck("the OLD ground rule (lowest floor + 0.30 m) drops the split-level lounge", !oldGround.some((r) => r.name === "Lounge"));
  const ground = s.groundRooms().map((r) => r.name);
  ck("the ground rooms are the plan's lowest storey — the lounge included", ground.includes("Lounge") && ground.includes("Kitchen"), ground);
  ck("  ...no stairwell (its floor is a tread), nothing upstairs",
     !ground.includes("Staircase") && !ground.some((n) => ["Gym Room", "Bedroom 3", "Tearrace 2F"].includes(n)), ground);
  ck("the stairwell under a point is found; a living room is not one", s.stairwellAt(-3, 8)?.name === "Staircase" && s.stairwellAt(5, 5) === null);
  ck("a stairwell by any of the plan's languages", ["Staircase", "Escalier", "Treppe", "Front steps"].every(isStairwell) && !isStairwell("Living Room"));
  ck("standing on 2.56 over the living room: the gym above it; on 0.1: the living room",
     s.roomStandingOn(5, 2.56, 5)?.name === "Gym Room" && s.roomStandingOn(5, 0.1, 5)?.name === "Living Room");
  ck("standing outside every room: none", s.roomStandingOn(50, 0, 50) === null);
  const tie = new Storeys([{ name: "first", floorY: 0, pts: sq(0, 5, 0, 5) }, { name: "second", floorY: 0, pts: sq(0, 5, 0, 5) }]);
  ck("two rooms on one floor over one point: the FIRST listed (as a single-storey villa always did)", tie.roomStandingOn(1, 0, 1)?.name === "first");
  ck("no rooms: no ground rooms", new Storeys([]).groundRooms().length === 0);
}

console.log("\n  one plan, held once:");
{
  const SRC = new URL("../../src/", import.meta.url).pathname;
  const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(p) && out.push(p); } return out; };
  const files = walk(SRC).map((f) => ({ f: f.slice(SRC.length), src: readFileSync(f, "utf8") }));
  const builders = files.filter(({ src }) => /new Storeys(?:<[^>]*>)?\((?!\[\]\))/.test(src)).map(({ f }) => f);
  ck("only SceneManager builds a plan with rooms in it; everyone else is handed it",
     builders.length === 1 && builders[0] === "babylon/SceneManager.ts", builders);
  ck("roomStorey.ts is gone (folded into the plan)", !existsSync(new URL("../../src/babylon/roomStorey.ts", import.meta.url)));
  const heightRule = files.filter(({ src }) => /groundY \+|STAIR_FOOT_TOLERANCE/.test(src)).map(({ f }) => f);
  ck("no 'lowest floor + tolerance is the ground' rule is left", heightRule.length === 0, heightRule);
  // (A MESH-name word list for collision — structureSet's stairPat — is a
  // different question: which catalog piece is a stair, not which plan room.)
  const stairRe = files.filter(({ f, src }) => f !== "babylon/storeys.ts" && /STAIR_ROOM_RE/.test(src)).map(({ f }) => f);
  ck("the plan-room stairwell test lives in the plan alone", stairRe.length === 0, stairRe);
  const sm = files.find(({ f }) => f === "babylon/SceneManager.ts").src;
  ck("  ...and SceneManager hands the same plan to the camera and the visuals",
     (sm.match(/this\.camera\.setPlan\(plan\);/g) ?? []).length === 2 && (sm.match(/this\.visuals\.setPlan\(plan\);/g) ?? []).length === 2);
  ck("the stair foot and the coverage report read the plan's ground rooms",
     /groundRooms: \(\) => this\.plan\.groundRooms\(\),/.test(sm) && /this\.structure\.reportCoverage\(plan\);/.test(sm));
  // (The stair foot itself moved to walkerSpawn.ts in 2.496.98; it reads the
  //  plan's ground rooms through SpawnWorld — tests/oracles/walker_spawn.mjs.)
}

console.log("\n  the edges:");
{
  const s = new Storeys([{ name: "Living", floorY: 0, pts: sq(0, 5, 0, 5) }, { name: "Staircase", floorY: 0.85, pts: sq(5, 7, 0, 5) }]);
  ck("a staircase alone is no storey: one storey, nothing above", s.count === 1 && s.floorAbove(s.storeyAt(2.3)) === Infinity);
  const d = new Storeys([{ name: "a", floorY: 0, pts: sq(0, 5, 0, 5), storey: 1 }, { name: "b", floorY: 2.8, pts: sq(0, 5, 0, 5), storey: 1 }]);
  ck("one storey number for rooms metres apart is a default, not the plan's word — grouped by height",
     d.count === 2 && d.floorAbove(d.storeyStandingOn(0)) === 2.8, d.count);
  const e = new Storeys([]);
  ck("no rooms: no storey, nothing above, no room", e.storeyAt(1) === null && e.floorAbove(e.storeyAt(1)) === Infinity && e.roomAt(0, 1, 0) === null);
}

if (fail) { console.log(`  ${fail} FAILED`); process.exit(1); }
console.log("  all passed");
