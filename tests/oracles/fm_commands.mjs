// Every change to the Facility record is one pure step (src/fm/fmCommands.ts): who did it, when and the new ids are
// stamped there, the same for every write (architecture review, 2026-10-14). A fault a person RAISED carried no step
// and no author — "Opened 14:20" where its close read "by Facility manager". Driven by value.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { applyFmCommand } = await import("@/fm/fmCommands");
const { faultWhen } = await import("@/fm/faultNotes");

let n = 0;
const k = (by) => ({ now: "2026-10-14T06:20:00.000Z", id: (p) => `${p}${++n}`, by });
const EMPTY = { schedules: [], completions: [], costs: [], tickets: [], savedDocuments: [] };
const stamp = (at) => at.slice(11, 16);

console.log("  a raised fault says who raised it:");
const raised = applyFmCommand(EMPTY, { type: "addTicket", ticket: { title: "Dripping tap", photoIds: [] } }, k("Owner"));
const t = raised.tickets[0];
ck("a new fault: open, stamped now, its first step the raising — by the profile that raised it",
   t.status === "open" && t.openedAt === "2026-10-14T06:20:00.000Z" && t.updates?.length === 1
   && t.updates[0].status === "open" && t.updates[0].by === "Owner" && !t.updates[0].kind, t);
ck("  ...and its card says so", faultWhen(t, stamp) === "Opened 06:20 by Owner", faultWhen(t, stamp));
const guest = applyFmCommand(EMPTY, { type: "addTicket", ticket: { title: "Noisy AC", photoIds: [], reportedBy: "guest" } }, k("Guest"));
ck("a guest's report: by Guest", faultWhen(guest.tickets[0], stamp) === "Opened 06:20 by Guest");
const agent = { ...t, source: "vesta_agent", updates: [{ ...t.updates[0], by: "VESTA Agent" }] };
ck("the VESTA Agent's own fault does not repeat its mark on this line", faultWhen(agent, stamp) === "Opened 06:20");

const opened = applyFmCommand(EMPTY, { type: "addTicket", ticket: { title: "Pump capacitor", photoIds: [] }, asTicket: true }, k("Owner"));
const tk = opened.tickets[0];
ck("\"Open a ticket\" (owner, 2026-10-14): a TICKET at once — in progress, taken on by whoever opened it",
   tk.status === "in_progress" && tk.updates.length === 1 && tk.updates[0].status === "in_progress" && tk.updates[0].by === "Owner");
ck("  ...its card says when and by whom", faultWhen(tk, stamp) === "Opened 06:20 · in progress since 06:20 by Owner", faultWhen(tk, stamp));

console.log("\n  every write, one way:");
const closed = applyFmCommand(raised, { type: "closeTickets", ids: [t.id] }, k("Facility manager"));
ck("closing stamps who closed it", closed.tickets[0].status === "resolved"
   && closed.tickets[0].updates.at(-1).by === "Facility manager");
const sched = applyFmCommand(EMPTY, { type: "addSchedule", schedule: { title: "Pool filter", intervalDays: 7 } }, k());
ck("a schedule gets its id and creation time from the stamp", sched.schedules[0].createdAt === "2026-10-14T06:20:00.000Z" && /^sc\d+$/.test(sched.schedules[0].id));
const doc = applyFmCommand(EMPTY, { type: "saveDocument", doc: { kind: "recap", month: "2026-09", markdown: "x" } }, k());
ck("a saved document too", doc.savedDocuments[0].generatedAt === "2026-10-14T06:20:00.000Z" && /^doc\d+$/.test(doc.savedDocuments[0].id));
const cost = applyFmCommand(EMPTY, { type: "addCost", cost: { at: "2026-10-14", amountIdr: 5, label: "x", category: "minor", photoIds: [] } }, k());
const fixed = applyFmCommand(cost, { type: "updateCost", id: cost.costs[0].id, patch: { amountIdr: 7 } }, k());
ck("a spend entry, then corrected", fixed.costs[0].amountIdr === 7 && fixed.costs.length === 1);
ck("removing every schedule keeps the completions (evidence of work done)",
   applyFmCommand({ ...EMPTY, schedules: [{ id: "s" }], completions: [{ id: "c" }] }, { type: "removeAllSchedules" }, k()).completions.length === 1);
ck("the record passed in is never changed", raised.tickets[0].status === "open" && EMPTY.tickets.length === 0);

done("✅ every Facility change is one command, who and when stamped there");
