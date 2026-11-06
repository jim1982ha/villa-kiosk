// EVERY KIND OF CARD, ONE ROW (owner, 2026-11-01: "enforce a unique, centralised and consistent style for all faults
// cards"; an offline camera's row had no time). 2.496.645 made one state pill and checked it on the kinds the change
// touched; the time was another field, on faults only, and no check asked it of the others. Here every field is asked
// of every kind, through the real path: the villa's items, the cards, the row drawn, and the history they are read from.
// A new kind of line fails below until it is in the table.
import { h, draw, inside, text } from "../consistency/screen.mjs";
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
const { devicesOf } = await import("../consistency/devices.mjs");
const { attentionOf, groupAttention, sinceEntities } = await import("@/config/attention");
const { cockpitCard, confirmingCards, rowWhen, TIME_UNKNOWN } = await import("@/config/cockpitCard");
const { InboxCard } = await import("@/components/cockpit/MessagesTab");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { momentText, clockTime, dayShort, statusMoment } = await import("@/utils/dateText");
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
const items = attentionOf({ devices, entities, entityMap, resolvedRooms, fmData, sinceOf }).attentionItems;

console.log("  every kind of line is in this check:");
const union = readFileSync(new URL("../../src/config/attention.ts", import.meta.url), "utf8").match(/type AttentionKind = ([^;]+);/)[1];
const allKinds = [...union.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
ck("the table holds every kind the villa model has", [...new Set(items.map((i) => i.kind))].sort().join() === allKinds.join(),
   [allKinds, items.map((i) => i.kind)]);

const of = (id) => { const i = items.find((x) => x.id === id); if (!i) throw new Error(`no ${id}: ${items.map((x) => x.id)}`); return i; };
const issue = (...ids) => ({ kind: "issue", key: ids[0], card: cockpitCard(groupAttention(ids.map(of))[0], null, new Date(now)) });
const watched = confirmingCards([{ ticket: ticket("w1", "lock.asked"), word: "Cleared", who: "", closedAt: began, at: now + HOUR, due: false }],
  { devices, entities, entityMap, resolvedRooms, may: () => true })[0];
// ⚠️ CLOSED IS THE SAME CARD (owner, 2026-11-07: #133-P1 under Closed was VESTA's message drawn as a notification, a
// bell, "#133-P1 (closed)" and no device, state or room): a closed fault, and a closed alert VESTA told, through the
// Closed section's real path (closedCards, messagesView)
const { closedCards } = await import("@/config/cockpitCard");
const { messagesView } = await import("@/messages/messagesModel");
const { parseVestaMessage } = await import("@/messages/announcements");
const closedAt = new Date(now - HOUR).toISOString();
const shut = (id, extra = {}) => ticket(id, "lock.asked", { status: "resolved", resolvedAt: closedAt, notWatched: true,
  // the Agent's close as it writes it (kiosk.py close_fault: a "cleared" kind, its note), `by` the Kiosk's stamp
  updates: [{ at: closedAt, status: "resolved", photoIds: [], kind: "cleared", note: "Cleared: back to normal.", by: "VESTA Agent" }], ...extra });
const closedFm = { ...EMPTY_FM_DATA, tickets: [shut("c1"), shut("c2", { alertNumber: 133, alertPriority: "P1" })] };
const closedOnes = closedCards(closedFm, null, new Date(now), { devices, entities, entityMap, resolvedRooms, may: () => true });
globalThis.window = globalThis.window ?? { location: { pathname: "/" } };   // a photo's address: the add-on's own (no Ingress prefix)
const PHOTO = (n) => `${String(n).repeat(32)}.jpg`;
const vesta133 = parseVestaMessage({ seq: 7, key: "incident:133", at: closedAt, title: "#133-P1 (closed)", stage: "closed", to: "Owner & FM",
  body: "Test door opened while the villa is empty", status: ["- Alert sent 03:39", "✅ Cleared on 07/11/2026 03:45."],
  photos: [{ id: PHOTO(1), label: "Parking", at: new Date(began).toISOString() }, { id: PHOTO(2), label: "Door", at: new Date(began + 60_000).toISOString() }] });
const closedView = messagesView({ open: [], watched: [], closed: closedOnes, announcements: [vesta133], filter: "issues", selected: null });
const closedItem = (id) => closedView.closed.find((i) => i.key === `closed:${id}`);
const table = { offline: issue("unavailable:camera.offline"), missing: issue("unavailable:camera.gone"), alarm: issue("alarm:binary_sensor.leak"),
  "task never done": issue("schedule:s1"), fault: issue("fault:f1"), ticket: issue("fault:f2"), watched: { kind: "issue", key: "w", card: watched },
  closed: closedItem("c1"), "closed alert": closedItem("c2") };
const STATED = ["ticket", "watched", "fault", "closed", "closed alert"];

const { AttentionCard } = await import("@/components/cockpit/IssueCard");
console.log("\n  each field of the row, on each kind:");
// ⚠️ NAME ON TOP, STATE FIRST (owner, 2026-11-05, the second card): the strip names it and says when, the card's first
// line says where it stands, the quiet line says where and when VESTA looks next, the words say what is wrong, never the
// state
for (const [name, item] of Object.entries(table)) {
  const row = draw(h(InboxCard, { item, opened: true, canManage: false, onOpenEntity() {}, onEditTicket() {}, onRaiseTicket() {} }));
  const strip = inside(row, "fm-record-strip"), main = inside(row, "fm-record-main");
  ck(`${name}: its strip first, its name in it, its time at its right end`,
     row.indexOf("fm-record-strip") < row.indexOf("fm-record-main") && text(inside(strip, "fm-record-name")) === `|${item.card.title}|`
     && new RegExp(`fm-record-when">${momentText(began).replace(/\//g, "\\/")}</span></div>$`).test(strip)
     && !text(inside(main, "fm-record-state") + inside(main, "fm-record-meta")).includes(momentText(began))
     && !text(main).includes(`|${item.card.title}|`), row);
  const opened = draw(h(AttentionCard, { card: item.card, onOpenEntity() {} }));
  ck("  ...the one card, in the Inbox as drawn alone: the same strip, first line and quiet line", /fm-record-card/.test(row) && /fm-record-card/.test(opened)
     && strip === inside(opened, "fm-record-strip") && inside(row, "fm-record-state") === inside(opened, "fm-record-state")
     && inside(row, "fm-record-meta") === inside(opened, "fm-record-meta"), opened);
  const state = inside(main, "fm-record-state"), said = text(state).replace(/\|/g, "");
  const meta = inside(row, "fm-record-meta");
  ck("  ...its state the card's first line (none in its strip), its room the quiet line's first words, nothing of its state in the words or that line",
     (said.length > 0) === ((item.card.status ?? []).length > 0 || STATED.includes(name))
     && (!said || main.startsWith(`<div class="fm-record-main"><div class="fm-record-state`)) && !strip.includes("fm-record-status")
     && (item.card.status ?? []).every((s) => said.includes(s.text)) && text(meta).startsWith(`|${item.card.room}|`)
     && !/Missing|Unavailable|In progress|Never recorded/.test(text(meta) + text(inside(row, "cockpit-attention-sub-title") || "")), [said, meta, row]);
}
ck("each kind that has a state says it; a ticket's, its stage, who took it its who line (owner, 2026-11-02/05)", ["offline", "missing", "alarm", "task never done"]
   .every((k) => (table[k].card.status ?? []).length > 0) && table.ticket.card.lines[0].move?.stage === "ticket"
   && !(table.ticket.card.status ?? []).length, Object.entries(table).map(([k, v]) => [k, v.card.status]));
{
  const row = draw(h(InboxCard, { item: table.ticket, opened: true, canManage: false, onOpenEntity() {}, onEditTicket() {}, onRaiseTicket() {} }));
  ck("  ...a ticket's strip green, its first line \"Ticket in progress\" in green; its who line who opened it, not its stage again",
     /fm-record-strip strip-ok"/.test(row) && /fm-record-state strip-ok"><span class="fm-record-status">Ticket in progress</.test(row) && /fm-record-who"[\s\S]*<span>Opened/.test(row)
     && !/In progress/.test(text(inside(row, "fm-record-who"))), row);
}
{
  // owner, 2026-11-06: "House Pump Power", a maintenance check's fault nobody had moved, began with its quiet line
  const row = (k) => draw(h(InboxCard, { item: table[k], opened: true, canManage: false, onOpenEntity() {}, onEditTicket() {}, onRaiseTicket() {} }));
  const first = (k) => inside(row(k), "fm-record-state");
  ck("every kind of card has its first line; a fault nobody moved says \"New fault\", amber as its strip",
     Object.keys(table).every((k) => first(k) !== "") && /^<div class="fm-record-state strip-warn"><span class="fm-record-status">New fault<\/span>/.test(first("fault"))
     && /fm-record-strip strip-warn"/.test(row("fault")), Object.keys(table).map((k) => [k, text(first(k))]));
  // the same fault, moved: its move says where it stands, never "New fault" (a ticket's stage, a reopening)
  ck("  ...only while nobody moved it: a ticket says its stage, not \"New fault\"", !/New fault/.test(row("ticket")) && !/New fault/.test(row("watched")));
}
{
  // owner, 2026-11-07: the closed visit #133-P1 drawn as every card, its message's photos a row inside it
  const item = table["closed alert"];
  const row = draw(h(InboxCard, { item, opened: true, canManage: false, onOpenEntity() {}, onEditTicket() {}, onRaiseTicket() {} }));
  const strip = inside(row, "fm-record-strip"), caps = [...row.matchAll(/<figcaption>([^<]*)<\/figcaption>/g)].map((m) => m[1]);
  ck("its Status under Closed: its moments on the alert's own day are its time alone (statusMoment, the Agent's rule)",
     statusMoment(began, began) === clockTime(began) && statusMoment(began + 26 * HOUR, began) === `${dayShort(began + 26 * HOUR)} ${clockTime(began + 26 * HOUR)}`
     && statusMoment(began, null) === momentText(began), [statusMoment(began, began), statusMoment(began + 26 * HOUR, began)]);
  ck("a closed alert VESTA told is listed once, by its fault's card: never also VESTA's message as a card of its own",
     closedView.closed.length === 2 && closedView.closed.every((i) => i.kind === "issue"), closedView.closed);
  ck("  ...its strip: its alert's chip, its device's name; its state its first line; its room its quiet line",
     /<span class="fm-record-number">#133-P1<\/span><span class="fm-record-name">/.test(strip) && text(inside(strip, "fm-record-name")) === "|Asked|"
     && !/\(closed\)/.test(row) && inside(row, "fm-record-state") !== "" && text(inside(row, "fm-record-meta")).startsWith("|Hall|"), row);
  ck("  ...its message's every photo in one row, each its camera and its own time, never one photo at the close",
     caps.length === 2 && caps[0] === `Parking · ${clockTime(began)}` && caps[1] === `Door · ${clockTime(began + 60_000)}`
     && /Status:/.test(row) && /✅ Cleared on 07\/11\/2026 03:45\./.test(row), caps);
}
{
  // owner, 2026-11-07: closed cards under Closed wore the Watch list's green check, as a watched "House Pump Power" did —
  // the check is the Watch card's alone; every kind of closed card wears where it came from, in the grey of what is over
  const row = (k) => draw(h(InboxCard, { item: table[k], opened: true, canManage: false, onOpenEntity() {}, onEditTicket() {}, onRaiseTicket() {} }));
  const lead = (k) => inside(inside(row(k), "fm-record-strip"), "fm-record-lead");
  ck("a closed card never wears the Watch check: a closed fault and a closed alert wear their source, grey; Watch keeps its check",
     /fault-watched-icon/.test(lead("watched")) && ["closed", "closed alert"].every((k) => !/fault-watched-icon/.test(row(k))
       && /cockpit-attention-icon cockpit-attention-lost/.test(lead(k))),
     ["watched", "closed", "closed alert"].map((k) => [k, lead(k)]));
}
{
  // owner, 2026-11-07: a hold on #134-P1's card under Closed did nothing, the villa's message beside it asked for the
  // superadmin code: every record under Closed is held to erase, the same way
  const { cardErase } = await import("@/components/cockpit/IssueCard");
  const { FmDataContext } = await import("@/fm/FmDataContext");
  // under the Facility records, as in the app: the hold erases through their one write (removeTicket)
  const fm = { removeTicket: async () => true };
  const held = (item) => /fm-erasable/.test(draw(h(FmDataContext.Provider, { value: fm },
    h(InboxCard, { item, opened: true, canManage: false, onOpenEntity() {}, onEditTicket() {}, onRaiseTicket() {} }))));
  const note = closedView.closed.length ? messagesView({ open: [], watched: [], closed: [], announcements: [vesta133], filter: "issues", selected: null }).closed[0] : null;
  ck("every card under Closed is held to erase: a closed fault, a closed alert VESTA told, a message no fault holds; never an open one",
     held(table.closed) && held(table["closed alert"]) && note?.kind === "notification" && held(note)
     && !held(table.fault) && !held(table.watched), [note?.kind]);
  const done = [];
  const erase = cardErase(table["closed alert"].card, async (id, t) => done.push(`ticket ${id} ${t}`), async (a, t) => done.push(`message ${a.key} ${t}`));
  await erase.run("T");
  ck("  ...held, its fault and VESTA's message of it go, behind the code", done.join() === "ticket c2 T,message incident:133 T"
     && erase.detail === "#133-P1 Asked" && cardErase(table.fault.card, async () => {}, async () => {}) === undefined, done);
}
{
  // owner, 2026-11-05: "#91-P1" a small chip in the strip, before the name, from the record (fmEngine.alertLabel)
  const alerted = attentionOf({ devices, entities, entityMap, resolvedRooms, sinceOf,
    fmData: { ...EMPTY_FM_DATA, tickets: [ticket("f7", "lock.asked", { alertNumber: 91, alertPriority: "P1", status: "in_progress" })] } }).attentionItems;
  const card = cockpitCard(groupAttention(alerted.filter((i) => i.id === "fault:f7"))[0], null, new Date(now));
  const row = draw(h(InboxCard, { item: { kind: "issue", key: "f7", card }, opened: true, canManage: false, onOpenEntity() {}, onEditTicket() {}, onRaiseTicket() {} }));
  ck("  ...an alert's name a chip in its strip, before its name", /<span class="fm-record-number">#91-P1<\/span><span class="fm-record-name"><button[^>]*>Asked<\/button><\/span>/.test(inside(row, "fm-record-strip")), inside(row, "fm-record-strip"));
}
{
  // owner, 2026-11-05: Open issues red, then amber, then grey, then what is being handled; within a colour, as grouped
  const { cockpitIssues } = await import("@/config/cockpitIssues");
  const groups = groupAttention(items);
  const open = cockpitIssues({ attentionGroups: groups, devices, shows: () => true },
    { fmData, cadence: null, now: new Date(now), entities, entityMap, resolvedRooms }).open;
  const RANK = { danger: 0, warn: 1, lost: 2, handled: 3 };
  const tones = open.map((c) => c.tone), kept = (t) => open.filter((c) => c.tone === t).map((c) => c.key).join()
    === groups.map((g) => cockpitCard(g, null, new Date(now))).filter((c) => c.tone === t).map((c) => c.key).join();
  const sorted = (ts) => ts.every((t, i) => i === 0 || RANK[ts[i - 1]] <= RANK[t]);
  ck("Open issues in their colour's order: red, amber, grey, then handled; each colour in the grouping's order",
     sorted(tones) && ["danger", "warn", "lost", "handled"].every((t) => tones.includes(t)) && ["danger", "warn", "lost", "handled"].every(kept)
     // the grouping's own order is not that one: the order is the Inbox's
     && !sorted(groups.map((g) => cockpitCard(g, null, new Date(now)).tone)), tones);
}
const css = readFileSync(new URL("../../src/styles/07-facility.css", import.meta.url), "utf8");
// owner, 2026-11-05: a name can be a sentence (a ticket's title): two lines at most, then "…"; the rest on its first line
const rule = (sel) => (css.match(new RegExp(`(?:^|\\n)[^{}\\n]*${sel.replace(/[.()]/g, "\\$&")}[^{}\\n]*\\{[^}]*\\}`, "g")) ?? []).join("\n");
ck("the strip's name wraps to two lines at most; its icons, chip and time never shrink, on its first line; no rule frames a row with a coloured edge",
   /-webkit-line-clamp: 2/.test(rule(".fm-record-name")) && /overflow: hidden/.test(rule(".fm-record-name"))
   && ["fm-record-lead", "fm-record-number", "fm-record-when"].every((c) => /flex: none/.test(rule(`.${c}`)) && /white-space: nowrap/.test(rule(`.${c}`)))
   && /align-items: flex-start/.test(rule(".fm-record-strip, .fm-record-part-head"))
   && !/\.fm-record-card\.ticket/.test(css) && !/border-left: [2-9]px/.test(css));

console.log("\n  every card of the app, wherever it is drawn:");
{
  const { readdirSync } = await import("node:fs");
  const { elements, parseTsx, propText } = await import("../consistency/jsx.mjs");
  const root = new URL("../../src/components/", import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".tsx") && f !== "fm/RecordCard.tsx")
    .filter((f) => readFileSync(new URL(f, root), "utf8").includes("<RecordCard"));
  // a card that belongs to no place: every other card has its room line. A new one fails here until it is decided.
  const NO_ROOM = { "cockpit/MessagesTab.tsx": 1 /* a notification or a report */, "fm/ReadinessTab.tsx": 1 /* a villa-wide check */,
    "fm/SavedDocumentsList.tsx": 1 /* a saved document */, "fm/TicketsTab.tsx": 1 /* "No ticket in progress" */, "fm/TodayTab.tsx": 1 /* "Nothing due" */,
    // Settings' records (owner, 2026-11-06): a full-screen announcement (every tablet's), a chat that gets the messages
    // (a person's phone or group)
    "settings/MessagesSettings.tsx": 1, "settings/WhoGetsMessages.tsx": 1,
    // ⚠️ EVERY SETTINGS CARD FOR AN ENTITY, the one EntityCard: its name, its id alone under it (owner, 2026-11-06: a
    // device's room under its name "no added value"; "only showing the baseline entity name", the room line redundant)
    "settings/EntityCard.tsx": 1 };
  const cards = files.map((f) => { const all = elements(parseTsx(`components/${f}`), "RecordCard");
    return { f, all, roomless: all.filter((e) => propText(e, "room") === undefined || propText(e, "room") === null).length,
      perCaller: all.filter((e) => /\|\| undefined/.test(propText(e, "room") ?? "")).length }; });
  ck("every card has its room line, derived from the tree: only the listed ones go without",
     cards.every((c) => c.roomless === (NO_ROOM[c.f] ?? 0) && c.perCaller === 0), cards.map((c) => [c.f, c.all.length, c.roomless, c.perCaller]));
  const { default: RecordCard } = await import("@/components/fm/RecordCard");
  const drawn = draw(h(RecordCard, { title: "T", room: "Hall", when: "01/01/2026 10:00",
    pills: h("span", { className: "fm-clause" }, "tag") }));
  ck("  ...its time in its strip, its room then its tags on its quiet line",
     /fm-record-when">01\/01/.test(inside(drawn, "fm-record-strip")) && !inside(drawn, "fm-record-main").includes("01/01/2026")
     && text(inside(drawn, "fm-record-meta")) === "|Hall|tag|", drawn);
  const bare = draw(h(RecordCard, { title: "T", when: "01/01/2026 10:00" }));
  ck("  ...a card with no status and no icon still has its strip, its name and its time in it, no first line (one card, every case)",
     /^<div class="fm-record-card"><div class="fm-row fm-record"><div class="fm-record-strip strip-neutral"><span class="fm-record-name">T<\/span><span class="fm-record-when">01\/01\/2026 10:00<\/span><\/div><div class="fm-record-main"><\/div>/.test(bare), bare);
  const stated = draw(h(RecordCard, { title: "T", when: "1", status: [{ text: "Overdue", tone: "tone-danger" }, { text: "Paused", tone: "tone-quiet" }],
    statusTip: "Why", room: "Hall" }));
  ck("  ...a card's states its first line, joined, in its worst tone's colour, its (i) after them, before its quiet line",
     /<div class="fm-record-main"><div class="fm-record-state strip-danger"><span class="fm-record-status">Overdue · Paused<\/span><span class="info-tip">[\s\S]*?<\/div><div class="fm-record-meta">/.test(stated)
     && /fm-record-strip strip-danger"><span class="fm-record-name">T</.test(stated), stated);
  // ⚠️ EVERY FRAME IS RECORDCARD'S (architecture review, 2026-11-05): a ticket of several records was framed by the
  // Tickets tab itself; its records, then one bar after all of them, are RecordGroup's
  const { RecordGroup } = await import("@/components/fm/RecordCard");
  const group = draw(h(RecordGroup, { actions: h("button", { className: "btn" }, "Close") },
    h(RecordCard, { title: "A", when: "1", framed: false }), h(RecordCard, { title: "B", when: "2", framed: false })));
  ck("  ...a card of several records: one frame, its records, one bar after all of them",
     /^<div class="fm-record-card"><div class="fm-record-group">(<div class="fm-row fm-record">.*?){2}<\/div><div class="fm-record-actions"[^>]*><button class="btn">Close<\/button><\/div><\/div>$/.test(group), group);
  // architecture review, 2026-11-05: a spend's device was a chip beside its title, the one card left that way
  const named = ["fm/TicketsTab.tsx", "fm/SpendTab.tsx"].filter((f) => !cards.find((c) => c.f === f)?.all
    .some((e) => /<DeviceChip /.test(propText(e, "device") ?? "")));
  ck("  ...a card that names a device: its link first on its quiet line (Tickets, Spend)", named.length === 0, named);
  const framing = files.filter((f) => /className="fm-record-(card|group)"/.test(readFileSync(new URL(f, root), "utf8")));
  ck("  ...and no list draws a card's frame of its own", framing.length === 0, framing);
}

console.log("\n  the same device, the same room, in the Inbox and on its ticket:");
{
  const { recordRoom } = await import("@/config/attention");
  const ctx = { entities, resolvedRooms: { ...resolvedRooms, "camera.gone": "Living Room" }, deviceOf: devices.deviceOf };
  const inbox = attentionOf({ devices, entities, entityMap, resolvedRooms: ctx.resolvedRooms, fmData, sinceOf }).attentionItems
    .find((i) => i.id === "unavailable:camera.gone");
  ck("a Missing device: the room of its Inbox card", recordRoom({ entityId: "camera.gone" }, ctx) === inbox.room && inbox.room === "Living Room", inbox);
  ck("  ...a device still there: the same", recordRoom({ entityId: "camera.offline", room: "Old" }, ctx) === "Storage");
  ck("  ...no device: the stored one", recordRoom({ room: "Hall" }, ctx) === "Hall");
}

console.log("\n  what the corner says, and where the moment comes from:");
const one = (id, s) => attentionOf({ devices, entities, entityMap, resolvedRooms, fmData, sinceOf: () => s }).attentionItems.find((i) => i.id === id);
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

{
  // owner, 2026-11-01: the Inbox said 01:07, its last escalation, the ticket 00:19, its opening: "it shall be the same time"
  const taken = fmData.tickets.find((t) => t.id === "f2");
  const told = { ...of("fault:f2"), story: [{ at: new Date(now - HOUR).toISOString(), note: "Escalation sent (to: Owner)" }] };
  ck("  ...a ticket and its Inbox card say one time, whatever was told of it since",
     rowWhen(cockpitCard(groupAttention([told])[0], null, new Date(now))) === momentText(taken.openedAt));
}

{
  // owner, 2026-11-01: "offline for over 8d 19h" under a time 2 days old
  const { faultBegan } = await import("@/fm/fmEngine");
  const since = new Date(now - 200 * HOUR).toISOString(), openedAt = new Date(now - 48 * HOUR).toISOString();
  const offline = ticket("f9", "lock.taken", { status: "in_progress", openedAt, since });
  const [i] = attentionOf({ devices, entities, entityMap, resolvedRooms, fmData: { ...EMPTY_FM_DATA, tickets: [offline] }, sinceOf }).attentionItems.filter((x) => x.id === "fault:f9");
  ck("  ...a fault counting from when its device went offline: that moment, on its card and its ticket alike",
     rowWhen(cockpitCard(groupAttention([i])[0], null, new Date(now))) === momentText(since) && faultBegan(offline) === since
     && faultBegan({ openedAt }) === openedAt && faultBegan({ openedAt, since: "x" }) === openedAt);
  const tab = readFileSync(new URL("../../src/components/fm/TicketsTab.tsx", import.meta.url), "utf8");
  ck("  ...the Tickets tab asks the same", /const when = momentText\(faultBegan\(t\)\);/.test(tab) && /\bwhen=\{when\}/.test(tab));
}

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
