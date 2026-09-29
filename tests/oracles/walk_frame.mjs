// The walk camera's collision rule, driven through one placement pass
// (src/babylon/placementPass.ts, `groundOf`).
//
// On the walk camera `sx` and `sz` are across and ALONG the heading: one
// ground plane. Until 2.496.187 three stages asked "do these overlap" three
// ways there — the absorb sweep a cylinder (ground distance, then height),
// `fits` a 3-axis sphere, settleChips `sx`/`sy` only — so:
//   * a badge in the gap between the sphere and the cylinder was refused by
//     `fits` and absorbed by nobody, and its card's room went to a chip
//     (measured on the villa: 1,080 orphan findings over 144 walk frames,
//     120 after);
//   * a room chip far down the corridor from a badge still "collided" with it.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { PlacementPass, groundOf } = await import("@/babylon/placementPass");
const { RoomFocus } = await import("@/babylon/roomFocus");
const { MAX_GRID_CHIPS } = await import("@/babylon/badgeCard");
const { roomKey } = await import("@/config/roomKey");


const PX = 10;
// On the walk basis below, the pass's real projection (planeOf) is x across,
// y up (screen down is +sy, so -y), z along — the fixtures' positions.
const planeOf = (_c, x, y, z) => ({ sx: x * PX, sy: -y * PX, sz: z * PX });
function rig(rooms, chips = []) {
  const pass = new PlacementPass();
  pass.begin({
    metrics: { minGapPx: 2, cardIconFraction: 0.8, countPillFraction: 0.4, countFontFraction: 0.6 },
    summary: { size: 40, font: 16, countSize: 16, countFont: 10 }, perCardCap: MAX_GRID_CHIPS,
    rooms, focus: new RoomFocus(), scale: 1, cardBudget: 10_000, cellCap: 6,
    chips: { members: [], view: null, text: { charPx: 7, padPx: 20 }, budget: 0 },
  });
  // The chips an obstacle test collides with, fixed: what is under test here is
  // the collision metric, not how chips are derived (placement_pass,
  // chips_behind).
  pass.deriveChips = () => chips;
  return pass;
}
const badge = (id, x, y, z) => ({ id, lbl: { type: "sensor", category: "comfort" }, x: 0, y: 0, wx: x, wy: y, wz: z, ...planeOf(null, x, y, z), inFront: true, occluded: false });
const group = (key, members, shown, rooms) => {
  const n = members.length, avg = (k) => members.reduce((a, m) => a + shown[m][k], 0) / n;
  const wx = avg("wx"), wy = avg("wy"), wz = avg("wz");
  return { key, room: rooms[0], roomKeys: rooms.map(roomKey), members, wx, wy, wz, ...planeOf(null, wx, wy, wz), grid: n, focused: false };
};
const walk = { pxPerWorld: PX, basis: { rx: 1, rz: 0, ax: 0, az: 1, sinPhi: 0, cosPhi: 1, mode: "world3d" }, refDepth: 0 };
const chipped = (pass) => [...pass.roomClustered].filter(([, v]) => v).map(([k]) => k);

console.log("  the ground axis:");
ck("orbit camera (sz = 0): exactly |dx|", groundOf(-7, 0) === 7);
ck("walk camera: across and along the heading are one distance", groundOf(3, 4) === 5);

console.log("\n  a card beside a badge from another room — absorbed or clear, never a chip:");
{
  // A tall, narrow badge: the sphere measured its ground clearance by its
  // HEIGHT (max of the two), the absorb sweep by its WIDTH.
  const rooms = { a: "Living", b: "Living", c: "Hall" };
  let bad = [], tried = 0;
  for (let ax = -8; ax <= 8; ax += 0.5) for (let az = -8; az <= 8; az += 0.5) for (const ay of [0, 1, 2, 3]) {
    const shown = [badge("a", 0, 0, 0), badge("b", 0.2, 0, 0), badge("c", ax, ay, az)];
    const boxes = [{ halfW: 20, halfH: 20, cy: 0 }, { halfW: 20, halfH: 20, cy: 0 }, { halfW: 8, halfH: 20, cy: 0 }];
    const pass = rig(rooms);
    const pending = [group("grp|a", [0, 1], shown, ["Living"])];
    pass.entityGrouped.add("a"); pass.entityGrouped.add("b");
    pass.placeEntityGroups(shown, boxes, pending, walk);
    tried++;
    if (chipped(pass).length) bad.push([ax, ay, az]);
  }
  ck(`${tried} positions: the card's room is never chipped by a badge it could have absorbed`, bad.length === 0, bad.slice(0, 5));
}

{
  // The absorb sweep's own metric, by value: whether a badge is taken into a
  // card depends on HOW FAR it stands on the ground, never on which way —
  // turning the walker rotates sx/sz together. A square (per-axis) test takes
  // a diagonal badge a round one leaves; |dx| alone swallows a whole corridor.
  const rooms = { a: "Living", b: "Living", c: "Living" };
  const disagree = []; let taken = 0;
  for (let r = 0; r <= 10; r += 0.25) {
    const seen = new Set();
    for (let deg = 0; deg < 360; deg += 15) {
      const t = (deg * Math.PI) / 180;
      const shown = [badge("a", 0, 0, 0), badge("b", 0, 0, 0), badge("c", r * Math.cos(t), 0, r * Math.sin(t))];
      const boxes = shown.map(() => ({ halfW: 20, halfH: 20, cy: 0 }));
      const pass = rig(rooms);
      const pending = [group("grp|a", [0, 1], shown, ["Living"])];
      pass.entityGrouped.add("a"); pass.entityGrouped.add("b");
      pass.placeEntityGroups(shown, boxes, pending, walk);
      seen.add(pass.entityGrouped.has("c"));
    }
    if (seen.size > 1) disagree.push(r);
    if (seen.has(true) && seen.size === 1) taken++;
  }
  ck("a badge nearby is taken into the card (the check below is not vacuous)", taken > 0 && taken < 41, taken);
  ck("  ...at the same distance in every direction", disagree.length === 0, disagree);
}

console.log("\n  two cards, one above the other:");
{
  // Ground-coincident, separated in HEIGHT by more than the two card
  // half-heights but less than their circumscribed radii: the sphere
  // refused the second card and chipped its room.
  const rooms = { a: "Living", b: "Living", c: "Hall", d: "Hall" };
  const shown = [badge("a", 0, 0, 0), badge("b", 0.1, 0, 0), badge("c", 0, 4.6, 0.5), badge("d", 0.1, 4.6, 0.5)];
  const boxes = shown.map(() => ({ halfW: 20, halfH: 20, cy: 0 }));
  const pass = rig(rooms);
  const pending = [group("grp|a", [0, 1], shown, ["Living"]), group("grp|c", [2, 3], shown, ["Hall"])];
  for (const id of "abcd") pass.entityGrouped.add(id);
  pass.placeEntityGroups(shown, boxes, pending, walk);
  ck("both seated, no chip", pending.length === 2 && chipped(pass).length === 0, [pending.map((g) => g.key), chipped(pass)]);
}

console.log("\n  a room chip down the corridor from a badge:");
{
  const rooms = { a: "Living", k: "Kitchen" };
  const far = [{ rooms: ["Kitchen"], roomKeys: [roomKey("Kitchen")], centre: { x: 0, y: 0, z: 12 }, halfW: 30 }];
  const shown = [badge("a", 0, 0, 0)];
  const boxes = [{ halfW: 20, halfH: 20, cy: 0 }];
  const pass = rig(rooms, far);
  pass.settleChips(shown, boxes, [], walk);
  ck("12 m apart along the heading: the badge's room is not chipped", chipped(pass).length === 0, chipped(pass));
  const near = [{ ...far[0], centre: { x: 0, y: 0, z: 0.5 } }];
  const pass2 = rig(rooms, near);
  pass2.settleChips(shown, boxes, [], walk);
  ck("  ...and on top of it, it is (the test still bites)", chipped(pass2).includes(roomKey("Living")), chipped(pass2));
}

done("✅ the walk camera measures ground distance everywhere");

