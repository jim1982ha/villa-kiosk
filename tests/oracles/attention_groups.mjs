// "Needs attention" is one row per DEVICE (2.496.246).
//
// An unlocked entrance door was red on the map — one row, "Unlocked" — and
// ten minutes later the VESTA rule's alert became the agent's Kiosk ticket on
// that same lock: a second row, and the count went up for a door already
// listed. An offline device and its watchdog ticket did the same.
// config/attention.groupAttention folds the problems of one device into one row;
// this drives values through it and through buildAttentionItems, and checks
// the corner cases the design named: nothing lost or doubled, every fault
// keeps its Close, no-device problems stand alone, an unknown entity is its
// own device, the profile filter runs first, the worst problem leads, the
// order does not depend on arrival, and every count reads the rows.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { buildAttentionItems, groupAttention, attentionFor, attentionLine } = await import("@/config/attention");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");

const ent = (id, state, name) => ({ entity_id: id, state, attributes: { friendly_name: name } });
const entities = {
  "lock.door": ent("lock.door", "unlocked", "Front door"),
  "sensor.door_battery": ent("sensor.door_battery", "40", "Front door battery"),
  "light.lamp": ent("light.lamp", "unavailable", "Hall lamp"),
  "lock.back": ent("lock.back", "locked", "Back door"),
};
const entityMap = Object.fromEntries(Object.keys(entities).map((id) => [id, { entityId: id, type: id.split(".")[0] }]));
const resolvedRooms = { "lock.door": "Entrance", "light.lamp": "Hall", "lock.back": "Garden" };
const ticket = (id, title, entityId, extra = {}) => ({ id, title, status: "open", openedAt: "2026-10-02T10:00:00Z", photoIds: [], updates: [], ...(entityId ? { entityId } : {}), ...extra });
// The battery sensor is the lock's own entity in Home Assistant's registry.
const folding = new Map([["sensor.door_battery", "lock.door"]]);
const build = (tickets, more = {}) => buildAttentionItems({
  unavailableIds: ["light.lamp"], entities, entityMap, alertThresholds: {}, resolvedRooms,
  fmData: { ...EMPTY_FM_DATA, tickets }, selectableIds: Object.keys(entities), folding, ...more,
});

console.log("  the entrance door:");
const before = build([]);
const after = build([ticket("va-1", "Entrance door unlocked", "lock.door")]);
const gBefore = groupAttention(before), gAfter = groupAttention(after);
const door = gAfter.find((g) => g.entityId === "lock.door");
ck("the agent's ticket on an unlocked door joins the door's row: still ONE row, the count does not move",
   gBefore.length === gAfter.length && door?.items.map((i) => i.kind).join() === "alarm,fault", gAfter.map((g) => [g.title, g.items.map((i) => i.id)]));
ck("  ...the row is named after the device, opens the lock, and leads with the red state",
   door?.title === "Front door" && door.kind === "alarm" && door.room === "Entrance", door);
ck("  ...its lines: the state's word, then the fault naming itself",
   door?.items.map(attentionLine).join(" | ") === "Unlocked | Open fault: Entrance door unlocked", door?.items.map(attentionLine));
ck("  ...and the row keeps its place when the ticket lands (ordered by worst problem and name, not arrival)",
   gBefore.findIndex((g) => g.entityId === "lock.door") === gAfter.findIndex((g) => g.entityId === "lock.door"));
const battery = groupAttention(build([ticket("va-2", "Battery low", "sensor.door_battery")]));
ck("a ticket on ANOTHER entity of the same device (its battery sensor) folds into the lock's row",
   battery.length === gBefore.length && battery.find((g) => g.key === "device:lock.door")?.items.length === 2, battery.map((g) => g.key));
const offline = groupAttention(build([ticket("va-3", "Hall lamp offline", "light.lamp")]));
ck("an offline device and its watchdog ticket: one row, amber, 'N problems' under the device's name",
   offline.find((g) => g.key === "device:light.lamp")?.kind === "unavailable" && offline.find((g) => g.key === "device:light.lamp")?.title === "Hall lamp");

console.log("\n  corner cases:");
const loose = groupAttention(build([ticket("t-a", "Pool pump noisy"), ticket("t-b", "Pool pump noisy")]));
ck("problems naming no device are never grouped — not even two with the same title",
   loose.filter((g) => g.title === "Pool pump noisy").length === 2);
const ghost = groupAttention(build([ticket("t-g", "Old sensor", "sensor.renamed_away")]));
const ghostRow = ghost.find((g) => g.entityId === "sensor.renamed_away");
ck("an entity the fold does not know is its own device: a row of its own, as before grouping",
   ghostRow?.key === "device:sensor.renamed_away" && ghostRow.items.length === 1);
const lone = groupAttention(before).find((g) => g.entityId === "light.lamp");
ck("a device with ONE problem reads exactly as the item did (title, room, the item itself)",
   lone?.title === "Hall lamp" && lone.room === "Hall" && lone.items.length === 1 && lone.items[0].detail === "Unavailable");
const loneFault = groupAttention(build([ticket("va-4", "Back door stiff", "lock.back")])).find((g) => g.entityId === "lock.back");
ck("  ...and a lone ticket with no room of its own (the agent's) takes its device's room",
   loneFault?.title === "Back door stiff" && loneFault.room === "Garden", loneFault);
const warnOnly = groupAttention(build([ticket("w1", "Squeaks", "lock.back"), ticket("w2", "Loose handle", "lock.back")]));
const backRow = warnOnly.find((g) => g.key === "device:lock.back");
ck("two faults on one device: one row under the device's name, both faults inside",
   backRow?.title === "Back door" && backRow.items.length === 2 && backRow.kind === "fault");

console.log("\n  nothing lost, nothing doubled — every fault keeps its Close:");
// mulberry32: a power-of-two LCG's low bits cycle every 2-4 draws, so `% 2`
// never produced the ties the order check needs (a mutant survived it).
let seed = 7;
const rnd = (n) => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (((t ^ (t >>> 14)) >>> 0) % n);
};
const KINDS = ["alarm", "unavailable", "fault", "schedule"];
const DEVICES = ["d1", "d2", "d3", null];
let conserved = true, ordered = true, worstFirst = true;
for (let run = 0; run < 300; run++) {
  const items = Array.from({ length: 1 + rnd(9) }, (_, n) => {
    const kind = KINDS[rnd(4)], dev = DEVICES[rnd(4)];
    return { id: `${kind}:${run}:${n}`, kind, title: `T${rnd(2)}`, detail: kind, ...(kind === "fault" ? { ticketId: `t${run}-${n}` } : {}),
      ...(dev ? { entityId: `${dev}.e${rnd(2)}`, device: { key: dev, label: dev.toUpperCase() } } : {}) };
  });
  const groups = groupAttention(items);
  const out = groups.flatMap((g) => g.items.map((i) => i.id)).sort().join();
  if (out !== items.map((i) => i.id).sort().join()) conserved = false;
  const tickets = groups.flatMap((g) => g.items.map((i) => i.ticketId).filter(Boolean)).sort().join();
  if (tickets !== items.map((i) => i.ticketId).filter(Boolean).sort().join()) conserved = false;
  if (groups.some((g) => g.items.some((i) => (i.device?.key ?? `item:${i.id}`) !== (g.items[0].device?.key ?? `item:${g.items[0].id}`)))) conserved = false;
  const shuffled = [...items].reverse();
  if (groupAttention(shuffled).map((g) => g.key).join() !== groups.map((g) => g.key).join()) ordered = false;
  const RANK = { alarm: 0, unavailable: 1, fault: 2, schedule: 3 };
  if (groups.some((g) => g.kind !== g.items[0].kind || g.items.some((i) => RANK[i.kind] < RANK[g.kind]))) worstFirst = false;
}
ck("300 random sets: every item comes back exactly once, every ticket id with it, each row one device", conserved);
ck("  ...the rows' order does not depend on the order the problems arrived in", ordered);
{
  const tie = [{ id: "a", kind: "fault", title: "Same", detail: "x", entityId: "d1.e", device: { key: "d1", label: "D1" } },
    { id: "b", kind: "fault", title: "Same", detail: "x", entityId: "d2.e", device: { key: "d2", label: "D2" } }];
  ck("  ...even between two rows of the same severity and the same title",
     groupAttention(tie).map((g) => g.key).join() === groupAttention([...tie].reverse()).map((g) => g.key).join());
}
ck("  ...each row's icon is its most serious problem, listed first", worstFirst);

console.log("\n  the profile filter runs FIRST:");
const att = { unavailableIds: ["light.lamp"], selectableIds: Object.keys(entities), attentionItems: build([ticket("va-5", "Battery low", "sensor.door_battery")]) };
const guest = attentionFor(att, (id) => id !== "lock.door");
const guestRow = guest.attentionGroups.find((g) => g.key === "device:lock.door");
ck("a profile that may not open the lock never gets its red state inside the row, only what it may open",
   guestRow?.items.map((i) => i.entityId).join() === "sensor.door_battery", guestRow?.items);
const owner = attentionFor(att, () => true);
ck("the health line counts ROWS (the badge's number) but reads its level from every problem",
   owner.health.summary.startsWith(`${owner.attentionGroups.length} thing`) && owner.attentionGroups.length < owner.attentionItems.length && owner.health.level === "danger",
   [owner.health, owner.attentionGroups.length, owner.attentionItems.length]);

console.log("\n  a reading nobody placed on the map (2.496.258):");
// A pump: its power sensor is placed, its energy meter is not. The agent's
// energy-drop ticket names the meter. Driven through the REAL fold.
const { deviceFolding } = await import("@/config/deviceGroups");
const pumpEntities = { ...entities, "sensor.pump_power": ent("sensor.pump_power", "34", "Pump power"),
  "sensor.pump_energy": ent("sensor.pump_energy", "21.6", "Pump energy") };
const pumpMap = { ...entityMap, "sensor.pump_power": { entityId: "sensor.pump_power", type: "sensor" } };
const registry = { "sensor.pump_power": "dev-pump", "sensor.pump_energy": "dev-pump", "lock.door": "dev-door" };
const pumpFold = deviceFolding(pumpMap, [], registry);
const pumpRows = groupAttention(buildAttentionItems({
  unavailableIds: [], entities: pumpEntities, entityMap: pumpMap, alertThresholds: {},
  resolvedRooms: { ...resolvedRooms, "sensor.pump_power": "Pool" },
  fmData: { ...EMPTY_FM_DATA, tickets: [ticket("pm-1", "Pump used 0.09 kWh/day", "sensor.pump_energy")] },
  selectableIds: Object.keys(pumpMap), folding: pumpFold,
}));
const pumpRow = pumpRows.find((g) => g.items.some((i) => i.id === "fault:pm-1"));
ck("the fold puts an unplaced entity on its Home Assistant device's placed one",
   pumpFold.get("sensor.pump_energy") === "sensor.pump_power", [...pumpFold]);
ck("  ...so the meter's ticket is the pump's row, with the pump's room",
   pumpRow?.key === "device:sensor.pump_power" && pumpRow.room === "Pool", pumpRow);
ck("  ...and tapping it opens the pump the map shows, not the meter",
   pumpRow?.entityId === "sensor.pump_power", pumpRow?.entityId);
ck("  ...while a placed entity is never re-folded and a device with nothing placed adds nothing",
   !pumpFold.has("sensor.pump_power") && deviceFolding(entityMap, [], { "sensor.x": "dev-none" }).size === 0);

console.log("\n  the callers:");
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
const vm = src("config/VillaModel.tsx"), cockpit = (src("components/cockpit/CockpitModal.tsx") + src("components/cockpit/CockpitOverview.tsx"));
const hud = src("components/hud/HUD.tsx");
const counted = [...hud.matchAll(/formatCountBadge\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => a !== "facilityAttention");
ck("every Cockpit count in the top bar and the phone menu is the number of ROWS",
   counted.length === 2 && counted.every((a) => a === "attentionGroups.length"), counted);
// 2.496.268: grouped ONCE, per profile — the villa model's role-blind
// grouping had no reader and ran on every state push anyway.
ck("the villa model hands buildAttentionItems the device fold, and leaves the grouping to the profile's view",
   /selectableIds, folding \}\);/.test(vm) && !/groupAttention|villaHealthFrom/.test(vm)
   && /return attentionFor\(attention, \(id\) => sees\.has\(id\)\);/.test(src("components/cockpit/useVillaAttention.ts")));
ck("the Cockpit draws one row per group, and every fault line inside a row has its own Close",
   /attentionGroups\.map\(\(group\) => \(\s*<CockpitAttentionRow key=\{group\.key\} group=\{group\}/.test(cockpit)
   && /function CockpitAttentionSub[\s\S]*?useFaultClose\(item, canCloseFault\)/.test(cockpit));

done("✅ one row per device in Needs attention");
