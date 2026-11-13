// The Overview's Live issues and the Tickets tab (owner, 2026-10-14): ONE list of everything open on the Overview, a
// card per device — what Home Assistant reports right now (no buttons: it clears when the device does), faults the
// VESTA Agent or a person opened, tickets in progress. "Open ticket" (was "Mark in progress") makes a card's faults ONE ticket (each still
// its own record, so the Agent can clear one alone), "Edit ticket" then opens it in the Tickets tab, which holds the
// tickets in progress and the Closed ones. It replaced "Needs attention" and the Faults tab's open list (the same
// faults twice). The same with or without the Agent: only where faults come from differs.
// Where a check can draw what it is about it does (tests/consistency/screen.mjs); the source-text checks left are
// wiring that needs the Facility data or the page to draw (said where), and stylesheet rules.
import { readFileSync, readdirSync } from "node:fs";
import { h, draw, text } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
import { devicesOf } from "../consistency/devices.mjs";
const E = await import("@/fm/fmEngine");
const W = await import("@/fm/deviceWork");
const { cockpitCard } = await import("@/config/cockpitCard");
const { groupAttention, attentionOf } = await import("@/config/attention");
// a card as the Overview draws it (cockpitCard) — its buttons, the records its Close reaches, its lines' words
const cardActions = (g) => cockpitCard(g, null).lines.flatMap((l) => l.actions);
const cardRecords = (g) => cockpitCard(g, null).lines.flatMap((l) => l.records.map((r) => r.id));
const lineText = (g, n = 0) => cockpitCard(g, null).lines[n]?.text;
const { screenReducer, START } = await import("@/pages/screen");

const k = { now: "2026-10-14T10:00:00.000Z", id: (p) => `${p}-${Math.random().toString(36).slice(2, 8)}` };
const rec = (id, entityId, status = "open") => ({ id, title: `fault ${id}`, status, openedAt: "2026-10-14T08:00:00.000Z", entityId, photoIds: [] });
const fm = (tickets) => ({ schedules: [], completions: [], costs: [], tickets, savedDocuments: [] });
// the pump's power and energy sensors are ONE device; the lock is another
const deviceOf = (id) => (id === "sensor.pump_energy" ? "sensor.pump_power" : id);

console.log("  a card's buttons are its faults' only (fm/deviceWork, architecture review 2026-10-16):");
const item = (id, kind, entityId, extra = {}) => ({ id, kind, title: id, detail: "", entityId, device: { key: deviceOf(entityId), label: "dev" }, ...extra });
// a card's buttons as the owner reads them: "label → the records it acts on [what it asks first]"
const said = (acts) => acts.map((a) => `${a.label} → ${[...a.ids].sort().join(",")}${a.step.kind === "close" ? (a.step.ask ? ` [${a.step.ask.question} / ${a.step.ask.confirmLabel}]` : " [closes as pressed]") : ""}${a.step.kind === "stage" ? ` (${a.step.to})` : ""}`);
// owner, 2026-10-30: Done · Need help · Open Ticket on every issue card, one Done closing everything on it; owner,
// 2026-11-05: in the order Done · Not a problem · Open Ticket · Need help, on the tablet and on Telegram
const OV_DONE = "[closes as pressed]", TK_CLOSE = "[Close this ticket? Nothing was done, no cost is recorded. / No action needed]";
// owner, 2026-11-04: Not a problem is a button of its own, after Need help, its label short, its meaning in its question
// owner, 2026-11-04: "When I click 'ignore' I don't want to see the confirmation message since it's redundant"
const NAP = "[closes as pressed]";
const [pump] = groupAttention([
  item("unavailable:sensor.pump_power", "unavailable", "sensor.pump_power"),
  item("fault:a", "fault", "sensor.pump_energy", { ticketId: "a", stage: "fault" }),
  item("fault:b", "fault", "sensor.pump_power", { ticketId: "b", stage: "ticket" }),
]);
const acts = cardActions(pump);
ck("a device's live state and its faults are ONE card", pump.items.length >= 2 && cardRecords(pump).length === 2, pump.items.map((i) => i.id));
// owner, 2026-11-01: "for each issue of a potential merged cards", Edit Ticket where a ticket is open
ck("  ...each problem its own buttons: the ticket's Edit Ticket, the fault's Open Ticket, each Done and Need help on its record alone",
   said(acts).join(" | ") === `Done → b ${OV_DONE} | Edit Ticket → b | Need help → b | Done → a ${OV_DONE} | Not a problem → a ${NAP} | Open Ticket → a (in_progress) | Need help → a`, said(acts));
const [taken] = groupAttention([item("fault:b", "fault", "sensor.pump_power", { ticketId: "b", stage: "ticket" }),
  item("fault:c", "fault", "sensor.pump_energy", { ticketId: "c", stage: "ticket" })]);
ck("  ...two tickets: Edit Ticket on each",
   said(cardActions(taken)).join(" | ") === `Done → b ${OV_DONE} | Edit Ticket → b | Need help → b | Done → c ${OV_DONE} | Edit Ticket → c | Need help → c`, said(cardActions(taken)));
const [lock] = groupAttention([item("alarm:lock.door", "alarm", "lock.door")]);
// a card with no record: the same three for its device — Done and Need help raise its fault with the press, Open Ticket
// opens the ticket form already pointed at it (owner, 2026-10-29; 2026-10-30)
ck("a card that is only what Home Assistant reports: Done · Open Ticket · Need help, for its device",
   said(cardActions(lock)).join(" | ") === "Done → lock.door | Open Ticket → lock.door | Need help → lock.door"
   && cardActions(lock).map((a) => a.step.kind === "raiseThen" ? `raise+${a.step.then}` : a.step.kind).join() === "raise+done,raise,raise+help",
   said(cardActions(lock)));
const [lone] = groupAttention([{ id: "alarm:x", kind: "alarm", title: "Water leak", detail: "" }]);
ck("  ...a problem on no device has nothing to open a ticket for: no button", cardActions(lone).length === 0, said(cardActions(lone)));
const srcAt = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const MT = srcAt("components/cockpit/MessagesTab.tsx");
const JSX = await import("../consistency/jsx.mjs");
// the issue card's buttons, as IssueCard hands them to the one carrier of every step (WorkButtons)
const [icButtons] = JSX.elements(JSX.parseTsx("components/cockpit/IssueCard.tsx"), "WorkButtons");
// what each press does, by pressing it (fm/workPress.pressOutcome: the one answer every tab's buttons carry out)
const P = await import("@/fm/workPress");
const J = JSON.stringify;
const lockActs = cardActions(lock), byKind = (acts, kind) => acts.find((a) => a.kind === kind);
const raisedHere = (id) => ({ title: "Lock: Unlocked", entityId: id, photoIds: [] });
ck("  ...pressed, Open Ticket opens the Tickets tab's ticket form pointed at the device (the one \"Open a ticket\" form, owner 2026-11-02); Done and Need help raise it in one write, at the device's place",
   J(P.pressOutcome(byKind(lockActs, "raiseTicket"))) === J({ does: "go", go: { to: "raiseTicket", id: "lock.door" } })
   && J(P.pressOutcome(byKind(lockActs, "doneNew"), { raised: raisedHere })) === J({ does: "write", write: { kind: "raise", fault: raisedHere("lock.door"), then: "done" } })
   && J(P.pressOutcome(byKind(lockActs, "helpNew"), { raised: raisedHere })) === J({ does: "write", write: { kind: "raise", fault: raisedHere("lock.door"), then: "help" } })
   && P.pressOutcome(byKind(lockActs, "doneNew")).does === "nothing"
   && JSX.propText(icButtons, "onOpen") !== null && JSX.propText(icButtons, "raised") === "(entityId) => raisedFor({ title: card.title, lines: [line] }, place(entityId, card.title))"
   && /onRaiseTicket=\{onRaiseTicket\}/.test(MT) && !/<FaultForm /.test(MT));
// owner, 2026-10-30: the Tickets tab's "Mark resolved" is the Inbox's Done (work done, its form kept), with Need help
ck("a ticket in progress (Tickets): Close (its resolve form; owner, 2026-11-04), No action needed, Need help, never Not a problem (owner, 2026-11-04) — each on every record of it, its own Close question",
   said(W.ticketActions([{ id: "a", stage: "ticket" }, { id: "b", stage: "ticket" }])).join(" | ")
   === `Close → a,b (resolved) | No action needed → a,b ${TK_CLOSE} | Need help → a,b`
   && W.WORK_ACTIONS.ticketDone.label === "Close" && W.ticketActions([{ id: "a", stage: "ticket" }])[2].step.kind === "help");
ck("  ...a closed record: Reopen, on it alone — and nothing else on a record that is not where the card expects it",
   said(W.closedActions({ id: "r", stage: "closed" }, true)).join() === "Reopen → r (open)"
   && W.closedActions({ id: "r", stage: "fault" }, true).length === 0 && W.ticketActions([{ id: "f", stage: "fault" }]).length === 0
   && W.overviewActions([{ id: "r", stage: "closed" }]).length === 0);
ck("  ...ONE wording per action: every button of a kind says the same, whichever card draws it",
   Object.entries(W.WORK_ACTIONS).every(([kind, spec]) => [acts, cardActions(taken), W.ticketActions([{ id: "a", stage: "ticket" }]), W.closedActions({ id: "r", stage: "closed" }, true)]
     .flat().filter((a) => a.kind === kind).every((a) => a.label === spec.label && JSON.stringify(a.step) === JSON.stringify(spec.step))));

console.log("\n  one answer to \"fault, ticket or closed\":");
ck("open → fault, in progress → ticket, resolved → closed",
   E.stageOf({ status: "open" }) === "fault" && E.stageOf({ status: "in_progress" }) === "ticket" && E.stageOf({ status: "resolved" }) === "closed");
ck("  ...a status this build does not know is a FAULT — never hidden, never closed", E.stageOf({ status: "escalated" }) === "fault" && E.stageOf({}) === "fault");
const odd = fm([{ ...rec("z", "lock.door"), status: "escalated" }]);
ck("  ...counted as an open fault, listed on the Overview, absent from Tickets",
   W.openCounts(odd.tickets, deviceOf).faults === 1 && E.fmAttention(odd).unresolved.length === 1
   && W.ticketCards(odd.tickets, deviceOf).length === 0);

console.log("\n  Mark in progress: one ticket per device, each fault its own record:");
let d = fm([rec("a", "sensor.pump_energy"), rec("b", "sensor.pump_power"), rec("c", "lock.door")]);
d = E.withTicketsAdvanced(d, ["a", "b"], "in_progress", { who: "Wayan", photoIds: [] }, undefined, k, "owner");
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
  const overview = groupAttention(attentionOf({ devices: devicesOf({ folding }), entities: {}, entityMap: {}, resolvedRooms: {}, fmData: fm(records) }).attentionItems);
  const tickets = W.ticketCards(records, fold);
  const counts = W.openCounts(records, fold);
  const has = (g, kind) => cardActions(g).some((a) => a.kind === kind);
  ck("the counts are the cards: devices with a fault nobody took on; in progress = Tickets cards; open = issue cards with a Done",
     counts.faults === overview.filter((g) => cardRecords(g).some((r) => E.stageOf(records.find((x) => x.id === r)) === "fault")).length && counts.tickets === tickets.length
     && counts.total === overview.filter((g) => has(g, "done")).length
     && JSON.stringify(counts) === JSON.stringify({ faults: 3, tickets: 3, total: 5 }), { counts, overview: overview.map((g) => g.key), tickets: tickets.map((t) => t.key) });
  ck("  ...each record's card is the same device in both: a Tickets card holds exactly its Overview card's tickets",
     tickets.every((t) => { const g = overview.find((o) => o.key === t.key);
       return g && cardRecords(g).filter((id) => E.stageOf(records.find((r) => r.id === id)) === "ticket").sort().join() === t.records.map((r) => r.id).sort().join(); })
     && records.filter(E.isTicketOpen).every((t) => overview.find((g) => g.key === W.recordWorkKey(t, fold))?.items
       .some((i) => (i.fault ?? i).ticketId === t.id)),
     tickets.map((t) => [t.key, t.records.map((r) => r.id)]));
  ck("  ...the Tickets card's buttons are its records', the Overview card's each its problem's",
     said(W.ticketActions(tickets.find((t) => t.key === "device:sensor.pump_power").records.map(W.workRecord))).join(" | ")
       === `Close → p2 (resolved) | No action needed → p2 ${TK_CLOSE} | Need help → p2`
     && said(cardActions(overview.find((g) => g.key === "device:sensor.pump_power"))).join(" | ")
       === `Done → p1 ${OV_DONE} | Not a problem → p1 ${NAP} | Open Ticket → p1 (in_progress) | Need help → p1 | Done → p2 ${OV_DONE} | Edit Ticket → p2 | Need help → p2`,
     said(cardActions(overview.find((g) => g.key === "device:sensor.pump_power"))));
  ck("  ...Tickets lists the device whose ticket was opened last first, never an open fault or a closed record",
     tickets.map((t) => t.key).join() === "item:fault:n2,device:lock.back,device:sensor.pump_power", tickets.map((t) => t.key));
}

console.log("\n  a fault naming several sensors sits on ONE card, on every screen (review \"One answer per question\" #1):");
{
  // a rule watching the pump's energy and a sensor the villa no longer has: the Overview, Tickets and the counts all
  // file it under the pump — deviceGroups.recordDeviceOf, the one answer
  const { recordDeviceOf } = await import("@/config/deviceGroups");
  const folding = new Map([["sensor.pump_energy", "sensor.pump_power"]]);
  const entities = { "sensor.pump_energy": { entity_id: "sensor.pump_energy", state: "unavailable", attributes: {} } };
  const of = recordDeviceOf(folding, (id) => id in entities);
  const records = [rec("m1", "sensor.gone,sensor.pump_energy"), { ...rec("m2", "sensor.gone,sensor.pump_energy"), status: "in_progress" }];
  const overview = groupAttention(attentionOf({ devices: devicesOf({ unavailable: ["sensor.pump_energy"], folding }), entities, entityMap: {}, resolvedRooms: {}, fmData: fm(records) }).attentionItems);
  const tickets = W.ticketCards(records, of);
  ck("the Overview card, the Tickets card and every record's key are the pump's",
     records.every((t) => W.recordWorkKey(t, of) === "device:sensor.pump_power") && tickets.map((t) => t.key).join() === "device:sensor.pump_power"
     && overview.some((g) => g.key === "device:sensor.pump_power" && cardRecords(g).length === 2),
     { tickets: tickets.map((t) => t.key), overview: overview.map((g) => [g.key, cardRecords(g)]) });
  ck("  ...counted once: one device with a fault and a ticket", JSON.stringify(W.openCounts(records, of)) === JSON.stringify({ faults: 1, tickets: 1, total: 1 }),
     W.openCounts(records, of));
  ck("  ...and with its device offline, the fault knows it (it joins the device's Unavailable line)",
     attentionOf({ devices: devicesOf({ folding }), entities, entityMap: {}, resolvedRooms: {}, fmData: fm(records.slice(0, 1)) }).attentionItems.find((i) => i.id === "fault:m1")?.offline === true);
}

console.log("\n  where things land:");
const OWNER = { facility: true }, GUEST = { facility: false };
const open = { ...START, nav: { ...START.nav, panel: { entityId: "light.a" } } };
const raised = screenReducer(open, { type: "reportFault" }, OWNER);
ck("a device's wrench (owner/facility): Tickets, Open a ticket pointed at it", raised.cockpitTab === "tickets" && raised.faultFor === "light.a");
const carded = screenReducer(START, { type: "raiseTicket", id: "light.b" }, OWNER);
ck("an Inbox card's Open Ticket for a device with no record: Tickets, Open a ticket pointed at it; a guest's, nothing",
   carded.cockpitTab === "tickets" && carded.faultFor === "light.b" && screenReducer(START, { type: "raiseTicket", id: "light.b" }, GUEST) === START);
const edit = screenReducer(START, { type: "editTicket", id: "b" }, OWNER);
ck("an open issue's Edit ticket: the Tickets tab, that record's form", edit.cockpitTab === "tickets" && edit.ticketFor === "b");
ck("  ...dropped once the form has it, and when the Cockpit closes",
   screenReducer(edit, { type: "ticketEditOpened" }, OWNER).ticketFor === null
   && screenReducer(edit, { type: "closeWindow", window: "cockpit" }, OWNER).ticketFor === null);
ck("a guest's Report a problem: the guest form, on no device", screenReducer(START, { type: "reportProblem" }, GUEST).guestReportFor === "");
ck("  ...and a guest cannot be sent to the Tickets tab", screenReducer(START, { type: "editTicket", id: "b" }, GUEST).ticketFor === null);

console.log("\n  the alert's number, as Telegram writes it (owner, 2026-10-14):");
const numbered = attentionOf({ devices: devicesOf(), entities: {}, entityMap: {}, resolvedRooms: {}, fmData: fm([{ ...rec("n", "switch.pump"), title: "House Pump Power has not run", alertNumber: 5 }, rec("p", "lock.door")]) }).attentionItems;
// ⚠️ THE CHIP IS THE NAME (architecture review, 2026-11-05): "#5" is its card's strip chip, never its words again
ck("a fault from a VESTA Agent alert carries \"#5\" for its card's strip, its words its title alone; one without a number, no name",
   numbered.find((i) => i.ticketId === "n")?.title === "House Pump Power has not run" && numbered.find((i) => i.ticketId === "n")?.alertLabel === "#5"
   && numbered.find((i) => i.ticketId === "p")?.title === "fault p" && numbered.find((i) => i.ticketId === "p")?.alertLabel === undefined,
   numbered.map((i) => [i.title, i.alertLabel]));
{
  // ⚠️ ONE CARD HEAD FOR EVERY TAB (architecture review, 2026-11-13): the Inbox card and the Tickets card of the same
  // record say the same head, read by value from what each draws (cockpitCard.cardFace, ticketFace)
  const { cardFace, ticketFace, closedCards } = await import("@/config/cockpitCard");
  const taken = { ...rec("t", "switch.pump", "in_progress"), title: "House Pump Power has not run", alertNumber: 5, alertPriority: "P2",
    updates: [{ at: "2026-10-14T09:00:00.000Z", status: "in_progress", who: "Wayan", photoIds: [] }] };
  const shut = { ...rec("s", "switch.pump", "resolved"), alertNumber: 6, resolvedAt: "2026-10-14T09:30:00.000Z",
    updates: [{ at: "2026-10-14T09:30:00.000Z", status: "resolved", who: "Wayan", photoIds: [] }] };
  const head = (f) => ({ number: f.number, status: f.status.map((x) => x.text).join(" · "), when: f.when, who: f.who });
  const [row] = groupAttention(attentionOf({ devices: devicesOf(), entities: {}, entityMap: {}, resolvedRooms: {}, fmData: fm([taken]) }).attentionItems);
  const inbox = cardFace(cockpitCard(row, null)).parts[0];
  ck("  ...the Tickets card of a ticket in progress has its Inbox card's head: its alert's name, its state, its time, who moved it",
     JSON.stringify(head(ticketFace(taken))) === JSON.stringify(head(inbox)) && inbox.number === "#5-P2" && inbox.status[0]?.text === "Ticket in progress"
     && ticketFace(taken).title === "House Pump Power has not run", [head(ticketFace(taken)), head(inbox)]);
  const [closed] = closedCards(fm([shut]), null, new Date("2026-10-15T00:00:00.000Z"),
    { devices: { deviceOf: (id) => id, isHidden: () => false }, entities: {}, entityMap: {}, resolvedRooms: {}, may: () => true });
  const under = closed && cardFace(closed).parts[0];
  ck("  ...and a closed one, under Closed in both tabs",
     !!under && JSON.stringify(head(ticketFace(shut))) === JSON.stringify(head(under)) && /Wayan/.test(under.who ?? ""), [head(ticketFace(shut)), under && head(under)]);
  ck("  ...a ticket's records after its first say neither its state nor who moved it again", ticketFace(taken, false).status.length === 0 && ticketFace(taken, false).who === null);
}
ck("  ...with its priority, named as Telegram names it (agent-contract.json ticket.alertLabel): \"#5-P2 · …\" (owner, 2026-10-28)",
   E.faultTitle({ title: "x", alertNumber: 5, alertPriority: "P2" }) === "#5-P2 · x"
   && E.faultTitle({ title: "x", alertNumber: 5, alertPriority: "high" }) === "#5 · x"
   && E.faultTitle({ title: "x", alertNumber: 5, alertPriority: "P9" }) === "#5 · x");   // only the agreement's priorities
ck("  ...a number that is not one (0, text) is not shown", E.faultTitle({ title: "x", alertNumber: 0 }) === "x" && E.faultTitle({ title: "x", alertNumber: "5" }) === "x");

const ov = readFileSync(new URL("../../src/components/cockpit/IssueCard.tsx", import.meta.url), "utf8");
const msg = readFileSync(new URL("../../src/components/cockpit/MessagesTab.tsx", import.meta.url), "utf8");
console.log("\n  an offline device is ONE line (owner, 2026-10-14: the same Timmerflotte said \"Unavailable\" and \"offline for 9 h\"):");
const ent = (id, state) => ({ entity_id: id, state, attributes: {}, last_changed: "", last_updated: "" });
const offlineDevice = (batteryState) => groupAttention(attentionOf({ devices: devicesOf({ unavailable: ["sensor.example_temperature"], folding: new Map([["sensor.example_battery", "sensor.example_temperature"]]) }), entities: { "sensor.example_temperature": ent("sensor.example_temperature", "unavailable"),
              "sensor.example_battery": ent("sensor.example_battery", batteryState) }, entityMap: {}, resolvedRooms: {}, fmData: fm([{ ...rec("off", "sensor.example_battery"), title: "Example has been offline for 9 h." }]) }).attentionItems);
const [one] = offlineDevice("unavailable");
ck("the fault on another entity of the device, itself unavailable, goes onto the device's Unavailable line",
   one.items.length === 1 && one.items[0].kind === "unavailable" && one.items[0].fault?.ticketId === "off"
   && lineText(one) === "Example has been offline for 9 h.", one.items.map((i) => i.id));
ck("  ...its Done, Not a problem, Open Ticket and Need help still act on it", said(cardActions(one)).join(" | ") === `Done → off ${OV_DONE} | Not a problem → off ${NAP} | Open Ticket → off (in_progress) | Need help → off`, said(cardActions(one)));
// a live state and the fault about the same entity, on one device's card: its ONE line, as drawn
const attentionLine = ({ fault, ...state }) => {
  const dev = { key: "x.d", label: "D" };
  const [g] = groupAttention([{ ...state, entityId: "x.d", device: dev }, { ...fault, kind: "fault", entityId: "x.d", device: dev }]);
  return g.items.length === 1 ? lineText(g) : `NOT ONE LINE: ${cockpitCard(g, null).lines.map((l) => l.text).join(" | ")}`;
};
const f = { id: "fault:x", kind: "fault", title: "Pump has been offline for 9 h.", detail: "", ticketId: "x" };
ck("  ...\"Unavailable — \" is not said before it (the fault says offline); a ticket's stage is its line's pill, not one of the card's",
   attentionLine({ id: "u", kind: "unavailable", title: "", detail: "Unavailable", fault: f }) === "Pump has been offline for 9 h."
   && attentionLine({ id: "u", kind: "unavailable", title: "", detail: "Unavailable", fault: { ...f, stage: "ticket" } }) === "Pump has been offline for 9 h."
   && cockpitCard({ key: "device:u", title: "D", items: [{ id: "u", kind: "unavailable", title: "", detail: "Unavailable", fault: { ...f, stage: "ticket" } }] }, null)
     .status.length === 0);
// owner, 2026-11-01: "follow how all other cards are style": a state is the card's status pill, never the line's words
const stated = (item) => { const c = cockpitCard({ key: `device:${item.id}`, title: "D", items: [item] }, null); return [c.lines[0].text, c.status?.map((s) => s.text).join() || undefined]; };
ck("  ...what the fault does not say stays, in the card's status pill: Missing, a live reading",
   JSON.stringify(stated({ id: "u", kind: "unavailable", title: "", detail: "Missing", fault: f })) === JSON.stringify(["Pump has been offline for 9 h.", "Missing"])
   && JSON.stringify(stated({ id: "a", kind: "alarm", title: "", detail: "92 %", fault: { ...f, title: "Humidity high" } })) === JSON.stringify(["Humidity high", "92 %"]));
ck("  ...a state word the fault's title already says is not said again (owner, 2026-10-18, #41); a word only inside another stays",
   attentionLine({ id: "a", kind: "alarm", title: "", detail: "Unlocked", fault: { ...f, title: "Laundry Room door unlocked" } }) === "Laundry Room door unlocked"
   && !stated({ id: "a", kind: "alarm", title: "", detail: "Unlocked", fault: { ...f, title: "Laundry Room door unlocked" } })[1]
   && JSON.stringify(stated({ id: "a", kind: "alarm", title: "", detail: "Open", fault: { ...f, title: "Door opened twice" } })) === JSON.stringify(["Door opened twice", "Open"]));
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
const lineSources = (g) => cockpitCard(g, null).lead;
const night = groupAttention(attentionOf({ devices: devicesOf({ unavailable: ["sensor.example_temperature"], folding: new Map([["sensor.example_battery", "sensor.example_temperature"]]) }), entities: { "sensor.example_temperature": ent("sensor.example_temperature", "unavailable"),
              "sensor.example_battery": ent("sensor.example_battery", "unavailable") }, entityMap: {}, resolvedRooms: {}, fmData: fm([agentRec({ id: "n1", entityId: "sensor.example_battery", origin: "night", title: "Example offline" })]) }).attentionItems)[0];
// the offline device grey ("lost"), its fault amber (owner, 2026-10-22: badge proposal 2 — both were amber)
ck("  ...an offline device and its night check's fault: ONE line, two icons — Live grey (no contact), Maintenance check amber (a fault)",
   JSON.stringify(lineSources(night)) === JSON.stringify({ sources: ["live", "night"], severities: ["lost", "warn"] }),
   lineSources(night));
const I = await import("@/components/fm/sourceIcons");
const drawn = draw(h(I.SourceIcons, lineSources(night)));
ck("  ...drawn one under the other, each in its severity's colour, named for a screen reader",
   (drawn.match(/<svg/g) || []).length === 2 && /cockpit-attention-lost[\s\S]*cockpit-attention-warn/.test(drawn)
   && !/cockpit-attention-(fault|unavailable|alarm|critical|schedule)/.test(drawn) && /aria-label="Live and Maintenance check"/.test(drawn), drawn);
const people = draw(h(I.SourceIcons, { sources: ["owner", "fm", "guest"], severities: ["warn"] }));
ck("  ...a profile is the top bar's badge: its letters in a circle (O, FM, G), in the line's colour",
   /source-role-badge cockpit-attention-icon cockpit-attention-warn"[^>]*>O</.test(people)
   && /source-role-badge two[^"]*"[^>]*>FM</.test(people) && /class="source-role-badge[^"]*"[^>]*>G</.test(people), people);
ck("  ...every source has its icon and its words in the (i)'s legend",
   S.ISSUE_SOURCES.every((x) => I.SOURCE_ICON[x] && I.SOURCE_WORDS[x])
   && S.ISSUE_SOURCES.every((x) => draw(h(I.TimingName, { k: x })).includes(draw(h(I.SOURCE_ICON[x], { size: 15, "aria-hidden": true })))
     && draw(h(I.TimingName, { k: x })).includes(`<b>${I.SOURCE_WORDS[x]}</b>`)));

console.log("\n  the Recap's readiness says what is found, never the goal over a contradiction (owner, 2026-10-14):");
const { buildReadiness } = await import("@/fm/readiness");
const noDevices = { ids: [], unavailable: [], partlyLost: [], healthOf: () => ({ kind: "alive" }), has: () => false, deviceOf: (id) => id, deviceOfRecord: (id) => id, isCritical: () => false,
  isHidden: () => false };
// the Recap reads ONE profile view: its devices and the problems the Overview lists for it (attention items)
const ready = (tickets, devs = noDevices) => {
  const data = fm(tickets);
  const view = { devices: devs, attentionItems: attentionOf({ devices: devs, entities: {}, entityMap: {}, resolvedRooms: {}, fmData: data }).attentionItems };
  return buildReadiness({}, data, view, {}).checks.find((c) => c.id === "tickets");
};
const readyWith = (tickets) => ready(tickets);
const mixedOpen = readyWith([agentRec({ id: "n1", origin: "night", entityId: "x.n1" }), agentRec({ id: "n2", origin: "night", entityId: "x.n2" }),
  agentRec({ id: "a1", alertNumber: 5, entityId: "x.a1" }), { ...rec("g", "x.g"), reportedBy: "guest" },
  { ...rec("t", "x.t"), status: "in_progress" }, { ...rec("r", "x.r"), status: "resolved", resolvedAt: "2026-10-14T09:00:00Z" }]);
ck("4 faults and 1 ticket: \"4 open faults · 1 ticket in progress\" (owner, 2026-11-01: never one inside the other), where to deal with each, and the faults' source icons",
   mixedOpen.label === "4 open faults · 1 ticket in progress"
   && mixedOpen.detail === 'Check the faults in Inbox › Open issues, or the tickets in Tickets.'
   && mixedOpen.sources.join() === "guest,alert,night", mixedOpen);   // the legend's order: the Kiosk's, then the Agent's
// ⚠️ COUNTED AS DRAWN, PER DEVICE (architecture review, 2026-10-15): the pump's two faults taken on together are ONE
// ticket card in Tickets, so one open ticket — not "2 open tickets" over one card
const pumpBy = (devs) => ready([{ ...rec("p1", "switch.pump"), status: "in_progress" },
  { ...rec("p2", "sensor.pump_power"), status: "in_progress" }, rec("p3", "sensor.pump_temp")],
  { ...noDevices, deviceOf: devs, deviceOfRecord: devs });
const onePump = pumpBy((id) => (id.includes("pump") ? "switch.pump" : id));
ck("  ...counted per device, as drawn: one device's 2 tickets + 1 fault = \"1 open fault · 1 ticket in progress\"",
   onePump.label === "1 open fault · 1 ticket in progress" && onePump.state === "warn", onePump);
ck("  ...and three devices are three", pumpBy((id) => id).label === "1 open fault · 2 tickets in progress", pumpBy((id) => id));
// the Recap files a record as every screen does — by the record's device (deviceOfRecord: a list of several sensors
// included), never by its raw field looked up as one entity (review "One answer per question" #1, 2026-10-19)
const byRecord = ready([rec("m1", "sensor.gone,sensor.pump_power"), rec("m2", "sensor.pump_power")],
  { ...noDevices, deviceOf: (id) => id, deviceOfRecord: (id) => (id.includes("pump") ? "sensor.pump_power" : id) });
ck("  ...a fault naming several sensors counts on its device's card", byRecord.label === "1 open fault", byRecord);
const onlyFaults = readyWith([agentRec({ id: "n1", origin: "night" })]);
ck("  ...one fault, no ticket: singular, no ticket said, and only Open issues", onlyFaults.label === "1 open fault"
   && onlyFaults.detail === 'Check the faults in Inbox › Open issues.', onlyFaults);
const onlyTickets = readyWith([{ ...rec("t", "x.y"), status: "in_progress" }]);
ck("  ...tickets only: no icon, only Tickets", onlyTickets.detail === 'Check the tickets in Tickets.' && onlyTickets.label === "1 ticket in progress" && onlyTickets.sources.length === 0, onlyTickets);
const allClear = readyWith([]);
ck("  ...nothing open: the goal is met, and said once", allClear.state === "pass" && allClear.label === "No open faults or tickets"
   && allClear.detail === "Nothing to deal with.", allClear);
{
  const { ReadinessChecks } = await import("@/components/fm/ReadinessTab");
  const result = { checks: [mixedOpen], passed: 0, total: 1, overall: "warn" };
  const drawn = draw(h(ReadinessChecks, { readiness: result, label: (id) => id, onOpenEntity: () => {}, onOpenCheck: () => {}, onGo: () => {} }));
  // owner, 2026-11-05: "faults" opens Inbox › Open issues on them, "tickets" the Tickets tab; the icons before "faults"
  ck("  ...the Recap draws those icons in the line, before \"faults\", and its two words open their place",
     text(drawn).includes('|Check the |G|[icon]|[icon]| |faults| in Inbox › Open issues, or the |tickets| in Tickets.|')
     && (drawn.match(/<button type="button" class="fm-text-link">(faults|tickets)<\/button>/g) ?? []).length === 2
     && JSON.stringify(mixedOpen.goes) === JSON.stringify([{ word: "faults", to: { place: "faults", ids: ["x.n1", "x.n2", "x.a1", "x.g"] } },
       { word: "tickets", to: { place: "tickets" } }]), text(drawn));
  // owner, 2026-11-05: "always expanded (remove the capability to collapse the card)"
  ck("  ...the checks are always shown under their verdict: nothing folds",
     text(drawn).includes("|Ready, with things worth fixing|0 of 1 checks passing|") && drawn.includes("4 open faults")
     && !/aria-expanded|fm-headline-toggle/.test(drawn.replace(/<button type="button" class="info-trigger"[^>]*>/g, "")), text(drawn));
  // owner, 2026-11-05: "show the device pills concerned by either the Ticket or Faults … never duplicate device"
  const pump = pumpBy((id) => (id.includes("pump") ? "switch.pump" : id));
  ck("  ...its devices as chips, as All devices reporting's: each device once (a pump's ticket and fault are one chip)",
     mixedOpen.entityIds.join() === "x.n1,x.n2,x.a1,x.g,x.t" && pump.entityIds.join() === "switch.pump"
     && (drawn.match(/class="fm-entity-chip"/g) ?? []).length === 5 && !mixedOpen.opens, [mixedOpen.entityIds, pump.entityIds]);
}

const recent = readFileSync(new URL("../../src/components/fm/RecentWorkList.tsx", import.meta.url), "utf8");
const ticketsTab = readFileSync(new URL("../../src/components/fm/TicketsTab.tsx", import.meta.url), "utf8");
ck("lists that only grow are ONE folded, paged list (owner, 2026-10-14): Tickets' Closed and Schedule's Recent work",
   /<FoldedList title="Closed" rows=\{closed\}/.test(ticketsTab) && /<FoldedList title="Recent work" rows=\{rows\}/.test(recent)
   && !/usePaged|<Pager|\.slice\(0, limit\)/.test(recent + ticketsTab));

// a ticket's card AS DRAWN (pill on the title line, buttons inside on the right): tests/oracles/cockpit_cards.mjs; its
// buttons as drawn: "the buttons, drawn" below. WIRING the Tickets tab alone holds (it needs the Facility data to render):
{
  const JSX = await import("../consistency/jsx.mjs");
  const [open, shut] = JSX.elements(JSX.parseTsx("components/fm/TicketsTab.tsx"), "WorkButtons");
  // owner, 2026-11-05 ("Status on top"): its bar the card's last part, under every record of it
  ck("a ticket is ONE card: its first record says its stage, its buttons the card's bar, under every record, the closed one its Reopen, no device name above",
     /<RecordGroup key=\{g\.key\} actions=\{buttons\}>/.test(ticketsTab) && /const records = g\.records\.map\(workRecord\);/.test(ticketsTab)
     && /const buttons = <WorkButtons actions=\{ticketActions\(records\)\}/.test(ticketsTab)
     // its first record `stated` (its stage and who moved it: cockpitCard.ticketFace, checked by value above)
     && /if \(g\.records\.length === 1\) return <Fragment key=\{g\.key\}>\{record\(g\.records\[0\], buttons\)\}<\/Fragment>;/.test(ticketsTab)
     && /\{g\.records\.map\(\(t, i\) => record\(t, undefined, false, i === 0\)\)\}\s*<\/RecordGroup>/.test(ticketsTab)
     && JSX.propText(open, "actions") === "ticketActions(records)" && JSX.propText(shut, "actions") === "closedActions(workRecord(t), closedTold(t).reopen)"
     // its standing Need help said on it, from the same records as its buttons (checked by value below)
     && JSX.propText(open, "asked") === "helpAsked(records)"
     && !/const title = head\.entityId/.test(ticketsTab));
}
{
  // ONE WORD AND ONE TONE PER STAGE (architecture review, 2026-10-19): the pill's word and colour and the recap's Status
  // column are fmEngine.STAGE_WORDS, BY VALUE — the pill said "In progress" in the Schedule's due-soon colour while the
  // recap printed the stored status ("in progress"). The pill as drawn: cockpit_cards.mjs.
  const { pillClass } = await import("@/fm/tone");
  const { buildMonthlyRecap } = await import("@/fm/fmDocuments");
  const pill = (t) => { const s = E.STAGE_WORDS[E.stageOf(t)]; return { text: s.word, tone: pillClass(s.tone) }; };
  const taken = { ...rec("w", "x.y", "in_progress"), openedAt: "2026-09-10T10:00:00.000Z" };
  const closed = { ...rec("z", "x.y", "resolved"), openedAt: "2026-09-11T10:00:00.000Z", resolvedAt: "2026-09-12T10:00:00.000Z" };
  ck("a ticket in progress is \"In progress\" in the warning tone, a closed one \"Resolved\" in the ok tone, an open fault's word is \"Open\"",
     pill(taken).text === "In progress" && pill(taken).tone === "tone-warn" && pill(closed).text === "Resolved" && pill(closed).tone === "tone-ok"
     && E.STAGE_WORDS.fault.word === "Open", [pill(taken), pill(closed)]);
  const recap = buildMonthlyRecap({ fm: fm([taken, closed]), month: "2026-09", villaName: "V", readiness: null, deviceOfRecord: deviceOf });
  const row = (t) => recap.split("\n").find((l) => l.includes(`| ${t.title} |`)) ?? "";
  ck("  ...the recap's Status column says the SAME word as the pill, for both", row(taken).includes(`| ${pill(taken).text} |`)
     && row(closed).includes(`| ${pill(closed).text} |`) && !/\| in progress \|/.test(recap), [row(taken), row(closed)]);
  const { ticketFace } = await import("@/config/cockpitCard");
  // nobody moved it: its stage's word from the table; moved: how (a ticket's stage, the table's word too)
  const unmoved = rec("u", "x.y");
  const stageSaid = (t) => ticketFace(t).status.map((x) => x.text).join();
  ck("  ...the Tickets tab's pill is the table's word (cockpitCard.ticketFace), no word of its own",
     stageSaid(unmoved) === E.STAGE_WORDS[E.stageOf(unmoved)].card && stageSaid(taken) === E.STAGE_WORDS.ticket.card
     && !/"In progress"|"Resolved"|due-soon/.test(ticketsTab), [unmoved, taken].map(stageSaid));

  // THE RECAP'S OPEN FIGURES ARE THE TICKETS TAB'S CARDS (architecture review, 2026-10-19): the pump's power and energy
  // sensors are one device with two faults nobody took on and two records taken on together — ONE card with Open
  // Ticket, ONE ticket card. The recap's "Open" line counted records (2 and 2) while its own §5 and the tab counted cards.
  const pumpWork = [rec("f1", "sensor.pump_energy"), rec("f2", "sensor.pump_power"),
    { ...rec("k1", "sensor.pump_energy", "in_progress"), openedAt: "2026-09-01T10:00:00.000Z" },
    { ...rec("k2", "sensor.pump_power", "in_progress"), openedAt: "2026-09-02T10:00:00.000Z" }];
  const counts = W.openCounts(pumpWork, deviceOf);
  const pumpRecap = buildMonthlyRecap({ fm: fm(pumpWork), month: "2026-09", villaName: "V", readiness: null, deviceOfRecord: deviceOf });
  const openLine = pumpRecap.split("\n").find((l) => l.startsWith("- Open faults:")) ?? "";
  ck("the recap's open figures equal the Tickets tab's cards: one device, one fault card, one ticket card — never the four records",
     counts.faults === 1 && counts.tickets === 1 && W.ticketCards(pumpWork, deviceOf).length === 1
     && openLine.includes(`Open faults: **${counts.faults}**`) && openLine.includes(`Tickets in progress: **${counts.tickets}**`)
     && !/\*\*2\*\*/.test(openLine), openLine);
  ck("  ...and the per-record figures stay per record: nothing is resolved here, and the engine's table no longer counts open work",
     E.ticketStats(pumpWork).resolved === 0 && !("open" in E.ticketStats(pumpWork)) && !("inProgress" in E.ticketStats(pumpWork)));
}
const spendTab = readFileSync(new URL("../../src/components/fm/SpendTab.tsx", import.meta.url), "utf8");
const todayTab = readFileSync(new URL("../../src/components/fm/TodayTab.tsx", import.meta.url), "utf8");
ck("ONE card for every Cockpit list (architecture review, 2026-10-15): Overview, Tickets, Schedule, Spend, Recent work draw RecordCard, nothing of their own",
   [ticketsTab, recent, spendTab, todayTab].every((f) => /<RecordCard /.test(f)) && /<RecordCard\s/.test(ov)
   && !/<ErasableRow|<RecordMeta|fm-document-link|className=\{`fm-row state-/.test(ticketsTab + recent + spendTab + todayTab)
   && !/cockpit-attention-(item|row|detail|actions)/.test(ov));
ck("  ...and Recent work is the SCHEDULED work: a ticket's repair is told on its closed card",
   /\.filter\(\(c\) => completionSource\(data, c\)\.kind === "schedule"\)/.test(recent)
   && /const work = data\.completions\.find\(\(c\) => c\.ticketId === t\.id && c\.costId\);/.test(ticketsTab));


console.log("\n  a line from Telegram is never a status change (architecture review, 2026-10-15):");
// the villa's case: open 23:40 on 30 Sep, reminder 23:50, taken on 00:10 on 1 Oct — the reminder's line written after
const late = { ...rec("m", "x.y"), status: "in_progress", openedAt: "2026-09-30T15:40:00Z", updates: [
  { at: "2026-09-30T15:40:00Z", status: "open", photoIds: [] },
  { at: "2026-09-30T16:10:00Z", status: "in_progress", by: "Facility manager", note: "On my way", photoIds: [] },
  { at: "2026-09-30T15:50:00Z", status: "in_progress", kind: "noted", note: "Reminder sent to Facility Manager", photoIds: [] }] };
ck("a fault still OPEN at month end is open in that month's report, whatever line Telegram added after",
   E.recordLife(late, Date.parse("2026-09-30T15:55:00Z")).status === "open" && E.recordLife(late, Date.parse("2026-09-30T16:30:00Z")).status === "in_progress",
   [E.recordLife(late, Date.parse("2026-09-30T15:55:00Z")).status, E.recordLife(late, Date.parse("2026-09-30T16:30:00Z")).status]);
const N2 = await import("@/fm/faultNotes");
ck("  ...and the card's notes read in time order (the reminder before the take-on)",
   N2.faultNoteLines(late, (a) => a.slice(11, 16)).join("|") === "Reminder sent to Facility Manager (15:50)|On my way (16:10)",
   N2.faultNoteLines(late, (a) => a.slice(11, 16)));
const resolvedLate = { ...late, status: "resolved", resolvedAt: "2026-09-30T17:40:00Z", updates: [...late.updates,
  { at: "2026-09-30T17:40:00Z", status: "resolved", photoIds: [] },
  { at: "2026-09-30T17:45:00Z", status: "resolved", kind: "retitled", title: "t", was: "s", photoIds: [] }] };
ck("  ...the time open counts status changes only: 2 h, never a title or a Telegram line",
   E.recordLife(resolvedLate).openMs === 2 * 3600 * 1000 && E.statusChanges(resolvedLate).every((u) => !["noted", "retitled", "reading"].includes(u.kind)),
   E.recordLife(resolvedLate).openMs);

console.log("\n  what happened on Telegram, on the card (owner, 2026-10-14: reminders, escalation, Need help):");
const N = await import("@/fm/faultNotes");
// what a card draws of who last moved it (owner, 2026-11-05, the "Status on top" card): its state line, then its who
// line, never the stage or the word twice (faultNotes.moveState, moveWho)
const drawnMove = (m, s) => { const st = N.moveState(m); return [st?.text, N.moveWho(m, st ? [st.text] : [], undefined, s)].filter(Boolean).join(" | "); };
const told = { ...rec("s", "switch.pump"), status: "open", updates: [
  { at: "2026-10-14T08:00:00.000Z", status: "open", photoIds: [], title: "fault s" },
  { at: "2026-10-14T08:49:00.000Z", status: "open", photoIds: [], kind: "noted", note: "Escalation sent to Owner" },
  { at: "2026-10-14T09:10:00.000Z", status: "open", photoIds: [], kind: "noted", note: "🆘 Need help pressed by Fabien" }] };
const reopenedThenTold = { ...told, updates: [{ at: "2026-10-13T08:00:00.000Z", status: "resolved", photoIds: [] },
  { at: "2026-10-14T07:00:00.000Z", status: "open", photoIds: [], kind: "reopened", by: "Owner" }, ...told.updates.slice(1)] };
const withLatest = attentionOf({ devices: devicesOf(), entities: {}, entityMap: {}, resolvedRooms: {}, fmData: fm([told]) }).attentionItems;
ck("under the fault, its short story as Telegram tells it, each line with its time, in time order (ticket 19 of \"One inbox\")",
   JSON.stringify(withLatest[0].story) === JSON.stringify([{ note: "Escalation sent to Owner", at: "2026-10-14T08:49:00.000Z" },
     { note: "🆘 Need help pressed by Fabien", at: "2026-10-14T09:10:00.000Z" }]), withLatest[0].story);
const lateWritten = { ...told, updates: [told.updates[0], told.updates[2], told.updates[1]] };
ck("  ...a line the Agent wrote late (the repair, minutes after its moment) still in its moment's place",
   attentionOf({ devices: devicesOf(), entities: {}, entityMap: {}, resolvedRooms: {}, fmData: fm([lateWritten]) }).attentionItems[0]
     .story.map((x) => x.note).join("|") === "Escalation sent to Owner|🆘 Need help pressed by Fabien");
ck("  ...a fault the Agent told nothing about has none (no line drawn)",
   attentionOf({ devices: devicesOf(), entities: {}, entityMap: {}, resolvedRooms: {}, fmData: fm([{ ...told, updates: [told.updates[0]] }]) }).attentionItems[0]
     .story.length === 0);
ck("  ...a noted line is never a status change: \"Reopened by Owner\" still read under it",
   N.statusSteps(reopenedThenTold).every((u) => u.kind !== "noted") && /^Reopened \| By Owner, on /.test(drawnMove(N.faultMove(reopenedThenTold), (a) => a.slice(11, 16))),
   N.faultMove(reopenedThenTold));
ck("  ...and each one is a note in the Tickets tab, with its time",
   N.faultNoteLines(told, (a) => a.slice(11, 16)).join("|") === "Escalation sent to Owner (08:49)|🆘 Need help pressed by Fabien (09:10)",
   N.faultNoteLines(told, (a) => a.slice(11, 16)));
{
  const { AttentionCard } = await import("@/components/cockpit/IssueCard");
  const card = draw(h(AttentionCard, { card: cockpitCard(groupAttention(withLatest)[0], { checkMinutes: 5, nightlyAt: "02:00" }), onOpenEntity: () => {} }));
  ck("  ...shown on the Overview card, under the fault's line", /fault s[\s\S]*class="cockpit-attention-latest">🆘 Need help pressed by Fabien · /.test(card), text(card));
}

console.log("\n  the screens:");
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const tt = src("components/fm/TicketsTab.tsx");
// what ticketCards lists is checked by value above ("Tickets lists the device whose ticket was opened last first");
// here, that the tab draws it (its figures above the cards went: owner, 2026-11-03)
ck("the Tickets tab draws ticketCards — the tickets in progress, by device — and Closed",
   /ticketCards\(data\.tickets, deviceOfRecord\)/.test(tt) && !/Raise a fault/.test(tt));
// owner, 2026-11-03: "Remove the redundant line with the high level numbers above the list of opened tickets": no figures
ck("  ...and no figures above them (in progress, mean resolution, closed with no action, the kept record)",
   !/fm-summary|fm-stat|mean resolution|Over the kept record/.test(tt));
// owner, 2026-11-03 ("A"): a ticket's card says its state ONCE — its first record's pill; the records after it (the
// night check's finding beside VESTA's alert on the same device) do not repeat "Ticket opened by … In progress"
{
  const tab = JSX.parseTsx("components/fm/TicketsTab.tsx");
  const card = JSX.elements(tab, "RecordCard").find((c) => JSX.propText(c, "who") !== null);
  ck("a ticket's card says its state once: its strip's stage and its who line only where the record is `stated`, the first of its card",
     // what `stated` says is checked by value (cockpitCard.ticketFace, "a ticket's records after its first" above)
     !!card && JSX.propText(card, "who") === "face.who" && JSX.propText(card, "status") === "stated ? face.status : undefined"
     && /const face = ticketFace\(t, stated\);/.test(tt) && JSX.elements(tab, "StatusPill").length === 0
     && /, false, i === 0\)\)\}/.test(tt), card && JSX.propText(card, "who"));
}
// owner, 2026-11-02: "Move the Open Ticket button from the Inbox page to the Tickets page"
{
  const tab = JSX.parseTsx("components/fm/TicketsTab.tsx");
  const bar = JSX.elements(tab, "div").find((d) => JSX.propText(d, "className") === '"tickets-toolbar"');
  const label = bar ? JSX.elements(bar, "WorkButton") : [];
  const form = JSX.elements(tab, "FaultForm").find((f) => JSX.propText(f, "presetEntity") !== null);
  ck("  ...its first line: Open Ticket, in the cards' words and wrench, opening the one \"Open a ticket\" form above the tickets",
     label.length === 1 && JSX.propText(label[0], "kind") === '"raiseTicket"' && JSX.propText(label[0], "onClick") === "() => setRaising({})"
     && !!form && JSX.propText(form, "presetEntity") === "raising.entity" && JSX.guardsOf(form).join() === "raising");
  ck("  ...pointed at a device when asked (a device window's Open Ticket, an Inbox card): FacilitySections hands the Cockpit's request on",
     /raiseFor=\{reportFaultFor\} onRaiseOpened=\{onFaultFormOpened\}/.test(readFileSync(new URL("../../src/components/fm/FacilitySections.tsx", import.meta.url), "utf8"))
     && /setRaising\(\{ entity: raiseFor \}\)/.test(tt));
}
// owner, 2026-10-31: the Issues' button on the filters' line, at its right; wrapping whole. Open Ticket left it for the
// Tickets tab (owner, 2026-11-02): a guest's "Report a problem" is the one left
{
  const tab = JSX.parseTsx("components/cockpit/MessagesTab.tsx");
  const cls = (el) => JSX.propText(el, "className");
  const bar = JSX.elements(tab, "div").find((d) => cls(d) === '"messages-toolbar"');
  const kids = bar ? bar.children.filter((c) => JSX.tagOf(c) || (c.expression && c.getText().trim())) : [];
  const actions = bar ? JSX.elements(bar, "div").find((d) => cls(d) === '"messages-toolbar-actions"') : undefined;
  const open = actions ? JSX.elements(actions, "WorkButton") : [];
  // owner, 2026-11-10: the filters are the app's one choice control (SegmentedGroup), each segment its words' width
  ck("the filters' line: the filters (the one choice control), then at its right a guest's Report a problem; never Open Ticket, nor its form",
     !!bar && JSX.tagOf(kids[0]) === "SegmentedGroup" && JSX.propText(kids[0], "layout") === '"natural"' && !!actions
     && open.length === 0 && /Report a problem/.test(actions.getText()) && !/raiseTicket|<FaultForm /.test(msg),
     kids.map((k) => k.getText().slice(0, 50)));
  ck("  ...only while the issues are listed, for a profile that reports and does not manage",
     !!actions && JSX.guardsOf(actions).join() === "showsIssues,!canManage,canReport", actions && JSX.guardsOf(actions));
  ck("  ...and nothing of it left on the section's title line", !/Open a ticket<\/button>/.test(msg)
     && !JSX.elements(tab, "ListSection").some((s) => JSX.propText(s, "actions") !== null));
  const { WORK_ACTIONS } = await import("@/fm/deviceWork");
  const wb = JSX.parseTsx("components/fm/WorkButtons.tsx");
  ck("  ...the Tickets tab's Open Ticket: the card's words and wrench, defined once (WorkButton, the card's buttons draw it too)",
     WORK_ACTIONS.raiseTicket.label === "Open Ticket" && WORK_ACTIONS.openTicket.label === WORK_ACTIONS.raiseTicket.label
     && JSX.elements(wb, "WorkButton").length === 1 && JSX.propText(JSX.elements(wb, "WorkButton")[0], "kind") === "a.kind");
  const shared = readFileSync(new URL("../../src/styles/08-shared.css", import.meta.url), "utf8");
  const modals = readFileSync(new URL("../../src/styles/04-modals.css", import.meta.url), "utf8");
  const { FILTERS } = await import("@/messages/messagesModel");
  const { withCount } = await import("@/utils/countBadge");
  const notesSection = JSX.elements(tab, "ListSection").find((s) => JSX.propText(s, "onToggle") === '() => fold("notes")');
  // owner, 2026-11-01: "Notifications if it fits". It does (below), so the short "Notifs" went with its code
  ck("  ...the filters say Issues · Notifications · Reports, each with its count as a tab says it (\"Issues (6)\"); drawn from that one list; the section is \"Notifications\"",
     FILTERS.map((f) => f.label).join(" · ") === "Issues · Notifications · Reports" && FILTERS.every((f) => !("short" in f))
     && /label: withCount\(f\.label, f\.count\)/.test(msg) && withCount("Issues", 6) === "Issues (6)" && withCount("Reports", 0) === "Reports"
     && withCount("Reports", null) === "Reports" && !!notesSection && JSX.propText(notesSection, "title") === '"Notifications"', FILTERS);
  // owner, 2026-10-31: "the corners are not the same: style them all the same"; 2026-11-10: one definition for every
  // choice and every button. Neither the filters nor the button beside them has a look of its own in any stylesheet:
  // the one choice control and the one worded button, standing on a line that stretches them
  const postcss = (await import("postcss")).default;
  const styles = readdirSync(new URL("../../src/styles/", import.meta.url)).filter((f) => f.endsWith(".css"))
    .map((f) => readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), "utf8"));
  const own = [];
  for (const css of styles) postcss.parse(css).walkRules((r) => {
    if (/\.messages-filter|\.messages-toolbar-actions \S/.test(r.selector)) own.push(r.selector);
  });
  ck("  ...the filters and the button beside them have no look of their own (the one choice control, the one button); the line gives them its height",
     own.length === 0
     && /\.messages-toolbar \{[^}]*align-items: stretch;/.test(shared) && /\.messages-toolbar-actions \{[^}]*align-items: stretch;/.test(shared), own);
  {
    // The three filters hold a 360 px phone's line (the screen less 36 px) with the whole word "Notifications" and a
    // two-figure count. Measured in headless Firefox with the real control at its 14 px: the words' own widths
    // "Issues (99)" 72.9 (chosen, bold), "Notifications" 83.3, "Reports" 51.2. The rest is the control's own rules
    const px = (css, re) => Number((css.match(re) ?? [])[1]);
    const pad = px(modals, /\.segmented-natural button \{[^}]*padding: 0 (\d+)px/);
    const gap = px(modals, /\.segmented, \.tool-group \{[^}]*gap: (\d+)px/), track = px(modals, /\.segmented, \.tool-group \{[^}]*padding: (\d+)px/);
    const needed = [72.9, 83.3, 51.2].reduce((w, l) => w + l + 2 * pad, 0) + 2 * gap + 2 * track;
    ck("  ...the three filters, \"Notifications\" whole, fit one line on a 360 px phone (the control's own padding and gaps)",
       pad > 0 && gap > 0 && track > 0 && needed <= 360 - 36, { pad, gap, track, needed: Math.round(needed * 10) / 10 });
  }
  ck("  ...the two groups wrap whole: the filters keep their width (sliding sideways only on a line narrower than themselves), the button keeps the right",
     /\.messages-toolbar \{[^}]*flex-wrap: wrap;/.test(shared) && /\.segmented-natural \{[^}]*flex: 0 1 auto;[^}]*max-width: 100%;[^}]*overflow-x: auto;/.test(modals)
     && /\.segmented-natural button \{[^}]*flex: 0 0 auto;/.test(modals) && /\.messages-toolbar-actions \{[^}]*margin-left: auto;/.test(shared));
}
// WHAT the buttons are, on which records, with which question: by value at the top and in "the buttons, drawn".
// Here only the wiring a drawing cannot reach — the Overview hands cardActions to the shared buttons, and acts on
// what each button names (its stage, its records), with no status or rule of its own
ck("a card draws what cardActions says (no rule of its own)",
   JSX.propText(icButtons, "actions") === "line.actions" && JSX.propText(icButtons, "asked") === "line.asked"
   && !/closeTickets|InlineConfirm|in_progress"|"resolved"/.test(ov + tt));
// ⚠️ ONE CARRIER OF EVERY STEP (architecture review round 6, 2026-10-30): each tab wrote its own Need help, failure line
// and stage form, and neither said what a Need help did. Both hand their buttons the one useCardWork; neither writes a
// step, nor opens a stage form, itself
ck("both tabs carry out their buttons' steps through the one useCardWork, never a step of their own",
   [ov, tt].every((f) => /useCardWork\(\)/.test(f) && !/helpTickets|addTicket|advanceTickets|FaultStageModal|setStaging/.test(f))
   && [icButtons, ...JSX.elements(JSX.parseTsx("components/fm/TicketsTab.tsx"), "WorkButtons")].every((b) => JSX.propText(b, "work") === "work"));

console.log("\n  the buttons, drawn — ONE close-with-confirm for both tabs:");
{
  const { default: WorkButtons } = await import("@/components/fm/WorkButtons");
  const work = (asking, problem = null) => ({ asking, problemFor: (key) => (key === "device:x" ? problem : null), press: () => {},
    cancel: () => {}, staging: null, endStaging: () => {} });
  const drawButtons = (actions, asking = null, extra = {}) => draw(h(WorkButtons,
    { actions, cardKey: "device:x", work: work(asking, extra.problem ?? null), ...extra }));
  const ovActs = W.overviewActions([{ id: "a", stage: "fault" }]), tkActs = W.ticketActions([{ id: "a", stage: "ticket" }]);
  // the words a row shows, wide (every label in full) or narrow (the one words): both are drawn, the row's width
  // shows one (07-facility.css .work-short)
  const seen = (html, narrow = false) => text(html.replace(narrow ? /<span class="work-long">[^<]*<\/span>/g
    : /<span class="work-short">[^<]*<\/span>/g, "")).replace(/\[icon\]\|?/g, "[icon] ");
  // owner, 2026-11-05 ("Status on top"): each a segment of the card's bar, the main action first, in green
  ck("an issue card: Done, Not a problem, Open Ticket, then Need help (owner, 2026-11-05), each with its icon, in the card's bar, Done first and green, named for a screen reader",
     /^<button type="button" class="btn fm-bar-main"[^>]*><svg[^>]*lucide-check/.test(drawButtons(ovActs, null, { name: "Pump" }))
     && (drawButtons(ovActs).match(/fm-bar-main/g) ?? []).length === 1 && /^<button type="button" class="btn fm-bar-main"/.test(drawButtons(tkActs))
     && !/fm-bar-main/.test(drawButtons(W.closedActions({ id: "r", stage: "closed" }, true)))
     && seen(drawButtons(ovActs, null, { name: "Pump" })) === "|[icon] Done|[icon] Not a problem|[icon] Open Ticket|[icon] Need help|"
     && /aria-label="Done “Pump”"/.test(drawButtons(ovActs, null, { name: "Pump" })) && /aria-label="Open Ticket"/.test(drawButtons(ovActs)), seen(drawButtons(ovActs)));
  // owner, 2026-11-04 (iPhone screenshot): "use 1 word label and icon in the button … open/edit a ticket shall also
  // appear on the same line"
  ck("  ...on a narrow row, one word each under its icon, in the same order: Done · Ignore · Ticket · Help, and the Tickets tab's Close · Dismiss · Help",
     seen(drawButtons(ovActs), true) === "|[icon] Done|[icon] Ignore|[icon] Ticket|[icon] Help|"
     && seen(drawButtons(W.overviewActions([{ id: "a", stage: "ticket" }])), true) === "|[icon] Done|[icon] Ticket|[icon] Help|"
     && seen(drawButtons(tkActs), true) === "|[icon] Close|[icon] Dismiss|[icon] Help|",
     [seen(drawButtons(ovActs), true), seen(drawButtons(tkActs), true)]);
  // owner, 2026-10-31 (iPhone screenshot): Open Ticket wrapped under Done · Need help. Measured on that screenshot, a
  // 390 px wide iPhone: the card 354 px wide (the screen less 36 px); the labels' own widths at 15 px: Done 34, Need
  // help 68, the wrench and Open Ticket 101 (the icon 14 px and the button's 8 px gap: 22). ⚠️ A FOURTH BUTTON (owner,
  // 2026-11-04): with Not a problem (98 px, Need help's width per letter) the four wrapped, Open Ticket on a second line;
  // the owner asked one word and its icon instead, all four on one line. Every label in full shows only where the row
  // holds the widest card's buttons (an issue's four; a ticket's three, No action needed 121 px); below, the one words
  // under their icons share the row equally, and the widest of them (Dismiss, 53 px) fits a quarter of a 360 px phone's row.
  {
    const { readFileSync } = await import("node:fs");
    const css = (f) => readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), "utf8");
    const fac = css("07-facility.css"), base = css("01-base.css");
    // ⚠️ THE BAR'S SEGMENTS ARE EQUAL (owner, 2026-11-05): a label in full needs its segment, a card's width shared by
    // its buttons, as wide as its widest label (Not a problem 98 px, a ticket's No action needed 121 px); the bar spans
    // the card edge to edge (no card padding, no icon column any more)
    const num = (re, t) => Number((t.match(re) ?? [])[1]);
    const seg = /\.fm-record-actions :is\(\.btn, \.fm-document-link\) \{([^}]*)\}/.exec(fac)?.[1] ?? "";
    const pad = num(/padding: 0 (\d+)px/, seg), iconGap = num(/gap: (\d+)px/, seg);
    const hair = num(/\.fm-record-actions \{[^}]*gap: (\d+)px/, fac);
    const narrowBelow = num(/@container work-row \(max-width: (\d+)px\)/, fac) + 1;
    const ICON = 14 + iconGap;
    const bar = (labels) => labels.length * (Math.max(...labels) + ICON + 2 * pad) + (labels.length - 1) * hair;
    const room = (screen) => screen - 36;
    const full = Math.max(bar([34, 68, 98, 79]), bar([40, 68, 121]));
    // the one words: Done, Help, Ignore, Ticket on an issue (Ticket, the widest, 46 px); Close, Help, Dismiss (53 px) on a ticket
    const tiles = Math.max(bar([34, 32, 44, 46]), bar([40, 32, 53]));
    ck("  ...every label in full only on a card that holds the widest card's four; one words below, the four on one line on every phone, 360 to 430 px",
       pad > 0 && iconGap > 0 && hair === 1 && /flex: 1 1 0; min-width: 0;/.test(seg) && full <= narrowBelow
       && [360, 375, 390, 412, 430].every((w) => room(w) < narrowBelow && tiles <= room(w))
       && /\.work-short \{ display: none; \}/.test(fac) && /^\.fm-record \{ container: work-row \/ inline-size; \}$/m.test(fac)
       // the CARD is measured: a row sized by its buttons (right of the words on a wide card) measured 0 px (owner, 2026-11-04)
       && (fac.match(/container(-type|-name)?:/g) ?? []).length === 1,
       { pad, iconGap, hair, full, narrowBelow, tiles, room360: room(360) });
  }
  ck("  ...a ticket: Close, No action needed and Need help, each with its icon; a closed record: Reopen",
     seen(drawButtons(tkActs)) === "|[icon] Close|[icon] No action needed|[icon] Need help|" && seen(drawButtons(W.closedActions({ id: "r", stage: "closed" }, true))) === "|[icon] Reopen|", seen(drawButtons(tkActs)));
  // each close asks the question of the button pressed (owner, 2026-11-04: Not a problem a button of its own, no
  // longer a second yes under Done's question; tests/oracles/not_a_problem.mjs)
  const asked = (kind, key = "device:x") => ({ key, kind });
  // owner, 2026-11-05: its question on a line of its own, then [the main action][Cancel], the main action first
  ck("  ...the button pressed asks ITS question in place of the buttons: the ticket's No action needed; Done and Not a problem have none (owner, 2026-11-07)",
     seen(drawButtons(ovActs, asked("done"))) === "|[icon] Done|[icon] Not a problem|[icon] Open Ticket|[icon] Need help|"
     && seen(drawButtons(ovActs, asked("notAProblem"))) === "|[icon] Done|[icon] Not a problem|[icon] Open Ticket|[icon] Need help|"
     && /^<div class="fm-record-ask"><svg[\s\S]*?<\/svg><span>Close this ticket\?[^<]*<\/span><\/div><button type="button" class="btn fm-bar-main">No action needed<\/button><button type="button" class="btn">Cancel<\/button>$/.test(drawButtons(tkActs, asked("closeTicket")))
     && seen(drawButtons(tkActs, asked("closeTicket"))) === "|[icon] Close this ticket? Nothing was done, no cost is recorded.|No action needed|Cancel|",
     [seen(drawButtons(ovActs, asked("done"))), seen(drawButtons(ovActs, asked("notAProblem"))), seen(drawButtons(tkActs, asked("closeTicket")))]);
  {
    // what a press does, on the drawn buttons themselves (WorkButtons draws with no hook: called, its tree is read)
    const calls = [];
    // each button hands its own action to the one carrier (useCardWork.press), whose outcome is fm/workPress's
    const { pressOutcome } = await import("@/fm/workPress");
    const pressing = { ...work(null), press: (key, a, opts) => { const o = pressOutcome(a, opts);
      calls.push(o.does === "write" ? [o.write.kind, o.write.ids.join(), !!o.write.work, !!o.write.lasting] : [o.does]); } };
    const tree = WorkButtons({ actions: ovActs, cardKey: "device:x", work: pressing });
    const buttons = [];
    const walk = (n) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) return n.forEach(walk);
      if (n.type === "button" || n.type?.name === "WorkButton") buttons.push(n); walk(n.props?.children); };
    walk(tree);
    const press = (label) => buttons.find((b) => b.props.kind === label)?.props.onClick();
    press("notAProblem"); press("done");
    ck("  ...Not a problem closes as pressed, as lasting with no work (owner, 2026-11-04); Done closes as pressed, as work done (owner, 2026-11-07): no question first",
       JSON.stringify(calls) === JSON.stringify([["close", "a", false, true], ["close", "a", true, false]]), calls);
  }
  ck("  ...another card's question leaves this one's buttons; a card with nothing to act on draws nothing",
     seen(drawButtons(tkActs, asked("closeTicket", "device:y"))) === "|[icon] Close|[icon] No action needed|[icon] Need help|" && drawButtons([]) === "");
  const { momentText } = await import("@/utils/dateText");
  const at = "2026-10-30T09:20:00.000Z";
  ck("  ...a Need help that stands is said above the buttons, when and by whom; a step that did not land, under them",
     seen(drawButtons(tkActs, null, { asked: { at, by: "Owner" } })) === `|🆘 Need help asked ${momentText(at)} (Owner)|[icon] Close|[icon] No action needed|[icon] Need help|`
     && seen(drawButtons(tkActs, null, { problem: "Not saved." })) === "|[icon] Close|[icon] No action needed|[icon] Need help|Not saved.|",
     [seen(drawButtons(tkActs, null, { asked: { at, by: "Owner" } })), seen(drawButtons(tkActs, null, { problem: "Not saved." }))]);
}

console.log("\n  a Need help pressed is said on its card, and asked once (architecture review round 6, 2026-10-30):");
{
  const { applyFmCommand } = await import("@/fm/fmCommands");
  const { momentText } = await import("@/utils/dateText");
  const at = "2026-10-30T09:20:00.000Z";
  const press = (d, ids) => applyFmCommand(d, { type: "helpTickets", ids }, { now: at, id: (p) => `${p}-x`, by: "owner" });
  const pump = [rec("a", "sensor.pump_power"), { ...rec("b", "sensor.pump_energy"), status: "in_progress" }];
  const before = fm(pump), after = press(before, ["a", "b"]);
  // the Inbox's card, built as Messages builds it, from the records
  const inbox = (d) => { const { lines } = cockpitCard(groupAttention(attentionOf({ devices: devicesOf(), entities: {}, entityMap: {}, resolvedRooms: {},
    fmData: d }).attentionItems).find((g) => g.items.some((i) => i.ticketId === "a")), null);
    return { asked: lines.find((l) => l.asked)?.asked ?? null, actions: lines.flatMap((l) => l.actions) }; };
  const ticket = (d) => d.tickets.filter((t) => t.id === "b").map(W.workRecord);
  // ⚠️ SAID ONCE (architecture review 23): the card's pill says it; the line above the buttons said it again
  const pillOf = (d) => cockpitCard(groupAttention(attentionOf({ devices: devicesOf(), entities: {}, entityMap: {}, resolvedRooms: {},
    fmData: d }).attentionItems).find((g) => g.items.some((i) => i.ticketId === "a")), null).lines.map((l) => (l.move ? drawnMove(l.move, momentText) : ""));
  ck("pressed on the Inbox: its card's pill says who asked and when, no line repeats it, and no second Need help",
     inbox(before).asked === null && inbox(after).asked === null
     && pillOf(after).includes(`Need help asked by Owner, on ${momentText(at)}`)
     && said(inbox(before).actions).some((x) => x.startsWith("Need help")) && !said(inbox(after).actions).some((x) => x.startsWith("Need help")),
     [inbox(after).asked, pillOf(after), said(inbox(after).actions)]);
  ck("  ...the Tickets tab's card the same, from the same records",
     W.helpAsked(ticket(after)) === null
     && said(W.ticketActions(ticket(after))).join(" | ") === `Close → b (resolved) | No action needed → b ${TK_CLOSE}`
     && said(W.ticketActions(ticket(before))).some((x) => x.startsWith("Need help")), said(W.ticketActions(ticket(after))));
  // a step after the press (a ticket opened on it): the pill says that step, so the line says the help still standing
  const later = { ...after, tickets: after.tickets.map((t) => (t.id !== "b" ? t : { ...t, updates: [...t.updates,
    { at: "2026-10-30T09:30:00.000Z", status: "in_progress", photoIds: [], by: "owner" }] })) };
  ck("  ...once something moved it after the press, the pill says that, and the line \"🆘 Need help asked <when> (Owner)\" says the help",
     W.helpLine(W.helpAsked(ticket(later)), momentText) === `🆘 Need help asked ${momentText(at)} (Owner)`, W.helpAsked(ticket(later)));
  // a record that joined the card since: Need help asks about it alone
  const joined = { ...after, tickets: [...after.tickets, rec("c", "sensor.pump_power")] };
  ck("  ...a record nobody asked about yet brings Need help back, for it alone",
     said(inbox(joined).actions).includes("Need help → c"), said(inbox(joined).actions));
  // the VESTA Agent's line of the escalation it sent, written after the press: its story says it from then on
  const told = { ...after, tickets: after.tickets.map((t) => ({ ...t, updates: [...t.updates,
    { at: "2026-10-30T09:19:00.000Z", status: t.status, kind: "noted", note: "Escalation sent (to: Owner)", photoIds: [] }] })) };
  ck("  ...answered by VESTA (a line written after it, whatever its time), the card's own line goes and Need help is back",
     inbox(told).asked === null && said(inbox(told).actions).some((x) => x.startsWith("Need help")) && W.helpAsked(ticket(told)) === null,
     [inbox(told).asked, said(inbox(told).actions)]);
  // what pressing does, through the one carrier (fm/workPress), with stand-in writers that record the call
  const { pressOutcome, carryOut } = await import("@/fm/workPress");
  const calls = [];
  const writers = { helpTickets: async (ids) => (calls.push(`help ${[...ids].join(",")}`), { done: true }),
    addTicket: async (t, o) => (calls.push(`raise ${t.entityId} then ${o.then}`), { done: true }) };
  const pressWrite = (a, raised) => { const o = pressOutcome(a, { raised }); return o.does === "write" ? carryOut(o.write, writers) : null; };
  const help = W.ticketActions(ticket(before)).find((a) => a.kind === "needHelp");
  const helpNew = W.overviewActions([], "light.example").find((a) => a.kind === "helpNew");
  await pressWrite(help); await pressWrite(helpNew, (id) => ({ title: "x", entityId: id, photoIds: [] }));
  ck("  ...pressed, Need help writes its step on the card's records; on a card with no record, raises it asking for help",
     calls.join(" | ") === "help b | raise light.example then help"
     && pressWrite(W.ticketActions(ticket(before))[0]) === null, calls);
  const closed = { ...after, tickets: after.tickets.map((t) => ({ ...t, status: "resolved" })) };
  ck("  ...and a closed record holds no Need help", closed.tickets.every((t) => E.standingHelp(t) === undefined));
}
console.log("\n  every button, pressed (fm/workPress: one outcome per press, on every tab):");
{
  // ⚠️ architecture review, 2026-11-13: a close was carried out by the buttons, a raise or an edit by the Inbox's card
  // alone, a stage change and the writes by useCardWork; each press is now one outcome, read here by pressing
  const { pressOutcome, carryOut } = await import("@/fm/workPress");
  const outcome = (a, opts) => { const o = pressOutcome(a, opts);
    return o.does === "write" ? `write ${o.write.kind}${o.write.ids ? ` ${o.write.ids.join(",")}` : ""}${o.write.work ? " work" : ""}${o.write.lasting ? " lasting" : ""}`
      : o.does === "stage" ? `stage ${o.ids.join(",")} → ${o.to}` : o.does === "go" ? `go ${o.go.to} ${o.go.id}` : o.does === "ask" ? `ask "${o.confirmLabel}"` : o.does; };
  const pressAll = (acts) => acts.map((a) => `${a.label}: ${outcome(a)}`).join(" | ");
  ck("an issue card's fault: Done closes it as work done, Not a problem closes it while it lasts, Open Ticket opens the stage form, Need help writes its step",
     pressAll(W.overviewActions([{ id: "a", stage: "fault" }])) === "Done: write close a work | Not a problem: write close a lasting | Open Ticket: stage a → in_progress | Need help: write help a",
     pressAll(W.overviewActions([{ id: "a", stage: "fault" }])));
  ck("  ...its ticket: Edit Ticket opens that ticket's form, on any tab drawing it",
     outcome(W.overviewActions([{ id: "t", stage: "ticket" }]).find((a) => a.kind === "editTicket")) === "go editTicket t");
  const tk = W.ticketActions([{ id: "t", stage: "ticket" }]);
  ck("a Tickets card: Close opens its resolve form, No action needed asks first and closes with nothing done on its yes, Need help writes its step",
     pressAll(tk) === "Close: stage t → resolved | No action needed: ask \"No action needed\" | Need help: write help t"
     && outcome(tk[1], { confirmed: true }) === "write close t", pressAll(tk));
  ck("  ...and never Not a problem, whatever its records", !W.ticketActions([{ id: "t", stage: "ticket" }, { id: "f", stage: "fault" }]).some((a) => a.kind === "notAProblem"));
  ck("a closed record's Reopen opens the stage form back to open", pressAll(W.closedActions({ id: "r", stage: "closed" }, true)) === "Reopen: stage r → open");
  const calls = [];
  const rec = (name) => async (...args) => (calls.push(`${name} ${J(args)}`), { done: name !== "helpTickets", note: name === "helpTickets" ? "Not saved" : null });
  const writers = { closeTickets: rec("closeTickets"), advanceTickets: rec("advanceTickets"), helpTickets: rec("helpTickets"), addTicket: rec("addTicket"), send: null };
  const done = await carryOut({ kind: "close", ids: ["a"], work: true }, writers);
  await carryOut({ kind: "close", ids: ["a"], lasting: true }, writers); await carryOut({ kind: "close", ids: ["a"] }, writers);
  const helped = await carryOut({ kind: "help", ids: ["a"] }, writers);
  ck("  ...carried out: work done is the resolve step, while it lasts and no action are closes; a write that did not land says why",
     J(calls) === J([`advanceTickets ${J([["a"], "resolved", { photoIds: [] }])}`, `closeTickets ${J([["a"], true])}`, `closeTickets ${J([["a"]])}`, `helpTickets ${J([["a"]])}`])
     && done.done && !helped.done && helped.note === "Not saved", calls);
  const tabs = [...JSX.elements(JSX.parseTsx("components/fm/TicketsTab.tsx"), "WorkButtons"), icButtons];
  ck("  ...every tab drawing work buttons opens the forms a press asks for (its `onOpen`)", tabs.length === 3 && tabs.every((b) => JSX.propText(b, "onOpen") !== null));
}
ck("a ticket's notes wrap inside its card, never past its edge (owner, 2026-10-14: a long \"VESTA reads\" ran out)",
   /\.fm-record-main \{ display: flex; flex-direction: column; gap: 4px; min-width: 0;/.test(src("styles/07-facility.css"))
   && /\.fm-timeline-note \{[^}]*overflow-wrap: anywhere;/.test(src("styles/07-facility.css")));
console.log("\n  one line per problem (owner, 2026-10-17: \"#49 · One mains phase lost\" six times):");
{
  const { AttentionCard } = await import("@/components/cockpit/IssueCard");
  const lost = (id) => ({ ...rec(id, "sensor.phase_a_voltage,sensor.phase_b_voltage"), title: "One mains phase lost", alertNumber: 49 });
  const six = ["a", "b", "c", "d", "e", "f"].map(lost);
  const ents = { "sensor.phase_b_voltage": { entity_id: "sensor.phase_b_voltage", state: "230", attributes: { friendly_name: "Phase B Voltage" } } };
  const items = attentionOf({ devices: devicesOf(), entities: ents, entityMap: {}, resolvedRooms: {}, fmData: fm([...six, { ...rec("g", "lock.door"), title: "Door unlocked" }]) }).attentionItems;
  const groups = groupAttention(items);
  const g = groups.find((x) => x.items.some((i) => i.title.includes("phase lost")));
  const card = draw(h(AttentionCard, { card: cockpitCard(g, { checkMinutes: 5, nightlyAt: "02:00" }), onOpenEntity: () => {} }));
  const said = text(card);
  ck("six records saying the same are ONE line, counted, its alert's name once (the strip's chip)", (said.match(/One mains phase lost/g) || []).length === 1
     && /One mains phase lost \(6 times\)/.test(said) && (said.match(/#49/g) || []).length === 1, said);
  ck("  ...and its card's buttons still reach all six", cardRecords(g).length === 6, cardRecords(g));
  ck("  ...a different problem keeps its own line", groups.some((x) => x.items.some((i) => i.title === "Door unlocked")));
  // ...two alerts saying the same words are two problems: their names left the words for the strip (architecture review,
  // 2026-11-05), so the words alone would fold #49 and #50 into one line under one chip
  const twoAlerts = groupAttention(attentionOf({ devices: devicesOf(), entities: ents, entityMap: {}, resolvedRooms: {},
    fmData: fm([lost("a"), { ...lost("b"), alertNumber: 50 }]) }).attentionItems).find((x) => x.items.some((i) => i.title.includes("phase lost")));
  ck("  ...two alerts with the same words: two lines, each its own name", twoAlerts.items.length === 2
     && twoAlerts.items.map((i) => i.alertLabel).join() === "#49,#50", twoAlerts.items.map((i) => [i.alertLabel, i.twins]));
  ck("a record naming several devices (\"a,b\") is the first the villa has, never a device called \"…,sensor\"",
     g.entityId === "sensor.phase_b_voltage" && !/,sensor/.test(g.title), g.entityId, g.title);
}

ck("the screens ask stageOf (or its count, openCounts, or the record's life: recordLife, closedTickets), never the status themselves",
   ["components/fm/TicketsTab.tsx", "components/fm/FaultForm.tsx", "components/fm/TodayTab.tsx"].every((f) => /stageOf\(|openCounts\(|recordLife\(|closedTickets\(/.test(src(f)) && !/status === "in_progress"|status !== "in_progress"|status === "open"/.test(src(f))));
// owner, 2026-11-01: a record is called a ticket only while it is one, or closed as one; a reopened ex-ticket is a fault
ck("the form's heading says Edit ticket for a ticket or a closed ticket (its life: recordLife) and Edit fault for anything else",
   /const heading = !editing \? "Open a ticket" : recordLife\(editing\)\.ticket \? "Edit ticket" : "Edit fault";/.test(src("components/fm/FaultForm.tsx")));
ck("the fault form is one, shared by raising and editing", /<FaultForm editing=\{t\} /.test(tt) && !/<input value=\{title\}/.test(ov + tt));

done("✅ one list of live issues; faults become tickets; the same with or without the Agent");
