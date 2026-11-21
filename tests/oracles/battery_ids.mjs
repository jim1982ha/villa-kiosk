// Which entities are batteries, looked at again only where an entity changed (config/batteryIds.ts, 2026-11-21): the
// answer equals a full scan after every update, and stays the same set while its members do (the device parts and the
// map's marks are built on it, so a new set for nothing would rebuild them on every state push).
import { ck, done } from "../consistency/check.mjs";
const { batteryTracker, batteryIdsOf } = await import("@/config/batteryIds");

const ent = (id, state, dc) => ({ entity_id: id, state, attributes: dc ? { device_class: dc } : {} });
const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

let entities = {};
for (let i = 0; i < 40; i++) entities[`sensor.s${i}`] = ent(`sensor.s${i}`, String(i), i % 5 === 0 ? "battery" : i % 3 ? "power" : undefined);
entities["light.hall"] = ent("light.hall", "on");

const track = batteryTracker();
const STEPS = [
  ["a sensor's reading changes", (e) => ({ ...e, "sensor.s1": ent("sensor.s1", "77", "power") })],
  ["a battery's level changes", (e) => ({ ...e, "sensor.s5": ent("sensor.s5", "12", "battery") })],
  ["a sensor becomes a battery", (e) => ({ ...e, "sensor.s2": ent("sensor.s2", "50", "battery") })],
  ["a battery stops being one", (e) => ({ ...e, "sensor.s10": ent("sensor.s10", "50", "power") })],
  ["a battery is added", (e) => ({ ...e, "sensor.new_battery": ent("sensor.new_battery", "90", "battery") })],
  ["a battery is removed", (e) => { const { ["sensor.s15"]: _, ...rest } = e; return rest; }],
  ["one removed and one added, the count unchanged", (e) => {
    const { ["sensor.s20"]: _, ...rest } = e; return { ...rest, "sensor.other_battery": ent("sensor.other_battery", "1", "battery") }; }],
  ["a battery goes unavailable (no attributes)", (e) => ({ ...e, "sensor.s25": { entity_id: "sensor.s25", state: "unavailable" } })],
  ["a non-battery is removed", (e) => { const { ["light.hall"]: _, ...rest } = e; return rest; }],
];

let set = track(entities);
ck("the first look is a full scan", same(set, batteryIdsOf(entities)), [...set]);
for (const [what, step] of STEPS) {
  entities = step(entities);
  const before = set;
  set = track(entities);
  ck(`${what}: equals a full scan`, same(set, batteryIdsOf(entities)), { got: [...set], want: [...batteryIdsOf(entities)] });
  if (same(before, set)) ck("  ...and is the same set as before", set === before);
}

console.log("\n  told what a push set (the store's list, entityStore.pushedChange):");
{
  const t = batteryTracker();
  let e = { "sensor.a": ent("sensor.a", "1", "battery"), "sensor.b": ent("sensor.b", "2", "power") };
  let s = t(e);
  const push = (changes) => { const from = e; e = { ...e, ...changes }; return t(e, { from, ids: Object.keys(changes) }); };
  const r1 = push({ "sensor.b": ent("sensor.b", "3", "power") });
  ck("a reading pushed: the same set", r1 === s && same(r1, batteryIdsOf(e)));
  const r2 = push({ "sensor.b": ent("sensor.b", "4", "battery") });
  ck("a push that makes one a battery: a new set, the full scan's", r2 !== s && same(r2, batteryIdsOf(e)), [...r2]);
  const r3 = push({ "sensor.c": ent("sensor.c", "5", "battery") });
  ck("a push that adds an entity: the full scan's answer", same(r3, batteryIdsOf(e)), [...r3]);
  const stale = { ...e, "sensor.a": ent("sensor.a", "x", "power") };
  const r4 = t(stale, { from: { other: 1 }, ids: [] });
  ck("a push over entities this tracker did not see last is not trusted: every entity is compared",
     same(r4, batteryIdsOf(stale)) && !r4.has("sensor.a"), [...r4]);
}

console.log("\n  churn:");
const quiet = track(entities);
for (let k = 0; k < 200; k++) {
  entities = { ...entities, "sensor.s1": ent("sensor.s1", String(k), "power"), "sensor.s5": ent("sensor.s5", String(k % 100), "battery") };
  if (track(entities) !== quiet) break;
}
ck("200 pushes of readings (a battery's level among them): the same set every time", track(entities) === quiet && same(quiet, batteryIdsOf(entities)));
ck("the same entities asked again: the same set", track(entities) === track(entities));

done("✅ battery ids: only what changed is looked at again, always the full scan's answer");
