// Where a walker can stand (src/babylon/walkerSpawn.ts), on a test grid —
// the second adapter at SpawnWorld's seam; SceneManager's Babylon rays are
// the first.
//
// ⚠️ SIX RELEASES OF SPAWN FIXES, EACH FROM A SCREENSHOT, NONE UNDER A TEST
// (to 2.496.97): mid-flight on the stairs, the crawlspace beneath them, between
// open risers, a split-level floor probed from below. Replayed. And the leaks
// the extraction closed: the eye height the room viewpoints ignored, and a
// picked room placed from the slab UNDER a raised floor.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const S = await import("@/babylon/walkerSpawn");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const sq = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const inside = (x, z, s) => x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1;
/** A villa of horizontal slabs. floorAt is floorProbe's LOWEST hit (the ground slab). */
function world({ eye = 1.7, slabs = [], wells = [], ground = [] } = {}) {
  return {
    eyeHeight: eye,
    floorAt: () => 0,
    castUp: (x, y, z, len) => {
      let best = null;
      for (const s of slabs) if (inside(x, z, s) && s.y > y && s.y <= y + len && (!best || s.y < best.y)) best = { y: s.y, mesh: s.name };
      return best;
    },
    stairwellAt: (x, z) => wells.find((w) => inside(x, z, w)) ?? null,
    groundRooms: () => ground,
    openestFacing: (x, y, z) => ({ x: x + 3, y, z }),
  };
}
const R = (x0, x1, z0, z1, extra) => ({ x0, x1, z0, z1, ...extra });

console.log("  standing:");
{
  const w = world({ slabs: [R(0, 5, 0, 5, { y: 0.4, name: "raised_floor" }), R(0, 5, 0, 5, { y: 2.8, name: "ceiling" })] });
  const s = S.standAt(w, 2, 2, 1);
  ck("a split-level room: stood on its raised floor (0.4), not blocked by it (2.464.0)", s.ok && s.y === 0.4, s);
  const crawl = world({ slabs: [R(0, 5, 0, 5, { y: 1.0, name: "Stair_tread" })] });
  const c = S.standAt(crawl, 2, 2, 1);
  ck("under a staircase: refused, and the blocker is NAMED (2.459.0)", !c.ok && /Stair_tread/.test(c.why), c);
  const riser = world({ slabs: [R(1.6, 1.7, 0, 5, { y: 1.2, name: "tread" })] });
  ck("an open riser a centre ray threads is caught across the body's width", !S.standAt(riser, 2, 2, 1).ok, S.standAt(riser, 2, 2, 1));
  const well = world({ wells: [R(0, 5, 0, 5, { name: "Staircase" })] });
  const wl = S.standAt(well, 2, 2, 1);
  ck("inside a stairwell: refused by the plan, whatever the rays say (2.460.0)", !wl.ok && /stairwell "Staircase"/.test(wl.why), wl);
}

console.log("\n  the default spawn (ground floor; the staircase last):");
{
  const pt = (name, x, floor = 1) => ({ name, floor, position: { x, y: 0, z: 2 }, target: { x, y: 1.6, z: 4 } });
  const points = [pt("Bedroom 3", 2, 2), pt("Kitchen", 12), pt("Living Room", 22)];
  const w = world();
  let stairsAsked = false;
  const sp = S.pickSpawn(w, points, () => { stairsAsked = true; return pt("Staircase", 40); });
  ck("an arrival room (the living room) wins", sp.name === "Living Room" && !stairsAsked, sp.name);
  ck("  ...its eye on the stood surface + the eye height", sp.position.y === 1.7, sp.position.y);
  const blocked = world({ slabs: [R(20, 25, 0, 5, { y: 1.0, name: "sofa_loft" })] });
  ck("the living room unstandable: the next ground room, never the storey above",
     S.pickSpawn(blocked, points, () => pt("Staircase", 40)).name === "Kitchen");
  const roomsBlocked = world({ slabs: [R(0, 30, 0, 5, { y: 1.0, name: "loft" })] });
  ck("every room unstandable: the foot of the stairs, tried only then",
     S.pickSpawn(roomsBlocked, points, () => pt("Staircase", 40)).name === "Staircase");
  const onlyUp = [pt("Bedroom 3", 2, 2)];
  const allBlocked = world({ slabs: [R(-100, 100, -100, 100, { y: 1.0, name: "lid" })] });
  const lines = [];
  const fb = S.pickSpawn(allBlocked, onlyUp, () => null, (l) => lines.push(l));
  ck("nothing standable: says so, and falls back rather than to the origin silently",
     fb.name === "Bedroom 3" && lines.some((l) => /NO standable candidate/.test(l)), lines);
  ck("a custom eye height is the eye height", S.pickSpawn(world({ eye: 1.5 }), points, () => null).position.y === 1.5);
}

console.log("\n  a picked room:");
{
  const w = world({ slabs: [R(0, 5, 0, 5, { y: 0.4, name: "raised_floor" })] });
  const room = { name: "Lounge", floor: 1, position: { x: 2, y: 0, z: 2 }, target: { x: 2, y: 1.6, z: 4 } };
  const r = S.roomSpawn(w, room);
  ck("placed on the raised floor it stands on (it was the slab beneath: 1.7)", Math.abs(r.position.y - 2.1) < 1e-9, r.position.y);
  const blocked = world({ slabs: [R(0, 5, 0, 5, { y: 1.0, name: "loft" })] });
  ck("  ...and never refused — the user chose it", S.roomSpawn(blocked, room).name === "Lounge");
}

console.log("\n  the foot of the stairs:");
{
  const w = world({ wells: [R(0, 2, 0, 2, { name: "Staircase" })], ground: [{ pts: sq(-10, 10, -10, 10) }] });
  const f = S.stairFoot(w, 1, 1);
  ck("found outside the stairwell, in a ground room, the nearest ring out", !(f.x >= 0 && f.x <= 2 && f.z >= 0 && f.z <= 2) && Math.hypot(f.x - 1, f.z - 1) <= 2, f);
  ck("no ground rooms yet (calibration has not run): unchanged", JSON.stringify(S.stairFoot(world(), 3, 4)) === JSON.stringify({ x: 3, z: 4 }));
  ck("a flight's bottom is the lower end, and up is toward the higher",
     JSON.stringify(S.flightBottom(0, 6, 0.3, 2.4)) === JSON.stringify({ bottom: 0, up: 1 })
       && JSON.stringify(S.flightBottom(0, 6, 2.4, 0.3)) === JSON.stringify({ bottom: 6, up: -1 }));
}

console.log("\n  one eye height:");
ck("the default is 1.7, and a setting wins", S.eyeHeightOf(undefined) === 1.7 && S.eyeHeightOf(1.55) === 1.55);
{
  const sm = readFileSync(new URL("../../src/babylon/SceneManager.ts", import.meta.url), "utf8");
  ck("SceneManager has no eye-height literal and no side-channel stand fields",
     !/\?\? 1\.7|floorY \+ 1\.7|lastStandY|lastStandableWhy|private standable/.test(sm));
  ck("the room viewpoints use the configured eye height", /y: mm\(floorY \+ this\.eyeHeight\(\)\)/.test(sm));
  ck("both spawns go through walkerSpawn", /pickSpawn\(w, this\.calibratedPoints/.test(sm) && /return roomSpawn\(this\.spawnWorld\(\), room\);/.test(sm));
  const cfg = readFileSync(new URL("../../src/config/AppConfig.ts", import.meta.url), "utf8");
  ck("the config's default is the same constant", /eyeHeight: DEFAULT_EYE_HEIGHT,/.test(cfg));
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ a walker lands where a person can stand");
process.exit(fail ? 1 : 0);
