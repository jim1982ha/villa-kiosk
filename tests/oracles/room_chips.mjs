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
  ck("  ...each pill its OWN room's health: red alert, amber fault, grey lost, purple all right",
     model.lines.map((l) => `${l.room}=${l.health}`).join() === "Master Bedroom=alert,Den=ok,Study=fault,Hall=ok,Master Bathroom=unavailable",
     model.lines.map((l) => [l.room, l.health]));
  ck("  ...each line's pill is the colour and number that room's chip shows standing alone",
     model.lines.every((l) => healthPill(l.health).fill === healthPill(alone[l.key].health).fill && l.count === alone[l.key].count && l.label === alone[l.key].label));
  ck("  ...four pill colours, not one", new Set(model.lines.map((l) => healthPill(l.health).fill)).size === 4);
  ck("  ...a tap on a line names that room and only its devices",
     model.lines.find((l) => l.room === "Study").entityIds.join() === "c1,c2");
  ck("  ...and the border is the MERGED one: no member is on, so it rests", model.frame === "rest");
  const lit = bucketRoomChips([M("x", "a", 0, "off"), M("y", "b", 1, "on")], () => true, (k) => k);
  lit.forEach((c, i) => { c.x = i; c.y = 0; c.halfW = 10; c.halfH = 5; });
  const [one] = mergeOverlapping(lit, 2, (c) => c.ids.length, (keep, drop) => combineChips(keep, drop));
  ck("  ...one room on lights the merged chip's single border", roomChipModel(one, false, () => false).frame === "active");
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
  const derive = (members) => {
    const pass = new PlacementPass();
    pass.begin({
      metrics: { minGapPx: 2, cardIconFraction: 0.8, countPillFraction: 0.4, countFontFraction: 0.6 },
      summary: { size: UNIT, font: 16, countSize: 16, countFont: 10 }, perCardCap: MAX_GRID_CHIPS,
      rooms: {}, focus: new RoomFocus(), exempt: new Set(), scale: 1, cardBudget: 10_000, cellCap: 6,
      chips: { members, view: { tm: scene.getTransformMatrix(), vp }, text: { charPx: 7, padPx: 20 }, budget: 400 },
    });
    for (const m of members) { pass.roomDisplay.set(m.room, m.room); pass.chipRoom(m.room, "solver"); }
    return pass.deriveChips();
  };
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
  ck("a second room on the same spot makes a TWO-line chip, which reaches it: all three merge",
     grown.length === 1 && grown[0].lines.length === 3, grown.map((c) => c.lines.map((l) => l.room)));
  ck("  ...the chip is measured one line per room tall", grown[0].halfH === (3 * UNIT) / 2, grown[0].halfH);
  const pile = derive(Array.from({ length: 8 }, (_, i) => at(`r${i}`, `room${i}`, i * 0.9 * UNIT)));
  ck("  ...a column of eight rooms, each grown chip reaching the next, settles with nothing overlapping",
     clear(pile) && pile.reduce((n, c) => n + c.lines.length, 0) === 8, pile.map((c) => c.lines.length));
  const again = derive(Array.from({ length: 8 }, (_, i) => at(`r${i}`, `room${i}`, i * 0.9 * UNIT)).reverse());
  ck("  ...and the same rooms in another order give the same chips",
     JSON.stringify(again.map((c) => c.lines.map((l) => l.room))) === JSON.stringify(pile.map((c) => c.lines.map((l) => l.room))));
}

done("✅ a room chip says who is in it, merged or not");

