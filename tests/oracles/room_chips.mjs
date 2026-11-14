// A room chip stands for the right badges, and two chips merge into the right one.
//
// ⚠️ chip_merge.mjs TESTS THE MERGE LOOP WITH ITS OWN COMBINE RULE. The rule
// that actually runs — what a merged chip's members, centre, room names and
// ring become — was inline in EntityVisuals.deriveChips and never under test.
// roomChips.ts holds it now (the first slice of the tier resolution); this
// runs the real bucketing and the real combine, inside the real merge loop.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { bucketRoomChips, combineChips } = await import("@/babylon/roomChips");
const { roomChipModel } = await import("@/babylon/summaryLook");
const { healthPill } = await import("@/babylon/colors");
const { mergeOverlapping } = await import("@/babylon/boxMerge");
const { deviceLook, storeLookSource } = await import("@/utils/deviceActivity");

// A member's look is the REAL deviceLook of a device in that state (2.496.245 —
// it was a bare `kind` string the test made up): on = a light on, off = a light
// off, alert = a jammed lock (an unlocked one is in use, not an alert: owner, 2026-10-26), unavailable = a light HA has lost.
// fault = a light with an open Cockpit fault.
const STATE_OF = { on: ["light.x", "on"], off: ["light.x", "off"], alert: ["lock.x", "jammed"], unavailable: ["light.x", "unavailable"], fault: ["light.x", "off"] };
const lookOf = (kind) => {
  if (!kind) return undefined;
  const [id, state] = STATE_OF[kind];
  return deviceLook(id, storeLookSource({ [id]: { entity_id: id, state, attributes: {} } }, { entityMap: {}, isCritical: () => false, isHidden: () => false, hasFault: () => kind === "fault", partsOf: () => [] }));
};
const M = (id, room, x, kind) => ({ id, room, pos: { x, y: 1, z: 0 }, look: lookOf(kind) });
const members = [
  M("light.k1", "kitchen", 0, "on"), M("light.k2", "kitchen", 2, "off"),
  M("fan.bed", "bedroom", 10, "unavailable"),
  M("light.hall", "hall", 20, "off"),                  // hall is NOT clustered
];
const clustered = (k) => k !== "hall";
const display = (k) => ({ kitchen: "Kitchen", bedroom: "Bedroom 1" }[k] ?? k);

console.log("  bucketing:");
const chips = bucketRoomChips(members, clustered, display);
ck("one chip per CLUSTERED room, in first-seen order", chips.map((c) => c.key).join() === "kitchen,bedroom", chips.map((c) => c.key));
ck("a chip prints the room's own spelling, not its key, on one line", chips[1].room === "Bedroom 1" && chips[1].lines.length === 1 && chips[1].lines[0].label === "Bedroom 1");
ck("its centre is its members' mean position", chips[0].centre.x === 1, chips[0].centre);
// owner, 2026-10-01: red is the legend's "Needs attention" — a device merely ON never rings red
ck("a member that is on gives the chip the neutral 'on' ring, NOT red", chips[0].ringOn === true && chips[0].ringRed === false);
{
  const alerting = bucketRoomChips([M("lock.d", "door", 0, "alert"), M("light.d", "door", 1, "on")], () => true, (k) => k);
  ck("a member that needs attention rings it red, and red wins over 'on'", alerting[0].ringRed === true && alerting[0].ringOn === false);
}
ck("an unavailable member dims it, and does NOT ring it", chips[1].unavailable === true && chips[1].ringRed === false);

console.log("\n  merging:");
{
  const [k, b] = bucketRoomChips(members, clustered, display);
  combineChips(k, b);
  ck("the merged chip holds both rooms' badges", k.ids.join() === "light.k1,light.k2,fan.bed", k.ids);
  ck("  ...its centre is weighted by members (2 at x=1, 1 at x=10 → 4)", Math.abs(k.centre.x - 4) < 1e-9, k.centre.x);
  ck("  ...it keeps the rooms' NAMES, so a tap can offer them", k.roomNames.join() === "Kitchen,Bedroom 1", k.roomNames);
  ck("  ...and every key it now stands for", k.keys.join() === "kitchen,bedroom", k.keys);
  ck("  ...and either one's ring and dimming", k.ringOn && !k.ringRed && k.unavailable);
  ck("  ...and prints one line per room, each with its own devices", k.rooms === 2 && k.lines.map((l) => `${l.room}:${l.ids.length}`).join() === "Kitchen:2,Bedroom 1:1", k.lines.map((l) => [l.room, l.ids]));
}
{
  // The real loop with the real rule: three chips crowded together on screen.
  const cs = bucketRoomChips([M("a", "a", 0), M("b", "b", 1), M("c", "c", 2), M("c2", "c", 2)], () => true, (k) => k.toUpperCase());
  cs.forEach((c, i) => { c.x = i * 5; c.y = 0; c.halfW = 10; c.halfH = 5; });
  const out = mergeOverlapping(cs, 2, (c) => c.ids.length, (keep, drop) => combineChips(keep, drop));
  ck("inside the real merge loop, crowded chips become one holding every badge",
     out.length === 1 && [...out[0].ids].sort().join() === "a,b,c,c2", out.map((c) => c.ids));
  ck("  ...named for every room it covers", [...out[0].roomNames].sort().join() === "A,B,C" && out[0].rooms === 3);
}

console.log("\n  a chip's ring is the count rule (deviceActivity.groupLook — group_look.mjs drives it in full):");
{
  ck("the room chip keeps the count rule", bucketRoomChips([M("a", "r", 0, "on"), M("b", "r", 1, "off")], () => true, (k) => k)[0].ringOn
     && bucketRoomChips([M("a", "r", 0, "alert"), M("b", "r", 1, "off")], () => true, (k) => k)[0].ringRed
     && !bucketRoomChips([M("a", "r", 0, "unavailable")], () => true, (k) => k)[0].ringRed);
  ck("  ...a member the map has no state for rings nothing", !bucketRoomChips([M("a", "r", 0), M("b", "r", 1, "off")], () => true, (k) => k)[0].ringOn);
}

console.log("\n  a merged chip lists its rooms (owner, 2026-11-14: was \"Living Room +4 (29)\"):");
{
  // Five rooms crowded together: each line is its room's name, ITS count and
  // ITS health, coloured as that room's own chip would be; the border is the merged one.
  const ms = [
    M("a1", "mbed", 0, "alert"), M("a2", "mbed", 0, "off"), M("a3", "mbed", 0, "off"),
    M("b1", "mbath", 1, "unavailable"),
    M("c1", "study", 2, "fault"), M("c2", "study", 2, "off"),
    M("d1", "den", 3, "off"), M("d2", "den", 3, "off"),
    M("e1", "hall", 4, "off"),
  ];
  const names = { mbed: "Master Bedroom", mbath: "Master Bathroom", study: "Study", den: "Den", hall: "Hall" };
  const alone = Object.fromEntries(bucketRoomChips(ms, () => true, (k) => names[k]).map((c) => [c.key, roomChipModel(c, false, () => false).lines[0]]));
  const cs = bucketRoomChips(ms, () => true, (k) => names[k]);
  cs.forEach((c, i) => { c.x = i * 5; c.y = 0; c.halfW = 10; c.halfH = 5; });
  const [chip] = mergeOverlapping(cs, 2, (c) => c.ids.length, (keep, drop) => combineChips(keep, drop));
  const model = roomChipModel(chip, false, () => false);
  ck("one chip, five lines: one per room", model.lines.length === 5, model.lines.map((l) => l.label));
  ck("  ...busiest room first, then by room (stable however the merge went)",
     model.lines.map((l) => `${l.label} (${l.count})`).join(", ") === "Master Bedroom (3), Den (2), Study (2), Hall (1), Master Bathroom (1)",
     model.lines.map((l) => `${l.label} (${l.count})`));
  ck("  ...each pill its OWN room's health: red alert, amber fault, grey lost, green all right",
     model.lines.map((l) => `${l.room}=${l.health}`).join() === "Master Bedroom=alert,Den=ok,Study=fault,Hall=ok,Master Bathroom=unavailable",
     model.lines.map((l) => [l.room, l.health]));
  ck("  ...each line's pill is the colour and number that room's chip shows standing alone",
     model.lines.every((l) => healthPill(l.health).fill === healthPill(alone[l.key].health).fill && l.count === alone[l.key].count && l.label === alone[l.key].label));
  ck("  ...four pill colours, not one", new Set(model.lines.map((l) => healthPill(l.health).fill)).size === 4);
  ck("  ...a tap on a line names that room and only its devices",
     model.lines.find((l) => l.room === "Study").entityIds.join() === "c1,c2");
}

console.log("\n  a merged chip is one line per room TALL, and the merge still settles (placementPass.deriveChips, real camera):");
{
  const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
  const { Scene } = await import("@babylonjs/core/scene.js");
  const { FreeCamera } = await import("@babylonjs/core/Cameras/freeCamera.js");
  const { Vector3, Matrix } = await import("@babylonjs/core/Maths/math.vector.js");
  const { PlacementPass } = await import("@/babylon/placementPass");
  const { RoomFocus } = await import("@/babylon/roomFocus");
  const { MAX_GRID_CHIPS } = await import("@/babylon/badgeCard");
  const engine = new NullEngine({ renderWidth: 2000, renderHeight: 960, textureSize: 64, deterministicLockstep: false, lockstepMaxSteps: 1 });
  const scene = new Scene(engine);
  const cam = new FreeCamera("c", new Vector3(0, 1.6, 0), scene); cam.fov = 0.8; cam.minZ = 0.05;
  scene.activeCamera = cam; cam.computeWorldMatrix(true); scene.updateTransformMatrix(true);
  const vp = cam.viewport.toGlobal(2000, 960);
  const sy = (y) => Vector3.Project(new Vector3(0, y, 6), Matrix.IdentityReadOnly, scene.getTransformMatrix(), vp).y;
  const pxPerM = (sy(1.2) - sy(1.3)) * 10;          // screen y grows downward
  const UNIT = 40;                                  // summary.size: one line
  const begin = (members, cover, open = null) => {
    const pass = new PlacementPass();
    pass.begin({
      metrics: { minGapPx: 2, cardIconFraction: 0.8, countPillFraction: 0.4, countFontFraction: 0.6 },
      summary: { size: UNIT, font: 16, countSize: 16, countFont: 10 }, perCardCap: MAX_GRID_CHIPS,
      rooms: {}, focus: new RoomFocus(), exempt: new Set(), scale: 1, cardBudget: 10_000, cellCap: 6,
      chips: { members, view: { tm: scene.getTransformMatrix(), vp }, text: { charPx: 7, padPx: 20 }, budget: 400, cover, open },
    });
    for (const m of members) { pass.roomDisplay.set(m.room, m.room); pass.chipRoom(m.room, "solver"); }
    return pass;
  };
  const derive = (members, cover, open) => begin(members, cover, open).deriveChips();
  const at = (id, room, up) => ({ id, room, pos: { x: 0, y: 1.2 + up / pxPerM, z: 6 } });
  // A chip is drawn ENTIRELY ABOVE its anchor. "attic" stands 1.75 lines above
  // "kitchen": clear of a one-line kitchen chip, but inside the top line of a
  // two-line one.
  const drawn = (c) => ({ cy: c.y - c.halfH, hh: c.halfH, cx: c.x, hw: c.halfW });
  const clear = (cs) => cs.every((a, i) => cs.every((b, j) => j <= i
    || Math.abs(a.x - b.x) >= a.halfW + b.halfW + 2 || Math.abs(drawn(a).cy - drawn(b).cy) >= a.halfH + b.halfH + 2));
  const two = derive([at("k", "kitchen", 0), at("t", "attic", 1.75 * UNIT)]);
  ck("the premise: a room 1.75 lines above a one-line chip keeps its own chip", two.length === 2, two.map((c) => c.key));
  const grown = derive([at("k", "kitchen", 0), at("p", "pantry", 0), at("t", "attic", 1.75 * UNIT)]);
  const pair = grown.find((c) => c.lines.length === 2);
  ck("a second room on the same spot FOLDS into one line: the room above keeps its own chip",
     grown.length === 2 && !!pair, grown.map((c) => c.lines.map((l) => l.room)));
  // countSize 16: the `+N` pill hangs half of it (8 px) below the line.
  ck("  ...the merged chip is measured FOLDED: one line and the `+N` pill's overhang below it", pair?.halfH === (UNIT + 8) / 2, pair?.halfH);
  const pile = derive(Array.from({ length: 8 }, (_, i) => at(`r${i}`, `room${i}`, i * 0.9 * UNIT)));
  ck("  ...a column of eight rooms, each grown chip reaching the next, settles with nothing overlapping",
     clear(pile) && pile.reduce((n, c) => n + c.lines.length, 0) === 8, pile.map((c) => c.lines.length));
  const again = derive(Array.from({ length: 8 }, (_, i) => at(`r${i}`, `room${i}`, i * 0.9 * UNIT)).reverse());
  ck("  ...and the same rooms in another order give the same chips",
     JSON.stringify(again.map((c) => c.lines.map((l) => l.room))) === JSON.stringify(pile.map((c) => c.lines.map((l) => l.room))));
  console.log("\n  every room chip is drawn on the visible map, clear of the HUD and of every card (owner, 2026-11-14):");
  {
    const { chipBox, chipSlotAt, chipTabZone, drawnLayout } = await import("@/babylon/roomChips");
    const { drawnCardBox } = await import("@/babylon/placementPass");
    // A room anchored at a screen point: the camera looks down +z from (0, 1.6, 0).
    const cx0 = vp.width / 2, cy0 = vp.height / 2;
    const atPx = (id, room, sx, sy) => ({ id, room, pos: { x: (sx - cx0) / pxPerM, y: 1.6 - (sy - cy0) / pxPerM, z: 6 } });
    const probe = Vector3.Project(new Vector3(100 / pxPerM, 1.6 - 50 / pxPerM, 6), Matrix.IdentityReadOnly, scene.getTransformMatrix(), vp);
    ck("the premise: a room placed at a screen point projects there", Math.abs(probe.x - (cx0 + 100)) < 0.5 && Math.abs(probe.y - (cy0 + 50)) < 0.5, [probe.x, probe.y]);
    // The HUD over the map: a top bar, a bottom bar, and a rail down the left.
    const TOP = 60, BOTTOM = vp.height - 60;
    const rail = { left: 10, top: TOP + 8, right: 70, bottom: 500 };
    const cover = [{ left: 0, top: 0, right: vp.width, bottom: TOP }, { left: 0, top: BOTTOM, right: vp.width, bottom: vp.height }, rail];
    const edges = (b) => ({ l: b.cx - b.hw, r: b.cx + b.hw, t: b.cy - b.hh, b: b.cy + b.hh });
    const onMap = (c) => { const e = edges(chipBox(c)); return e.t >= TOP && e.b <= BOTTOM && e.l >= 0 && e.r <= vp.width; };
    const apart = (a, b, gap = 2) => Math.abs(a.cx - b.cx) >= a.hw + b.hw + gap || Math.abs(a.cy - b.cy) >= a.hh + b.hh + gap;
    const railBox = { cx: (rail.left + rail.right) / 2, cy: (rail.top + rail.bottom) / 2, hw: (rail.right - rail.left) / 2, hh: (rail.bottom - rail.top) / 2 };

    const [under] = derive([atPx("p", "pool", cx0, 30)]);
    ck("the premise: a room just below the top edge draws its chip under the top bar", edges(chipBox(under)).t < TOP, edges(chipBox(under)));
    const [shifted] = derive([atPx("p", "pool", cx0, 30)], cover);
    ck("a chip under the top bar is moved down, fully inside the visible map", onMap(shifted), edges(chipBox(shifted)));
    ck("  ...only as far as that: its top edge one gap below the bar, its x unchanged",
       Math.abs(edges(chipBox(shifted)).t - (TOP + 2)) < 1e-6 && shifted.dx === 0, [edges(chipBox(shifted)), shifted.dx]);
    const [corner] = derive([atPx("s", "corner room", 20, 80)], cover);
    ck("a chip in the top-left corner, under the rail, is moved clear of the rail and inside the map",
       onMap(corner) && apart(chipBox(corner), railBox), edges(chipBox(corner)));
    const [side] = derive([atPx("k", "edge room", vp.width - 5, cy0)], cover);
    ck("a chip half off the right edge is moved fully inside it", onMap(side), edges(chipBox(side)));

    const [away] = derive([atPx("g", "garage", -400, cy0)], cover);
    ck("a room wholly off the screen keeps its chip there, unseen, not lined up along the edge", away.dx === 0 && away.dy === 0 && edges(chipBox(away)).r < 0);
    const many = Array.from({ length: 30 }, (_, i) => atPx(`d${i}`, `room ${String(i).padStart(2, "0")}`, cx0, 700));
    const [tall] = derive(many, cover);
    ck("thirty rooms on one spot: one chip, drawn FOLDED: its busiest room's line and the `+N` pill",
       tall.lines.length === 30 && tall.cols === 1 && tall.rows === 1 && tall.halfH === (UNIT + 8) / 2, [tall.cols, tall.rows]);
    const [wide] = derive(many, cover, tall.key);
    const w = drawnLayout(wide), wb = { cx: wide.x + w.dx, cy: wide.y - w.halfH + w.dy, hw: w.halfW, hh: w.halfH };
    ck("  ...opened, it shows all thirty, in columns, taller than the map",
       wide.open && w.cols >= 2 && w.rows * w.cols >= 30, [w.cols, w.rows]);
    ck("  ...that fits the visible map, top bar to bottom bar", (() => { const e = edges(wb); return e.t >= TOP && e.b <= BOTTOM && e.l >= 0 && e.r <= vp.width; })(), edges(wb));
    const colW = (2 * wb.hw) / w.cols, rowH = (2 * wb.hh - w.overhang) / w.rows;
    const tapped = Array.from({ length: 30 }, (_, i) => chipSlotAt(wide,
      wb.cx - wb.hw + (Math.floor(i / w.rows) + 0.5) * colW, wb.cy - wb.hh + ((i % w.rows) + 0.5) * rowH));
    const wz = chipTabZone(wide);
    ck("  ...each column fills top-down, a tap on any line names that line's room, the pill folds it",
       tapped.every((t, i) => t === i) && chipSlotAt(wide, wz.cx, wz.cy) === "toggle", tapped);
    const fb = chipBox(tall), fz = chipTabZone(tall);
    ck("  ...folded, a tap on its line's name names that room; on its pill, below the line, it opens",
       chipSlotAt(tall, fb.cx - fb.hw + 5, fb.cy - fb.hh + UNIT / 2) === 0 && chipSlotAt(tall, fb.cx, fb.cy + fb.hh) === "toggle");
    ck("  ...the pill's tap zone is at least a line tall and a line and a half wide, centred on the chip",
       fz.hh * 2 >= UNIT - 1e-9 && fz.hw * 2 >= 1.5 * UNIT - 1e-9 && Math.abs(fz.cx - fb.cx) < 1e-9);
    const back = derive([...many].reverse(), cover)[0];
    ck("  ...and it settles the same whatever order the rooms come in",
       JSON.stringify(back.lines.map((l) => l.room)) === JSON.stringify(tall.lines.map((l) => l.room)) && back.cols === tall.cols && back.dy === tall.dy);
    {
      // Rooms crowded into one chip beside a room with a chip of its own:
      // opening the big one moves nothing else, and nothing merges into it.
      const crowd = [...Array.from({ length: 6 }, (_, i) => atPx(`m${i}`, `crowd${i}`, cx0, 500)), atPx("solo", "solo", cx0 + 300, 500)];
      const shut = derive(crowd, cover);
      const big = shut.find((ch) => ch.lines.length === 6);
      const opened = derive(crowd, cover, big.key);
      ck("opening a folded chip leaves every chip's place, and what merged into what, as it was",
         opened.length === shut.length && opened.every((ch, i) => JSON.stringify(chipBox(ch)) === JSON.stringify(chipBox(shut[i])) && ch.lines.length === shut[i].lines.length),
         [shut.map(chipBox), opened.map(chipBox)]);
      ck("  ...only the opened chip is drawn open, taller than it was folded",
         opened.filter((ch) => ch.open).length === 1 && drawnLayout(opened.find((ch) => ch.open)).halfH > big.halfH);
      ck("  ...and a key naming a chip of one room opens nothing",
         derive(crowd, cover, shut.find((ch) => ch.lines.length === 1).key).every((ch) => !ch.open));
    }
    const pile = derive(Array.from({ length: 12 }, (_, i) => atPx(`q${i}`, `room${i}`, cx0 + (i % 3) * 30, 250 - i * 20)), cover);
    ck("a chain of rooms reaching above the top bar settles on the map with no two chips overlapping",
       pile.every(onMap) && pile.every((c, i) => pile.every((o, j) => j <= i || apart(chipBox(c), chipBox(o)))), pile.map((c) => [c.lines.length, edges(chipBox(c))]));

    // A card of another room's devices stands where a room chip would be drawn.
    const study = atPx("s1", "study", cx0, 400);
    const card = { key: "hall:fan.a", room: "Hall", roomKeys: ["hall"], members: [0, 1, 2, 3], grid: 4, focused: false,
                   wx: study.pos.x + 10 / pxPerM, wy: study.pos.y - 15 / pxPerM, wz: 6, sx: 0, sy: 0, sz: 0 };
    const pass = begin([study], cover);
    const cardBox = drawnCardBox(pass.f, card, scene.getTransformMatrix(), vp);
    const [bare] = pass.deriveChips();
    ck("the premise: the study's chip, where it stands, covers the hall's group card", !apart(chipBox(bare), cardBox), [chipBox(bare), cardBox]);
    const [kept] = pass.settleChips([], [], [card], null);
    ck("the settled chip is moved off the card, still on the map, near its room",
       apart(chipBox(kept), cardBox) && onMap(kept) && Math.hypot(kept.dx, kept.dy) < 4 * (kept.halfW + kept.halfH),
       [chipBox(kept), cardBox]);
  }
}

console.log("\n  a chip of many rooms is drawn folded, and folding never hides trouble (owner, 2026-11-14):");
{
  // n rooms crowded into one chip: room i has (n - i) devices, so the busiest
  // come first; `kinds` puts a state on one room's devices.
  const merged = (n, kinds = {}) => {
    const ms = [];
    for (let i = 0; i < n; i++) for (let d = 0; d < n - i; d++) ms.push(M(`r${i}d${d}`, `r${i}`, i, d === 0 ? kinds[i] : "off"));
    const cs = bucketRoomChips(ms, () => true, (k) => k.toUpperCase());
    cs.forEach((c) => { c.x = 0; c.y = 0; c.halfW = 10; c.halfH = 5; });
    return mergeOverlapping(cs, 2, (c) => c.ids.length, (keep, drop) => combineChips(keep, drop))[0];
  };
  const rowsOf = (chip) => roomChipModel(chip, false, () => false).slots;
  const lone = bucketRoomChips([M("a", "r", 0, "off")], () => true, (k) => k)[0];
  ck("a chip of one room draws its one line, no `+N` pill", rowsOf(lone).join() === "0" && !roomChipModel(lone, false, () => false).toggle);
  ck("two rooms draw the busiest room's line and a `+N` pill", rowsOf(merged(2)).join() === "0"
     && !!roomChipModel(merged(2), false, () => false).toggle && roomChipModel(merged(2), false, () => false).lines[0].room === "R0");
  const ten = merged(10);
  ck("ten rooms draw the busiest room's line and a `+N` pill", rowsOf(ten).join() === "0" && !!roomChipModel(ten, false, () => false).toggle);
  ck("  ...a hidden second room's trouble shows on the `+` of a two-room chip",
     healthPill(roomChipModel(merged(2, { 1: "alert" }), false, () => false).toggle.health).fill === healthPill("alert").fill);
  const pillOf = (chip) => healthPill(roomChipModel(chip, false, () => false).toggle.health).fill;
  const lineFill = (h) => healthPill(h).fill;
  ck("  ...all its hidden rooms all right: the `+` pill is the all-right colour", pillOf(ten) === lineFill("ok"));
  ck("  ...a hidden room needing attention: the `+` pill is red", pillOf(merged(10, { 7: "alert" })) === lineFill("alert"));
  ck("  ...a hidden fault: amber", pillOf(merged(10, { 5: "fault" })) === lineFill("fault"));
  ck("  ...a hidden lost device: grey", pillOf(merged(10, { 9: "unavailable" })) === lineFill("unavailable"));
  ck("  ...red beats amber beats grey", pillOf(merged(10, { 4: "fault", 6: "alert", 8: "unavailable" })) === lineFill("alert")
     && pillOf(merged(10, { 4: "unavailable", 6: "fault" })) === lineFill("fault"));
  ck("  ...trouble on a SHOWN line stays on that line, not on the `+` pill", pillOf(merged(10, { 0: "alert" })) === lineFill("ok"));
  const open = merged(10, { 7: "alert" });
  open.open = { cols: 1, rows: 10, halfW: 10, halfH: 5, dx: 0, dy: 0, overhang: 2 };
  ck("opened, it draws every line, and the pill to fold it", rowsOf(open).join() === "0,1,2,3,4,5,6,7,8,9" && !!roomChipModel(open, false, () => false).toggle);
}

done("✅ a room chip says who is in it, merged or not");

