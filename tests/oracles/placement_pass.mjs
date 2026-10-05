// One placement pass (src/babylon/placementPass.ts): which badges become a
// card, which rooms become chips, and why — driven with a frame of plain
// values (PlacementFrame), the same kind EntityVisuals hands it each layout.
// It used to take a twelve-callback host.
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
import { ck, done } from "../consistency/check.mjs";
const { PlacementPass, roomSpanLabel, roomOfEntity, cardOf, layoutOf, sortCardMembers } = await import("@/babylon/placementPass");
const { RoomFocus } = await import("@/babylon/roomFocus");
const { arrange, cardLift, MAX_GRID_CHIPS } = await import("@/babylon/badgeCard");
const { roomKey, NO_ROOM_LABEL } = await import("@/config/roomKey");


const metrics = { minGapPx: 2, cardIconFraction: 0.8, countPillFraction: 0.4, countFontFraction: 0.6 };
const frameOf = (rooms, focus) => ({
  metrics, summary: { size: 40, font: 16, countSize: 16, countFont: 10 }, perCardCap: MAX_GRID_CHIPS,
  rooms, focus, scale: 1, cardBudget: 10_000, cellCap: 6,
  chips: { members: [], view: null, text: { charPx: 7, padPx: 20 }, budget: 0 },
});
function rig(rooms) {
  const focus = new RoomFocus();
  const pass = new PlacementPass();
  pass.begin(frameOf(rooms, focus));
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
  const clear = { pxPerWorld: 10, basis: { rx: 1, rz: 0, ax: 0, az: 1, sinPhi: -1, cosPhi: 0, mode: "plane" } };
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

console.log("\n  the pass's own products (2.496.189):");
{
  ck("a card spanning rooms reads 'primary +N', one room reads its name",
     roomSpanLabel("Living", 3) === "Living +2" && roomSpanLabel("Living", 1) === "Living");
  ck("a card hangs half its own height above its anchor, at the badge scale", cardLift({ height: 40 }, 1.5) === 30);
  const rooms = { a: "Living", b: "Living", c: "Kitchen", d: "Hall" };
  const shown = ["a", "b", "c", "d"].map((id, i) => badge(id, i * 2, i));
  const { pass } = rig(rooms);
  pass.roomDisplay.set("living", "Living"); pass.roomDisplay.set("kitchen", "Kitchen");
  pass.entityGrouped.add("a");
  pass.chipRoom("hall", "solver");
  ck("drawn: a badge in a card is not, one behind its room's chip is not, the rest are",
     !pass.drawnBadge("a") && !pass.drawnBadge("d") && pass.drawnBadge("b") && pass.drawnBadge("c"));
  const clear = { pxPerWorld: 10, basis: { rx: 1, rz: 0, ax: 0, az: 1, sinPhi: -1, cosPhi: 0, mode: "plane" } };
  const out = [];
  const buckets = [{ room: "kitchen", rooms: ["kitchen", "living"], pileKey: "b", members: [2, 1] }, { room: "living", rooms: ["living"], pileKey: "zz", members: [0, 1] }];
  pass.groupsFromBuckets(shown, buckets, 1, clear, out);
  const g = out[0];
  ck("only `count` buckets become cards (the pool may hold stale ones)", out.length === 1);
  ck("a bucket's card: keyed by its pile, named 'primary +N', its rooms copied",
     g.key === "grp|b" && g.room === "Kitchen +1" && g.roomKeys.join() === "kitchen,living" && g.roomKeys !== buckets[0].rooms, g);
  ck("  ...its members in card order, and they leave the badge tier",
     g.members.join() === "1,2" && pass.entityGrouped.has("b") && pass.entityGrouped.has("c") && buckets[0].members.join() === "2,1", g.members);
  ck("  ...standing at their WORLD centroid, projected by the pass's frame",
     g.wx === 3 && g.wz === 1.5 && g.sx === 30 && g.sy === 15 && g.grid === 2 && g.focused === false, [g.wx, g.wz, g.sx, g.sy]);
}

console.log("\n  the frame's own rules, by value:");
{
  ck("a device's room is its resolved room, trimmed; none is the no-room bucket",
     roomOfEntity({ a: " Living " }, "a") === "Living" && roomOfEntity({ a: "  " }, "a") === NO_ROOM_LABEL && roomOfEntity({}, "b") === NO_ROOM_LABEL);
  const f = frameOf({}, new RoomFocus());
  ck("a card is the arrangement of its cells at the summary size (badgeCard.arrange)",
     JSON.stringify(cardOf(f, 3)) === JSON.stringify(arrange(3, 40, 0.8, 2)));
  ck("  ...and a group's card is capped by the frame's width budget",
     layoutOf({ ...f, cardBudget: 90 }, { grid: 8, focused: true }, 8).width
       < layoutOf({ ...f, cardBudget: 10_000 }, { grid: 8, focused: true }, 8).width);
  const shown = [{ id: "z", lbl: { type: "light", category: "light" } }, { id: "a", lbl: { type: "light", category: "light" } }];
  ck("a card's members read in rank, then id, order", sortCardMembers(shown, [0, 1]).join() === "1,0");
}

console.log("\n  one run, the whole pass:");
{
  const rooms = { a: "living", b: "Living", c: "Kitchen", d: "Hall" };
  const shown = ["a", "b", "c", "d"].map((id, i) => badge(id, i * 5, 0));
  const focus = new RoomFocus();
  focus.grant(["kitchen"]);
  const pass = new PlacementPass();
  const r = pass.run(frameOf(rooms, focus), shown, boxesFor(shown), null, true);
  ck("a room's printed name is its smallest spelling, whichever badge came first", pass.roomDisplay.get("living") === "Living");
  ck("a focus holding: every OTHER room is chipped, reason 'focus'; the focused room is not",
     pass.roomClustered.get("living") && pass.roomClustered.get("hall") && !pass.roomClustered.get("kitchen") && pass.chipWhyCount.get("focus") === 2);
  ck("  ...so only the focused room's badge is drawn", shown.filter((s) => pass.drawnBadge(s.id)).map((s) => s.id).join() === "c");
  ck("no projection: no solve, no cards, no chips drawn (no members)", r.solved === null && r.pending.length === 0 && r.chips.length === 0);
  const again = pass.run(frameOf(rooms, new RoomFocus()), shown, boxesFor(shown), null, false);
  ck("the next run starts clean: nothing carried over", pass.roomClustered.size === 0 && again.pending.length === 0);
}

console.log("\n  the caller:");
{
  const { readFileSync } = await import("node:fs");
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  ck("EntityVisuals holds one pass with NO host, and runs it once per layout with a frame",
     /private readonly pass = new PlacementPass\(\);/.test(ev)
     && (ev.match(/this\.pass\.run\(/g) ?? []).length === 1
     && /this\.pass\.run\(\s*this\.placementFrame\(shown\), shown, boxes, clearance, suppressOthers\)/.test(ev));
  ck("  ...and never sequences its steps itself",
     !/this\.pass\.(chipRoom|groupsFromBuckets|pairFocusedRoom|placeEntityGroups|settleChips|deriveChips)\(/.test(ev)
     && (ev.match(/this\.pass\.begin\(\);/g) ?? []).length === 1);
  ck("EntityVisuals draws a badge by the pass's own predicate, and takes its cards from it",
     /&& this\.pass\.drawnBadge\(s\.id\);/.test(ev) && /linkOffsetYInPixels = -cardLift\(lay, scale\);/.test(ev));
  ck("  ...and keeps none of its state, steps or the helpers that moved",
     !/private (roomClustered|entityGrouped|chipWhyCount|seatLog|pendingGroups)\b|private (placeEntityGroups|pairFocusedRoom|settleChips|dropEscalatedGroups|chipRoom|deriveChips|planeOf|measuredAt|sortCardMembers|drawnCells|cellMax)\(/.test(ev));
}

done("✅ one placement pass, its rules driven");

