// "Corner dot" — the square says what a device does, the corner mark says what is wrong (owner, 2026-10-22: badge
// proposal 2; utils/deviceActivity badgeFace / badgeMarkOf / linkPillOf, drawn by babylon/badgeIcons) — and "one corner
// per device" (owner, 2026-10-22): top-right the device itself, bottom-right its linked entity, one precedence for both.
//
// Until then a problem WAS the face: an alarm painted the whole square red, lost contact a dashed amber ring, so the
// badge stopped saying what the device was doing; a linked switch on forced the device "on" (a pump-power sensor lit
// its room chip whenever its relay ran); an open Cockpit fault showed nothing on the map; a device hidden in the
// villa's system was still drawn; and "no contact" was amber, the colour of a fault. This drives values through the
// pure rule and the real adapters: the mark's order, the linked dot, the hidden device's missing badge, the linked
// entity wearing its device's badge, the fault set, the asleep lens and the one grey for "no contact".
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const {
  badgeMarkFor, deviceLook, drawsBadge, badgeOwnerOf, storeLookSource, mapLookSource,
} = await import("@/utils/deviceActivity");
const { STATUS_COLOR } = await import("@/utils/stateColors");
const { markSurface, categorySurface } = await import("@/config/EntityCategories");
const { faultDevices } = await import("@/config/attention");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { UnavailableByDesign } = await import("@/ha/unavailableByDesign");
const { panelHeader } = await import("@/components/panels/panelHeader");

const ent = (id, state, attributes = {}) => ({ entity_id: id, state, attributes, last_changed: "", last_updated: "" });
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

console.log("  the corner mark — one at most, the most urgent:");
{
  // the order, written out HERE (never read from the module under test): red "?" critical silent, red "!" alarm, amber
  // "!" fault, grey "?" no contact, grey "z" asleep, teal "…" moving
  const ORDER = ["critical", "alarm", "fault", "lost", "asleep", "moving"];
  const wrong = [];
  for (let bits = 0; bits < 1 << ORDER.length; bits++) {
    const facts = Object.fromEntries(ORDER.map((m, i) => [m, !!(bits & (1 << i))]));
    const want = ORDER.find((m) => facts[m]) ?? null;
    const got = badgeMarkFor(facts);
    if (got !== want) wrong.push({ facts, want, got });
  }
  ck("every one of the 64 combinations of facts takes the first in the owner's order", wrong.length === 0, wrong.slice(0, 3));
  const only = (...ms) => badgeMarkFor(Object.fromEntries(ORDER.map((m) => [m, ms.includes(m)])));
  ck("  ...critical-lost beats alarm, alarm beats fault, fault beats lost, lost beats asleep, asleep beats moving; none: no mark",
     only("critical", "alarm") === "critical" && only("alarm", "fault") === "alarm" && only("fault", "lost") === "fault"
     && only("lost", "asleep") === "lost" && only("asleep", "moving") === "asleep" && only() === null);
}

console.log("\n  through the real look (deviceLook), every surface's:");
{
  const E = {
    "lock.front": ent("lock.front", "unlocked"), "lock.back": ent("lock.back", "locking"),
    "cover.blind": ent("cover.blind", "opening"), "light.hall": ent("light.hall", "unavailable"),
    "light.crit": ent("light.crit", "unavailable"), "light.ok": ent("light.ok", "on"),
  };
  const faults = new Set(["lock.front", "light.hall", "light.crit", "light.ok"]);
  const config = { entityMap: {}, isHidden: () => false, isCritical: (id) => id === "light.crit" || id === "light.ok", hasFault: (id) => faults.has(id) };
  const L = (id) => deviceLook(id, storeLookSource(E, config));
  ck("a critical device silent: red \"?\" even with an open fault", L("light.crit").mark === "critical");
  ck("an unlocked door with an open fault: red \"!\" — its face OPEN (active), never red",
     L("lock.front").mark === "alarm" && L("lock.front").face === "active");
  ck("a lost lamp with an open fault: amber \"!\" (a fault outranks no contact); without one, grey \"?\"",
     L("light.hall").mark === "fault"
     && deviceLook("light.hall", storeLookSource(E, { ...config, hasFault: () => false })).mark === "lost");
  ck("  ...its face the resting look, faded, its glyph grey — no dashed amber ring",
     L("light.hall").face === "unavailable" && categorySurface("light", "unavailable").faded === true
     && categorySurface("light", "unavailable").ringHairline === true
     && categorySurface("light", "unavailable").glyph === markSurface("lost").fill);
  ck("a lamp on with an open fault: amber \"!\" over its ON face — critical or not: red \"?\" needs contact lost",
     L("light.ok").mark === "fault" && L("light.ok").face === "active");
  ck("a lock locking, a blind opening: teal \"…\" (moving), never an alarm",
     L("lock.back").mark === "moving" && L("cover.blind").mark === "moving" && !L("lock.back").alert);
  ck("no fault list given (the Cockpit's own counts): no amber",
     deviceLook("light.ok", storeLookSource(E, { entityMap: {}, isHidden: () => false })).mark === null);
  ck("the room's count reads the fault too (DeviceLook.fault)",
     L("light.ok").fault && !deviceLook("light.ok", storeLookSource(E, { ...config, hasFault: () => false })).fault);
}

console.log("\n  asleep by design (the entity store's lens):");
{
  const lens = new UnavailableByDesign();
  const door = ent("binary_sensor.door", "off", { device_class: "door" });
  lens.setIds(new Set(["binary_sensor.door"]), {});
  const live = lens.see(door);
  const asleep = lens.see(ent("binary_sensor.door", "unavailable", { device_class: "door" }));
  const fresh = new UnavailableByDesign();
  fresh.setIds(new Set(["binary_sensor.door"]), {});
  const never = fresh.see(ent("binary_sensor.door", "unavailable", { device_class: "door" }));
  const look = (e) => deviceLook("binary_sensor.door", storeLookSource({ "binary_sensor.door": e }, { entityMap: {}, isHidden: () => false }));
  ck("asleep, shown with its last report: grey \"z\", its face its last state, never lost",
     asleep.state === "off" && look(asleep).mark === "asleep" && look(asleep).face === "off" && !look(asleep).unavailable);
  ck("  ...asleep before any report is known (\"unknown\"): grey \"z\" too", never.state === "unknown" && look(never).mark === "asleep");
  ck("  ...awake (its live report): no mark", look(live).mark === null && look(door).mark === null);
  ck("  ...a device not on the list keeps the villa's own state: lost, grey \"?\"",
     look(new UnavailableByDesign().see(ent("binary_sensor.door", "unavailable"))).mark === "lost");
}

console.log("\n  one corner per device — the bottom-right pill is the linked entity, all of it (owner, 2026-10-22):");
{
  const P = "sensor.pump_power", R = "switch.pump";
  const entityMap = { [P]: { entityId: P, type: "sensor", linkedEntityId: R } };
  const world = (relay, cfg = {}) => {
    const E = { [P]: ent(P, "80", { device_class: "power" }) };
    if (relay !== null) E[R] = ent(R, relay);
    return storeLookSource(E, { entityMap, isHidden: () => false, ...cfg });
  };
  const at = (relay, cfg) => deviceLook(P, world(relay, cfg));
  ck("relay on: filled; off: hollow — the sensor's face, kind and top-right its own (no forced \"on\")",
     at("on").linkPill === "on" && at("off").linkPill === "off" && at("on").face === "off" && at("on").kind === "info"
     && !at("on").active && at("on").mark === null && at("off").face === at("on").face);
  ck("  ...no linked entity: no bottom-right pill", deviceLook(R, world("on")).linkPill === null);
  ck("  ...a linked entity never reported: a plain hollow pill, not a \"?\" for what the map has not heard from yet",
     at(null).linkPill === "off");
  // the linked entity's OWN problems, each in the bottom-right and never in the top-right
  const lockMap = { "lock.l": { entityId: "lock.l", type: "lock", linkedEntityId: "binary_sensor.d" } };
  const door = (state, cfg = {}) => deviceLook("lock.l", storeLookSource({
    "lock.l": ent("lock.l", "locked"), "binary_sensor.d": ent("binary_sensor.d", state, { device_class: "door" }),
  }, { entityMap: lockMap, isHidden: () => false, ...cfg }));
  ck("a linked door sensor reading Open: red \"!\" bottom-right, NOT top-right; the lock is not alerting",
     door("on").linkPill === "alarm" && door("on").mark === null && !door("on").alert && door("on").kind !== "alert");
  ck("  ...its open fault: amber \"!\" bottom-right (the lock's own fault list says nothing of the lock)",
     door("off", { hasFault: (id) => id === "binary_sensor.d" }).linkPill === "fault"
     && door("off", { hasFault: (id) => id === "binary_sensor.d" }).mark === null);
  ck("  ...lost: grey \"?\"; lost AND critical: red \"?\" — bottom-right",
     door("unavailable").linkPill === "lost" && door("unavailable", { isCritical: (id) => id === "binary_sensor.d" }).linkPill === "critical"
     && door("unavailable").mark === null);
  ck("  ...a linked lock locking: teal \"…\" bottom-right", deviceLook(P, storeLookSource(
    { [P]: ent(P, "80"), "lock.g": ent("lock.g", "locking") },
    { entityMap: { [P]: { entityId: P, type: "sensor", linkedEntityId: "lock.g" } }, isHidden: () => false })).linkPill === "moving");
  {
    const lens = new UnavailableByDesign();
    lens.setIds(new Set([R]), {});
    lens.see(ent(R, "on"));
    const asleepRelay = lens.see(ent(R, "unavailable"));
    const s2 = storeLookSource({ [P]: ent(P, "80"), [R]: asleepRelay }, { entityMap, isHidden: () => false });
    ck("  ...asleep by design: grey \"z\" bottom-right (a problem outranks its on/off)", deviceLook(P, s2).linkPill === "asleep");
  }
  // ONE precedence: the bottom pill is the very function the top pill is, applied to the linked entity's reading
  const cases = [["on", {}], ["unavailable", { hasFault: () => true }], ["unavailable", { isCritical: () => true, hasFault: () => true }],
                 ["off", { hasFault: () => true }], ["on", { hasFault: () => true }]];
  const same = cases.every(([st, cfg]) => {
    const src = storeLookSource({ "lock.l": ent("lock.l", "locked"), "binary_sensor.d": ent("binary_sensor.d", st, { device_class: "door" }) },
      { entityMap: lockMap, isHidden: () => false, ...cfg });
    const own = deviceLook("binary_sensor.d", src).mark;   // the sensor's own badge, its top-right
    const pill = deviceLook("lock.l", src).linkPill;
    return own === null ? pill === "on" || pill === "off" : pill === own;
  });
  ck("the bottom-right pill of the lock IS the door sensor's own top-right pill, whenever it has one (one precedence)", same);
  ck("  ...and the source says so: linkPillOf applies badgeMarkOf to the linked reading",
     /return \(r\.link \? badgeMarkOf\(r\.link\) : null\) \?\? \(r\.linkedOn \? "on" : "off"\);/.test(src("utils/deviceActivity.ts")));
}

console.log("\n  the two pills' size and place (the approved mock: a 56 px square, 28 px pills):");
{
  const { pillGeometry, PILL_MARGIN, PICTURE_SCALE } = await import("@/babylon/badgeLook");
  const g = pillGeometry(0, 56);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ck("each pill half the square's side, a 16 px symbol, a 2 px ground ring, a 3 px hollow ring",
     near(g.r * 2, 28) && near(g.symbolPx, 16) && near(g.ring, 2) && near(g.hollowRing, 3), g);
  ck("  ...equal, on the right: top-right and bottom-right, each 6 px outside its corner",
     near(g.top.cx, 48) && near(g.top.cy, 8) && near(g.bottom.cx, 48) && near(g.bottom.cy, 48)
     && near(g.top.cx + g.r, 56 + 6) && near(g.top.cy - g.r, -6) && near(g.bottom.cy + g.r, 56 + 6), g);
  // the picture: a margin round the square wide enough for the pill and its ring, and no wider
  const px = 72, m = px * PILL_MARGIN, side = px - 2 * m, gp = pillGeometry(m, side);
  ck("the picture's margin holds the pills with their ring, never clipped (and is drawn PICTURE_SCALE larger)",
     near(side, 56) && gp.top.cy - gp.r - gp.ring >= -1e-9 && gp.top.cx + gp.r + gp.ring <= px + 1e-9
     && gp.bottom.cy + gp.r + gp.ring <= px + 1e-9 && near(PICTURE_SCALE * side, px), { m, side });
  const css = readFileSync(new URL("../../src/styles/01-base.css", import.meta.url), "utf8");
  const v = Number(/--badge-picture-scale:\s*([\d.]+);/.exec(css)?.[1]);
  ck("  ...the lists' CSS scale is the map's (to 4 places)", Math.abs(v - PICTURE_SCALE) < 1e-4, v);
  const bi = src("babylon/badgeIcons.ts");
  ck("the bake paints the device's mark top-right and the linked pill bottom-right, through one painter (pin it)",
     /if \(mark\) drawPill\(ctx, pills, pills\.top, mark, ""\);/.test(bi)
     && /if \(linkPill\) drawPill\(ctx, pills, pills\.bottom, linkPill, categorySurface\(category, "active", colorOverride\)\.glyph\);/.test(bi)
     && /const px = bakeSizeFor\(pxHint \* PICTURE_SCALE\);/.test(bi));
}

console.log("\n  a linked entity placed on its own wears its device's badge:");
{
  const entityMap = {
    "lock.gate": { entityId: "lock.gate", type: "lock", linkedEntityId: "switch.gate_relay", badgeColor: "#123456" },
    "switch.gate_relay": { entityId: "switch.gate_relay", type: "switch" },
  };
  ck("its device is the one whose linkedEntityId names it; anything else is its own",
     badgeOwnerOf("switch.gate_relay", entityMap) === "lock.gate" && badgeOwnerOf("lock.gate", entityMap) === "lock.gate"
     && badgeOwnerOf("light.x", entityMap) === "light.x");
  const E = { "lock.gate": ent("lock.gate", "locked"), "switch.gate_relay": ent("switch.gate_relay", "on") };
  const h = panelHeader({ panel: { entityId: "switch.gate_relay", mapping: entityMap["switch.gate_relay"] }, entities: E,
    config: { entityMap, isHidden: () => false }, canControl: false, linkedSwitch: null });
  const own = panelHeader({ panel: { entityId: "lock.gate", mapping: entityMap["lock.gate"] }, entities: E,
    config: { entityMap, isHidden: () => false }, canControl: false, linkedSwitch: null });
  ck("  ...the relay's badge: the lock's pictogram, category and colour — its face its OWN on",
     h.badge.iconKey === own.badge.iconKey && h.badge.category === own.badge.category && h.badge.color === "#123456"
     && h.badge.state === "active" && own.badge.state === "off", { relay: h.badge, lock: own.badge });
  const ev = src("babylon/EntityVisuals.ts"), sg = src("components/panels/SummaryGroupPanel.tsx");
  ck("  ...the map's badges, its group cells and the device lists ask the same (pin the callers)",
     /const owner = badgeOwnerOf\(entityId, this\.config\.entityMap\);/.test(ev)
     && (ev.match(/this\.badgeSubject\(/g) ?? []).length >= 4
     && /const owner = badgeOwnerOf\(id, config\.entityMap\);/.test(sg));
}

console.log("\n  hidden in the villa's system — no badge at all:");
{
  const E = { "lock.old": ent("lock.old", "unlocked"), "light.gone": ent("light.gone", "unavailable"), "lock.door": ent("lock.door", "unlocked") };
  const config = { entityMap: {}, isHidden: (id) => id !== "lock.door", isCritical: () => true, hasFault: () => true };
  for (const [name, s] of [["the store", storeLookSource(E, config)], ["the map", mapLookSource(new Map(Object.entries(E)), new Map(), () => config)]]) {
    ck(`${name}: a hidden device draws no badge, and says nothing (no mark, never a fault)`,
       !drawsBadge("lock.old", s) && !drawsBadge("light.gone", s) && drawsBadge("lock.door", s)
       && deviceLook("lock.old", s).mark === null && deviceLook("light.gone", s).mark === null && !deviceLook("lock.old", s).fault);
  }
  ck("  ...the map asks it before drawing — and so the room chip never counts it (pin the caller)",
     /private badgeEligible\([^)]*\): boolean \{\s+if \(hidden\.includes\(lbl\.category\)\) return false;\s+if \(!drawsBadge\(id, this\.lookSource\)\) return false;/.test(src("babylon/EntityVisuals.ts")));
}

console.log("\n  the open faults, folded onto their devices:");
{
  const t = (id, entityId, status = "open") => ({ id, title: "x", status, openedAt: "2026-10-20T10:00:00Z", photoIds: [], updates: [], entityId });
  const fm = { ...EMPTY_FM_DATA, tickets: [t("a", "sensor.pump_energy"), t("b", "light.hall", "resolved"), t("c", "sensor.gone,switch.y")] };
  const set = faultDevices(fm, (id) => id !== "sensor.gone", new Map([["sensor.pump_energy", "switch.pump"]]));
  ck("an open fault marks its entity AND its device; a closed one marks nothing; a list names the first the system has",
     set.has("sensor.pump_energy") && set.has("switch.pump") && !set.has("light.hall") && set.has("switch.y") && !set.has("sensor.gone"),
     [...set]);
}

console.log("\n  one grey for \"no contact\":");
{
  const css = readFileSync(new URL("../../src/styles/01-base.css", import.meta.url), "utf8");
  ck("the status vocabulary's lost contact is the grey token, never the amber of a fault",
     STATUS_COLOR.unavailable === "var(--status-lost)" && STATUS_COLOR.unavailable !== "var(--status-warning)");
  ck("  ...defined in every theme (light, dark, night)", (css.match(/--status-lost:\s*#[0-9A-Fa-f]{6};/g) ?? []).length === 3);
  ck("  ...the badge's grey \"?\" and \"z\" are that grey; the fault's \"!\" amber; red only for act-now",
     markSurface("lost").fill === markSurface("asleep").fill && markSurface("lost").fill !== markSurface("fault").fill
     && markSurface("critical").fill === markSurface("alarm").fill && markSurface("alarm").fill !== markSurface("fault").fill
     && markSurface("lost").symbol === "?" && markSurface("asleep").symbol === "z" && markSurface("fault").symbol === "!"
     && markSurface("critical").symbol === "?" && markSurface("moving").symbol === "…");
}

done("✅ the square says what a device does, the corner mark what is wrong");
