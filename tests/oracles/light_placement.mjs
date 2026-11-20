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
const { placeLight, placeLights, LIGHT_POOL_RADIUS, POOL_EDGE_M } = await import("@/babylon/lightPlacement");
const { Storeys } = await import("@/babylon/storeys");
const { GLOW_TERM, POOL_CENTRE } = await import("@/babylon/lampGlow");
const { pointInPolygon, earClipTriangulate, pointInside } = await import("@/utils/geometry");
const { POOL_ALPHA_STOPS } = await import("@/babylon/LightPools");
const { floorOfArea } = await import("@/babylon/floorProbe");
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
/** Every surface a storey has over (x, z), as the probe's column: its floor, and a tread over it. */
const columnOf = (x, z, storey) => (storey >= 2 ? [UP] : onFlight(x, z) ? [0, tread(x)] : [0]);
/** The scripted probe: `below` its memo (stale, when a test says so), `fresh` the ray today, `column` what lies on
 *  the floor; the vote is the probe's own (floorOfArea). */
const probe = (below = floorBelow, column = columnOf, fresh = floorBelow) => ({
  below, describeBelow: (x, y, z) => ({ y: fresh(x, y, z) }),
  areaFloorY: (area, storey) => floorOfArea(area, (x, z) => column(x, z, storey)),
});

// THE glow's own formula (GLOW_TERM), summed over lamps as the shader does.
const term = new Function("min", "max", "clamp", "smoothstep", "step", "inversesqrt", "pX", "pY", "pZ", "nX", "nY", "nZ",
  "lgPx", "lgPy", "lgPz", "lgFloor", "lgCeil", GLOW_TERM.map(([n, e]) => `const ${n} = ${e};`).join("\n") + "\nreturn lgW;");
const H = [Math.min, Math.max, (v, a, b) => Math.min(b, Math.max(a, v)),
  (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); },
  (e, v) => (v < e ? 0 : 1), (v) => 1 / Math.sqrt(v)];
/** How lit a surface is by these lamps, as a fraction of a pool's centre. */
const lit = (lamps, p, n) => lamps.reduce((a, l) => a + term(...H, ...p, ...n, l.x, l.y, l.z, l.at.glowFloorY, Math.min(l.at.ceilingY, 1e6)), 0) / POOL_CENTRE;
const lamp = (x, z, y, storeys, pr = probe()) => ({ x, y, z, at: placeLight({ x, z, fromY: y, floorY: floorBelow(x, y, z) }, { probe: pr, storeys }) });

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
  const t = placeLight({ x: 3, z: 5, fromY: 2.8, floorY: 0 }, { probe: probe((x, y, z) => (Math.abs(x - 3) < 1 ? 0.75 : floorBelow(x, y, z))), storeys: P });
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
  ck("a lamp beside a wall: its patch stops at the wall line", !!w.at.shape && w.at.shape.flat().every((q) => q.x <= 10 + 1e-9 && inHall(q)), w.at.shape);
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
  const alone = placeLight({ x: 6, z: -1.2, fromY: 2.4, floorY: 0.06 }, { probe: path, storeys: P }, { spreadM: Infinity });
  const crowded = placeLight({ x: 6, z: -1.2, fromY: 2.4, floorY: 0.06 }, { probe: path, storeys: P }, { spreadM: 1.0 });
  ck("the path under it and along it is lit as far as its light reaches the hedge beside it (2.5 m along: lit)",
     patchAt(alone, 2.5) > 0.1 && alone.shape.some((piece) => pointInPolygon(8.5, -1.2, piece)), { radius: alone.radius, at25: patchAt(alone, 2.5) });
  const plant = lit([{ x: 6, y: 2.4, z: -1.2, at: alone }], [8.5, 1.2, -1.2], [0, 1, 0]);
  ck("  ...where a hedge top beside the path (1.2 m), as far out, is lit by the same lamp", plant > 0.05, plant);
  ck("  ...its patch stops at the house wall: nothing on the far side", alone.shape.flat().every((q) => q.z <= 1e-9), alone.shape);
  ck("a lamp among others in its room keeps its small patch (their patches overlap already)", crowded.radius < 2, crowded.radius);
  const inside = placeLight({ x: 6, z: 3, fromY: 2.4, floorY: 0 }, { probe: probe(() => 0), storeys: P }, { spreadM: Infinity });
  ck("  ...and a lamp alone in the house beyond the wall spreads only inside the house", inside.shape.flat().every((q) => q.z >= -1e-9), inside.shape);
}

console.log("\n  two rooms with no wall between them (an open border, the room map's answer):");
{
  const P = plan(0);
  const hall = P.rooms.find((r) => r.name === "Hall"), next = P.rooms.find((r) => r.name === "Next");
  const openTo = (r) => (r === hall ? [next] : r === next ? [hall] : []);
  const o = placeLight({ x: 9, z: 5, fromY: 2.8, floorY: 0 }, { probe: probe(), storeys: P, openTo });
  const reach = o.shape.flat().reduce((m, q) => Math.max(m, q.x), -Infinity);
  ck("a lamp a metre from the border: its patch goes on into the next room, as far as it reaches (no line at the border)",
     o.room === hall && reach > 10.5 && o.shape.some((piece) => pointInPolygon(10.4, 5, piece)), { reach, pieces: o.shape.length });
  ck("  ...centred under the lamp, never pushed off the open edge", o.cx === 9 && o.cz === 5, { cx: o.cx, cz: o.cz });
  const e = placeLight({ x: 9.9, z: 5, fromY: 2.8, floorY: 0 }, { probe: probe(), storeys: P, openTo });
  ck("  ...a lamp right on that border stays where it is too", e.cx === 9.9 && e.shape.some((piece) => pointInPolygon(10.3, 5, piece)), { cx: e.cx });
  const w = placeLight({ x: 9, z: 5, fromY: 2.8, floorY: 0 }, { probe: probe(), storeys: P });
  ck("the same lamp with a wall on that border: its patch stops at the wall", w.shape.flat().every((q) => q.x <= 10 + 1e-9), w.shape);
  const st = placeLight({ x: 3, z: 2.5, fromY: 2.8, floorY: 0 }, { probe: probe(), storeys: P, openTo: (r) => (r === hall ? [P.rooms.find((q) => q.name === "Staircase" && q.storey === 1)] : []) });
  ck("a room open to the stairwell: its lamp's patch does not float over the flight", st.shape.flat().every((q) => q.z >= 2 - 1e-9), st.shape);
  const up = placeLight({ x: 9, z: 5, fromY: 2.8, floorY: 0 }, { probe: probe(), storeys: P, openTo: (r) => (r === hall ? [P.rooms.find((q) => q.name === "Bedroom")] : []) });
  ck("never into a room on another storey", up.shape.flat().every((q) => q.x <= 10 + 1e-9), up.shape);
}

console.log("\n  a terrace set into a garden drawn round it (the garden's outline has the terrace as a notch), no wall between:");
{
  // Terrace x 0..6.6, z -2..4 against the house (z < -2); the garden wraps its
  // three open sides. The lamp hangs mid-terrace, 0.4 m from its front edge:
  // its reach crosses that edge only.
  const terrace = room("Terrace", 0, 1, sq(0, 6.6, -2, 4));
  const garden = room("Garden", 0, 1, [{ x: -6, z: -2 }, { x: 0, z: -2 }, { x: 0, z: 4 }, { x: 6.6, z: 4 }, { x: 6.6, z: -2 },
    { x: 12, z: -2 }, { x: 12, z: 10 }, { x: -6, z: 10 }]);
  const P = new Storeys([terrace, garden]);
  const openTo = (r) => (r === terrace ? [garden] : r === garden ? [terrace] : []);
  const LX = 3.3, LZ = 3.6;
  const t = placeLight({ x: LX, z: LZ, fromY: 2.2, floorY: 0 }, { probe: probe(() => 0), storeys: P, openTo });
  // Every bit of floor within the lamp's reach, terrace or garden, is under its patch, exactly once: as
  // drawn, each piece in triangles (LightPools.applyShape).
  const drawn = t.shape.flatMap((piece) => earClipTriangulate(piece).map(([a, b, c]) => [piece[a], piece[b], piece[c]]));
  let missing = 0, twice = 0, n = 0;
  for (let x = LX - t.radius; x <= LX + t.radius; x += 0.1) for (let z = LZ - t.radius; z <= LZ + t.radius; z += 0.1) {
    if (Math.hypot(x - LX, z - LZ) > t.radius * 0.95) continue;
    n++;
    const k = drawn.filter((tri) => pointInPolygon(x, z, tri)).length;
    if (k === 0) missing++; else if (k > 1) twice++;
  }
  ck("a lamp 0.4 m from the terrace's front edge: its light goes on over the lawn beyond, none missing, none doubled",
     missing <= n * 0.01 && twice <= n * 0.01, { points: n, missing, twice });
}

console.log("\n  a room outline drawn with a repeated corner and points along a straight wall:");
{
  // An L-shaped room as a drawing tool traces it: (4, 0) twice, (2, 0), (4, 1.5) and (0, 2.5) on straight runs.
  const L = room("L", 0, 1, [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 1.5 }, { x: 4, z: 3 },
    { x: 2, z: 3 }, { x: 2, z: 5 }, { x: 0, z: 5 }, { x: 0, z: 2.5 }]);
  const P = new Storeys([L]);
  const c = placeLight({ x: 2, z: 2, fromY: 2.6, floorY: 0 }, { probe: probe(() => 0), storeys: P }, { spreadM: 4 });
  const drawn = c.shape.flatMap((piece) => earClipTriangulate(piece).map(([a, b, cc]) => [piece[a], piece[b], piece[cc]]));
  let missing = 0, n = 0;
  for (let x = 0.05; x < 4; x += 0.1) for (let z = 0.05; z < 5; z += 0.1) {
    if (!pointInPolygon(x, z, L.pts) || Math.hypot(x - 2, z - 2) > c.radius * 0.95) continue;
    n++;
    if (!drawn.some((tri) => pointInPolygon(x, z, tri))) missing++;
  }
  ck("its lamp's patch covers all of the floor it reaches", missing === 0 && n > 100, { points: n, missing });
  const whole = earClipTriangulate(L.pts);
  const area = whole.reduce((a, [i, j, k]) => a + Math.abs((L.pts[j].x - L.pts[i].x) * (L.pts[k].z - L.pts[i].z) - (L.pts[k].x - L.pts[i].x) * (L.pts[j].z - L.pts[i].z)) / 2, 0);
  ck("  ...and the room's highlight, drawn from the same triangles, fills it", Math.abs(area - 16) < 1e-9, area);
}

console.log("\n  a lamp over a tub, a lamp over a step, a lamp over a path:");
{
  const P = plan(0);
  // A tub in the hall, its water 0.16 m up (x 2.5..3.5, z 4..5.6); the lamp above its end.
  const inTub = (x, z) => x > 2.5 && x < 3.5 && z > 4 && z < 5.6;
  const tub = (x, y, z) => (inTub(x, z) ? 0.16 : floorBelow(x, y, z));
  const over = placeLight({ x: 3, z: 4.3, fromY: 2.3, floorY: 0 }, { probe: probe(tub, (x, z, s) => (inTub(x, z) ? [0, 0.16] : columnOf(x, z, s)), tub), storeys: P });
  ck("over a tub's end: the pool lies on the floor round it, not on the water (owner, 2026-11-20, the onsen)",
     over.surfaceY === 0, [over.surfaceY, over.notes]);
  // A raised platform 0.15 m up across the hall's end (x 0..10, z 4..8); the lamp in its middle.
  const onDeck = (x, z) => z > 4 && z < 8;
  const deck = (x, y, z) => (onDeck(x, z) ? 0.15 : floorBelow(x, y, z));
  const step = placeLight({ x: 5, z: 6, fromY: 2.3, floorY: 0 }, { probe: probe(deck, (x, z, s) => (onDeck(x, z) ? [0, 0.15] : columnOf(x, z, s)), deck), storeys: P });
  ck("  ...over a step, the step all round: the pool stays on the step", step.surfaceY === 0.15, [step.surfaceY, step.notes]);
  // A path 6 cm up on the ground, 2 m wide along the hall (z 4..6), a kerb 0.4 m up beside it (z 6..6.3);
  // the lamp over the path. The ground runs on under the path: the lowest surface there is the ground's.
  const onPath = (x, z) => z > 4 && z < 6, onKerb = (x, z) => z >= 6 && z < 6.3;
  const path = (x, y, z) => (onPath(x, z) ? 0.06 : onKerb(x, z) ? 0.4 : floorBelow(x, y, z));
  const lit = placeLight({ x: 5, z: 5, fromY: 2.4, floorY: 0 }, { probe: probe(path, (x, z, s) => (onPath(x, z) ? [0, 0.06] : onKerb(x, z) ? [0, 0.4] : columnOf(x, z, s)), path), storeys: P });
  ck("  ...over a path on the ground, the path along under it: the pool lies on the path (the entrance light, 0.06 m)",
     lit.surfaceY === 0.06, [lit.surfaceY, lit.notes]);
}

console.log("\n  every lamp at once (placeLights): a light of three lamps, one past its wall line, and a lamp alone:");
{
  const P = plan(0);
  // Three ceiling lamps of one light in the hall, the third a marker whose centre lies 5 cm past the
  // hall's wall with the next room; one lamp of its own in the next room.
  const at = (x, z, light) => ({ x, z, fromY: 2.8, floorY: 0, light });
  const { placements: [a, b, wallLamp, alone] } = placeLights([at(3, 5, 0), at(6, 5, 0), at(10.05, 5, 0), at(12, 5)],
    { probe: probe(), storeys: P });
  const inHall = (q) => q.x <= 10 + 1e-9;
  ck("the marker past the wall line lights the hall with its light's other lamps, laid into the hall, not the room behind",
     wallLamp.room?.name === "Hall" && Math.abs(wallLamp.cx - (10 - POOL_EDGE_M)) < 1e-6 && wallLamp.shape.flat().every(inHall),
     { room: wallLamp.room?.name, cx: wallLamp.cx });
  ck("  ...the hall's lamps, three metres apart, keep their small patches (theirs already overlap)",
     a.radius === LIGHT_POOL_RADIUS && b.radius === LIGHT_POOL_RADIUS, [a.radius, b.radius]);
  ck("the lamp alone in the next room spreads as far as its light reaches the floor, inside its walls",
     alone.radius > LIGHT_POOL_RADIUS + 0.5 && alone.shape.flat().every((q) => q.x >= 10 - 1e-9), alone.radius);
}

console.log("\n  where a room's floor is read:");
{
  // A garden round three sides of a house (x 2..8, z 0..6): its middle is on the house.
  const garden = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }, { x: 0, z: 6 }, { x: 8, z: 6 }, { x: 8, z: 2 }, { x: 0, z: 2 }]
    .map(({ x, z }) => ({ x, z }));
  const square = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }];
  const g = pointInside(garden, { x: 5.6, z: 4 });
  ck("a garden drawn round a house: on the lawn, not on the house", pointInPolygon(g.x, g.z, garden), g);
  const s = pointInside(square, { x: 2, z: 2 });
  ck("a room whose middle is in it: its middle, as before", s.x === 2 && s.z === 2, s);
}
done("✅ a light lights its own room, and a stair light its steps");
