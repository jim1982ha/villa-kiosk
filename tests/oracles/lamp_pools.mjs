// tests/oracles/lamp_pools.mjs
// How much floor light each lamp gives, and where (src/babylon/bulbSet.ts,
// lightPoolSet.ts, lightPlacement.ts, through BulbSet on Babylon's NullEngine:
// the real pools and placement, no GPU).
//
// The owner's report (2026-11-19): the bright patches on a balcony floor did
// not match the row of lamps above, sometimes beside a lamp, sometimes past it.
// A pendant drawn in three materials lit its floor three times as brightly as a
// plain bulb beside it, and a wall light whose marker sat in the wall laid its
// patch in the room behind the wall.
import { ck, done } from "../consistency/check.mjs";
// The pools paint a gradient on a canvas; placement needs no pixels.
globalThis.OffscreenCanvas ??= class {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() {
    const n = this.width * this.height * 4;
    return new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(n) }) });
  }
};
const stored = new Map();
globalThis.localStorage ??= {
  getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)),
  removeItem: (k) => stored.delete(k), key: (i) => [...stored.keys()][i] ?? null,
  get length() { return stored.size; },
};
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { MeshBuilder } = await import("@babylonjs/core/Meshes/meshBuilder.js");
const { TransformNode } = await import("@babylonjs/core/Meshes/transformNode.js");
const { Color3 } = await import("@babylonjs/core/Maths/math.color.js");
const { PBRMaterial } = await import("@babylonjs/core/Materials/PBR/pbrMaterial.js");
const { BulbSet } = await import("@/babylon/bulbSet");
const { Storeys } = await import("@/babylon/storeys");
const { pointInPolygon } = await import("@/utils/geometry");
const { POOL_ALPHA_STOPS } = await import("@/babylon/LightPools");

const sq = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const room = (name, pts) => ({ name, floorY: 0, storey: 1, pts });
// A balcony (x 0..8) and, behind its end wall (x 8..8.2), the next room.
const BALCONY = sq(0, 8, 0, 3), NEXT = sq(8.2, 12, 0, 3);
const plan = () => new Storeys([room("<balcony>", BALCONY), room("<next_room>", NEXT)]);
const floor = { below: () => 0, describeBelow: () => ({ y: 0 }), clearMemo() {}, save() {}, stats: { probeAbove: 0 } };
const on = { on: true, colour: new Color3(1, 1, 1), frac: 1 };

/** A lamp of three materials, as a glTF node imports: three meshes named
 *  "<node>_primitive<i>" under the node (rod, canopy, shade). */
function pendant(scene, name, x, z) {
  const node = new TransformNode(name, scene);
  const parts = [[0.02, 0.6, 2.3], [0.15, 0.05, 2.62], [0.4, 0.3, 2.0]].map(([w, h, y], i) => {
    const m = MeshBuilder.CreateBox(`${name}_primitive${i}`, { width: w, height: h, depth: w }, scene);
    m.parent = node;
    m.position.set(x, y, z);
    m.computeWorldMatrix(true);
    return m;
  });
  return parts;
}
function sphere(scene, name, x, y, z) {
  const m = MeshBuilder.CreateSphere(name, { diameter: 0.1 }, scene);
  m.position.set(x, y, z);
  m.computeWorldMatrix(true);
  return m;
}

const scene = new Scene(new NullEngine());
// One light: two pendants along the balcony and a wall light at each end, the
// far one's marker sitting in the end wall, 5 cm past the balcony's outline.
const p1 = pendant(scene, "<light>_a", 3, 1.5), p2 = pendant(scene, "<light>_b", 5, 1.5);
const wallNear = sphere(scene, "<light>_c", 0.4, 2.4, 1.5);
const wallFar = sphere(scene, "<light>_d", 8.05, 2.4, 1.5);
const light = [...p1, ...p2, wallNear, wallFar];
// Another light: a plain bulb, and an LED strip 3 m long.
const bulb = sphere(scene, "<other>_bulb", 2, 2.6, 2.5);
const strip = MeshBuilder.CreateBox("<other>_strip", { width: 3, height: 0.02, depth: 0.02 }, scene);
strip.position.set(4, 2.6, 0.5); strip.computeWorldMatrix(true);
const other = [bulb, strip];
const bulbs = new BulbSet(scene, floor, () => [{ meshes: light, reading: on }, { meshes: other, reading: on }]);
for (const m of [...light, ...other]) bulbs.addFixture(m, true);
bulbs.mergeStrips([light, other]);
bulbs.setRooms(plan());
bulbs.resync();
bulbs.syncGlow();

const lamps = bulbs.lamps();
const near = (x, z) => lamps.filter((l) => Math.hypot(l.x - x, l.z - z) < 0.3);
const pools = scene.meshes.filter((m) => m.name.startsWith("lightPool_") && m.isEnabled());
const poolsNear = (x, z, r = 0.6) => pools.filter((m) => Math.hypot(m.position.x - x, m.position.z - z) < r);

console.log("\n  a pendant of three materials beside a plain bulb:");
ck("one floor patch under each pendant, as under the bulb", poolsNear(3, 1.5).length === 1 && poolsNear(5, 1.5).length === 1
   && poolsNear(2, 2.5).length === 1, { a: poolsNear(3, 1.5).length, b: poolsNear(5, 1.5).length, bulb: poolsNear(2, 2.5).length });
ck("  ...and one light for the furniture under it, as bright as the bulb's",
   near(3, 1.5).length === 1 && near(3, 1.5)[0].amount === near(2, 2.5)[0].amount, near(3, 1.5).map((l) => l.amount));
ck("  ...centred under the whole lamp", Math.abs(poolsNear(3, 1.5)[0].position.x - 3) < 1e-6 && Math.abs(poolsNear(3, 1.5)[0].position.z - 1.5) < 1e-6,
   poolsNear(3, 1.5)[0].position);

console.log("\n  an LED strip, 3 m long:");
// The floor light under it, as the pools paint it: each lamp's strength times
// the pools' own falloff (POOL_ALPHA_STOPS) at that distance.
const alphaAt = (t) => {
  for (let i = 0; i < POOL_ALPHA_STOPS.length - 1; i++) {
    const [t0, a0] = POOL_ALPHA_STOPS[i], [t1, a1] = POOL_ALPHA_STOPS[i + 1];
    if (t <= t1) return a0 + (a1 - a0) * (t - t0) / (t1 - t0);
  }
  return 0;
};
const stripLamps = lamps.filter((l) => Math.abs(l.z - 0.5) < 1e-6);
const floorAt = (x) => stripLamps.reduce((a, l) => a + l.amount * alphaAt(Math.hypot(l.x - x, l.z - 0.5) / l.radius), 0);
const along = [3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5].map(floorAt);
ck("the floor along it is one even band, no brighter spot (within 10% from 0.5 m in from one end to the other)",
   Math.max(...along) / Math.min(...along) < 1.1, along.map((v) => +v.toFixed(3)));
ck("  ...and the strip gives the light it always did: two lamps' worth", Math.abs(stripLamps.reduce((a, l) => a + l.amount, 0) - 2) < 1e-9,
   stripLamps.map((l) => l.amount));
ck("  ...its patches stop half a step in from its ends, so two strips meeting at a corner do not double it",
   Math.min(...stripLamps.map((l) => l.x)) > 2.5 + 0.2 && Math.max(...stripLamps.map((l) => l.x)) < 5.5 - 0.2, stripLamps.map((l) => l.x));

console.log("\n  a wall light whose marker sits in the end wall:");
const farPool = pools.find((m) => m.name.includes("<light>_d"));
const balconyBits = near(3, 1.5)[0].room;
const farLamp = lamps.find((l) => Math.abs(l.x - 8.05) < 1e-6);
ck("its patch lies on the balcony its light's other lamps light, a little in from the wall",
   !!farPool && pointInPolygon(farPool.position.x, farPool.position.z, BALCONY) && farPool.position.x <= 8 - 0.29, farPool?.position);
ck("  ...never in the room behind the wall", !!farLamp && JSON.stringify(farLamp.room) === JSON.stringify(balconyBits),
   { lamp: farLamp?.room, balcony: balconyBits });
ck("  ...and its light still comes from the lamp itself", !!farLamp && Math.abs(farLamp.x - 8.05) < 1e-6, farLamp);
const nearPool = pools.find((m) => m.name.includes("<light>_c"));
ck("the near wall light, 40 cm in from its wall, keeps its patch under it",
   !!nearPool && Math.abs(nearPool.position.x - 0.4) < 1e-6, nearPool?.position);

console.log("\n  where rooms meet with no wall, and where a wall with a doorway parts them (the room map reads the walls):");
{
  // Three rooms in a row: <room_a> and <room_b> share a 4 m border with no
  // wall; a wall with a 0.9 m doorway parts <room_b> from <room_c>.
  const sc = new Scene(new NullEngine());
  const slab = MeshBuilder.CreateBox("slab", { width: 30, height: 0.1, depth: 10 }, sc);
  slab.position.set(6, -0.05, 2);
  slab.material = new PBRMaterial("slab", sc);
  for (const [z0, z1] of [[0, 1.5], [2.4, 4]]) {
    const w = MeshBuilder.CreateBox("wall", { width: 0.2, height: 3, depth: z1 - z0 }, sc);
    w.position.set(8.1, 1.5, (z0 + z1) / 2);
    w.metadata = { gltf: { extras: { vk_role: "structure" } } };
    w.material = new PBRMaterial("wall", sc);
  }
  const a = sphere(sc, "<a>_lamp", 3.2, 2.5, 2), b = sphere(sc, "<b>_lamp", 7.3, 2.5, 2);
  const set = new BulbSet(sc, floor, () => [{ meshes: [a], reading: on }, { meshes: [b], reading: on }]);
  for (const m of [a, b]) set.addFixture(m, true);
  set.mergeStrips([[a], [b]]);
  set.glowEverythingLit();
  set.setRooms(new Storeys([room("<room_a>", sq(0, 4, 0, 4)), room("<room_b>", sq(4, 8, 0, 4)), room("<room_c>", sq(8.2, 12, 0, 4))]));
  set.resync();
  set.syncGlow();
  const xsOf = (lamp) => {
    const pool = sc.meshes.find((m) => m.name.startsWith("lightPool_") && m.name.includes(lamp));
    const v = pool.getVerticesData("position");
    return Array.from({ length: v.length / 3 }, (_, i) => v[3 * i] + pool.position.x);
  };
  const ax = xsOf("<a>_lamp"), bx = xsOf("<b>_lamp");
  ck("a lamp 0.8 m from the open border: its patch goes on into the next room, no line where the rooms meet",
     Math.max(...ax) > 4.5, Math.max(...ax));
  ck("a lamp 0.7 m from the wall with a doorway: its patch stops at the wall, the doorway too", Math.max(...bx) <= 8 + 1e-6, Math.max(...bx));
}

done("✅ one lamp, one patch, under it and in its own room");
