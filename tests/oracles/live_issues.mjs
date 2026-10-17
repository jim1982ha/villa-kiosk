// The Overview's Live issues and the Tickets tab (owner, 2026-10-14): ONE list of everything open on the Overview, a
// card per device — what Home Assistant reports right now (no buttons: it clears when the device does), faults the
// VESTA Agent or a person opened, tickets in progress. "Open ticket" (was "Mark in progress") makes a card's faults ONE ticket (each still
// its own record, so the Agent can clear one alone), "Edit ticket" then opens it in the Tickets tab, which holds the
// tickets in progress and the Closed ones. It replaced "Needs attention" and the Faults tab's open list (the same
// faults twice). The same with or without the Agent: only where faults come from differs.
// Where a check can draw what it is about it does (tests/consistency/screen.mjs); the source-text checks left are
// wiring that needs the Facility data or the page to draw (said where), and stylesheet rules.
import { readFileSync } from "node:fs";
import { h, draw, text } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
const E = await import("@/fm/fmEngine");
const W = await import("@/fm/deviceWork");
const { groupAttention, cardActions, cardRecords, attentionLineIn, buildAttentionItems } = await import("@/config/attention");
const { screenReducer, START } = await import("@/pages/screen");

const k = { now: "2026-10-14T10:00:00.000Z", id: (p) => `${p}-${Math.random().toString(36).slice(2, 8)}` };
const rec = (id, entityId, status = "open") => ({ id, title: `fault ${id}`, status, openedAt: "2026-10-14T08:00:00.000Z", entityId, photoIds: [] });
const fm = (tickets) => ({ schedules: [], completions: [], costs: [], tickets, savedDocuments: [] });
// the pump's power and energy sensors are ONE device; the lock is another
const deviceOf = (id) => (id === "sensor.pump_energy" ? "sensor.pump_power" : id);

console.log("  a card's buttons are its faults' only (fm/deviceWork, architecture review 2026-10-16):");
const item = (id, kind, entityId, extra = {}) => ({ id, kind, title: id, detail: "", entityId, device: { key: deviceOf(entityId), label: "dev" }, ...extra });
// a card's buttons as the owner reads them: "label → the records it acts on [what it asks first]"
const said = (acts) => acts.map((a) => `${a.label} → ${[...a.ids].sort().join(",")}${a.step.kind === "close" ? ` [${a.step.question} / ${a.step.confirmLabel}]` : ""}${a.step.kind === "stage" ? ` (${a.step.to})` : ""}`);
const OV_CLOSE = "[Close this? No action needed. / Close]", TK_CLOSE = "[Close this ticket? Nothing was done — no cost is recorded. / Close ticket]";
const [pump] = groupAttention([
  item("unavailable:sensor.pump_power", "unavailable", "sensor.pump_power"),
  item("fault:a", "fault", "sensor.pump_energy", { ticketId: "a", stage: "fault" }),
  item("fault:b", "fault", "sensor.pump_power", { ticketId: "b", stage: "ticket" }),
]);
const acts = cardActions(pump);
ck("a device's live state and its faults are ONE card", pump.items.length >= 2 && cardRecords(pump).length === 2, pump.items.map((i) => i.id));
ck("  ...Open Ticket takes on its fault (adding it to the ticket); Close closes both, the fault AND the ticket",
   said(acts).join(" | ") === `Open Ticket → a (in_progress) | Close → a,b ${OV_CLOSE}`, said(acts));
const [taken] = groupAttention([item("fault:b", "fault", "sensor.pump_power", { ticketId: "b", stage: "ticket" }),
  item("fault:c", "fault", "sensor.pump_energy", { ticketId: "c", stage: "ticket" })]);
ck("  ...once every fault is a ticket, the button is Edit Ticket, on its first record",
   said(cardActions(taken)).join(" | ") === `Edit Ticket → b | Close → b,c ${OV_CLOSE}`, said(cardActions(taken)));
const [lock] = groupAttention([item("alarm:lock.door", "alarm", "lock.door")]);
ck("a card that is only what Home Assistant reports has nothing to act on — no button", cardActions(lock).length === 0);
ck("a ticket in progress (Tickets): Mark resolved and Close, both on every record of it — its own Close question",
   said(W.ticketActions([{ id: "a", stage: "ticket" }, { id: "b", stage: "ticket" }])).join(" | ")
   === `Mark resolved → a,b (resolved) | Close → a,b ${TK_CLOSE}`);
ck("  ...a closed record: Reopen, on it alone — and nothing else on a record that is not where the card expects it",
   said(W.closedActions({ id: "r", stage: "closed" })).join() === "Reopen → r (open)"
   && W.closedActions({ id: "r", stage: "fault" }).length === 0 && W.ticketActions([{ id: "f", stage: "fault" }]).length === 0
   && W.overviewActions([{ id: "r", stage: "closed" }]).length === 0);
ck("  ...ONE wording per action: every button of a kind says the same, whichever card draws it",
   Object.entries(W.WORK_ACTIONS).every(([kind, spec]) => [acts, cardActions(taken), W.ticketActions([{ id: "a", stage: "ticket" }]), W.closedActions({ id: "r", stage: "closed" })]
     .flat().filter((a) => a.kind === kind).every((a) => a.label === spec.label && JSON.stringify(a.step) === JSON.stringify(spec.step))));

console.log("\n  one answer to \"fault, ticket or closed\":");
ck("open → fault, in progress → ticket, resolved → closed",
   E.stageOf({ status: "open" }) === "fault" && E.stageOf({ status: "in_progress" }) === "ticket" && E.stageOf({ status: "resolved" }) === "closed");
ck("  ...a status this build does not know is a FAULT — never hidden, never closed", E.stageOf({ status: "escalated" }) === "fault" && E.stageOf({}) === "fault");
const odd = fm([{ ...rec("z", "lock.door"), status: "escalated" }]);
ck("  ...counted as an open fault, listed on the Overview, absent from Tickets",
   E.ticketStats(odd.tickets).open === 1 && E.fmAttention(odd).unresolved.length === 1
   && W.ticketCards(odd.tickets, deviceOf).length === 0);

console.log("\n  Mark in progress: one ticket per device, each fault its own record:");
let d = fm([rec("a", "sensor.pump_energy"), rec("b", "sensor.pump_power"), rec("c", "lock.door")]);
d = E.withTicketsAdvanced(d, ["a", "b"], "in_progress", { who: "Wayan", photoIds: [] }, undefined, k, "Owner");
const inProg = d.tickets.filter((t) => t.status === "in_progress");
ck("both of the pump's faults are in progress, in one edit; the lock's is untouched",
   inProg.map((t) => t.id).sort().join() === "a,b" && d.tickets.find((t) => t.id === "c").status === "open");
const groups = W.ticketCards(d.tickets, deviceOf);
ck("  ...and the Tickets tab shows them as ONE ticket for the pump", groups.length === 1 && groups[0].records.length === 2, groups);
const resolved = E.withTicketsAdvanced(d, ["a", "b"], "resolved", { photoIds: [] }, { amountIdr: 100, category: "minor", label: "x" }, k);
ck("resolving the ticket files its cost ONCE", resolved.costs.length === 1 && resolved.tickets.filter((t) => t.status === "resolved").length === 2);

console.log("\n  the Agent clears one problem of a ticket:");
const oneCleared = E.withTicketClosed(d, "a", k, undefined);
const left = W.ticketCards(oneCleared.tickets, deviceOf);
ck("that record closes; the ticket stays in progress for the other", left.length === 1 && left[0].records.map((t) => t.id).join() === "b");
const both = E.withTicketsClosed(oneCleared, ["b"], k);
ck("  ...and with its last one it goes to Closed", W.ticketCards(both.tickets, deviceOf).length === 0
   && both.tickets.filter(E.isTicketResolved).map((t) => t.id).sort().join() === "a,b");
ck("a fault on no device is a ticket of its own", W.ticketCards([rec("x", undefined, "in_progress"), rec("y", undefined, "in_progress")], deviceOf).length === 2);

console.log("\n  ONE card per device, on the Overview and in Tickets, and the counts are the cards:");
{
  // the pump (power + energy: one device) has a fault and a ticket; the lock a fault; two records on no device, one of
  // each stage; a door's ticket alone; a closed one
  const folding = new Map([["sensor.pump_energy", "sensor.pump_power"]]);
  const fold = (id) => folding.get(id) ?? id;
  const at = (h) => `2026-10-14T0${h}:00:00.000Z`;
  const records = [{ ...rec("p1", "sensor.pump_energy"), openedAt: at(1) }, { ...rec("p2", "sensor.pump_power", "in_progress"), openedAt: at(2) },
    rec("l1", "lock.door"), rec("n1", undefined), { ...rec("n2", undefined, "in_progress"), openedAt: at(4) },
    { ...rec("d1", "lock.back", "in_progress"), openedAt: at(3) }, { ...rec("z", "lock.back", "resolved"), resolvedAt: at(5) }];
  const overview = groupAttention(buildAttentionItems({ unavailableIds: [], entities: {}, entityMap: {}, alertThresholds: {}, resolvedRooms: {},
    selectableIds: [], folding, fmData: fm(records) }));
  const tickets = W.ticketCards(records, fold);
  const counts = W.openCounts(records, fold);
  const has = (g, kind) => cardActions(g).some((a) => a.kind === kind);
  ck("the counts are the cards: devices to take on = Overview cards with Open Ticket; in progress = Tickets cards; open = Overview cards with a Close",
     counts.faults === overview.filter((g) => has(g, "openTicket")).length && counts.tickets === tickets.length
     && counts.total === overview.filter((g) => has(g, "closeDevice")).length
     && JSON.stringify(counts) === JSON.stringify({ faults: 3, tickets: 3, total: 5 }), { counts, overview: overview.map((g) => g.key), tickets: tickets.map((t) => t.key) });
  ck("  ...each record's card is the same device in both: a Tickets card holds exactly its Overview card's tickets",
     tickets.every((t) => { const g = overview.find((o) => o.key === t.key);
       return g && cardRecords(g).filter((r) => r.stage === "ticket").map((r) => r.id).sort().join() === t.records.map((r) => r.id).sort().join(); })
     && records.filter(E.isTicketOpen).every((t) => overview.find((g) => g.key === W.recordWorkKey(t, fold))?.items
       .some((i) => (i.fault ?? i).ticketId === t.id)),
     tickets.map((t) => [t.key, t.records.map((r) => r.id)]));
  ck("  ...the Tickets card's buttons are its records', the Overview card's the whole device's",
     said(W.ticketActions(tickets.find((t) => t.key === "device:sensor.pump_power").records.map(W.workRecord))).join(" | ")
       === `Mark resolved → p2 (resolved) | Close → p2 ${TK_CLOSE}`
     && said(cardActions(overview.find((g) => g.key === "device:sensor.pump_power"))).join(" | ")
       === `Open Ticket → p1 (in_progress) | Close → p1,p2 ${OV_CLOSE}`);
  ck("  ...Tickets lists the device whose ticket was opened last first, never an open fault or a closed record",
     tickets.map((t) => t.key).join() === "item:fault:n2,device:lock.back,device:sensor.pump_power", tickets.map((t) => t.key));
}

console.log("\n  where things land:");
const OWNER = { facility: true }, GUEST = { facility: false };
const open = { ...START, nav: { ...START.nav, panel: { entityId: "light.a" } } };
const raised = screenReducer(open, { type: "reportFault" }, OWNER);
ck("a device's wrench (owner/facility): the Overview, Raise a fault pointed at it", raised.cockpitTab === "overview" && raised.faultFor === "light.a");
const edit = screenReducer(START, { type: "editTicket", id: "b" }, OWNER);
ck("an Overview card's Edit ticket: the Tickets tab, that record's form", edit.cockpitTab === "tickets" && edit.ticketFor === "b");
ck("  ...dropped once the form has it, and when the Cockpit closes",
   screenReducer(edit, { type: "ticketEditOpened" }, OWNER).ticketFor === null
   && screenReducer(edit, { type: "closeWindow", window: "cockpit" }, OWNER).ticketFor === null);
ck("a guest's Report a problem: the guest form, on no device", screenReducer(START, { type: "reportProblem" }, GUEST).guestReportFor === "");
ck("  ...and a guest cannot be sent to the Tickets tab", screenReducer(START, { type: "editTicket", id: "b" }, GUEST).ticketFor === null);

console.log("\n  the alert's number, as Telegram writes it (owner, 2026-10-14):");
const numbered = buildAttentionItems({ unavailableIds: [], entities: {}, entityMap: {}, alertThresholds: {}, resolvedRooms: {},
  selectableIds: [], folding: new Map(),
  fmData: fm([{ ...rec("n", "switch.pump"), title: "House Pump Power has not run", alertNumber: 5 }, rec("p", "lock.door")]) });
ck("a fault from a VESTA Agent alert reads \"#5 · …\" on its card; one without a number, its title alone",
   numbered.find((i) => i.ticketId === "n")?.title === "#5 · House Pump Power has not run" && numbered.find((i) => i.ticketId === "p")?.title === "fault p",
   numbered.map((i) => i.title));
ck("  ...and the same in the Tickets tab", /<RecordCard key=\{t\.id\} framed=\{framed\} title=\{faultTitle\(t\)\}/.test(readFileSync(new URL("../../src/components/fm/TicketsTab.tsx", import.meta.url), "utf8")));
ck("  ...a number that is not one (0, text) is not shown", E.faultTitle({ title: "x", alertNumber: 0 }) === "x" && E.faultTitle({ title: "x", alertNumber: "5" }) === "x");

const ov = readFileSync(new URL("../../src/components/cockpit/CockpitOverview.tsx", import.meta.url), "utf8");
console.log("\n  an offline device is ONE line (owner, 2026-10-14: the same Timmerflotte said \"Unavailable\" and \"offline for 9 h\"):");
const ent = (id, state) => ({ entity_id: id, state, attributes: {}, last_changed: "", last_updated: "" });
const offlineDevice = (batteryState) => groupAttention(buildAttentionItems({
  unavailableIds: ["sensor.example_temperature"],
  entities: { "sensor.example_temperature": ent("sensor.example_temperature", "unavailable"),
              "sensor.example_battery": ent("sensor.example_battery", batteryState) },
  entityMap: {}, alertThresholds: {}, resolvedRooms: {}, selectableIds: [],
  folding: new Map([["sensor.example_battery", "sensor.example_temperature"]]),
  fmData: fm([{ ...rec("off", "sensor.example_battery"), title: "Example has been offline for 9 h." }]) }));
const [one] = offlineDevice("unavailable");
ck("the fault on another entity of the device, itself unavailable, goes onto the device's Unavailable line",
   one.items.length === 1 && one.items[0].kind === "unavailable" && one.items[0].fault?.ticketId === "off"
   && attentionLineIn(one, one.items[0]) === "Example has been offline for 9 h.", one.items.map((i) => i.id));
ck("  ...its Close and Open ticket still act on it", said(cardActions(one)).join(" | ") === `Open Ticket → off (in_progress) | Close → off ${OV_CLOSE}`, said(cardActions(one)));
const { attentionLine } = await import("@/config/attention");
const f = { id: "fault:x", kind: "fault", title: "Pump has been offline for 9 h.", detail: "", ticketId: "x" };
ck("  ...\"Unavailable — \" is not said before it (the fault says offline); a ticket still says it is in progress",
   attentionLine({ id: "u", kind: "unavailable", title: "", detail: "Unavailable", fault: f }) === "Pump has been offline for 9 h."
   && attentionLine({ id: "u", kind: "unavailable", title: "", detail: "Unavailable", fault: { ...f, stage: "ticket" } }) === "In progress: Pump has been offline for 9 h.");
ck("  ...what the fault does not say stays: Not in Home Assistant, a live reading",
   attentionLine({ id: "u", kind: "unavailable", title: "", detail: "Not in Home Assistant", fault: f }) === "Not in Home Assistant — Pump has been offline for 9 h."
   && attentionLine({ id: "a", kind: "alarm", title: "", detail: "92 %", fault: { ...f, title: "Humidity high" } }) === "92 % — Humidity high");
const [two] = offlineDevice("42");
ck("  ...a fault on an entity that still reports (a battery reading 42 %) stays its own line", two.items.length === 2, two.items.map((i) => i.id));
const [unknownValue] = offlineDevice("unknown");
ck("  ...and \"unknown\" (a sensor with no value) is not offline: its own line", unknownValue.items.length === 2);

console.log("\n  each problem's source, as an icon (owner, 2026-10-14):");
const S = await import("@/fm/issueSource");
const agentRec = (x) => ({ ...rec("a", "x.y"), source: "vesta_agent", ...x });
ck("a fault's source is read from its record: the Agent's origin, its alert number, a guest's mark, the profile that opened it",
   S.faultSource(agentRec({ origin: "night" })) === "night" && S.faultSource(agentRec({ origin: "chat" })) === "chat"
   && S.faultSource(agentRec({ alertNumber: 5 })) === "alert" && S.faultSource(agentRec({})) === "chat"   // an old fault with no origin (owner, 2026-10-15: no "VESTA Agent" source)
   && S.faultSource({ ...rec("g", "x.y"), reportedBy: "guest" }) === "guest"
   && S.faultSource({ ...rec("o", "x.y"), updates: [{ at: "", status: "in_progress", photoIds: [], by: "Owner" }] }) === "owner"
   && S.faultSource({ ...rec("f", "x.y"), updates: [{ at: "", status: "in_progress", photoIds: [], by: "Facility manager" }] }) === "fm"
   && S.faultSource(rec("p", "x.y")) === "person");
const { lineSources } = await import("@/config/attention");
const night = groupAttention(buildAttentionItems({
  unavailableIds: ["sensor.example_temperature"],
  entities: { "sensor.example_temperature": ent("sensor.example_temperature", "unavailable"),
              "sensor.example_battery": ent("sensor.example_battery", "unavailable") },
  entityMap: {}, alertThresholds: {}, resolvedRooms: {}, selectableIds: [],
  folding: new Map([["sensor.example_battery", "sensor.example_temperature"]]),
  fmData: fm([agentRec({ id: "n1", entityId: "sensor.example_battery", origin: "night", title: "Example offline" })]) }))[0];
ck("  ...an offline device and its night check's fault: ONE line, two icons — Live (amber), Night check (red)",
   JSON.stringify(lineSources(night.items[0])) === JSON.stringify({ sources: ["live", "night"], kinds: ["unavailable", "fault"] }),
   lineSources(night.items[0]));
const I = await import("@/components/fm/sourceIcons");
const drawn = draw(h(I.SourceIcons, lineSources(night.items[0])));
ck("  ...drawn one under the other, each in its status colour, named for a screen reader",
   (drawn.match(/<svg/g) || []).length === 2 && /cockpit-attention-unavailable[\s\S]*cockpit-attention-fault/.test(drawn)
   && /aria-label="Live and Night check"/.test(drawn), drawn);
const people = draw(h(I.SourceIcons, { sources: ["owner", "fm", "guest"], kinds: ["fault"] }));
ck("  ...a profile is the top bar's badge: its letters in a circle (O, FM, G), in the line's colour",
   /source-role-badge cockpit-attention-icon cockpit-attention-fault"[^>]*>O</.test(people)
   && /source-role-badge two[^"]*"[^>]*>FM</.test(people) && /class="source-role-badge[^"]*"[^>]*>G</.test(people), people);
ck("  ...every source has its icon and its words in the (i)'s legend",
   S.ISSUE_SOURCES.every((x) => I.SOURCE_ICON[x] && I.SOURCE_WORDS[x])
   && /SOURCE_ICON\[r\.source\]/.test(readFileSync(new URL("../../src/components/fm/FaultTiming.tsx", import.meta.url), "utf8")));

console.log("\n  the Recap's readiness says what is found, never the goal over a contradiction (owner, 2026-10-14):");
const { buildReadiness } = await import("@/fm/readiness");
const noDevices = { ids: [], unavailable: [], has: () => false, deviceOf: (id) => id };
const readyWith = (tickets) => buildReadiness({}, fm(tickets), noDevices).checks.find((c) => c.id === "tickets");
const mixedOpen = readyWith([agentRec({ id: "n1", origin: "night", entityId: "x.n1" }), agentRec({ id: "n2", origin: "night", entityId: "x.n2" }),
  agentRec({ id: "a1", alertNumber: 5, entityId: "x.a1" }), { ...rec("g", "x.g"), reportedBy: "guest" },
  { ...rec("t", "x.t"), status: "in_progress" }, { ...rec("r", "x.r"), status: "resolved", resolvedAt: "2026-10-14T09:00:00Z" }]);
ck("4 faults and 1 ticket: \"4 detected faults (1 open ticket)\", where to deal with each, and the faults' source icons",
   mixedOpen.label === "4 detected faults (1 open ticket)"
   && mixedOpen.detail === 'Check the faults in "Overview", or the open tickets in "Tickets".'
   && mixedOpen.sources.join() === "guest,alert,night", mixedOpen);   // the legend's order: the Kiosk's, then the Agent's
// ⚠️ COUNTED AS DRAWN, PER DEVICE (architecture review, 2026-10-15): the pump's two faults taken on together are ONE
// ticket card in Tickets, so one open ticket — not "2 open tickets" over one card
const pumpBy = (devs) => buildReadiness({}, fm([{ ...rec("p1", "switch.pump"), status: "in_progress" },
  { ...rec("p2", "sensor.pump_power"), status: "in_progress" }, rec("p3", "sensor.pump_temp")]),
  { ...noDevices, deviceOf: devs }).checks.find((c) => c.id === "tickets");
const onePump = pumpBy((id) => (id.includes("pump") ? "switch.pump" : id));
ck("  ...counted per device, as drawn: one device's 2 tickets + 1 fault = \"1 detected fault (1 open ticket)\"",
   onePump.label === "1 detected fault (1 open ticket)" && onePump.state === "warn", onePump);
ck("  ...and three devices are three", pumpBy((id) => id).label === "1 detected fault (2 open tickets)", pumpBy((id) => id));
const onlyFaults = readyWith([agentRec({ id: "n1", origin: "night" })]);
ck("  ...one fault, no ticket: singular, and only Overview", onlyFaults.label === "1 detected fault (0 open tickets)"
   && onlyFaults.detail === 'Check the faults in "Overview".', onlyFaults);
const onlyTickets = readyWith([{ ...rec("t", "x.y"), status: "in_progress" }]);
ck("  ...tickets only: no icon, only Tickets", onlyTickets.detail === 'Check the open tickets in "Tickets".' && onlyTickets.sources.length === 0, onlyTickets);
const allClear = readyWith([]);
ck("  ...nothing open: the goal is met, and said once", allClear.state === "pass" && allClear.label === "No open faults or tickets"
   && allClear.detail === "Nothing to deal with.", allClear);
{
  const { ReadinessChecks } = await import("@/components/fm/ReadinessTab");
  const result = { checks: [mixedOpen], passed: 0, total: 1, overall: "warn" };
  const checks = (startOpen) => draw(h(ReadinessChecks, { readiness: result, label: (id) => id, onOpenEntity: () => {}, onOpenCheck: () => {}, ...(startOpen ? { startOpen } : {}) }));
  ck("  ...the Recap draws those icons in the line, after \"Check the\"",
     text(checks(true)).includes('|Check the |G|[icon][icon]| faults in "Overview", or the open tickets in "Tickets".|'), text(checks(true)));
  const folded = checks();   // as the tab draws it: no startOpen
  ck("  ...the checks fold under their verdict, closed at first; a tap on the verdict opens them (owner, 2026-10-14)",
     /class="fm-headline-toggle" aria-expanded="false"/.test(folded) && text(folded).includes("|Ready, with things worth fixing|0 of 1 checks passing|")
     && !folded.includes("4 detected faults") && checks(true).includes("4 detected faults")
     // its chevron right after the words (owner, 2026-10-14), not pushed to the far end — a stylesheet rule
     && /\.fm-headline-toggle > svg \{ flex: 0 0 auto; color/.test(readFileSync(new URL("../../src/styles/07-facility.css", import.meta.url), "utf8")), text(folded));
}

const recent = readFileSync(new URL("../../src/components/fm/RecentWorkList.tsx", import.meta.url), "utf8");
const ticketsTab = readFileSync(new URL("../../src/components/fm/TicketsTab.tsx", import.meta.url), "utf8");
ck("lists that only grow are ONE folded, paged list (owner, 2026-10-14): Tickets' Closed and Schedule's Recent work",
   /<FoldedList title="Closed" rows=\{closed\}/.test(ticketsTab) && /<FoldedList title="Recent work" rows=\{rows\}/.test(recent)
   && !/usePaged|<Pager|\.slice\(0, limit\)/.test(recent + ticketsTab));

// a ticket's card AS DRAWN (pill on the title line, buttons inside on the right): tests/oracles/cockpit_cards.mjs; its
// buttons as drawn: "the buttons, drawn" below. WIRING the Tickets tab alone holds (it needs the Facility data to render):
ck("a ticket is ONE card: the first record carries the pill and the ticket's buttons, the closed one its Reopen, no device name above",
   /<div key=\{g\.key\} className="fm-record-card">/.test(ticketsTab) && /record\(t, i === 0 \? \{ text: "In progress", tone: "due-soon" \} : undefined,\s*i === 0 \? <WorkButtons actions=\{ticketActions\(g\.records\.map\(workRecord\)\)\}/.test(ticketsTab)
   && /record\(t, \{ text: "Resolved", tone: "ok" \},\s*<WorkButtons actions=\{closedActions\(workRecord\(t\)\)\}/.test(ticketsTab)
   && !/const title = head\.entityId/.test(ticketsTab));
const spendTab = readFileSync(new URL("../../src/components/fm/SpendTab.tsx", import.meta.url), "utf8");
const todayTab = readFileSync(new URL("../../src/components/fm/TodayTab.tsx", import.meta.url), "utf8");
ck("ONE card for every Cockpit list (architecture review, 2026-10-15): Overview, Tickets, Schedule, Spend, Recent work draw RecordCard, nothing of their own",
   [ticketsTab, recent, spendTab, todayTab].every((f) => /<RecordCard /.test(f)) && /<RecordCard\s/.test(ov)
   && !/<ErasableRow|<RecordMeta|fm-document-link|className=\{`fm-row state-/.test(ticketsTab + recent + spendTab + todayTab)
   && !/cockpit-attention-(item|row|detail|actions)/.test(ov));
ck("  ...and Recent work is the SCHEDULED work: a ticket's repair is told on its closed card",
   /\.filter\(\(c\) => completionSource\(data, c\)\.kind === "schedule"\)/.test(recent)
   && /const work = data\.completions\.find\(\(c\) => c\.ticketId === t\.id && c\.costId\);/.test(ticketsTab));

ck("a card's \"Opened … by …\" stays on its pills' line and wraps there (owner, 2026-10-15)",
   /\.fm-meta-when \{ font-size: var\(--text-xs\); flex: 1 1 0; min-width: 14em; \}/.test(readFileSync(new URL("../../src/styles/07-facility.css", import.meta.url), "utf8")));

console.log("\n  a line from Telegram is never a status change (architecture review, 2026-10-15):");
// the villa's case: open 23:40 on 30 Sep, reminder 23:50, taken on 00:10 on 1 Oct — the reminder's line written after
const late = { ...rec("m", "x.y"), status: "in_progress", openedAt: "2026-09-30T15:40:00Z", updates: [
  { at: "2026-09-30T15:40:00Z", status: "open", photoIds: [] },
  { at: "2026-09-30T16:10:00Z", status: "in_progress", by: "Facility manager", note: "On my way", photoIds: [] },
  { at: "2026-09-30T15:50:00Z", status: "in_progress", kind: "noted", note: "Reminder sent to Facility Manager", photoIds: [] }] };
ck("a fault still OPEN at month end is open in that month's report, whatever line Telegram added after",
   E.ticketAt(late, "2026-09-30T15:55:00Z").status === "open" && E.ticketAt(late, "2026-09-30T16:30:00Z").status === "in_progress",
   [E.ticketAt(late, "2026-09-30T15:55:00Z"), E.ticketAt(late, "2026-09-30T16:30:00Z")]);
const N2 = await import("@/fm/faultNotes");
ck("  ...and the card's notes read in time order (the reminder before the take-on)",
   N2.faultNoteLines(late, (a) => a.slice(11, 16)).join("|") === "Reminder sent to Facility Manager (15:50)|On my way (16:10)",
   N2.faultNoteLines(late, (a) => a.slice(11, 16)));
const resolvedLate = { ...late, status: "resolved", resolvedAt: "2026-09-30T17:40:00Z", updates: [...late.updates,
  { at: "2026-09-30T17:40:00Z", status: "resolved", photoIds: [] },
  { at: "2026-09-30T17:45:00Z", status: "resolved", kind: "retitled", title: "t", was: "s", photoIds: [] }] };
ck("  ...the time open counts status changes only: 2 h, never a title or a Telegram line",
   E.openTimeMs(resolvedLate) === 2 * 3600 * 1000 && E.statusChanges(resolvedLate).every((u) => !["noted", "retitled", "reading"].includes(u.kind)),
   E.openTimeMs(resolvedLate));

console.log("\n  what happened on Telegram, on the card (owner, 2026-10-14: reminders, escalation, Need help):");
const N = await import("@/fm/faultNotes");
const told = { ...rec("s", "switch.pump"), status: "open", updates: [
  { at: "2026-10-14T08:00:00.000Z", status: "open", photoIds: [], title: "fault s" },
  { at: "2026-10-14T08:49:00.000Z", status: "open", photoIds: [], kind: "noted", note: "Escalation sent to Owner" },
  { at: "2026-10-14T09:10:00.000Z", status: "open", photoIds: [], kind: "noted", note: "🆘 Need help pressed by Fabien" }] };
const reopenedThenTold = { ...told, updates: [{ at: "2026-10-13T08:00:00.000Z", status: "resolved", photoIds: [] },
  { at: "2026-10-14T07:00:00.000Z", status: "open", photoIds: [], kind: "reopened", by: "Owner" }, ...told.updates.slice(1)] };
const withLatest = buildAttentionItems({ unavailableIds: [], entities: {}, entityMap: {}, alertThresholds: {}, resolvedRooms: {},
  selectableIds: [], folding: new Map(), fmData: fm([told]) });
ck("the card's line under the fault: the LAST thing Telegram said, with its time",
   withLatest[0].latest?.note === "🆘 Need help pressed by Fabien" && withLatest[0].latest.at === "2026-10-14T09:10:00.000Z", withLatest[0].latest);
ck("  ...a noted line is never a status change: \"reopened by Owner\" still read under it",
   N.statusSteps(reopenedThenTold).every((u) => u.kind !== "noted") && /reopened .* by Owner/.test(N.faultWhen(reopenedThenTold, (a) => a.slice(11, 16))),
   N.faultWhen(reopenedThenTold, (a) => a.slice(11, 16)));
ck("  ...and each one is a note in the Tickets tab, with its time",
   N.faultNoteLines(told, (a) => a.slice(11, 16)).join("|") === "Escalation sent to Owner (08:49)|🆘 Need help pressed by Fabien (09:10)",
   N.faultNoteLines(told, (a) => a.slice(11, 16)));
{
  const { AttentionCard } = await import("@/components/cockpit/CockpitOverview");
  const card = draw(h(AttentionCard, { group: groupAttention(withLatest)[0], onOpenEntity: () => {}, cadence: { checkMinutes: 5, nightlyAt: "02:00" } }));
  ck("  ...shown on the Overview card, under the fault's line", /fault s[\s\S]*class="cockpit-attention-latest">🆘 Need help pressed by Fabien · /.test(card), text(card));
}

console.log("\n  the screens:");
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const tt = src("components/fm/TicketsTab.tsx");
// what ticketCards lists is checked by value above ("Tickets lists the device whose ticket was opened last first");
// here, that the tab draws it — and counts it (openCounts: the same cards)
ck("the Tickets tab draws ticketCards — the tickets in progress, by device — and Closed; never a raise form",
   /ticketCards\(data\.tickets, deviceOf\)/.test(tt) && /openCounts\(data\.tickets, deviceOf\)\.tickets/.test(tt) && !/Raise a fault/.test(tt));
ck("the Overview's title line: the (i) then Open a ticket, for the profiles that manage tickets; a guest reports a problem",
   /<FaultTiming \/>\s*<button className="btn ghost" onClick=\{\(\) => setRaising\(\{\}\)\}><Plus size=\{16\} \/> Open a ticket<\/button>/.test(ov) && /Report a problem<\/button>/.test(ov) && /<FaultForm /.test(ov));
// WHAT the buttons are, on which records, with which question: by value at the top and in "the buttons, drawn".
// Here only the wiring a drawing cannot reach — the Overview hands cardActions to the shared buttons, and acts on
// what each button names (its stage, its records), with no status or rule of its own
ck("a card draws what cardActions says (no rule of its own)",
   /const acts = cardActions\(group\);/.test(ov) && /<WorkButtons actions=\{acts\} cardKey=\{group\.key\} closer=\{closer\}/.test(ov)
   && /a\.step\.kind === "stage" \? setStaging\(\{ tickets: records\(a\.ids\), to: a\.step\.to \}\) : onEditTicket\(a\.ids\[0\]\)/.test(ov)
   && !/closeTickets|InlineConfirm|in_progress"|"resolved"/.test(ov + tt));

console.log("\n  the buttons, drawn — ONE close-with-confirm for both tabs:");
{
  const { default: WorkButtons } = await import("@/components/fm/WorkButtons");
  const closer = (asking) => ({ asking, problemFor: () => null, ask: () => {}, cancel: () => {}, close: async () => {} });
  const drawButtons = (actions, asking = null, extra = {}) => draw(h(WorkButtons,
    { actions, cardKey: "device:x", closer: closer(asking), onAction: () => {}, ...extra }));
  const ovActs = cardActions(pump), tkActs = W.ticketActions([{ id: "a", stage: "ticket" }]);
  ck("an Overview card: Open Ticket with its wrench, Close with its cross, in their row, Close named for a screen reader",
     /^<div class="fm-fault-actions">/.test(drawButtons(ovActs, null, { name: "Pump", className: "fm-fault-actions" }))
     && text(drawButtons(ovActs, null, { name: "Pump" })) === "|[icon] Open Ticket|[icon] Close|"
     && /aria-label="Close “Pump”"/.test(drawButtons(ovActs, null, { name: "Pump" })), text(drawButtons(ovActs)));
  ck("  ...a ticket: Mark resolved and Close, no icon; a closed record: Reopen",
     text(drawButtons(tkActs)) === "|Mark resolved|Close|" && text(drawButtons(W.closedActions({ id: "r", stage: "closed" }))) === "|Reopen|", text(drawButtons(tkActs)));
  ck("  ...its Close asks ITS question in place of the buttons — the Overview's for the device, the ticket's for the ticket",
     text(drawButtons(ovActs, "device:x")) === "|Close this? No action needed.|Cancel|Close|"
     && text(drawButtons(tkActs, "device:x")) === "|Close this ticket? Nothing was done — no cost is recorded.|Cancel|Close ticket|",
     [text(drawButtons(ovActs, "device:x")), text(drawButtons(tkActs, "device:x"))]);
  ck("  ...another card's question leaves this one's buttons; a card with nothing to act on draws nothing",
     text(drawButtons(tkActs, "device:y")) === "|Mark resolved|Close|" && drawButtons([]) === "");
}
ck("a ticket's notes wrap inside its card, never past its edge (owner, 2026-10-14: a long \"VESTA reads\" ran out)",
   /\.fm-record-body > \.fm-row-main \{ flex: 1 1 260px; min-width: 0; \}/.test(src("styles/07-facility.css"))
   && /\.fm-timeline-note \{[^}]*overflow-wrap: anywhere;/.test(src("styles/07-facility.css")));
console.log("\n  one line per problem (owner, 2026-10-17: \"#49 · One mains phase lost\" six times):");
{
  const { AttentionCard } = await import("@/components/cockpit/CockpitOverview");
  const lost = (id) => ({ ...rec(id, "sensor.phase_a_voltage,sensor.phase_b_voltage"), title: "One mains phase lost", alertNumber: 49 });
  const six = ["a", "b", "c", "d", "e", "f"].map(lost);
  const ents = { "sensor.phase_b_voltage": { entity_id: "sensor.phase_b_voltage", state: "230", attributes: { friendly_name: "Phase B Voltage" } } };
  const items = buildAttentionItems({ unavailableIds: [], entities: ents, entityMap: {}, alertThresholds: {}, resolvedRooms: {},
    selectableIds: [], folding: new Map(), fmData: fm([...six, { ...rec("g", "lock.door"), title: "Door unlocked" }]) });
  const groups = groupAttention(items);
  const g = groups.find((x) => x.items.some((i) => i.title.includes("phase lost")));
  const card = draw(h(AttentionCard, { group: g, onOpenEntity: () => {}, cadence: { checkMinutes: 5, nightlyAt: "02:00" } }));
  const said = text(card);
  ck("six records saying the same are ONE line, counted", (said.match(/#49 · One mains phase lost/g) || []).length === 1
     && /#49 · One mains phase lost \(6 times\)/.test(said), said);
  ck("  ...and its card's buttons still reach all six", cardRecords(g).length === 6, cardRecords(g));
  ck("  ...a different problem keeps its own line", groups.some((x) => x.items.some((i) => i.title === "Door unlocked")));
  ck("a record naming several devices (\"a,b\") is the first the villa has, never a device called \"…,sensor\"",
     g.entityId === "sensor.phase_b_voltage" && !/,sensor/.test(g.title), g.entityId, g.title);
}

ck("the screens ask stageOf (or its count, openCounts), never the status themselves",
   ["components/fm/TicketsTab.tsx", "components/fm/FaultForm.tsx", "components/fm/TodayTab.tsx"].every((f) => /stageOf\(|openCounts\(/.test(src(f)) && !/status === "in_progress"|status !== "in_progress"|status === "open"/.test(src(f))));
ck("the fault form is one, shared by raising and editing", /<FaultForm key=\{editing\.id\} editing=\{editing\}/.test(tt) && !/<input value=\{title\}/.test(ov + tt));

done("✅ one list of live issues; faults become tickets; the same with or without the Agent");
