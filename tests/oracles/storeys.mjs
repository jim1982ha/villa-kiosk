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
const { Storeys } = await import("@/babylon/storeys");

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
