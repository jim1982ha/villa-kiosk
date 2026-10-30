// "Needs attention" is one row per DEVICE (2.496.246).
//
// An unlocked entrance door was red on the map — one row, "Unlocked" — and
// (since 2026-10-26 an unlocked door is in use, no alarm: the case is driven with a JAMMED lock, still red)
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
const { buildAttentionItems, groupAttention, attentionFor } = await import("@/config/attention");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { devicesOf } = await import("../consistency/devices.mjs");
// A card's words, icons and buttons are what cockpitCard returns — what the Overview draws (architecture review,
// 2026-10-19: these checks read attention's line functions one by one, which the card might not have used)
const { cockpitCard } = await import("@/config/cockpitCard");
const card = (g) => cockpitCard(g, null);
const lineText = (g, n = 0) => card(g).lines[n]?.text;
// where an open card draws a line's icons: config/cockpitCard.cardIcons, the one place (review round 4, 2026-10-30)
const { cardIcons } = await import("@/config/cockpitCard");
const lineIcon = (g, n = 0) => cardIcons(card(g)).lines[n] ?? null;

const ent = (id, state, name) => ({ entity_id: id, state, attributes: { friendly_name: name } });
const entities = {
  "lock.door": ent("lock.door", "jammed", "Front door"),
  "sensor.door_battery": ent("sensor.door_battery", "40", "Front door battery"),
  "light.lamp": ent("light.lamp", "unavailable", "Hall lamp"),
  "lock.back": ent("lock.back", "locked", "Back door"),
};
const entityMap = Object.fromEntries(Object.keys(entities).map((id) => [id, { entityId: id, type: id.split(".")[0] }]));
const resolvedRooms = { "lock.door": "Entrance", "light.lamp": "Hall", "lock.back": "Garden" };
const ticket = (id, title, entityId, extra = {}) => ({ id, title, status: "open", openedAt: "2026-10-02T10:00:00Z", photoIds: [], updates: [], ...(entityId ? { entityId } : {}), ...extra });
// The battery sensor is the lock's own entity in Home Assistant's registry.
const folding = new Map([["sensor.door_battery", "lock.door"]]);
const villa = devicesOf({ ids: Object.keys(entities), unavailable: ["light.lamp"], folding });
const build = (tickets, more = {}) => buildAttentionItems({
  devices: villa, entities, entityMap, resolvedRooms,
  fmData: { ...EMPTY_FM_DATA, tickets }, ...more,
});

// owner, 2026-10-15: the card's "Next check" — the clock the Agent wrote on its fault reaches the card's problem
{
  const [item] = build([ticket("va-9", "Lamp offline for 2 d", "light.lamp",
    { source: "vesta_agent", origin: "night", check: "minutes" })]).filter((i) => i.ticketId === "va-9");
  ck("a fault's own check (how the Agent reads it again) is on its problem, for its card's Next check",
     item?.check === "minutes" && item.source === "night", item);
}

console.log("  the entrance door:");
const before = build([]);
const after = build([ticket("va-1", "Entrance door jammed", "lock.door")]);
const gBefore = groupAttention(before), gAfter = groupAttention(after);
const door = gAfter.find((g) => g.entityId === "lock.door");
ck("the agent's ticket on a jammed door joins the door's row: still ONE row, the count does not move",
   gBefore.length === gAfter.length && door?.items.map((i) => i.kind).join() === "alarm" && door.items[0].fault?.ticketId === "va-1",
   gAfter.map((g) => [g.title, g.items.map((i) => i.id)]));
ck("  ...the row is named after the device, opens the lock, and leads with the red state",
   door?.title === "Front door" && door.kind === "alarm" && door.room === "Entrance", door);
// ⚠️ ONE PROBLEM, ONE LINE (owner, 2026-10-10: "why do we see 2 lines for the same issue?"): the ticket is about the
// very lock whose state is listed — it was a second line, "Open fault: Entrance door unlocked", under "Unlocked"
// (owner, 2026-10-18: "Unlocked — #41 · Laundry Room door unlocked" — the state's word is not said when the fault says it)
ck("  ...ONE line: its fault naming itself, the state's word not said again (the fault keeps its ticket, so its Close)",
   door && card(door).lines.map((l) => l.text).join(" | ") === "Entrance door jammed", door && card(door).lines);
ck("  ...and the villa's own items are never written on: the ticket gone, the state line has no fault",
   !before.concat(after).some((i) => i.fault) && !groupAttention(before).some((g) => g.items.some((i) => i.fault)));
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
ck("a device with ONE problem: its row is the device, the problem its line",
   lone?.title === "Hall lamp" && lone.room === "Hall" && lone.items.length === 1 && lineText(lone) === "Unavailable");
const loneFault = groupAttention(build([ticket("va-4", "Back door stiff", "lock.back")])).find((g) => g.entityId === "lock.back");
// ⚠️ ONE SHAPE (owner, 2026-10-10): a lone fault titled its row with its own text ("Back door stiff") where the same
// device with two problems was titled "Back door" — the Cockpit showed three shapes of row
ck("  ...and a lone ticket is titled by its DEVICE, the fault its line, the device's room taken",
   loneFault?.title === "Back door" && loneFault.room === "Garden"
     && lineText(loneFault) === "Back door stiff", loneFault);
// ⚠️ NO "Open fault:" (owner, 2026-10-14: "providing no value") — but a fault someone took still says so
const taken = groupAttention(build([{ ...ticket("va-5", "Back door stiff", "lock.back"), status: "in_progress" }]))
  .find((g) => g.entityId === "lock.back");
ck("  ...an open fault's line is its text alone, one taken in hand still reads \"In progress: …\"",
   taken && lineText(taken) === "In progress: Back door stiff", taken?.items);
// ⚠️ ONE ICON PER MEANING (owner, 2026-10-13: "the icon is redundant"): every line repeated its row's icon
ck("  ...and its line shows no icon of its own: the row's says it already",
   lineIcon(loneFault) === null && lineIcon(lone) === null);
const mixed = battery.find((g) => g.key === "device:lock.door");
ck("  ...while a row mixing sources marks each line with its own (a person's fault under a live lock), none before its name",
   mixed?.kind === "alarm" && mixed.items.map((_, n) => lineIcon(mixed, n)?.sources.join("+") ?? "").join(",") === "live,person"
   && cardIcons(card(mixed)).head === null && cardIcons(card(mixed)).column,
   mixed?.items.map((i, n) => [i.kind, lineIcon(mixed, n)]));
ck("  ...and a row of one source draws its icons before its name only, none on its lines",
   cardIcons(card(loneFault)).head !== null && cardIcons(card(loneFault)).lines.every((x) => x === null));
const noDevice = groupAttention(build([ticket("t-n", "Pool pump noisy")])).find((g) => g.key === "item:fault:t-n");
ck("  ...and a problem with no device stands for itself: its line says only its status, never its title twice",
   noDevice?.title === "Pool pump noisy" && lineText(noDevice) === "", noDevice);
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
  // every item once: as a line, as the fault of the live line about the same entity (mergeFaults), or — a fault saying
  // exactly what another on its row says — as that line's twin (foldTwins, owner 2026-10-17: one line, counted)
  const shown = (g) => g.items.flatMap((i) => (i.fault ? [i, i.fault] : [i]));
  const twinIds = new Set(groups.flatMap((g) => shown(g).flatMap((i) => i.twins ?? [])));
  const out = groups.flatMap((g) => shown(g).map((i) => i.id)).sort().join();
  if (out !== items.filter((i) => !twinIds.has(i.ticketId)).map((i) => i.id).sort().join()) conserved = false;
  const tickets = groups.flatMap((g) => shown(g).flatMap((i) => [i.ticketId, ...(i.twins ?? [])]).filter(Boolean)).sort().join();
  if (tickets !== items.map((i) => i.ticketId).filter(Boolean).sort().join()) conserved = false;
  // a twin says exactly what its line says, on the same row
  for (const g of groups) for (const i of shown(g)) for (const tw of i.twins ?? []) {
    const twin = items.find((x) => x.ticketId === tw);
    if (!twin || twin.title !== i.title || (twin.device?.key ?? null) !== (i.device?.key ?? null)) conserved = false;
  }
  if (groups.some((g) => g.items.some((i) => (i.device?.key ?? `item:${i.id}`) !== (g.items[0].device?.key ?? `item:${g.items[0].id}`)))) conserved = false;
  const shuffled = [...items].reverse();
  if (groupAttention(shuffled).map((g) => g.key).join() !== groups.map((g) => g.key).join()) ordered = false;
  const RANK = { alarm: 0, unavailable: 1, fault: 2, schedule: 3 };
  if (groups.some((g) => g.kind !== g.items[0].kind || g.items.some((i) => RANK[i.kind] < RANK[g.kind]))) worstFirst = false;
}
ck("300 random sets: every item comes back exactly once (a fault saying the same as another as its twin), every ticket id with it, each row one device", conserved);
ck("  ...the rows' order does not depend on the order the problems arrived in", ordered);
{
  const tie = [{ id: "a", kind: "fault", title: "Same", detail: "x", entityId: "d1.e", device: { key: "d1", label: "D1" } },
    { id: "b", kind: "fault", title: "Same", detail: "x", entityId: "d2.e", device: { key: "d2", label: "D2" } }];
  ck("  ...even between two rows of the same severity and the same title",
     groupAttention(tie).map((g) => g.key).join() === groupAttention([...tie].reverse()).map((g) => g.key).join());
}
ck("  ...each row's icon is its most serious problem, listed first", worstFirst);

console.log("\n  the profile filter runs FIRST:");
const att = { devices: villa, attentionItems: build([ticket("va-5", "Battery low", "sensor.door_battery")]) };
const guest = attentionFor(att, (id) => id !== "lock.door");
const guestRow = guest.attentionGroups.find((g) => g.key === "device:lock.door");
ck("a profile that may not open the lock never gets its red state inside the row, only what it may open",
   guestRow?.items.map((i) => i.entityId).join() === "sensor.door_battery", guestRow?.items);
const owner = attentionFor(att, () => true);
ck("the health line counts ROWS (the badge's number) but reads its level from every problem",
   owner.health.summary.startsWith(`${owner.attentionGroups.length} thing`) && owner.attentionGroups.length < owner.attentionItems.length && owner.health.level === "danger",
   [owner.health, owner.attentionGroups.length, owner.attentionItems.length]);
ck("  ...and the profile's devices are the ones it may open: the Overview's tiles and the Recap count these",
   guest.devices.ids.join() === Object.keys(entities).filter((id) => id !== "lock.door").join() && !guest.devices.has("lock.door")
   && owner.devices.ids.length === Object.keys(entities).length && guest.devices.unavailable.join() === "light.lamp", guest.devices.ids);

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
  devices: devicesOf({ ids: Object.keys(pumpMap), folding: pumpFold }), entities: pumpEntities, entityMap: pumpMap,
  resolvedRooms: { ...resolvedRooms, "sensor.pump_power": "Pool" },
  fmData: { ...EMPTY_FM_DATA, tickets: [ticket("pm-1", "Pump used 0.09 kWh/day", "sensor.pump_energy")] },
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
const vm = src("config/VillaModel.tsx"), cockpit = (src("components/cockpit/CockpitModal.tsx") + src("components/cockpit/MessagesTab.tsx") + src("components/cockpit/IssueCard.tsx"));
const hud = src("components/hud/HUD.tsx");
const counted = [...hud.matchAll(/formatCountBadge\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => a !== "facilityAttention");
ck("every Cockpit count in the top bar and the phone menu is the number of ROWS",
   counted.length === 2 && counted.every((a) => a === "attentionGroups.length"), counted);
// 2.496.268: grouped ONCE, per profile — the villa model's role-blind
// grouping had no reader and ran on every state push anyway.
ck("the villa model hands buildAttentionItems its device list (the fold and the critical list inside), and leaves the grouping to the profile's view",
   // never grouped for a COUNT there (a `//` once swallowed that half, review 2026-10-19); the list asked, never restated
   // (review, 2026-10-19). Grouped once, role-blind, for ONE reader only: what is wrong with each device, the map's
   // badges (attention.deviceIssues — review L, 2026-10-25: the badges read the cards, as the window's sign does)
   /buildAttentionItems\(\{\s*devices, entities,/.test(vm) && /return \{ devices, attentionItems \};/.test(vm) && !/villaHealthFrom/.test(vm)
   && (vm.match(/groupAttention\(/g) ?? []).length === 1 && /deviceIssues\(groupAttention\(attention\.attentionItems\)\)/.test(vm)
   && /return attentionFor\(attention, \(id\) => sees\.has\(id\)\);/.test(src("components/cockpit/useVillaAttention.ts")));
// HOW a card is drawn (its buttons inside, the click its own, the source icons) is checked on the drawn card:
// tests/oracles/cockpit_cards.mjs (architecture review, 2026-10-15). Here: the WIRING a drawing cannot see.
// ONE CARD, BY VALUE (architecture review scan 1, 2026-10-19): what a card says and does is config/cockpitCard's answer
// — its buttons cardActions', each line's words, icons, latest and Close the line's own — and the page draws that and
// nothing else: it asks attention for no part of a card (these checks matched its JSX text before, and broke on any
// rewrite that kept the behaviour)
{
  const groups = [...battery, ...offline, ...loose, ...gAfter];   // devices with a fault, offline, loose problems
  const views = groups.map((g) => [g, cockpitCard(g, { checkMinutes: 5, nightlyAt: "02:00" })]);
  ck("a card's view is its group: one line per problem, in its order",
     views.length > 0 && views.every(([g, v]) => v.key === g.key && v.title === g.title
       && v.lines.length === g.items.length && v.lines.every((l, n) => l.key === g.items[n].id)));
  const att2 = await import("@/config/attention");
  ck("  ...and how a card says its problems is cockpitCard's alone: attention exports no line, icon or button rule",
     ["cardActions", "itemActions", "attentionLineIn", "attentionLine", "lineIcon", "lineSources", "cardRecords", "healthClass"]
       .every((n) => !(n in att2)), Object.keys(att2));
  // ⚠️ THE CARDS ARE config/cockpitIssues' (architecture review, 2026-10-26): one card per group, made there, drawn here
  ck("  ...and the Cockpit draws the cards cockpitIssues made, one per group, asking attention for no part of a card",
     // Messages since ticket 17: one line per card, in the model's order, the card itself open on the right
     /messagesView\(\{\s*open, watched, /.test(cockpit) && /view\.issues\.map\(\(i\) => <MessageRow key=\{i\.key\} item=\{i\}/.test(cockpit)
     && /<CockpitAttentionRow key=\{item\.key\} card=\{item\.card\}/.test(cockpit)
     && !/cockpitCard\(/.test(cockpit) && /cockpitIssues\(view, /.test(src("components/cockpit/useVillaAttention.ts"))
     && !/(cardActions|itemActions|attentionLineIn|lineIcon|lineSources|nextCheck)\(/.test(cockpit)
     && /const acts = card\.actions;/.test(cockpit));
}

// owner, 2026-10-30: "Done / Need Help / Open Ticket consistently for all of them", one Done closing everything on the
// card (in place of each problem's own Close, 2026-10-18: "#41 could not be closed without #55")
{
  const cardActions = (g) => card(g).actions;
  const dev = { key: "lock.door2", label: "Door", room: "Hall" };
  const [two] = groupAttention([
    { id: "alarm:lock.door2", kind: "alarm", title: "Door", detail: "Unlocked", entityId: "lock.door2", source: "live", device: dev },
    { id: "fault:a", kind: "fault", title: "#41 · Door unlocked", detail: "Fault", entityId: "lock.door2", ticketId: "a", stage: "fault", source: "alert", device: dev },
    { id: "fault:b", kind: "fault", title: "#55 · Door unlocked", detail: "Fault", entityId: "lock.door2", ticketId: "b", stage: "fault", source: "alert", device: dev }]);
  const labels = (g) => cardActions(g).map((a) => a.label).join(" · ");
  const done = cardActions(two).find((a) => a.kind === "done");
  ck("  a card with two problems: Done · Need help · Open Ticket, its one Done closing both; no line carries a button",
     labels(two) === "Done · Need help · Open Ticket" && done?.ids.slice().sort().join() === "a,b"
     && card(two).lines.every((l) => !("actions" in l)), { labels: labels(two), done });
  const [one] = groupAttention([
    { id: "fault:c", kind: "fault", title: "#60 · Door unlocked", detail: "Fault", entityId: "lock.door3", ticketId: "c", stage: "fault", source: "alert",
      device: { key: "lock.door3", label: "Door 3", room: "Hall" } }]);
  ck("  ...a card with one problem: the same three buttons",
     labels(one) === "Done · Need help · Open Ticket" && cardActions(one).find((a) => a.kind === "done")?.ids.join() === "c");
}

console.log("\n  one way a problem's entity becomes its card's device, for the open issues and the Watched cards (review N, card 6)");
{
  const { cardDevice, cardHead } = await import("@/config/attention");
  const { readFileSync } = await import("node:fs");
  const ctx = { devices: { deviceOf: (x) => (x === "sensor.pump_power" ? "switch.pump" : x) }, entityMap: {}, entities: {},
    resolvedRooms: { "switch.pump": "", "sensor.pump_power": "" } };
  const d = cardDevice("sensor.pump_power", "Pool House", ctx);
  ck("the device the entity folds onto, and with no room of its own (nor its entity) the record's room",
     d.key === "switch.pump" && d.room === "Pool House", d);
  ck("  ...titled by the device; a problem with no device stands for itself, and every card has a room line",
     cardHead(d, "Pump weak", undefined).title === d.label && cardHead(undefined, "Pump weak", undefined).title === "Pump weak"
       && cardHead(undefined, "Pump weak", undefined).room === "Other", cardHead(undefined, "Pump weak", undefined));
  const cc = readFileSync(new URL("../../src/config/cockpitCard.ts", import.meta.url), "utf8");
  ck("  ...and the Watched cards name and place their device only through it",
     /cardDevice\(entityId, t\.room, \{ devices, entityMap, entities, resolvedRooms \}\)/.test(cc) && /\.\.\.cardHead\(device, title, t\.room\)/.test(cc)
       && !/\blabelOf\(|deviceRoomOrRecord\(|roomLabel\(/.test(cc.slice(cc.indexOf("export function confirmingCards"))));
}

// owner, 2026-10-30: "it's here but not visible in the card on the left" — the onsen pump's row led with the night
// check's finding and its alert, escalated to the Owner, showed only once the card was opened
{
  const { rowTime } = await import("@/config/cockpitCard");
  const night = ticket("va-20", "Back door ran shorter than expected", "lock.back", { source: "vesta_agent", origin: "night" });
  const alert = ticket("va-21", "Back door left open", "lock.back",
    { source: "vesta_agent", alertNumber: 96, openedAt: "2026-10-02T11:00:00Z" });
  for (const order of [[night, alert], [alert, night]]) {
    const row = groupAttention(build(order)).find((g) => g.entityId === "lock.back");
    const c = row && card(row);
    ck("an alert VESTA follows leads its device's row, before a finding of the same kind, whatever came first",
       c?.lines[0]?.alertNumber === 96 && c.lines.length === 2 && rowTime(c) === "2026-10-02T11:00:00Z",
       c?.lines.map((l) => [l.alertNumber, l.text, l.openedAt]));
    ck("  ...and the row's icons say both problems, the alert's first: the list's row and the card's head draw them",
       c?.lead?.sources.join() === [...c.lines[0].own.sources, ...c.lines[1].own.sources].join()
       && c.lead.sources.includes("night"), [c?.lead, c?.lines.map((l) => l.own)]);
    const drawn = cardIcons(c);
    ck("  ...the open card draws each icon once, beside its line, none before its name, its column kept",
       drawn.head === null && drawn.column && drawn.lines[0]?.sources.join() === c.lines[0].own.sources.join()
       && drawn.lines[1]?.sources.join() === "night", drawn);
  }
}

done("✅ one card per device in the Live issues");
