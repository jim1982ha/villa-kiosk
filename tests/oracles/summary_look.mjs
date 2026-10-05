// A summary on the map — a group card, a room chip — as a model, driven by
// value (babylon/summaryLook.ts, 2.496.245).
//
// The rules sat inside EntityVisuals' drawing code (updateEntityGroups,
// renderChips), and the only checks on them were regexes over its source text,
// which pass as long as a line is spelled the same, whatever it does. They are
// a pure model now; this drives members' real deviceLooks through it.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { groupCardModel, roomChipModel, roomLook, summaryFrame } = await import("@/babylon/summaryLook");
const { bucketRoomChips, combineChips } = await import("@/babylon/roomChips");
const { deviceLook, storeLookSource } = await import("@/utils/deviceActivity");

const ent = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });
const ENTITIES = {
  "light.on": ent("light.on", "on"), "light.off": ent("light.off", "off"),
  "lock.open": ent("lock.open", "unlocked"), "lock.open2": ent("lock.open2", "unlocked"),
  "camera.idle": ent("camera.idle", "idle"), "light.lost": ent("light.lost", "unavailable"),
  "sensor.power": ent("sensor.power", "80"), "switch.pump": ent("switch.pump", "on"),
};
const src = storeLookSource(ENTITIES, {
  entityMap: { "sensor.power": { entityId: "sensor.power", type: "sensor", linkedEntityId: "switch.pump" } }, alertThresholds: {} });
const member = (id, extra = {}) => ({ id, look: deviceLook(id, src), reported: id in ENTITIES, occluded: false, ...extra });

console.log("  a group card:");
{
  const two = groupCardModel([member("light.on"), member("lock.open")], 2, false);
  ck("two cells: it SHOWS its devices — a grid of 2, one cell per member with that member's own face and ring",
     two.gridN === 2 && two.cells.map((c) => `${c.id}:${c.face}/${c.ring}`).join() === "light.on:active/active,lock.open:alert/alert", two.cells);
  ck("  ...its frame is not red for one alerting cell of two (each cell already says so)", two.frame === "rest");
  ck("  ...red when EVERY cell alerts", groupCardModel([member("lock.open"), member("lock.open2")], 2, false).frame === "alert");
  ck("  ...never the 'on' frame while showing devices", groupCardModel([member("light.on"), member("light.on")], 2, false).frame === "rest");
  const pumpCell = groupCardModel([member("sensor.power"), member("light.off")], 2, false).cells[0];
  ck("  ...a linked cell rings in its own colour, its face its own state", pumpCell.face === "off" && pumpCell.ring === "active");
  const cnt = groupCardModel([member("light.on"), member("light.off"), member("lock.open"), member("camera.idle")], 1, false);
  ck("a count (one cell drawn): no grid, no cells", cnt.gridN === 0 && cnt.cells.length === 0, cnt);
  ck("  ...red when ANY member alerts", cnt.frame === "alert");
  ck("  ...the neutral 'on' frame when one is on and none alerts",
     groupCardModel([member("light.on"), member("light.off"), member("light.off")], 1, false).frame === "active");
  ck("  ...a member the map never heard from draws its phantom cell but rings nothing",
     groupCardModel([member("light.ghost"), member("light.on")], 2, false).cells[0].face === "unavailable"
     && groupCardModel([member("light.ghost"), member("light.off")], 1, false).frame === "rest");
  ck("its entity ids are its members, in member order", cnt.entityIds.join() === "light.on,light.off,lock.open,camera.idle");
  const walls = [member("light.on", { occluded: true }), member("light.off", { occluded: true })];
  ck("hidden while walking when EVERY member is behind a wall", groupCardModel(walls, 2, true).hidden);
  ck("  ...not when one is visible, nor in the overview",
     !groupCardModel([walls[0], member("light.off")], 2, true).hidden && !groupCardModel(walls, 2, false).hidden);
}

console.log("\n  a room chip:");
{
  const M = (id, room, x) => ({ id, room, pos: { x, y: 1, z: 0 }, look: id in ENTITIES ? deviceLook(id, src) : undefined });
  const [k, b] = bucketRoomChips([M("light.on", "kitchen", 0), M("light.off", "kitchen", 1), M("light.lost", "bed", 5), M("lock.open", "bed", 6)],
    () => true, (r) => r.toUpperCase());
  const km = roomChipModel(k, false, () => false);
  ck("prints its label, names its room, counts its devices", km.label === "KITCHEN" && km.displayName === "KITCHEN" && km.count === "2" && km.entityIds.join() === "light.on,light.off");
  ck("  ...the 'on' border for a light on, a GREEN count (all right)", km.frame === "active" && km.health === "ok");
  const bm = roomChipModel(b, false, () => false);
  // The owner's screenshot (2026-10-04): a red border beside a green count.
  // "Is this room all right?" is the NUMBER's answer alone; the border only says on.
  ck("  ...an unlocked lock and a lost light: a RED count — attention outranks lost contact — and NO red border",
     bm.health === "alert" && bm.frame === "rest", bm);
  {
    const [lost] = bucketRoomChips([M("light.lost", "x", 0), M("light.off", "x", 1)], () => true, (r) => r);
    const [onAndAlert] = bucketRoomChips([M("light.on", "y", 0), M("lock.open", "y", 1)], () => true, (r) => r);
    ck("  ...a room with only a lost device: an AMBER count", roomChipModel(lost, false, () => false).health === "unavailable");
    const oa = roomChipModel(onAndAlert, false, () => false);
    ck("  ...a light on beside an unlocked door keeps its 'on' border (red no longer hides it) and counts red",
       oa.frame === "active" && oa.health === "alert", oa);
  }
  const lookOf = (ids) => roomLook(ids.map((id) => (id in ENTITIES ? deviceLook(id, src) : undefined)));
  const kr = lookOf(k.ids), br = lookOf(b.ids);
  ck("a room's row in \"Which room?\" wears that room's own chip frame and pill (roomLook = roomChipModel)",
     kr.frame === km.frame && kr.health === km.health && br.frame === bm.frame && br.health === bm.health, { kr, br });
  ck("  ...a plain room rests, a room nobody reported rests and reads available",
     lookOf(["light.off"]).frame === "rest" && lookOf(["light.ghost"]).frame === "rest" && lookOf(["light.ghost"]).health === "ok");
  combineChips(k, b);
  const merged = roomChipModel(k, false, () => false);
  ck("merged: every room's devices, both names; the worst health wins and an 'on' survives",
     merged.count === "4" && merged.roomNames.join() === "KITCHEN,BED" && merged.health === "alert" && merged.frame === "active", merged);
  {
    // The chip that KEEPS is resting; only the room it swallows has a light on.
    const [rest, lit] = bucketRoomChips([M("light.off", "a", 0), M("light.on", "b", 9)], () => true, (r) => r);
    combineChips(rest, lit);
    ck("  ...merging a resting room with a lit one: the merged chip shows 'on'", roomChipModel(rest, false, () => false).frame === "active");
  }
  ck("hidden while walking only when EVERY device is behind a wall",
     roomChipModel(k, true, () => true).hidden && !roomChipModel(k, true, (id) => id !== "light.on").hidden && !roomChipModel(k, false, () => true).hidden);
  const many = bucketRoomChips(Array.from({ length: 120 }, (_, i) => M(`light.off`, "hall", i)), () => true, (r) => r)[0];
  ck("the pill is capped: 120 devices read \"99+\"", roomChipModel(many, false, () => false).count === "99+");
}

console.log("\n  the frame:");
ck("red outranks on; neither is rest", summaryFrame({ ringRed: true, ringOn: true }) === "alert"
   && summaryFrame({ ringRed: false, ringOn: true }) === "active" && summaryFrame({ ringRed: false, ringOn: false }) === "rest");

console.log("\n  the count's colour (colors.healthPill):");
{
  const { healthPill, ALERT_RED_HEX } = await import("@/babylon/colors");
  const { categorySurface } = await import("@/config/EntityCategories");
  const up = (h) => String(h).toUpperCase();
  const red = healthPill("alert"), lost = healthPill("unavailable"), ok = healthPill("ok");
  ck("red = the legend's 'Needs attention' red; amber = the badge's own lost-contact amber; green otherwise — three different colours",
     up(red.fill) === up(ALERT_RED_HEX) && up(red.fill) === up(categorySurface("others", "alert").ring)
     && up(lost.fill) === up(categorySurface("others", "unavailable").ring)
     && new Set([red.fill, lost.fill, ok.fill].map(up)).size === 3, { red, lost, ok });
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  ck("  ...its number readable on all three (4.5:1 or better)",
     [red, lost, ok].every((p) => contrast(p.fill, p.ink) >= 4.5), [red, lost, ok].map((p) => contrast(p.fill, p.ink).toFixed(2)));
  const { readFileSync } = await import("node:fs");
  const rd = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
  const ev = rd("babylon/EntityVisuals.ts"), sheet = rd("components/hud/RoomChoiceSheet.tsx"), legend = rd("components/hud/LegendModal.tsx");
  ck("  ...the map chip, the \"Which room?\" row and the legend all ask it, none picks its own",
     /\.\.\.healthPill\(model\.health\),/.test(ev) && /healthPill\(c\.health\)\.fill/.test(sheet) && /healthPill\(c\.health\)\.ink/.test(sheet)
     && /healthPill\(n\.health\)\.fill/.test(legend) && !/AVAILABLE_GREEN_HEX|ALERT_RED_HEX/.test(ev + sheet + legend));
}

done("✅ a summary on the map is a model; EntityVisuals only draws it");
