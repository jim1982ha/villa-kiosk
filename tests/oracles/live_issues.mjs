// The Overview's Live issues and the Tickets tab (owner, 2026-10-14): ONE list of everything open on the Overview, a
// card per device — what Home Assistant reports right now (no buttons: it clears when the device does), faults the
// VESTA Agent or a person opened, tickets in progress. "Open ticket" (was "Mark in progress") makes a card's faults ONE ticket (each still
// its own record, so the Agent can clear one alone), "Edit ticket" then opens it in the Tickets tab, which holds the
// tickets in progress and the Closed ones. It replaced "Needs attention" and the Faults tab's open list (the same
// faults twice). The same with or without the Agent: only where faults come from differs.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const E = await import("@/fm/fmEngine");
const { ticketGroups } = await import("@/fm/ticketGroups");
const { groupAttention, cardActions, attentionLineIn } = await import("@/config/attention");
const { screenReducer, START } = await import("@/pages/screen");

const k = { now: "2026-10-14T10:00:00.000Z", id: (p) => `${p}-${Math.random().toString(36).slice(2, 8)}` };
const rec = (id, entityId, status = "open") => ({ id, title: `fault ${id}`, status, openedAt: "2026-10-14T08:00:00.000Z", entityId, photoIds: [] });
const fm = (tickets) => ({ schedules: [], completions: [], costs: [], tickets, savedDocuments: [] });
// the pump's power and energy sensors are ONE device; the lock is another
const deviceOf = (id) => (id === "sensor.pump_energy" ? "sensor.pump_power" : id);

console.log("  a card's buttons are its faults' only:");
const item = (id, kind, entityId, extra = {}) => ({ id, kind, title: id, detail: "", entityId, device: { key: deviceOf(entityId), label: "dev" }, ...extra });
const [pump] = groupAttention([
  item("unavailable:sensor.pump_power", "unavailable", "sensor.pump_power"),
  item("fault:a", "fault", "sensor.pump_energy", { ticketId: "a", stage: "fault" }),
  item("fault:b", "fault", "sensor.pump_power", { ticketId: "b", stage: "ticket" }),
]);
const acts = cardActions(pump);
ck("a device's live state and its faults are ONE card", pump.items.length >= 2 && acts.close.length === 2, pump.items.map((i) => i.id));
ck("  ...Mark in progress takes on its fault (adding it to the ticket); Close closes both",
   acts.markInProgress.join() === "a" && acts.editTicket === null && acts.close.sort().join() === "a,b", acts);
const [taken] = groupAttention([item("fault:b", "fault", "sensor.pump_power", { ticketId: "b", stage: "ticket" })]);
ck("  ...once every fault is a ticket, the button is Edit ticket, on that record",
   cardActions(taken).markInProgress.length === 0 && cardActions(taken).editTicket === "b");
const [lock] = groupAttention([item("alarm:lock.door", "alarm", "lock.door")]);
ck("a card that is only what Home Assistant reports has nothing to act on — no button", cardActions(lock) === null);

console.log("\n  one answer to \"fault, ticket or closed\":");
ck("open → fault, in progress → ticket, resolved → closed",
   E.stageOf({ status: "open" }) === "fault" && E.stageOf({ status: "in_progress" }) === "ticket" && E.stageOf({ status: "resolved" }) === "closed");
ck("  ...a status this build does not know is a FAULT — never hidden, never closed", E.stageOf({ status: "escalated" }) === "fault" && E.stageOf({}) === "fault");
const odd = fm([{ ...rec("z", "lock.door"), status: "escalated" }]);
ck("  ...counted as an open fault, listed on the Overview, absent from Tickets",
   E.ticketStats(odd.tickets).open === 1 && E.fmAttention(odd).unresolved.length === 1
   && ticketGroups(odd.tickets.filter((t) => E.stageOf(t) === "ticket"), deviceOf).length === 0);

console.log("\n  Mark in progress: one ticket per device, each fault its own record:");
let d = fm([rec("a", "sensor.pump_energy"), rec("b", "sensor.pump_power"), rec("c", "lock.door")]);
d = E.withTicketsAdvanced(d, ["a", "b"], "in_progress", { who: "Wayan", photoIds: [] }, undefined, k, "Owner");
const inProg = d.tickets.filter((t) => t.status === "in_progress");
ck("both of the pump's faults are in progress, in one edit; the lock's is untouched",
   inProg.map((t) => t.id).sort().join() === "a,b" && d.tickets.find((t) => t.id === "c").status === "open");
const groups = ticketGroups(inProg, deviceOf);
ck("  ...and the Tickets tab shows them as ONE ticket for the pump", groups.length === 1 && groups[0].records.length === 2, groups);
const resolved = E.withTicketsAdvanced(d, ["a", "b"], "resolved", { photoIds: [] }, { amountIdr: 100, category: "minor", label: "x" }, k);
ck("resolving the ticket files its cost ONCE", resolved.costs.length === 1 && resolved.tickets.filter((t) => t.status === "resolved").length === 2);

console.log("\n  the Agent clears one problem of a ticket:");
const oneCleared = E.withTicketClosed(d, "a", k, undefined);
const left = ticketGroups(oneCleared.tickets.filter((t) => t.status === "in_progress"), deviceOf);
ck("that record closes; the ticket stays in progress for the other", left.length === 1 && left[0].records.map((t) => t.id).join() === "b");
const both = E.withTicketsClosed(oneCleared, ["b"], k);
ck("  ...and with its last one it goes to Closed", ticketGroups(both.tickets.filter((t) => t.status === "in_progress"), deviceOf).length === 0
   && both.tickets.filter(E.isTicketResolved).map((t) => t.id).sort().join() === "a,b");
ck("a fault on no device is a ticket of its own", ticketGroups([rec("x", undefined, "in_progress"), rec("y", undefined, "in_progress")], deviceOf).length === 2);

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
const { buildAttentionItems } = await import("@/config/attention");
const numbered = buildAttentionItems({ unavailableIds: [], entities: {}, entityMap: {}, alertThresholds: {}, resolvedRooms: {},
  selectableIds: [], folding: new Map(),
  fmData: fm([{ ...rec("n", "switch.pump"), title: "House Pump Power has not run", alertNumber: 5 }, rec("p", "lock.door")]) });
ck("a fault from a VESTA Agent alert reads \"#5 · …\" on its card; one without a number, its title alone",
   numbered.find((i) => i.ticketId === "n")?.title === "#5 · House Pump Power has not run" && numbered.find((i) => i.ticketId === "p")?.title === "fault p",
   numbered.map((i) => i.title));
ck("  ...and the same in the Tickets tab", /<strong>\{faultTitle\(t\)\}<\/strong>/.test(readFileSync(new URL("../../src/components/fm/TicketsTab.tsx", import.meta.url), "utf8")));
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
ck("  ...its Close and Open ticket still act on it", cardActions(one)?.close.join() === "off");
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
   && S.faultSource(agentRec({ alertNumber: 5 })) === "alert" && S.faultSource(agentRec({})) === "agent"
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
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const I = await import("@/components/fm/sourceIcons");
const drawn = renderToStaticMarkup(React.createElement(I.SourceIcons, lineSources(night.items[0])));
ck("  ...drawn one under the other, each in its status colour, named for a screen reader",
   (drawn.match(/<svg/g) || []).length === 2 && /cockpit-attention-unavailable[\s\S]*cockpit-attention-fault/.test(drawn)
   && /aria-label="Live and Night check"/.test(drawn), drawn);
const people = renderToStaticMarkup(React.createElement(I.SourceIcons, { sources: ["owner", "fm", "guest"], kinds: ["fault"] }));
ck("  ...a profile is the top bar's badge: its letters in a circle (O, FM, G), in the line's colour",
   /source-role-badge cockpit-attention-icon cockpit-attention-fault"[^>]*>O</.test(people)
   && /source-role-badge two[^"]*"[^>]*>FM</.test(people) && /class="source-role-badge[^"]*"[^>]*>G</.test(people), people);
ck("  ...every source has its icon and its words in the (i)'s legend",
   S.ISSUE_SOURCES.every((x) => I.SOURCE_ICON[x] && I.SOURCE_WORDS[x])
   && /SOURCE_ICON\[r\.source\]/.test(readFileSync(new URL("../../src/components/fm/FaultTiming.tsx", import.meta.url), "utf8")));

console.log("\n  the Recap's readiness says what is found, never the goal over a contradiction (owner, 2026-10-14):");
const { buildReadiness } = await import("@/fm/readiness");
const noDevices = { ids: [], unavailable: [], has: () => false };
const readyWith = (tickets) => buildReadiness({}, fm(tickets), noDevices).checks.find((c) => c.id === "tickets");
const mixedOpen = readyWith([agentRec({ id: "n1", origin: "night" }), agentRec({ id: "n2", origin: "night" }),
  agentRec({ id: "a1", alertNumber: 5 }), { ...rec("g", "x.y"), reportedBy: "guest" },
  { ...rec("t", "x.y"), status: "in_progress" }, { ...rec("r", "x.y"), status: "resolved", resolvedAt: "2026-10-14T09:00:00Z" }]);
ck("4 faults and 1 ticket: \"4 detected faults (1 open ticket)\", where to deal with each, and the faults' source icons",
   mixedOpen.label === "4 detected faults (1 open ticket)"
   && mixedOpen.detail === 'Check the faults in "Overview", or the open tickets in "Tickets".'
   && mixedOpen.sources.join() === "alert,night,guest", mixedOpen);
const onlyFaults = readyWith([agentRec({ id: "n1", origin: "night" })]);
ck("  ...one fault, no ticket: singular, and only Overview", onlyFaults.label === "1 detected fault (0 open tickets)"
   && onlyFaults.detail === 'Check the faults in "Overview".', onlyFaults);
const onlyTickets = readyWith([{ ...rec("t", "x.y"), status: "in_progress" }]);
ck("  ...tickets only: no icon, only Tickets", onlyTickets.detail === 'Check the open tickets in "Tickets".' && onlyTickets.sources.length === 0, onlyTickets);
const allClear = readyWith([]);
ck("  ...nothing open: the goal is met, and said once", allClear.state === "pass" && allClear.label === "No open faults or tickets"
   && allClear.detail === "Nothing to deal with.", allClear);
const tab = readFileSync(new URL("../../src/components/fm/ReadinessTab.tsx", import.meta.url), "utf8");
ck("  ...the Recap draws those icons in the line, after \"Check the\"",
   /<CheckDetail check=\{c\} \/>/.test(tab) && /Check the <SourceIconRow sources=\{check\.sources\} \/> faults/.test(tab));

ck("  ...the checks fold under their verdict, closed at first; a tap on the verdict opens them (owner, 2026-10-14)",
   /const \[showChecks, setShowChecks\] = useState\(false\);/.test(tab) && /\{showChecks && <div className="fm-list">/.test(tab)
   && /className="fm-headline-toggle" aria-expanded=\{showChecks\}\s*onClick=\{\(\) => setShowChecks\(\(v\) => !v\)\}/.test(tab));

const recent = readFileSync(new URL("../../src/components/fm/RecentWorkList.tsx", import.meta.url), "utf8");
const ticketsTab = readFileSync(new URL("../../src/components/fm/TicketsTab.tsx", import.meta.url), "utf8");
ck("lists that only grow are ONE folded, paged list (owner, 2026-10-14): Tickets' Closed and Schedule's Recent work",
   /<FoldedList title="Closed" rows=\{closed\}/.test(ticketsTab) && /<FoldedList title="Recent work" rows=\{rows\}/.test(recent)
   && !/usePaged|<Pager|\.slice\(0, limit\)/.test(recent + ticketsTab));

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
ck("  ...shown on the Overview card", /item\.latest \?\? item\.fault\?\.latest/.test(ov) && /cockpit-attention-latest/.test(ov));

console.log("\n  the screens:");
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const tt = src("components/fm/TicketsTab.tsx");
ck("the Tickets tab lists the tickets in progress (by device) and Closed — never an open fault",
   /data\.tickets\.filter\(\(t\) => stageOf\(t\) === "ticket"\)/.test(tt) && /ticketGroups\(/.test(tt) && !/Raise a fault/.test(tt));
ck("the Overview's title line: the (i) then Open a ticket, for the profiles that manage tickets; a guest reports a problem",
   /<FaultTiming \/>\s*<button className="btn ghost" onClick=\{\(\) => setRaising\(\{\}\)\}><Plus size=\{16\} \/> Open a ticket<\/button>/.test(ov) && /Report a problem<\/button>/.test(ov) && /<FaultForm /.test(ov));
ck("a card draws what cardActions says (no rule of its own)",
   /const acts = cardActions\(group\);/.test(ov) && /setStaging\(records\(acts\.markInProgress\)\)\}><Wrench size=\{14\} aria-hidden \/> Open Ticket</.test(ov)
   && /onEditTicket\(acts\.editTicket as string\)\}><Pencil size=\{14\} aria-hidden \/> Edit Ticket</.test(ov)
   && /onEditTicket\(acts\.editTicket as string\)/.test(ov) && /closeTickets\(acts\.close\)/.test(ov) && !/in_progress"/.test(ov.replace(/to="in_progress"/, "")));
ck("a card's lines on the left, its buttons on the right of the same line (owner, 2026-10-14)",
   /<div className="cockpit-attention-detail">\s*<ul className="cockpit-attention-subs">[\s\S]*?<\/ul>\s*\{actions\}\s*<\/div>/.test(ov)
   && /\.cockpit-attention-detail \{ display: flex;/.test(readFileSync(new URL("../../src/styles/08-shared.css", import.meta.url), "utf8")));
ck("a ticket's notes wrap inside its card, never past its edge (owner, 2026-10-14: a long \"VESTA reads\" ran out)",
   /\.fm-fault \.fm-row-main \{ flex: 1 1 100%; min-width: 0; \}/.test(src("styles/07-facility.css"))
   && /\.fm-timeline-note \{[^}]*overflow-wrap: anywhere;/.test(src("styles/07-facility.css")));
ck("the screens ask stageOf, never the status themselves",
   ["components/fm/TicketsTab.tsx", "components/fm/FaultForm.tsx", "components/fm/TodayTab.tsx"].every((f) => /stageOf\(/.test(src(f)) && !/status === "in_progress"|status !== "in_progress"|status === "open"/.test(src(f))));
ck("the fault form is one, shared by raising and editing", /<FaultForm key=\{editing\.id\} editing=\{editing\}/.test(tt) && !/<input value=\{title\}/.test(ov + tt));

done("✅ one list of live issues; faults become tickets; the same with or without the Agent");
