// EVERY KIND OF CARD, ONE ROW (owner, 2026-11-01: "enforce a unique, centralised and consistent style for all faults
// cards"; an offline camera's row had no time). 2.496.645 made one state pill and checked it on the kinds the change
// touched; the time was another field, on faults only, and no check asked it of the others. Here every field is asked
// of every kind, through the real path: the villa's items, the cards, the row drawn, and the history they are read from.
// A new kind of line fails below until it is in the table.
import { h, draw, inside, text } from "../consistency/screen.mjs";
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
const { devicesOf } = await import("../consistency/devices.mjs");
const { buildAttentionItems, groupAttention, sinceEntities } = await import("@/config/attention");
const { cockpitCard, confirmingCards, rowWhen, TIME_UNKNOWN } = await import("@/config/cockpitCard");
const { MessageRow } = await import("@/components/cockpit/MessagesTab");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { momentText } = await import("@/utils/dateText");
const { loadHistory, stateSinceAnswer, stateSinceRequests } = await import("@/ha/historySource");

const HOUR = 3_600_000, now = Date.now(), began = now - 5 * HOUR, restart = now - HOUR;
const entity = (id, state, attributes = {}) => ({ entity_id: id, state, attributes, last_changed: new Date(restart).toISOString() });
const entities = Object.fromEntries([
  entity("camera.offline", "unavailable"), entity("binary_sensor.leak", "on", { device_class: "moisture" }),
  entity("lock.asked", "locked"), entity("lock.taken", "locked"),
].map((e) => [e.entity_id, e]));
const ticket = (id, entityId, extra = {}) => ({ id, title: `Fault ${id}`, status: "open", openedAt: new Date(began).toISOString(), entityId,
  photoIds: [], room: "Hall", ...extra });
const fmData = { ...EMPTY_FM_DATA,
  tickets: [ticket("f1", "lock.asked"), ticket("f2", "lock.taken", { status: "in_progress" })],
  schedules: [{ id: "s1", title: "AC service", everyDays: 1, enabled: true, room: "Hall", createdAt: new Date(began).toISOString() },
    { id: "s2", title: "Pool filter", everyDays: 1, enabled: true, room: "Hall", createdAt: new Date(now - 960 * HOUR).toISOString() }],
  completions: [{ id: "c1", scheduleId: "s2", at: new Date(now - 96 * HOUR).toISOString(), by: "Op", photoIds: [] }] };
const devices = devicesOf({ ids: Object.keys(entities), unavailable: ["camera.offline", "camera.gone"] });
const entityMap = {}, resolvedRooms = { "camera.offline": "Storage", "binary_sensor.leak": "Laundry" };
const sinceOf = () => ({ at: began, before: false });
const items = buildAttentionItems({ devices, entities, entityMap, resolvedRooms, fmData, sinceOf });

console.log("  every kind of line is in this check:");
const union = readFileSync(new URL("../../src/config/attention.ts", import.meta.url), "utf8").match(/type AttentionKind = ([^;]+);/)[1];
const allKinds = [...union.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
ck("the table holds every kind the villa model has", [...new Set(items.map((i) => i.kind))].sort().join() === allKinds.join(),
   [allKinds, items.map((i) => i.kind)]);

const of = (id) => { const i = items.find((x) => x.id === id); if (!i) throw new Error(`no ${id}: ${items.map((x) => x.id)}`); return i; };
const issue = (...ids) => ({ kind: "issue", key: ids[0], card: cockpitCard(groupAttention(ids.map(of))[0], null, new Date(now)) });
const watched = confirmingCards([{ ticket: ticket("w1", "lock.asked"), word: "Cleared", who: "", closedAt: began, at: now + HOUR, due: false }],
  { devices, entities, entityMap, resolvedRooms, may: () => true })[0];
const table = { offline: issue("unavailable:camera.offline"), missing: issue("unavailable:camera.gone"), alarm: issue("alarm:binary_sensor.leak"),
  "task never done": issue("schedule:s1"), fault: issue("fault:f1"), ticket: issue("fault:f2"), watched: { kind: "issue", key: "w", card: watched } };

const { AttentionCard } = await import("@/components/cockpit/IssueCard");
console.log("\n  each field of the row, on each kind:");
for (const [name, item] of Object.entries(table)) {
  const row = draw(h(MessageRow, { item, selected: false, onSelect() {} }));
  ck(`${name}: its name on the first line, the time beside it`, /<b>[^<]+<\/b>/.test(inside(row, "messages-row-head"))
     && text(inside(row, "messages-row-time")).includes(momentText(began)), row);
  const opened = draw(h(AttentionCard, { card: item.card, onOpenEntity() {} }));
  ck("  ...the opened card's second line is the row's own, the first keeps only its name and its next check",
     (inside(row, "card-pill-line") ?? "") === (inside(opened, "card-pill-line") ?? "")
     && !/fm-badge/.test(inside(opened, "fm-record-head")), opened);
  ck("  ...no frame: every row one look", /class="messages-row"/.test(row), row);
  const pills = row.indexOf("card-pill-status"), room = row.indexOf("fm-entity-chip");
  ck("  ...its room left, its state pills in the group pushed right, nothing of its state in the words",
     (pills >= 0) === ((item.card.status ?? []).length > 0) && (pills < 0 || room < 0 || room < pills) && !row.slice(0, pills < 0 ? 0 : pills).includes("fm-badge")
     && (pills < 0 || !/Missing|Unavailable|In progress/.test(text(inside(row, "messages-row-sub") || ""))), row);
}
ck("each kind that has a state shows it as a pill", ["offline", "missing", "alarm", "task never done", "ticket"]
   .every((k) => (table[k].card.status ?? []).length > 0), Object.entries(table).map(([k, v]) => [k, v.card.status]));
const css = readFileSync(new URL("../../src/styles/07-facility.css", import.meta.url), "utf8");
ck("the pills' group is pushed right; no rule frames a row", /\.card-pill-status \{[^}]*margin-left: auto/.test(css)
   && !/\.messages-row\.ticket/.test(css));

console.log("\n  what the corner says, and where the moment comes from:");
const one = (id, s) => buildAttentionItems({ devices, entities, entityMap, resolvedRooms, fmData, sinceOf: () => s }).find((i) => i.id === id);
const corner = (i) => rowWhen(cockpitCard(groupAttention([i])[0], null, new Date(now)));
ck("the history's moment, never the restart's last_changed", one("unavailable:camera.offline", { at: began, before: false }).openedAt === new Date(began).toISOString());
ck("  ...not read yet, or it cannot say: its last_changed, never an empty corner",
   one("unavailable:camera.offline", "loading").openedAt === entities["camera.offline"].last_changed
   && one("alarm:binary_sensor.leak", null).openedAt === entities["binary_sensor.leak"].last_changed);
ck("  ...older than the villa keeps: \"Before\" that moment, not a moment it did not happen at",
   corner(one("unavailable:camera.offline", { at: began, before: true })) === `Before ${momentText(began)}`);
ck("  ...a device gone longer than the villa keeps says so", corner(one("unavailable:camera.gone", null)) === TIME_UNKNOWN);
{
  const late = rowWhen(issue("schedule:s2").card), due = Date.now();
  ck("  ...a late task: the day it was due, in the past", /\d\d\/\d\d\/\d{4}/.test(late) && Date.parse(of("schedule:s2").openedAt) < due, late);
}
const told = groupAttention([of("unavailable:camera.offline"), { ...of("fault:f1"), id: "fault:f3", entityId: "camera.offline",
  openedAt: new Date(now - 9 * HOUR).toISOString(), device: of("unavailable:camera.offline").device }])[0];
ck("  ...a fault on that device: the fault's moment", rowWhen(cockpitCard(told, null, new Date(now))) === momentText(now - 9 * HOUR), told);

console.log("\n  the wiring: every moment is actually read:");
const asked = sinceEntities({ fmData, devices, entities, entityMap });
ck("every device a card says since of is read from its history", items.filter((i) => i.kind === "unavailable" || i.kind === "alarm")
   .every((i) => asked.includes(i.entityId)), asked);
const port = { stateRows: async (id, from) => (id === "camera.gone"
  ? [{ state: "idle", last_changed: new Date(from + 1).toISOString() }, { state: "", last_changed: new Date(began).toISOString() }]
  : [{ state: "unavailable", last_changed: new Date(began).toISOString() }]) };
const read = await loadHistory({ ...port, keptFrom: undefined }, stateSinceRequests(["camera.gone", "camera.offline"], ["camera.gone"]), now);
ck("a device still there: when its state began, from its history", stateSinceAnswer(read, "camera.offline", entities["camera.offline"])?.at === began, read);
ck("  ...a device gone: when it left, the time its window says", stateSinceAnswer(read, "camera.gone", undefined)?.at === began, read);
done();
