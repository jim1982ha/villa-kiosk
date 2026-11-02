// A TICKET'S DEVICE PILL IS ITS INBOX CARD'S DEVICE (architecture review round 16, 2026-11-03): Cockpit › Tickets looked a
// record's raw entity field up as one id, so a record naming several entities ("sensor.a,sensor.b", a rule watching
// three phases) was never found: its pill showed the stored name or the raw list, and a tap opened nothing, while the
// Inbox card of the same record named and opened its device. Driven by value: the record goes through the Inbox's own
// pipeline (buildAttentionItems → groupAttention: its card's title and what its name opens) and through the Tickets
// tab's pill (attention.recordDevicePill), and the two must agree. TicketsTab.tsx draws that pill and nothing else.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { elements, parseTsx, propText } from "../consistency/jsx.mjs";
const { buildAttentionItems, groupAttention, recordDevicePill } = await import("@/config/attention");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { devicesOf } = await import("../consistency/devices.mjs");

const ent = (id, name) => ({ entity_id: id, state: "on", attributes: { friendly_name: name }, last_changed: "2026-11-01T00:00:00Z" });
// placeholders: a meter box whose phase B sensor folds onto its relay (phase A is gone from the villa's system), and a
// lock renamed in the Kiosk (its stored name and the villa's system's name both differ from the one shown)
const entities = {
  "sensor.example_phase_b": ent("sensor.example_phase_b", "Meter Phase B Voltage"),
  "switch.example_meter": ent("switch.example_meter", "Meter relay"),
  "lock.example_door": ent("lock.example_door", "Lock 1"),
};
const entityMap = {
  "switch.example_meter": { entityId: "switch.example_meter", type: "switch", label: "Pool meter" },
  "lock.example_door": { entityId: "lock.example_door", type: "lock", label: "Front door" },
};
const folding = new Map([["sensor.example_phase_b", "switch.example_meter"]]);
const devices = devicesOf({ ids: Object.keys(entities), folding });
const resolvedRooms = {};
const rec = (id, entityId, deviceLabel) => ({ id, title: "Voltage out of range", status: "open", openedAt: "2026-11-02T08:00:00Z",
  entityId, deviceLabel, photoIds: [], updates: [] });
const records = [
  rec("t1", "sensor.example_phase_a,sensor.example_phase_b", "Meter Phase A Voltage"),   // a list: the stored name its first
  rec("t2", "lock.example_door", "Lock 1"),                                                // renamed since it was stored
];

const items = buildAttentionItems({ devices, entities, entityMap, resolvedRooms, fmData: { ...EMPTY_FM_DATA, tickets: records } });
const groups = groupAttention(items);
const inbox = (id) => {
  const g = groups.find((x) => x.items.some((i) => i.ticketId === id));
  return g ? { label: g.title, opens: g.entityId } : null;
};
const tickets = (t) => recordDevicePill(t, { devices, entityMap, entities, resolvedRooms });

for (const [t, what, want] of [[records[0], "a record naming several entities", { label: "Pool meter", opens: "switch.example_meter" }],
  [records[1], "a renamed device", { label: "Front door", opens: "lock.example_door" }]]) {
  const a = inbox(t.id), b = tickets(t);
  ck(`${what}: the Inbox card names and opens its device (the fixture reaches it)`, JSON.stringify(a) === JSON.stringify(want), a);
  ck(`  ...the Tickets card's pill says the same name and opens the same device`,
     b.label === a?.label && b.opens === a?.opens, { tickets: b, inbox: a });
}

// a device the villa's system no longer has: its stored name (the one it had), and a tap opens what the Inbox opens
{
  const gone = rec("t3", "lock.example_gone", "Back gate");
  const p = tickets(gone);
  ck("a device the villa's system no longer has keeps its stored name, and opens the id the record names",
     p.label === "Back gate" && p.opens === "lock.example_gone", p);
  const none = tickets(rec("t4", undefined, "Kitchen tap"));
  ck("  ...a record with no device: its stored name, opening nothing", none.label === "Kitchen tap" && none.opens === undefined, none);
}

// the Tickets tab draws that pill: its DeviceChip takes the name and the device from recordDevicePill, nothing else
{
  const tree = parseTsx("components/fm/TicketsTab.tsx");
  const chips = elements(tree, "DeviceChip");
  ck("TicketsTab's one DeviceChip names and opens the pill's device",
     chips.length === 1 && propText(chips[0], "entityId") === "pill.opens" && propText(chips[0], "label") === "pill.label"
     && /const pill = recordDevicePill\(t,/.test(tree.text), chips.map((c) => [propText(c, "entityId"), propText(c, "label")]));
}

done("✅ a ticket's device pill names and opens its Inbox card's device");
