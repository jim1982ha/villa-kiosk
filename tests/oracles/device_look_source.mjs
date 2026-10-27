// One device, one look — whichever side holds its state (2.496.245).
//
// deviceActivity's rule was shared but its INPUTS were not: every caller built
// its own DeviceReading, and `linkedOn` was resolved three ways — the map
// through devicePower, the panel header through its optimistic switch, the
// device-list rows through a raw `state === "on"`. So a device LINKED to a lock
// that was UNLOCKED, or a cover that was OPEN, rang on the map and sat plain in
// the list one tap away. deviceLook now resolves the linked entity and the
// reading itself, from a LookSource; this drives the SAME states through
// the map's adapter (mapLookSource — EntityVisuals' live cache) and the store's
// (storeLookSource — every React surface) and asserts identical looks.
import { register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { deviceLook, lookMarks, mapLookSource, NO_MARKS, sameMarks, storeLookSource } = await import("@/utils/deviceActivity");

const ent = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });

// Every type, in states that exercise each branch of the rule.
const DEVICES = {
  light: ["on", "off", "unavailable"],
  switch: ["on", "off", "unknown"],
  fan: ["on", "off"],
  lock: ["locked", "unlocked", "locking", "jammed", "unavailable"],
  cover: ["open", "closed", "opening"],
  climate: ["heat", "off", "cool"],
  media_player: ["playing", "paused", "idle", "off", "buffering"],
  camera: ["idle", "recording", "streaming", "unavailable"],
  sensor: ["24", "problem", "triggered", "sunny", "unavailable"],
  binary_sensor: ["on", "off", "unavailable"],
  input_boolean: ["on", "off"],
};
const CLASSES = { binary_sensor: [undefined, "motion", "moisture", "connectivity", "door"] };
// What a device can be LINKED to, in every position devicePower knows.
const LINKS = [null, ["switch.pump", "on"], ["switch.pump", "off"], ["lock.gate", "unlocked"], ["lock.gate", "locked"],
               ["cover.blind", "open"], ["cover.blind", "closed"], ["switch.pump", "unavailable"], ["switch.pump", null]];

const cases = [];
for (const [type, states] of Object.entries(DEVICES)) {
  for (const state of states) {
    for (const dc of CLASSES[type] ?? [undefined]) {
      for (const link of LINKS) {
        cases.push({ type, state, dc, link });
      }
    }
  }
}

const id = (type) => `${type}.device`;
const world = (c) => {
  const did = id(c.type);
  const entities = { [did]: ent(did, c.state, c.dc ? { device_class: c.dc } : {}) };
  if (c.link && c.link[1] !== null) entities[c.link[0]] = ent(c.link[0], c.link[1]);
  const mapping = { entityId: did, type: c.type, ...(c.link ? { linkedEntityId: c.link[0] } : {}) };
  const config = { entityMap: { [did]: mapping }, isHidden: () => false };
  return { did, entities, config, mapping };
};

const FIELDS = ["type", "face", "mark", "linkPill", "kind", "own", "active", "alert", "unavailable", "power", "linkedOn"];
const differ = [];
for (const c of cases) {
  const w = world(c);
  const viaStore = deviceLook(w.did, storeLookSource(w.entities, w.config));
  const viaMap = deviceLook(w.did, mapLookSource(new Map(Object.entries(w.entities)), new Map([[w.did, w.mapping]]), () => w.config));
  const bad = FIELDS.filter((f) => viaStore[f] !== viaMap[f]);
  if (bad.length) differ.push({ c, bad, viaStore, viaMap });
}
console.log(`  ${cases.length} (type, state, class, link) cases through both adapters`);
ck("the map's adapter and the store's give the SAME look in every case", differ.length === 0, differ.slice(0, 3));

console.log("\n  the linked entity is devicePower's, on both sides:");
const look = (type, state, link) => {
  const w = world({ type, state, link });
  return deviceLook(w.did, storeLookSource(w.entities, w.config));
};
// The confirmed divergence: SummaryGroupPanel read `entities[linked].state === "on"`.
const rawRule = (link) => link[1] === "on";
// red since 2026-10-21: a linked entity needing attention (an unlocked lock) gives the badge the red "!" (owner: a
// lock's door sensor reading Open turns the lock's badge red); the linked DOT says on/off (owner, 2026-10-22: badge
// proposal 2 — it was a ring)
// since "one corner per device" (owner, 2026-10-22) the linked lock's alarm is the bottom-right pill, not the top
// owner, 2026-10-26: an unlocked lock is in use — its pill filled (on), the red "!" only for a jammed one
ck("a device linked to an UNLOCKED lock: its bottom-right pill filled (on — the list's raw `=== \"on\"` said no); its own top-right clear; jammed: red \"!\"",
   look("sensor", "5", ["lock.gate", "unlocked"]).linkPill === "on" && look("sensor", "5", ["lock.gate", "jammed"]).linkPill === "alarm"
   && look("sensor", "5", ["lock.gate", "unlocked"]).mark === null
   && look("sensor", "5", ["lock.gate", "unlocked"]).linkedOn && !rawRule(["lock.gate", "unlocked"]));
ck("  ...linked to an OPEN cover: its dot filled", look("sensor", "5", ["cover.blind", "open"]).linkPill === "on");
ck("  ...linked to a LOCKED lock, a CLOSED cover, an OFF switch: hollow; a lost switch: its grey \"?\"",
   ["lock.gate:locked", "cover.blind:closed", "switch.pump:off"]
     .every((s) => look("sensor", "5", s.split(":")).linkPill === "off")
   && look("sensor", "5", ["switch.pump", "unavailable"]).linkPill === "lost");
ck("  ...linked to an entity HA never reported: hollow", look("sensor", "5", ["switch.pump", null]).linkedOn === false
   && look("sensor", "5", ["switch.pump", null]).linkPill === "off");
ck("  ...no linked entity: no dot", look("sensor", "5", null).linkPill === null);
ck("the face stays its own state: a linked switch on never makes the device ON (owner, 2026-10-22)",
   look("camera", "idle", ["switch.pump", "on"]).face === "active" && look("sensor", "5", ["switch.pump", "on"]).face === "off"
   && look("sensor", "5", ["switch.pump", "on"]).kind !== "on" && !look("sensor", "5", ["switch.pump", "on"]).active);


console.log("\n  the panel header's optimistic switch, and its drawn type:");
{
  const w = world({ type: "sensor", state: "5", link: ["switch.pump", "off"] });
  const pending = (v) => storeLookSource(w.entities, w.config, { pendingPower: (i) => (i === "switch.pump" ? v : undefined) });
  ck("a switch thrown on but not yet confirmed fills the header's dot now", deviceLook(w.did, pending(true)).linkPill === "on");
  ck("  ...thrown off: the dot goes hollow with it", deviceLook(w.did, pending(false)).linkPill === "off"
     && deviceLook(w.did, storeLookSource({ ...w.entities, "switch.pump": ent("switch.pump", "on") }, w.config, { pendingPower: () => false })).linkPill === "off");
  ck("  ...nothing pending: the confirmed state, as the map", deviceLook(w.did, pending(undefined)).linkPill === "off");
  const asLock = storeLookSource({ "switch.x": ent("switch.x", "unlocked") }, { entityMap: {}, isHidden: () => false }, { drawnAs: { entityId: "switch.x", type: "lock" } });
  ck("a device drawn as a lock by its mesh binding is read as a lock", deviceLook("switch.x", asLock).type === "lock" && deviceLook("switch.x", asLock).mark === "active");
  // The map's own counterpart: the mapping its mesh resolved to wins over the
  // entity map (a mesh binding can draw a device as another type).
  const onMap = mapLookSource(new Map([["switch.x", ent("switch.x", "unlocked")]]), new Map([["switch.x", { type: "lock" }]]),
    () => ({ entityMap: { "switch.x": { entityId: "switch.x", type: "switch" } }, isHidden: () => false }));
  ck("  ...and on the map, the mesh's mapping is the type it is drawn as — the same look as the header's",
     deviceLook("switch.x", onMap).type === "lock" && deviceLook("switch.x", onMap).face === deviceLook("switch.x", asLock).face);
}

console.log("\n  never reported:");
{
  const none = deviceLook("light.ghost", storeLookSource({}, { entityMap: {}, isHidden: () => false }));
  ck("a device HA never reported looks unavailable (the phantom), power unknown",
     none.face === "unavailable" && none.mark === "lost" && none.unavailable && none.power === "unknown");
}

console.log("\n  the callers ask it (pin the caller):");
{
  const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const ev = src("babylon/EntityVisuals.ts"), sg = src("components/panels/SummaryGroupPanel.tsx"), // the page and the open panel's actions it provides (components/panels/useOpenPanelActions, review 11)
    db = src("pages/Dashboard.tsx") + src("components/panels/useOpenPanelActions.ts"),
    ph = src("components/panels/panelHeader.ts");
  ck("the map paints badges, cells and chip members from deviceLook through its one source",
     (ev.match(/deviceLook\([^)]*this\.lookSource\)/g) ?? []).length >= 4 && /mapLookSource\(this\.lastState, this\.mapping/.test(ev));
  ck("the device-list rows and the panel header ask deviceLook through the store",
     // the header since 2.496.305 in components/panels/panelHeader (driven by value in panel_header.mjs)
     /deviceLook\(id, looks\)/.test(sg) && /deviceLook\(entityId, storeLookSource\(/.test(ph) && /panelHeader\(\{/.test(db));
  // ONE VALUE, THE VILLA MODEL'S (architecture review N, 2026-10-27): critical, hidden and an amber issue were gathered
  // by each drawing itself (six releases each repaired one that had forgotten one). Each now takes VillaModel `marks`.
  const vm = src("config/VillaModel.tsx");
  ck("the map takes the villa model's marks; the open window's header, the room chooser and the list rows the same marks as the profile sees the villa",
     /marks: \{ critical: criticalSet, isHidden, faults: issues\.amber \}/.test(vm) && /deviceIssues\(groupAttention\(attention\.attentionItems\)\)/.test(vm)
     && /const villa = useVillaModelValue\(villaSets\);/.test(db) && /<VillaModelProvider value=\{villa\}>/.test(db)
     && /const marks = villa\.marks;/.test(db) && /manager\?\.setDeviceMarks\(marks\)/.test(db)
     && /const sees = visibleTo\(role, \{ mapped: mappedEntityIds, entityMap, entities \}\);\s+return \{ critical: criticalSet, isHidden, faults: faultsFor\(attention, \(id\) => sees\.has\(id\)\) \};/.test(vm)
     && /const windowMarks = useMemo\(\(\) => villa\.marksFor\(role\), \[villa, role\]\);/.test(db)
     && /useOpenPanelActions\(\{[^}]*\bmarks: windowMarks,/.test(db) && /config: \{ \.\.\.config, \.\.\.lookMarks\(marks\) \}/.test(db)
     && /storeLookSource\(entities, \{ \.\.\.config, \.\.\.lookMarks\(windowMarks\) \}\)/.test(db)
     && /const marks = useMemo\(\(\) => marksFor\(role\), \[marksFor, role\]\);/.test(sg) && /storeLookSource\(entities, \{ \.\.\.config, \.\.\.lookMarks\(marks\) \}\)/.test(sg)
     && /\.\.\.lookMarks\(this\.marks\)/.test(ev) && /setDeviceMarks\(marks: DeviceMarks\): void \{\s+if \(sameMarks\(marks, this\.marks\)\) return;/.test(ev));
  // ...and no drawing gathers them itself: every file that names the critical or fault test is one of these, each for
  // its reason; a new one fails until someone says why it is not a drawing gathering the marks by hand
  const NAMES = {
    "utils/deviceActivity.ts": "THE look rule and its config, and lookMarks (the marks as the look reads them)",
    "config/deviceGroups.ts": "VillaDevices' own critical predicate, folded (the villa's devices)",
    "config/attention.ts": "the cards' alert scan over the villa's devices (the faults are what it builds)",
    "fm/readiness.ts": "the readiness checks' critical device lines, from the villa's devices",
  };
  const all = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? all(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : []);
  const root = new URL("../../src/", import.meta.url).pathname;
  const naming = all(root).filter((f) => /\b(isCritical|hasFault)\b/.test(src(relative(root, f)))).map((f) => relative(root, f)).sort();
  const hid = (id) => id === "light.h";
  const m = { critical: new Set(["lock.c"]), isHidden: hid, faults: new Set(["pump.f"]) };
  const L = lookMarks(m);
  ck("the marks as the look reads them: critical, hidden and a fault each from its own list",
     L.isCritical("lock.c") && !L.isCritical("pump.f") && L.isHidden("light.h") && !L.isHidden("lock.c") && L.hasFault("pump.f") && !L.hasFault("lock.c"));
  ck("  ...a drawing repaints only when one really changed: the same lists rebuilt are the same marks; a fault more, another hidden test, are not",
     sameMarks(m, { critical: new Set(["lock.c"]), isHidden: hid, faults: new Set(["pump.f"]) })
       && !sameMarks(m, { ...m, faults: new Set(["pump.f", "pump.g"]) }) && !sameMarks(m, { ...m, faults: new Set(["pump.g"]) })
       && !sameMarks(m, { ...m, critical: new Set() }) && !sameMarks(m, { ...m, isHidden: (id) => hid(id) }));
  const N = lookMarks(NO_MARKS);
  ck("  ...before the villa is read nothing is marked", !N.isCritical("lock.c") && !N.isHidden("light.h") && !N.hasFault("pump.f"));
  ck("no drawing gathers the marks itself: the files naming the critical or fault test are the classified ones",
     JSON.stringify(naming) === JSON.stringify(Object.keys(NAMES).sort()), naming);
  ck("no caller builds a reading by hand any more (badgeFaceAndRing / linkedOn / alertStateFor)",
     ![ev, sg, db, ph].some((s) => /badgeFaceAndRing\(|linkedOn:|alertStateFor\(|linkActiveIds/.test(s)));
}

// owner, 2026-10-21: "a suffix that will make no badge … `__nobadge` being the key suffix": an object named
// <entity>__nobadge — no badge, whatever the family; never a pose (always shown)
{
  const { badgeMeshes } = await import("@/babylon/meshVariants");
  const { readFileSync } = await import("node:fs");
  const from = (...names) => badgeMeshes(names.map((name) => ({ name }))).map((m) => m.name).join();
  const D = "binary_sensor.main_entrance_door_sensor";
  ck("a badge only from the object named after the entity: never its poses, never __nobadge",
     from(D) === D && from(`${D}__on`, `${D}__off`) === "" && from(`${D}__nobadge`) === ""
     && from(D, `${D}__nobadge`) === D && from("lock.door", "lock.door__locked", "lock.door__unlocked") === "lock.door");
  // owner, 2026-10-24: a curtain modelled only as its poses is always on the map — its poses make its badge
  const C = "cover.bedroom_curtain";
  ck("a curtain with only its poses has its badge from them, unless one is __nobadge; a lock's poses alone do not",
     from(`${C}__open`, `${C}__half`, `${C}__closed`) === `${C}__open,${C}__half,${C}__closed`
     && from(C, `${C}__open`) === C && from(`${C}__open`, `${C}__nobadge`) === ""
     && from("lock.door__locked", "lock.door__unlocked") === "");
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  ck("  ...the map's badge pipeline asks it, and stands the badge over those objects only",
     /if \(!badgeMeshes\(meshes, entityId\)\.length\) \{/.test(ev)
     && /const own = badgeMeshes\(all, entityId\);\s*const meshes = own\.length \? own : all;\s*const bounds = this\.mergedWorldBounds\(meshes\);/.test(ev));
  ck("  ...and __nobadge is never grouped as a pose (it would be hidden whenever the state asks another word)",
     /if \(suffix && suffix !== NO_BADGE_WORD\) \{/.test(readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8")));
}

done("✅ one device, one look, whichever side holds its state");
