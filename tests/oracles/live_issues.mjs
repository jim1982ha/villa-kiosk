// The Overview's Live issues and the Tickets tab (owner, 2026-10-14): ONE list of everything open on the Overview, a
// card per device — what Home Assistant reports right now (no buttons: it clears when the device does), faults the
// VESTA Agent or a person opened, tickets in progress. "Mark in progress" makes a card's faults ONE ticket (each still
// its own record, so the Agent can clear one alone), "Edit ticket" then opens it in the Tickets tab, which holds the
// tickets in progress and the Closed ones. It replaced "Needs attention" and the Faults tab's open list (the same
// faults twice). The same with or without the Agent: only where faults come from differs.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const E = await import("@/fm/fmEngine");
const { ticketGroups } = await import("@/fm/ticketGroups");
const { groupAttention, cardActions } = await import("@/config/attention");
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

console.log("\n  the screens:");
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const ov = src("components/cockpit/CockpitOverview.tsx"), tt = src("components/fm/TicketsTab.tsx");
ck("the Tickets tab lists the tickets in progress (by device) and Closed — never an open fault",
   /data\.tickets\.filter\(\(t\) => stageOf\(t\) === "ticket"\)/.test(tt) && /ticketGroups\(/.test(tt) && !/Raise a fault/.test(tt));
ck("the Overview's title line: the (i) then Open a ticket, for the profiles that manage tickets; a guest reports a problem",
   /<FaultTiming \/>\s*<button className="btn ghost" onClick=\{\(\) => setRaising\(\{\}\)\}><Plus size=\{16\} \/> Open a ticket<\/button>/.test(ov) && /Report a problem<\/button>/.test(ov) && /<FaultForm /.test(ov));
ck("a card draws what cardActions says (no rule of its own)",
   /const acts = cardActions\(group\);/.test(ov) && /setStaging\(records\(acts\.markInProgress\)\)\}>Mark in progress/.test(ov)
   && /onEditTicket\(acts\.editTicket as string\)/.test(ov) && /closeTickets\(acts\.close\)/.test(ov) && !/in_progress"/.test(ov.replace(/to="in_progress"/, "")));
ck("the screens ask stageOf, never the status themselves",
   ["components/fm/TicketsTab.tsx", "components/fm/FaultForm.tsx", "components/fm/TodayTab.tsx"].every((f) => /stageOf\(/.test(src(f)) && !/status === "in_progress"|status !== "in_progress"|status === "open"/.test(src(f))));
ck("the fault form is one, shared by raising and editing", /<FaultForm key=\{editing\.id\} editing=\{editing\}/.test(tt) && !/<input value=\{title\}/.test(ov + tt));

done("✅ one list of live issues; faults become tickets; the same with or without the Agent");
