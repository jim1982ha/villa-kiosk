// Every change to the Facility record is one pure step (src/fm/fmCommands.ts): who did it, when and the new ids are
// stamped there, the same for every write (architecture review, 2026-10-14). A fault a person RAISED carried no step
// and no author — "Opened 14:20" where its close read "by Facility manager". Driven by value. Since 2.496.623 the
// profile is stamped by its id beside its words (roles.authorStamp; architecture review round 8, 2026-10-30).
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { applyFmCommand } = await import("@/fm/fmCommands");
const { faultWhen } = await import("@/fm/faultNotes");
const { ROLE_LABELS } = await import("@/auth/roles");
const { faultSource } = await import("@/fm/issueSource");

let n = 0;
const k = (by) => ({ now: "2026-10-14T06:20:00.000Z", id: (p) => `${p}${++n}`, by });
const EMPTY = { schedules: [], completions: [], costs: [], tickets: [], savedDocuments: [] };
const stamp = (at) => at.slice(11, 16);

console.log("  a raised fault says who raised it:");
const raised = applyFmCommand(EMPTY, { type: "addTicket", ticket: { title: "Dripping tap", photoIds: [] } }, k("owner"));
const t = raised.tickets[0];
ck("a new fault: open, stamped now, its first step the raising — by the profile that raised it",
   t.status === "open" && t.openedAt === "2026-10-14T06:20:00.000Z" && t.updates?.length === 1
   && t.updates[0].status === "open" && t.updates[0].by === "Owner" && t.updates[0].role === "owner" && !t.updates[0].kind, t);
ck("  ...and its card says so", faultWhen(t, stamp) === "Opened 06:20 by Owner", faultWhen(t, stamp));
const guest = applyFmCommand(EMPTY, { type: "addTicket", ticket: { title: "Noisy AC", photoIds: [], reportedBy: "guest" } }, k("guest"));
ck("a guest's report: by Guest", faultWhen(guest.tickets[0], stamp) === "Opened 06:20 by Guest");
// The stamp is the profile's id and the role table's label (roles.json profiles.<role> — ONE table for the app and the
// proxy). The words STORED on every step until 2.496.622 were "Guest", "Owner", "Facility manager": the facility
// profile's became "Facility Manager" (owner, 2026-10-30), and its old steps are read as its own (formerLabels), so
// the words are pinned here on purpose — a renamed label is a decision about old records too.
ck("the stamp is the profile's id and the role table's label",
   ROLE_LABELS.guest === "Guest" && ROLE_LABELS.owner === "Owner" && ROLE_LABELS.ops === "Facility Manager"
   && guest.tickets[0].updates[0].role === "guest" && guest.tickets[0].updates[0].by === "Guest", ROLE_LABELS);
ck("  ...and a card reads it back through the same table (its source icon: the Owner's badge), old words included",
   faultSource(t) === "owner" && faultSource({ ...t, updates: [{ ...t.updates[0], by: "x", role: "ops" }] }) === "fm"
   && faultSource({ ...t, updates: [{ at: t.openedAt, status: "open", photoIds: [], by: "Facility manager" }] }) === "fm"
   && faultWhen({ ...t, updates: [{ at: t.openedAt, status: "open", photoIds: [], by: "Facility manager" }] }, stamp)
     === "Opened 06:20 by Facility Manager");
const agent = { ...t, source: "vesta_agent", updates: [{ ...t.updates[0], by: "VESTA Agent" }] };
ck("the VESTA Agent's own fault does not repeat its mark on this line", faultWhen(agent, stamp) === "Opened 06:20");

const opened = applyFmCommand(EMPTY, { type: "addTicket", ticket: { title: "Pump capacitor", photoIds: [] }, asTicket: true }, k("owner"));
const tk = opened.tickets[0];
ck("\"Open a ticket\" (owner, 2026-10-14): a TICKET at once — in progress, taken on by whoever opened it",
   tk.status === "in_progress" && tk.updates.length === 1 && tk.updates[0].status === "in_progress" && tk.updates[0].by === "Owner");
ck("  ...its card says when and by whom", faultWhen(tk, stamp) === "Opened 06:20 · in progress since 06:20 by Owner", faultWhen(tk, stamp));

console.log("\n  every write, one way:");
const closed = applyFmCommand(raised, { type: "closeTickets", ids: [t.id] }, k("ops"));
ck("closing stamps who closed it", closed.tickets[0].status === "resolved"
   && closed.tickets[0].updates.at(-1).by === "Facility Manager" && closed.tickets[0].updates.at(-1).role === "ops");
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

console.log("\n  Done · Need help · Open Ticket on every issue card (owner, 2026-10-30):");
{
  const AGREED = JSON.parse((await import("node:fs")).readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8"));
  const two = applyFmCommand(applyFmCommand(EMPTY, { type: "addTicket", ticket: { title: "Pump weak", photoIds: [] } }, k("owner")),
    { type: "addTicket", ticket: { title: "Pump noisy", photoIds: [] }, asTicket: true }, k("owner"));
  const [a, b] = two.tickets;
  const helped = applyFmCommand(two, { type: "helpTickets", ids: [a.id, b.id] }, k("ops"));
  const last = (t) => t.updates[t.updates.length - 1];
  ck("Need help writes a \"help\" step on each record, by the profile, its status unchanged (the agreement's own kind)",
     helped.tickets.every((t, i) => last(t).kind === "help" && last(t).role === "ops" && t.status === two.tickets[i].status
       && last(t).status === t.status)
     && AGREED.ticketUpdate.kinds.includes("help") && AGREED.ticketUpdate.notStatusChanges.includes("help"), helped.tickets.map(last));
  const shut = applyFmCommand(two, { type: "closeTickets", ids: [a.id] }, k("owner"));
  ck("  ...a closed record gets none", applyFmCommand(shut, { type: "helpTickets", ids: [a.id] }, k("owner")).tickets[0].updates.length
     === shut.tickets[0].updates.length);
  const doneNew = applyFmCommand(EMPTY, { type: "addTicket", ticket: { title: "LED Strip: Unavailable", entityId: "light.example", photoIds: [] },
    then: "done" }, k("owner"));
  const helpNew = applyFmCommand(EMPTY, { type: "addTicket", ticket: { title: "LED Strip: Unavailable", entityId: "light.example", photoIds: [] },
    then: "help" }, k("owner"));
  ck("  ...Done on a card with no record: its fault raised and resolved in ONE write, by the profile, as work done",
     doneNew.tickets.length === 1 && doneNew.tickets[0].status === "resolved" && doneNew.tickets[0].updates.map((u) => u.status).join() === "open,resolved"
     && last(doneNew.tickets[0]).role === "owner" && last(doneNew.tickets[0]).kind === undefined
     && doneNew.completions.length === 1 && doneNew.completions[0].ticketId === doneNew.tickets[0].id, doneNew);
  // owner, 2026-10-30 (review round 4): a Done is WORK DONE wherever it is pressed — Telegram's filed a completion in
  // Recent work, the Cockpit card's a "Closed without action" gone after 90 days
  {
    const { DONE_STEP } = await import("@/fm/fmCommands");
    const { WORK_ACTIONS } = await import("@/fm/deviceWork");
    const done = applyFmCommand(two, { type: "advanceTickets", ids: [a.id, b.id], to: "resolved", step: DONE_STEP }, k("owner"));
    ck("a card's Done resolves every record as work done: one completion each, by who pressed, never \"Closed without action\"",
       done.tickets.every((t) => t.status === "resolved" && last(t).kind === undefined && last(t).note !== "Closed without action")
       && done.completions.filter((c) => c.ticketId === a.id || c.ticketId === b.id).length === 2
       && done.completions.every((c) => c.by === "Owner" && c.role === "owner"), done);
    ck("  ...the issue card's Done asks first and files work (work: true); the Tickets tab's Close stays a no-action close",
       WORK_ACTIONS.done.step.kind === "close" && WORK_ACTIONS.done.step.work === true
       && WORK_ACTIONS.closeTicket.step.kind === "close" && !WORK_ACTIONS.closeTicket.step.work
       && WORK_ACTIONS.doneNew.step.kind === "raiseThen" && WORK_ACTIONS.doneNew.step.then === "done");
    const wb = (await import("node:fs")).readFileSync(new URL("../../src/components/fm/WorkButtons.tsx", import.meta.url), "utf8");
    ck("  ...the one confirm flow sends a work Done through the resolving command, a Close through the no-action one",
       /work \? advanceTickets\(ids, "resolved", DONE_STEP\) : closeTickets\(ids\)/.test(wb)
       && /work\.close\(cardKey, confirming\.ids, asWork\)/.test(wb));
  }
  ck("  ...Need help on it: raised and asked for help in ONE write, still open",
     helpNew.tickets[0].status === "open" && last(helpNew.tickets[0]).kind === "help", helpNew.tickets[0]);
  const { raisedFor } = await import("@/components/cockpit/IssueCard");
  const { recordPlace } = await import("@/fm/recordPlace");
  const lines = [{ text: "" }, { text: "Unavailable" }];
  const rooms = { "light.example": "Living Room", "light.roomless": "" };
  // the card's room line as IssueCard draws it ("Other" for a device in no room) is passed too: it must never be stored
  const r = raisedFor({ title: "LED Strip", room: "Somewhere else", lines }, recordPlace("light.example", "LED Strip", rooms));
  ck("  ...the fault it raises is titled by the device and what its line says, at its device's place (fm/recordPlace)",
     r.title === "LED Strip: Unavailable" && r.entityId === "light.example" && r.room === "Living Room" && r.deviceLabel === "LED Strip", r);
  // ⚠️ "OTHER" STORED AS A ROOM (architecture review round 6, 2026-10-30): the card's room line was saved as the ticket's
  // room, and "Other" is a label for no room — a pill on the Tickets tab no other record of it showed
  const none = raisedFor({ title: "LED Strip", room: "Other", lines }, recordPlace("light.roomless", "LED Strip", rooms));
  ck("  ...a device in no room: no room stored, never \"Other\"", none.entityId === "light.roomless" && !("room" in none), none);
}

done("✅ every Facility change is one command, who and when stamped there");
