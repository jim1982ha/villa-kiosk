// tests/oracles/room_light_mask.mjs
// A lamp lights its own room and the rooms open to it, never the room behind
// a wall (src/babylon/roomLightMask.ts). The owner's case: the corridor light
// upstairs lit the bathroom beside it.
import { ck, done } from "../consistency/check.mjs";
const { buildRoomLightMask, maskAllows } = await import("@/babylon/roomLightMask");
const { Storeys } = await import("@/babylon/storeys");

const sq = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const room = (name, pts) => ({ name, floorY: 0, storey: 1, pts });
// A corridor (x 0..6) with a bathroom past its end wall (x 6..9); a living
// room (x 0..6, z 4..10) with a kitchen beside it and no wall between
// (x 6..9); a bedroom below the living room (z 10..14) through a doorway.
const plan = new Storeys([
  room("Corridor", sq(0, 6, 0, 3.9)),
  room("Bathroom", sq(6.1, 9, 0, 3.9)),
  room("Living", sq(0, 6, 4.1, 10)),
  room("Kitchen", sq(6, 9, 4.1, 10)),
  room("Bedroom", sq(0, 6, 10.1, 14)),
  room("Guest", sq(6, 9, 10.1, 14)),
  // The living room again, its outline drawn 0.15 m into the bedroom.
  room("Spill", sq(0, 2.5, 4.1, 10.2)),
]);
/** Walls as the model would have them: vertical faces, 3 m tall. */
const walls = [
  [6.05, 0, 6.05, 3.9],                      // corridor | bathroom
  [0, 4, 9, 4],                              // corridor+bathroom | living+kitchen
  [0, 10.05, 2.55, 10.05], [3.45, 10.05, 6, 10.05],   // living | bedroom, a 0.9 m doorway
  [6, 10.05, 9, 10.05],                      // kitchen | guest
  [6.05, 10.1, 6.05, 14],                    // bedroom | guest
];
const triangles = (visit) => {
  for (const [x0, z0, x1, z1] of walls) {
    visit(x0, 0, z0, x1, 0, z1, x1, 3, z1);
    visit(x0, 0, z0, x1, 3, z1, x0, 3, z0);
  }
};
const mask = buildRoomLightMask(plan, triangles);
const R = Object.fromEntries(plan.rooms.map((r) => [r.name, r]));
const lights = (from, x, z, nx = 0, nz = 0) => maskAllows(mask, mask.bitsOf(R[from]), x, z, nx, nz);

console.log("\n  the corridor light:");
ck("lights the corridor's floor", lights("Corridor", 3, 2));
ck("  ...and the corridor's own end wall, by its face", lights("Corridor", 6.05, 2, -1, 0));
ck("not the bathroom past the wall: its floor, its far wall, its corner by the wall",
   !lights("Corridor", 7.5, 2) && !lights("Corridor", 8.95, 2) && !lights("Corridor", 6.15, 0.05));
ck("the top of the wall it shares with the bathroom stays dark (the bathroom is on its other side)", !lights("Corridor", 6.05, 2, 0, 0));
console.log("\n  open plan:");
ck("the living room and the kitchen share their light (no wall between them)",
   lights("Living", 8, 7) && lights("Kitchen", 3, 7), mask.open);
ck("a doorway is not open plan: the living room's light stays out of the bedroom", !lights("Living", 3, 12));
ck("a wall the kitchen shares with a guest room: the living room's light reaches the kitchen's face of it, not the guest room's",
   lights("Living", 7.5, 10.05, 0, -1) && !lights("Living", 7.5, 10.05, 0, 1));
ck("a bed head against the wall the bedroom shares with the living room, facing that wall, stays dark",
   !lights("Living", 1, 10.2, 0, -1));
ck("an outline drawn across a wall: the strip past the wall is the room it lies in, not the outline's",
   !lights("Spill", 1, 10.15) && lights("Bedroom", 1, 10.15));
console.log("\n  beyond the plan:");
ck("ground outside every room takes any lamp's light, as before", lights("Corridor", -3, 2));

console.log("\n  a previous load's answer:");
const again = buildRoomLightMask(plan, null, mask.known);
ck("draws the same map without reading a wall", Buffer.compare(Buffer.from(again.data), Buffer.from(mask.data)) === 0
   && again.open.join() === mask.open.join());
console.log("\n  a closed curtain:");
// Drawn across the whole living room | kitchen border, floor to 2.6 m.
const curtain = (visit) => {
  visit(6, 0, 4.1, 6, 0, 10, 6, 2.6, 10);
  visit(6, 0, 4.1, 6, 2.6, 10, 6, 2.6, 4.1);
};
const drawn = buildRoomLightMask(plan, null, mask.known, curtain);
const lightsDrawn = (from, x, z) => maskAllows(drawn, drawn.bitsOf(R[from]), x, z);
ck("the living room's light stops at it: the kitchen stays dark, the living room is lit",
   !lightsDrawn("Living", 8, 7) && lightsDrawn("Living", 3, 7), drawn.open);
ck("the other rooms are as before", drawn.open.filter((k) => k !== "Kitchen|Living").join() === mask.open.filter((k) => k !== "Kitchen|Living").join()
   && !lightsDrawn("Corridor", 7.5, 2) && lightsDrawn("Corridor", 3, 2));
ck("what the device keeps is the model's walls alone: opened again, the light passes",
   drawn.known.open.join() === mask.open.join() && maskAllows(buildRoomLightMask(plan, null, drawn.known), mask.bitsOf(R.Living), 8, 7));
done();
