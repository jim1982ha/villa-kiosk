// One placement pass (src/babylon/placementPass.ts): which badges become a
// card, which rooms become chips, and why — driven through a fake host.
//
// ⚠️ ~25 RELEASES (2.403–2.432) CHANGED THESE RULES AND NONE WAS UNDER A TEST:
// they lived in EntityVisuals as six methods talking through eight fields.
// Each case below is a rule a field capture once broke:
//   * the no-room bucket ("Other") never draws a chip (2.440.0);
//   * every chip states a reason, counted once (2.403.0);
//   * a group that loses a room RELEASES its other members instead of
//     chipping their rooms — one refusal once chipped five rooms;
//   * a card with nowhere to stand escalates its rooms, and says so;
//   * a focused room's card never escalates.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { PlacementPass } = await import("@/babylon/placementPass");
const { RoomFocus } = await import("@/babylon/roomFocus");
const { arrange } = await import("@/babylon/badgeCard");
const { roomKey, NO_ROOM_LABEL } = await import("@/config/roomKey");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

function rig(rooms) {
  const focus = new RoomFocus();
  const metrics = { minGapPx: 2, cardIconFraction: 0.8, countPillFraction: 0.4, countFontFraction: 0.6 };
  const host = {
    roomOf: (id) => rooms[id] ?? NO_ROOM_LABEL,
    layoutOf: (g, n) => arrange(Math.max(1, Math.min(g.grid, n)), 40, 0.8, 2),
    planeOf: (c, x, y, z) => ({ sx: x * c.pxPerWorld, sy: z * c.pxPerWorld, sz: 0 }),
    drawnDistance: (ax, ay, az, bx, by, bz) => Math.hypot(ax - bx, ay - by, az - bz),
    summaryMetrics: () => ({ size: 40, font: 16, countSize: 16, countFont: 10 }),
    sortCardMembers: (shown, m) => m.sort((a, b) => (shown[a].id < shown[b].id ? -1 : 1)),
    cardOf: (cells) => arrange(Math.max(1, cells), 40, 0.8, 2),
    cardBudget: () => 10_000,
    cardCellCap: () => 6,
    effectiveScale: () => 1,
    deriveChips: () => [],
    metrics: () => metrics,
    focus: () => focus,
  };
  const pass = new PlacementPass(host);
  pass.begin();
  return { pass, focus };
}
const badge = (id, x, z) => ({ id, lbl: { type: "sensor", category: "comfort" }, x: 0, y: 0, wx: x, wy: 0, wz: z, sx: x * 10, sy: z * 10, sz: 0, inFront: true, occluded: false });
const group = (key, members, shown, rooms, extra = {}) => {
  const n = members.length;
  const wx = members.reduce((a, m) => a + shown[m].wx, 0) / n, wz = members.reduce((a, m) => a + shown[m].wz, 0) / n;
  return { key, room: rooms[0], roomKeys: rooms.map(roomKey), members, wx, wy: 0, wz, sx: wx * 10, sy: wz * 10, sz: 0, grid: n, focused: false, ...extra };
};
const boxesFor = (shown) => shown.map(() => ({ halfW: 20, halfH: 20, cy: 0 }));

console.log("  chips and their reasons:");
{
  const { pass } = rig({});
  pass.chipRoom(roomKey(NO_ROOM_LABEL), "solver");
  ck("the no-room bucket ('Other') is never a chip — refused and counted", !pass.roomClustered.get(roomKey(NO_ROOM_LABEL)) && pass.chipRefusedNoRoom === 1);
  pass.chipRoom("kitchen", "solver"); pass.chipRoom("kitchen", "noseat");
  ck("a room chipped twice is one chip, counted under its FIRST reason", pass.chipWhyCount.get("solver") === 1 && !pass.chipWhyCount.has("noseat"), [...pass.chipWhyCount]);
  pass.begin();
  ck("a new pass forgets the last one's chips and counts", pass.roomClustered.size === 0 && pass.chipWhyCount.size === 0 && pass.chipRefusedNoRoom === 0);
}

console.log("\n  a group that loses a room:");
{
  const rooms = { a: "Living", b: "Living", c: "Kitchen", d: "Kitchen", e: "Hall" };
  const shown = ["a", "b", "c", "d", "e"].map((id, i) => badge(id, i, 0));
  const { pass } = rig(rooms);
  const g = group("grp|a", [0, 1, 2, 3], shown, ["Living", "Kitchen"]);
  const solo = group("grp|b", [1, 4], shown, ["Living", "Hall"]);
  for (const id of ["a", "b", "c", "d", "e"]) pass.entityGrouped.add(id);
  pass.chipRoom("living", "solver");
  const placed = [g, solo];
  pass.dropEscalatedGroups(placed, shown);
  ck("two survivors keep a smaller card: members, grid and rooms all shrink",
     placed.includes(g) && g.members.join() === "2,3" && g.grid === 2 && g.roomKeys.join() === "kitchen", [g.members, g.grid, g.roomKeys]);
  ck("one survivor is released to its own badge, and its card goes", !placed.includes(solo) && !pass.entityGrouped.has("e"));
  ck("NO other room is chipped — the bridge is cut (one refusal once chipped five)", !pass.roomClustered.get("kitchen") && !pass.roomClustered.get("hall"));
  const focused = group("grp|f", [0, 4], shown, ["Living", "Hall"], { focused: true });
  const keep = [focused];
  pass.dropEscalatedGroups(keep, shown);
  ck("a focused room's card is never taken down by another room's chip", keep.length === 1 && focused.members.length === 2);
}

console.log("\n  seating cards:");
{
  const rooms = { a: "Living", b: "Living", c: "Kitchen", d: "Kitchen", e: "Hall", f: "Hall" };
  const shown = ["a", "b", "c", "d", "e", "f"].map((id, i) => badge(id, i < 2 ? 0 : i < 4 ? 50 : 0.2, 0));
  const clear = { pxPerWorld: 10, basis: { rx: 1, rz: 0, ax: 0, az: 1, sinPhi: 1, cosPhi: 0, mode: "plane" } };
  {
    const { pass } = rig(rooms);
    const pending = [group("grp|a", [0, 1], shown, ["Living"]), group("grp|c", [2, 3], shown, ["Kitchen"])];
    for (const id of ["a", "b", "c", "d"]) pass.entityGrouped.add(id);
    pass.placeEntityGroups(shown, boxesFor(shown), pending, clear);
    ck("two cards far apart: both seated, no chip", pending.length === 2 && pass.roomClustered.size === 0, [pending.length, [...pass.roomClustered]]);
  }
  {
    const { pass } = rig(rooms);
    const pending = [group("grp|a", [0, 1], shown, ["Living"]), group("grp|e", [4, 5], shown, ["Hall"])];
    for (const id of ["a", "b", "e", "f"]) pass.entityGrouped.add(id);
    pass.placeEntityGroups(shown, boxesFor(shown), pending, clear);
    ck("two cards on one spot: one stands, the other's room goes to its chip — with a reason",
       pending.length === 1 && [...pass.roomClustered.values()].filter(Boolean).length === 1 && (pass.chipWhyCount.get("noseat") ?? 0) === 1,
       [pending.map((g) => g.key), [...pass.roomClustered], [...pass.chipWhyCount]]);
  }
  {
    const { pass } = rig(rooms);
    const pending = [group("grp|a", [0, 1], shown, ["Living"])];
    pass.placeEntityGroups(shown, boxesFor(shown), pending, { pxPerWorld: 0, basis: clear.basis });
    ck("no projection this pass: every group's rooms chip, reason 'noproj'", pending.length === 0 && pass.chipWhyCount.get("noproj") === 1);
  }
}

console.log("\n  the caller:");
{
  const { readFileSync } = await import("node:fs");
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  ck("EntityVisuals holds one pass and starts it each layout", /private readonly pass = new PlacementPass\(/.test(ev) && (ev.match(/this\.pass\.begin\(\);/g) ?? []).length === 2);
  ck("  ...and keeps none of its state or steps", !/private (roomClustered|entityGrouped|chipWhyCount|seatLog)\b|private (placeEntityGroups|pairFocusedRoom|settleChips|dropEscalatedGroups|chipRoom)\(/.test(ev));
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one placement pass, its rules driven");
process.exit(fail ? 1 : 0);
