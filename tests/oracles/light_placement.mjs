// Where a light stands and what its light reaches (src/babylon/lightPlacement.ts,
// storeys.ts, lampGlow.ts): a synthetic two-storey plan with a flight along one
// wall, a store built under the flight (its outline overlapping the staircase's,
// listed first, its floor the staircase's), a hall beside it and a room beyond
// the hall's wall. The floor probe is scripted from the same geometry.
//
// What a person sees: a lamp over the stairs lights the steps under and around
// it and lays no patch, never the room or the floor below the flight (owner,
// 2026-11-16: the step lights lit the floor under the stairs, the steps stayed
// dark); every light stays inside its own walls; ordinary room lights are as
// they were.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { placeLight } = await import("@/babylon/lightPlacement");
const { Storeys } = await import("@/babylon/storeys");
const { GLOW_TERM, POOL_CENTRE } = await import("@/babylon/lampGlow");
const { pointInPolygon } = await import("@/utils/geometry");
const { POOL_ALPHA_STOPS } = await import("@/babylon/LightPools");
/** What a patch gives the floor at distance d from its centre (its gradient). */
const patchAt = (at, d) => {
  const t = d / at.radius;
  for (let i = 0; i < POOL_ALPHA_STOPS.length - 1; i++) {
    const [t0, a0] = POOL_ALPHA_STOPS[i], [t1, a1] = POOL_ALPHA_STOPS[i + 1];
    if (t <= t1) return a0 + (a1 - a0) * (t - t0) / (t1 - t0);
  }
  return 0;
};

const UP = 3.0;                                   // the upper storey's floor
const sq = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const room = (name, floorY, storey, pts) => ({ name, floorY, storey, pts });
// The flight: x 0..10 along the wall at z = 0, z 0..2, rising 0.15 m a step.
const FLIGHT = sq(0, 10, 0, 2);
const tread = (x) => Math.min(UP, 0.15 * Math.ceil(Math.max(x, 0.01) / 0.5));
const onFlight = (x, z) => x > 0 && x < 10 && z > 0 && z < 2;
const plan = (stairFloor) => new Storeys([
  room("Store", 0, 1, sq(5, 10, 0, 2)),           // under the upper half of the flight
  room("Hall", 0, 1, sq(0, 10, 2, 8)),
  room("Next", 0, 1, sq(10, 14, 2, 8)),
  room("Staircase", stairFloor, 1, FLIGHT),
  room("Landing", UP, 2, sq(0, 10, 2, 8)),
  room("Bedroom", UP, 2, sq(10, 14, 2, 8)),
  room("Staircase", UP, 2, FLIGHT),
]);
/** The first floor straight down from (x, y, z): a tread, else a storey's floor. */
const floorBelow = (x, y, z) => {
  if (onFlight(x, z) && tread(x) <= y) return tread(x);
  return y >= UP ? UP : 0;
};
const probe = (below = floorBelow) => ({ below, describeBelow: (x, y, z) => ({ y: floorBelow(x, y, z) }) });

// THE glow's own formula (GLOW_TERM), summed over lamps as the shader does.
const term = new Function("min", "max", "clamp", "smoothstep", "step", "inversesqrt", "pX", "pY", "pZ", "nX", "nY", "nZ",
  "lgPx", "lgPy", "lgPz", "lgFloor", "lgCeil", GLOW_TERM.map(([n, e]) => `const ${n} = ${e};`).join("\n") + "\nreturn lgW;");
const H = [Math.min, Math.max, (v, a, b) => Math.min(b, Math.max(a, v)),
  (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); },
  (e, v) => (v < e ? 0 : 1), (v) => 1 / Math.sqrt(v)];
/** How lit a surface is by these lamps, as a fraction of a pool's centre. */
const lit = (lamps, p, n) => lamps.reduce((a, l) => a + term(...H, ...p, ...n, l.x, l.y, l.z, l.at.glowFloorY, Math.min(l.at.ceilingY, 1e6)), 0) / POOL_CENTRE;
const lamp = (x, z, y, storeys, pr = probe()) => ({ x, y, z, at: placeLight(x, z, y, floorBelow(x, y, z), pr, storeys) });

for (const [label, stairFloor] of [["its floor measured at the slab under it", 0], ["its floor measured on a tread", 0.85]]) {
  console.log(`\n  step lights on the wall beside a flight (the staircase ${label}):`);
  const P = plan(stairFloor);
  // A light every second step (1 m, a 0.3 m rise), 15 cm over its tread.
  const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => lamp(x, 0.05, tread(x) + 0.15, P));
  ck("every one, over the store's outline too, is the staircase's", steps.every((s) => s.at.room?.name === "Staircase"),
     steps.map((s) => s.at.room?.name));
  ck("  ...and lays no patch (no disc on a flight)", steps.every((s) => s.at.floorless));
  // Every tread, across its width: a light 15 cm over a tread reaches across
  // it at a grazing angle, so "lit" is a tenth of a floor under a ceiling
  // lamp (dark is 0: what the floor cut leaves).
  const treads = [];
  for (let x = 0.25; x < 9; x += 0.5) for (const z of [0.5, 1, 1.5]) treads.push([x, tread(x), z]);
  const dimmest = Math.min(...treads.map((p) => lit(steps, p, [0, 1, 0])));
  ck("every step of the flight is lit, from the bottom to the highest light", dimmest > 0.1, dimmest);
  const under = [[6, 0, 1], [7.5, 0.8, 1], [9, 1.2, 0.5]].map((p) => lit(steps, p, [0, 1, 0]));
  ck("the store under the flight gets no light you could see (under 1% of a floor under a ceiling lamp): its floor, a shelf, a cabinet",
     under.every((v) => v < 0.01), under);
  const lowerFloor = [[2, 0, 4], [6, 0, 4], [9, 0.1, 3]].map((p) => lit(steps, p, [0, 1, 0]));
  ck("the floor of the storey below gets nothing", lowerFloor.every((v) => v === 0), lowerFloor);
  const outside = lit(steps, [5, 1.0, -0.2], [0, 0, -1]);
  ck("the far face of the wall they are mounted on gets nothing", outside === 0, outside);
}

console.log("\n  the probe's memo hands a step light a LOWER lamp's tread:");
{
  const P = plan(0);
  const stale = probe((x, y, z) => (onFlight(x, z) ? tread(5) : floorBelow(x, y, z)));
  const s = lamp(8, 0.05, tread(8) + 0.15, P, stale);
  ck("it asks again and stands on its own tread, the staircase's, with no patch",
     Math.abs(s.at.surfaceY - tread(8)) < 1e-9 && s.at.room?.name === "Staircase" && s.at.floorless, s.at);
  ck("  ...and is never put on the floor below the flight", s.at.surfaceY > 0.5 && s.at.glowFloorY > 0.5, s.at);
}

console.log("\n  a pendant hanging into the stairwell from the storey above:");
{
  const P = plan(0);
  const p = lamp(6, 1, UP + 1.5, P);
  ck("it lights the flight: the staircase's, no patch", p.at.room?.name === "Staircase" && p.at.floorless, p.at.room?.name);
  const t = lit([p], [6, tread(6), 1], [0, 1, 0]);
  ck("  ...the step under it is lit", t > 0.2, t);
  const wall = lit([p], [6, UP + 0.8, 2.05], [0, 0, -1]);
  ck("  ...and the upper storey's wall facing it, beside the stairwell", wall > 0.2, wall);
  const store = lit([p], [7, 0.8, 1], [0, 1, 0]);
  ck("  ...never the store under the flight", store === 0, store);
}

console.log("\n  ordinary room lights, as they were:");
{
  const P = plan(0);
  const c = lamp(3, 5, 2.8, P);
  ck("a ceiling lamp: its patch on its room's floor, in its room", c.at.surfaceY === 0 && c.at.room?.name === "Hall" && !c.at.floorless, c.at);
  ck("  ...its glow from that floor up to the storey above", c.at.glowFloorY === 0 && c.at.ceilingY === UP, c.at);
  const t = placeLight(3, 5, 2.8, 0, probe((x, y, z) => (Math.abs(x - 3) < 1 ? 0.75 : floorBelow(x, y, z))), P);
  ck("a table under it (0.75 m) still puts its patch on the floor", t.surfaceY === 0 && t.room?.name === "Hall", t);
  const up = lamp(3, 5, UP + 2.4, P);
  ck("an upstairs lamp: its room upstairs, nothing above stops it", up.at.room?.name === "Landing" && up.at.glowFloorY === UP && up.at.ceilingY === Infinity, up.at);
}

console.log("\n  walls:");
{
  const P = plan(0);
  const w = lamp(9.7, 5, 2.8, P);                 // 0.3 m from the hall's wall with the next room
  const hall = P.rooms.find((r) => r.name === "Hall");
  // A point ON the wall line counts as inside; nudged 1 mm in to ask.
  const inHall = (q) => pointInPolygon(Math.min(q.x, 10 - 1e-3), q.z, hall.pts);
  ck("a lamp beside a wall: its patch stops at the wall line", !!w.at.shape && w.at.shape.every((q) => q.x <= 10 + 1e-9 && inHall(q)), w.at.shape);
  const far = lit([w], [10.1, 1.0, 5], [1, 0, 0]);
  const near = lit([w], [9.95, 1.0, 5], [-1, 0, 0]);
  ck("  ...the far face of that wall, in the next room, gets nothing; the near face is lit", far === 0 && near > 0.1, { far, near });
  const nextFloor = lit([w], [10.3, 0, 5], [0, 1, 0]);
  ck("  ...the next room's floor gets nothing", nextFloor === 0, nextFloor);
}

console.log("\n  an outdoor light over a path along the house wall, alone in its yard:");
{
  // The house (a room behind the wall at z = 0) and, outside it, a yard whose
  // path runs along the wall; a hedge stands 2 m out. The lamp hangs 1.2 m
  // from the wall over the path.
  const P = new Storeys([
    room("House", 0, 1, sq(0, 12, 0, 6)), room("Yard", 0, 1, sq(-4, 16, -6, 0)),
    room("Upper", UP, 2, sq(0, 12, 0, 6)), room("Upper 2", UP, 2, sq(12, 16, 0, 6)),
  ]);
  const path = probe(() => 0.06);
  const alone = placeLight(6, -1.2, 2.4, 0.06, path, P, Infinity);
  const crowded = placeLight(6, -1.2, 2.4, 0.06, path, P, 1.0);
  ck("the path under it and along it is lit as far as its light reaches the hedge beside it (2.5 m along: lit)",
     patchAt(alone, 2.5) > 0.1 && pointInPolygon(8.5, -1.2, alone.shape), { radius: alone.radius, at25: patchAt(alone, 2.5) });
  const plant = lit([{ x: 6, y: 2.4, z: -1.2, at: alone }], [8.5, 1.2, -1.2], [0, 1, 0]);
  ck("  ...where a hedge top beside the path (1.2 m), as far out, is lit by the same lamp", plant > 0.05, plant);
  ck("  ...its patch stops at the house wall: nothing on the far side", alone.shape.every((q) => q.z <= 1e-9), alone.shape);
  ck("a lamp among others in its room keeps its small patch (their patches overlap already)", crowded.radius < 2, crowded.radius);
  const inside = placeLight(6, 3, 2.4, 0, probe(() => 0), P, Infinity);
  ck("  ...and a lamp alone in the house beyond the wall spreads only inside the house", inside.shape.every((q) => q.z >= -1e-9), inside.shape);
}

done("✅ a light lights its own room, and a stair light its steps");
