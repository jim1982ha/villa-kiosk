// tests/oracles/lamp_rooms.mjs
// Every lamp keeps the rooms it lights, whatever order the fixtures and the
// plan come in (src/babylon/lampRooms.ts, through BulbSet on Babylon's
// NullEngine: the real pools, placement and room map, no GPU). The owner's
// case: after a config sync rebuilt the lamps, they had lost their rooms and
// the glow lit the next room through the wall (2.496.829, and the four
// releases after).
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
const { Color3 } = await import("@babylonjs/core/Maths/math.color.js");
const { PBRMaterial } = await import("@babylonjs/core/Materials/PBR/pbrMaterial.js");
const { BulbSet } = await import("@/babylon/bulbSet");
const { Storeys } = await import("@/babylon/storeys");

const sq = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const room = (name, pts) => ({ name, floorY: 0, storey: 1, pts });
// Two rooms side by side; one lamp in each, one in the garden past the plan.
const plan = () => new Storeys([room("<room_a>", sq(0, 4, 0, 4)), room("<room_b>", sq(4.2, 8, 0, 4))]);
const SPOTS = { a: [2, 2], b: [6, 2], garden: [20, 2] };
/** The floor is flat at 0 everywhere: the probe is the pools' input. */
const floor = { below: () => 0, describeBelow: () => ({ y: 0 }), clearMemo() {}, save() {}, stats: { probeAbove: 0 } };

/** A lightmapped villa's scene: a lit floor slab (the glow's surface), the
 *  wall between the two rooms as the model marks its structure, and the
 *  lamps, all on. */
function villa(key = null) {
  const scene = new Scene(new NullEngine());
  const slab = MeshBuilder.CreateBox("slab", { width: 30, height: 0.1, depth: 10 }, scene);
  slab.material = new PBRMaterial("slab", scene);
  const wall = MeshBuilder.CreateBox("wall", { width: 0.2, height: 3, depth: 4 }, scene);
  wall.position.set(4.1, 1.5, 2);
  wall.metadata = { gltf: { extras: { vk_role: "structure" } } };
  wall.material = new PBRMaterial("wall", scene);
  const lamps = Object.entries(SPOTS).map(([name, [x, z]]) => {
    const m = MeshBuilder.CreateSphere(`lamp_${name}`, { diameter: 0.2 }, scene);
    m.position.set(x, 2.5, z);
    m.computeWorldMatrix(true);
    return m;
  });
  const on = { on: true, colour: new Color3(1, 1, 1), frac: 1 };
  const bulbs = new BulbSet(scene, floor, () => lamps.map((m) => ({ meshes: [m], reading: on })));
  bulbs.setCacheKey(key);
  /** The load path's fixture pass, as indexMeshes runs it. */
  const index = () => {
    for (const m of lamps) bulbs.addFixture(m, true);
    bulbs.mergeStrips(lamps.map((m) => [m]));
    bulbs.glowEverythingLit();
  };
  return { bulbs, index };
}
/** What the glow is handed: each lamp's rooms, by where it stands. */
const roomsOf = (bulbs) => Object.fromEntries(Object.entries(SPOTS).map(([name, [x, z]]) => {
  const lamp = bulbs.lamps().find((l) => Math.abs(l.x - x) < 0.01 && Math.abs(l.z - z) < 0.01);
  return [name, lamp ? (lamp.room ? `${lamp.room.band}:${lamp.room.lo}:${lamp.room.hi}` : "none") : "missing"];
}));

console.log("\n  fixtures first, then the plan (a first load):");
const first = villa();
first.index();
first.bulbs.setRooms(plan());
const loaded = roomsOf(first.bulbs);
ck("each lamp in a room is held to it, and the two rooms differ",
   loaded.a !== "none" && loaded.b !== "none" && loaded.a !== loaded.b && !Object.values(loaded).includes("missing"), loaded);
ck("the garden lamp has no room: it lights as before, unmasked", loaded.garden === "none", loaded);
ck("the render report: a room map, three lamps, one without a room",
   JSON.stringify(first.bulbs.roomReport()) === JSON.stringify({ roomMap: true, lamps: 3, lampsNoRoom: 1 }), first.bulbs.roomReport());

console.log("\n  a config sync (the lamps cleared and built again, no new plan):");
first.bulbs.clear();
first.index();
ck("every lamp still has the rooms it had", JSON.stringify(roomsOf(first.bulbs)) === JSON.stringify(loaded), roomsOf(first.bulbs));
ck("  ...and the report still has its map", first.bulbs.roomReport().roomMap && first.bulbs.roomReport().lampsNoRoom === 1,
   first.bulbs.roomReport());
first.bulbs.clear();
first.index();
first.bulbs.clear();
first.index();
ck("  ...after a second and a third sync too", JSON.stringify(roomsOf(first.bulbs)) === JSON.stringify(loaded), roomsOf(first.bulbs));

console.log("\n  the plan first, then the fixtures:");
const early = villa();
early.bulbs.setRooms(plan());
early.index();
ck("the same rooms as fixtures-first", JSON.stringify(roomsOf(early.bulbs)) === JSON.stringify(loaded), roomsOf(early.bulbs));

console.log("\n  the stored wall answer (vk.roomlight2.):");
const keyed = villa("<model>");
keyed.index();
keyed.bulbs.setRooms(plan());
const keyedRooms = roomsOf(keyed.bulbs);
ck("a load keeps its answer under the model's key", stored.has("vk.roomlight2.<model>"), [...stored.keys()]);
const again = villa("<model>");
again.bulbs.setRooms(plan());
again.index();
ck("the next load, from the stored answer, gives every lamp the same rooms",
   JSON.stringify(roomsOf(again.bulbs)) === JSON.stringify(keyedRooms) && JSON.stringify(keyedRooms) === JSON.stringify(loaded),
   roomsOf(again.bulbs));

console.log("\n  no plan yet:");
const bare = villa();
bare.index();
ck("lamps light unmasked until a plan exists", Object.values(roomsOf(bare.bulbs)).every((r) => r === "none")
   && !bare.bulbs.roomReport().roomMap, roomsOf(bare.bulbs));
done();
