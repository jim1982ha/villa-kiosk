// One device, one look — whichever side holds its state (2.496.245).
//
// deviceActivity's rule was shared but its INPUTS were not: every caller built
// its own DeviceReading, and `linkedOn` was resolved three ways — the map
// through devicePower, the panel header through its optimistic switch, the
// device-list rows through a raw `state === "on"`. So a device LINKED to a lock
// that was UNLOCKED, or a cover that was OPEN, rang on the map and sat plain in
// the list one tap away. deviceLook now resolves the linked entity and the
// alert override itself, from a LookSource; this drives the SAME states through
// the map's adapter (mapLookSource — EntityVisuals' live cache) and the store's
// (storeLookSource — every React surface) and asserts identical looks.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { deviceLook, mapLookSource, storeLookSource } = await import("@/utils/deviceActivity");

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
const OVERRIDES = [undefined, "on", "off"];

const cases = [];
for (const [type, states] of Object.entries(DEVICES)) {
  for (const state of states) {
    for (const dc of CLASSES[type] ?? [undefined]) {
      for (const link of LINKS) {
        for (const override of type === "binary_sensor" ? OVERRIDES : [undefined]) {
          cases.push({ type, state, dc, link, override });
        }
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
  const config = {
    entityMap: { [did]: mapping },
    alertThresholds: c.override !== undefined ? { [did]: { alertState: c.override } } : {},
  };
  return { did, entities, config, mapping };
};

const FIELDS = ["type", "face", "ring", "kind", "own", "active", "alert", "unavailable", "power", "linkedOn"];
const differ = [];
for (const c of cases) {
  const w = world(c);
  const viaStore = deviceLook(w.did, storeLookSource(w.entities, w.config));
  const viaMap = deviceLook(w.did, mapLookSource(new Map(Object.entries(w.entities)), new Map([[w.did, w.mapping]]), () => w.config));
  const bad = FIELDS.filter((f) => viaStore[f] !== viaMap[f]);
  if (bad.length) differ.push({ c, bad, viaStore, viaMap });
}
console.log(`  ${cases.length} (type, state, class, link, override) cases through both adapters`);
ck("the map's adapter and the store's give the SAME look in every case", differ.length === 0, differ.slice(0, 3));

console.log("\n  the linked entity is devicePower's, on both sides:");
const look = (type, state, link) => {
  const w = world({ type, state, link });
  return deviceLook(w.did, storeLookSource(w.entities, w.config));
};
// The confirmed divergence: SummaryGroupPanel read `entities[linked].state === "on"`.
const rawRule = (link) => link[1] === "on";
ck("a device linked to an UNLOCKED lock is ringed (the list's raw `=== \"on\"` said no)",
   look("sensor", "5", ["lock.gate", "unlocked"]).ring === "active" && !rawRule(["lock.gate", "unlocked"]));
ck("  ...linked to an OPEN cover: ringed", look("sensor", "5", ["cover.blind", "open"]).ring === "active");
ck("  ...linked to a LOCKED lock, a CLOSED cover, an OFF or lost switch: not",
   ["lock.gate:locked", "cover.blind:closed", "switch.pump:off", "switch.pump:unavailable"]
     .every((s) => look("sensor", "5", s.split(":")).ring === "off"));
ck("  ...linked to an entity HA never reported: not", look("sensor", "5", ["switch.pump", null]).linkedOn === false);
ck("the ring is the badge's own colour, never red; the face stays its own state",
   look("camera", "idle", ["switch.pump", "on"]).face === "active" && look("sensor", "5", ["switch.pump", "on"]).face === "off");

console.log("\n  the alert override is resolved by deviceLook, not by its callers:");
{
  const w = world({ type: "binary_sensor", state: "on", dc: "motion", override: "on" });
  ck("a motion sensor the villa marked 'on is a fault' is red", deviceLook(w.did, storeLookSource(w.entities, w.config)).alert === true);
  const q = world({ type: "binary_sensor", state: "on", dc: "moisture", override: "off" });
  ck("  ...a leak sensor the villa marked 'off is the fault' is not red while on", deviceLook(q.did, storeLookSource(q.entities, q.config)).alert === false);
}

console.log("\n  the panel header's optimistic switch, and its drawn type:");
{
  const w = world({ type: "sensor", state: "5", link: ["switch.pump", "off"] });
  const pending = (v) => storeLookSource(w.entities, w.config, { pendingPower: (i) => (i === "switch.pump" ? v : undefined) });
  ck("a switch thrown on but not yet confirmed rings the header now", deviceLook(w.did, pending(true)).ring === "active");
  ck("  ...thrown off: the ring goes with it", deviceLook(w.did, pending(false)).ring === "off"
     && deviceLook(w.did, storeLookSource({ ...w.entities, "switch.pump": ent("switch.pump", "on") }, w.config, { pendingPower: () => false })).ring === "off");
  ck("  ...nothing pending: the confirmed state, as the map", deviceLook(w.did, pending(undefined)).ring === "off");
  const asLock = storeLookSource({ "switch.x": ent("switch.x", "unlocked") }, { entityMap: {}, alertThresholds: {} }, { drawnAs: { entityId: "switch.x", type: "lock" } });
  ck("a device drawn as a lock by its mesh binding is read as a lock", deviceLook("switch.x", asLock).type === "lock" && deviceLook("switch.x", asLock).alert);
  // The map's own counterpart: the mapping its mesh resolved to wins over the
  // entity map (a mesh binding can draw a device as another type).
  const onMap = mapLookSource(new Map([["switch.x", ent("switch.x", "unlocked")]]), new Map([["switch.x", { type: "lock" }]]),
    () => ({ entityMap: { "switch.x": { entityId: "switch.x", type: "switch" } }, alertThresholds: {} }));
  ck("  ...and on the map, the mesh's mapping is the type it is drawn as — the same look as the header's",
     deviceLook("switch.x", onMap).type === "lock" && deviceLook("switch.x", onMap).face === deviceLook("switch.x", asLock).face);
}

console.log("\n  never reported:");
{
  const none = deviceLook("light.ghost", storeLookSource({}, { entityMap: {}, alertThresholds: {} }));
  ck("a device HA never reported looks unavailable (the phantom), power unknown",
     none.face === "unavailable" && none.ring === "unavailable" && none.unavailable && none.power === "unknown");
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
     /deviceLook\(id, looks\)/.test(sg) && /storeLookSource\(entities, config\)/.test(sg) && /deviceLook\(entityId, storeLookSource\(/.test(ph)
     && /panelHeader\(\{/.test(db));
  ck("no caller builds a reading by hand any more (badgeFaceAndRing / linkedOn / alertStateFor)",
     ![ev, sg, db, ph].some((s) => /badgeFaceAndRing\(|linkedOn:|alertStateFor\(|linkActiveIds/.test(s)));
}

done("✅ one device, one look, whichever side holds its state");
