// tests/oracles/facility_numbers.mjs
//
// The numbers that reach the owner's report.
//
// ⚠️ src/fm/ IS PURE, REACHABLE, AND WAS ENTIRELY UNTESTED. 1,515 lines with no
// React and no network, importable by this loader with zero setup — and the only
// oracle that named it, ticket_status.mjs, re-implemented the open/resolved
// split in its own file and never touched the arithmetic. So every figure in the
// document an owner keeps as a record was produced by code nothing watched.
//
// Each block below is a rule that was silently wrong, in the direction that
// reads as compliance. That direction is the point: fmEngine's own comment says
// it — "a fault wrongly shown as open is a question someone asks; a fault
// wrongly shown as resolved is one nobody ever asks again."
// ⚠️ THE ALIAS HOOK, BECAUSE fm/ USES EXTENSIONLESS IMPORTS. fmEngine does
// `from "./fmTypes"`, which bare node cannot resolve — the same reason
// badge_geometry.mjs registers it. A direct `../../src/...` import fails at
// load, and run-all.sh discards stderr, so it would have read as a rule
// violation rather than a file that never ran.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);

const {
  ticketStats, scheduleStatus, budgetStatus, monthLabel, shortDate,
} = await import("@/fm/fmEngine");
const { openCounts } = await import("@/fm/deviceWork");
const { formatMoney } = await import("@/utils/money");
const { spendSummary } = await import("@/fm/fmDocuments");

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};
const HOUR = 3_600_000;
const t = (o) => ({ id: "t", title: "x", status: "resolved", openedAt: "2026-09-01T00:00:00Z", ...o });

console.log("  the mean says how many tickets it covers:");
// ⚠️ `resolved` and `timed` are independent counters. A ticket resolved with no
// resolvedAt — or with one BEFORE its openedAt — counts as resolved and is
// skipped by the mean. The report could print "Resolved: 3" beside a mean over
// one, with no signal the two numbers describe different sets.
const mixed = ticketStats([
  t({ resolvedAt: "2026-09-01T02:00:00Z" }),   // 2h, counted
  t({ resolvedAt: undefined }),                 // resolved, never timed
  t({ resolvedAt: "2026-08-31T00:00:00Z" }),    // resolved BEFORE opened
]);
eq("all three count as resolved", mixed.resolved, 3);
eq("...but the mean covers only the usable one", mixed.meanCoversTickets, 1);
eq("...and it is that one's duration", mixed.meanResolutionHours, 2);
eq("with nothing timed, the mean is null rather than 0",
   ticketStats([t({ resolvedAt: undefined })]).meanResolutionHours, null);
// An unknown status counts as OPEN, never resolved — the rule fmEngine states. What is open is counted per device
// card (deviceWork.openCounts — the Tickets tab's unit, and now the recap's); ticketStats keeps the per-record figures.
eq("a corrupt status counts as open", openCounts([t({ status: "" })], (id) => id).faults, 1);
eq("...and is not silently resolved", ticketStats([t({ status: "" })]).resolved, 0);

console.log("\n  how a fault was closed is its last STATUS step (architecture review, 2026-10-15):");
// a title change or a Telegram line written after the close carries "resolved" too: read as the close, a cleared Wi-Fi
// blip renamed afterwards counted as a repair and its hours went into the mean
const st = (at, status, x = {}) => ({ at, status, photoIds: [], ...x });
const blip = (...after) => t({ resolvedAt: "2026-09-01T00:10:00Z", updates: [st("2026-09-01T00:00:00Z", "open"),
  st("2026-09-01T00:10:00Z", "resolved", { kind: "cleared", note: "Cleared: back online." }), ...after] });
const renamed = ticketStats([blip(st("2026-09-02T00:00:00Z", "resolved", { kind: "retitled", title: "a", was: "b" }))]);
eq("a cleared blip renamed afterwards: still closed with no action, not a repair",
   [renamed.closedWithoutAction, renamed.resolved, renamed.meanResolutionHours], [1, 0, null]);
const noted = ticketStats([blip(st("2026-09-01T00:20:00Z", "resolved", { kind: "noted", note: "Reminder sent" }))]);
eq("  ...and with a Telegram line noted after it", [noted.closedWithoutAction, noted.resolved], [1, 0]);
const { CLEARED_NOTES } = await import("@/fm/fmTypes");
const { CLOSED_WITHOUT_ACTION } = await import("@/fm/fmEngine");
eq("the Kiosk's own \"Close\" note is one the agreement lists (the proxy reads the same list)",
   CLEARED_NOTES.includes(CLOSED_WITHOUT_ACTION), true);

console.log("\n  an unreadable date is not 'on schedule':");
// ⚠️ THE FALLTHROUGH. Every comparison against NaN is false, so an unparseable
// completion date walked past "overdue" and past "due-soon" and landed on "ok" —
// a maintenance obligation whose record cannot be read, printed as compliant.
const sched = { id: "s", task: "Service the pumps", everyDays: 30 };
const now = Date.parse("2026-09-15T00:00:00Z");
eq("a garbled completion date reads as never recorded",
   scheduleStatus(sched, [{ id: "c", scheduleId: "s", at: "not-a-date" }], now).state, "never");
eq("no completion at all also reads as never",
   scheduleStatus(sched, [], now).state, "never");
eq("a completion 40 days ago is overdue",
   scheduleStatus(sched, [{ id: "c", scheduleId: "s", at: "2026-08-06T00:00:00Z" }], now).state, "overdue");
eq("a completion today is on schedule",
   scheduleStatus(sched, [{ id: "c", scheduleId: "s", at: "2026-09-15T00:00:00Z" }], now).state, "ok");

console.log("\n  an unconfigured cap is not a cap of zero:");
// ⚠️ THE "of 0" DEFECT, THIRD AND FOURTH READERS. budgetStatus reports
// cap <= 0 as "not configured" — state ok, fraction 0 — and the two report
// documents printed the unset value anyway: "0 of the 0 monthly cap (0%)".
// SpendTab and TodayTab were corrected in 2.496.31; the pin written with them
// named only those two files, which is how fmDocuments survived it.
const noCap = budgetStatus([], "2026-09", { monthlyCap: 0, warnAt: 0.8 });
eq("no cap configured reads as ok, not exceeded", noCap.state, "ok");
eq("...with fraction 0, never NaN or Infinity", noCap.fraction, 0);
eq("...and the report says so in words, not as a zero",
   spendSummary(noCap)[0].includes("no monthly cap configured"), true);
eq("...and does not print a cap figure at all",
   /of the .* monthly cap/.test(spendSummary(noCap)[0]), false);
const withCap = budgetStatus(
  [{ id: "c", at: "2026-09-02T00:00:00Z", label: "Pump seal", category: "minor", amountIdr: 900 }],
  "2026-09", { monthlyCap: 1000, warnAt: 0.8 });
eq("a configured cap still reports the fraction", withCap.fraction, 0.9);
eq("...and reads as approaching at 80%", withCap.state, "approaching");
eq("...and the report prints the cap", spendSummary(withCap)[0].includes("monthly cap"), true);

console.log("\n  a malformed month does not become 'Invalid Date':");
eq("a garbled month key is echoed, not rendered", monthLabel("not-a-month"), "not-a-month");
eq("month 13 is refused", monthLabel("2026-13"), "2026-13");
eq("a real month renders", /2026/.test(monthLabel("2026-07")), true);

console.log("\n  nothing prints a currency nobody configured:");
// ONE money look (utils/money, 2.496.263): Home Assistant's currency, the
// reader's locale's currency style — Facility wrote "EUR 450,000", Energy "€".
eq("no currency configured shows the amount alone", formatMoney(450000, "", "en-US"), "450,000");
eq("a configured one in the locale's currency style", formatMoney(450000, "EUR", "en-US"), "€450,000");
eq("  ...whole units from 100 up, cents below", formatMoney(12.5, "EUR", "en-US"), "€12.50");
eq("  ...an unfamiliar code is written AS the code, never as a wrong symbol", formatMoney(1500, "XQZ", "en-US").replace(/\s/g, " "), "XQZ 1,500");
eq("a short date renders without throwing", typeof shortDate("2026-07-24T00:00:00Z"), "string");

console.log("\n  a figure names its period (architecture review, 2026-10-19: \"Resolved (all time)\" was the kept record):");
{
  const { keptDays, monthBounds, closedTicketStats } = await import("@/fm/fmEngine");
  const { h, draw, text } = await import("../consistency/screen.mjs");
  const { TicketFigures } = await import("@/components/fm/TicketsTab");
  const NOW = Date.parse("2026-12-31T12:00:00Z"), DAY = 86_400_000;
  const iso = (ms) => new Date(ms).toISOString();
  // a TICKET closed `daysAgo`, `hours` after its Open Ticket; `cleared`: with no work done; `waited`: hours it sat as a
  // fault before anyone took it on (owner, 2026-11-01: a ticket's time starts at its Open Ticket)
  const closed = (id, daysAgo, hours, cleared, waited = 0) => {
    const end = NOW - daysAgo * DAY, taken = end - hours * HOUR;
    return { id, title: id, status: "resolved", openedAt: iso(taken - waited * HOUR), resolvedAt: iso(end), photoIds: [],
      updates: [{ at: iso(taken), status: "in_progress", photoIds: [] },
        { at: iso(end), status: "resolved", photoIds: [], ...(cleared ? { kind: "cleared", note: "Closed without action" } : {}) }] };
  };
  // ...and a fault the VESTA Agent cleared by itself, nobody taking it on: never in the Tickets tab's figures
  const agentCleared = { id: "agent5", title: "agent5", status: "resolved", openedAt: iso(NOW - 5 * DAY - HOUR), resolvedAt: iso(NOW - 5 * DAY),
    photoIds: [], updates: [{ at: iso(NOW - 5 * DAY), status: "resolved", kind: "cleared", photoIds: [] }] };
  const tickets = [closed("blip91", 91, 1, true), closed("blip89", 89, 1, true), closed("fix100", 100, 2), closed("fix10", 10, 6, false, 48)];
  eq("the kept record is the shorter window the server publishes (0 = for ever, not a bound)",
     [keptDays({ clearedDays: 90, repairedDays: 365 }), keptDays({ clearedDays: 90, repairedDays: 0 }), keptDays({ clearedDays: 0, repairedDays: 0 })], [90, 90, null]);
  const kept = ticketStats(tickets, { start: NOW - 90 * DAY, end: NOW + 1 });
  eq("over the kept record: the 91-day-old no-action close and the 100-day-old repair are out (a fault's time: from raised, 48h + 6h)",
     [kept.closedWithoutAction, kept.resolved, kept.meanResolutionHours], [1, 1, 54]);
  const keptTickets = closedTicketStats([...tickets, agentCleared], { start: NOW - 90 * DAY, end: NOW + 1 });
  eq("  ...the TICKETS' figures: the Agent's own clear is not one, and a ticket's time runs from its Open Ticket (6h)",
     [keptTickets.closedWithoutAction, keptTickets.resolved, keptTickets.meanResolutionHours], [1, 1, 6]);
  eq("  ...with no window, every record given (the old figures)", [ticketStats(tickets).closedWithoutAction, ticketStats(tickets).resolved], [2, 2]);
  const tab = text(draw(h(TicketFigures, { tickets: [...tickets, agentCleared], inProgress: 0, retention: { clearedDays: 90, repairedDays: 365 }, now: NOW })));
  eq("the Tickets tab draws those figures, and names their window",
     tab, "|0|in progress|6h|mean resolution|1|closed, no action|Over the kept record (90 days).|");
  const unsaid = text(draw(h(TicketFigures, { tickets, inProgress: 0, retention: null, now: NOW })));
  eq("  ...a server that did not say: what is held, and no number of days claimed", unsaid.endsWith("|Over the kept record.|"), true);
  // the month as it stood at its end: fixed in November, reopened and cleared in December — November's repair
  const twice = { ...closed("twice", 5, 1, true), openedAt: "2026-11-10T00:00:00Z",
    updates: [{ at: "2026-11-10T04:00:00Z", status: "resolved", photoIds: [] }, { at: "2026-12-20T00:00:00Z", status: "open", photoIds: [], kind: "reopened" },
      { at: iso(NOW - 5 * DAY), status: "resolved", photoIds: [], kind: "cleared", note: "Closed without action" }] };
  const nov = ticketStats([twice], monthBounds("2026-11")), dec = ticketStats([twice], monthBounds("2026-12"));
  eq("a month counts its own closes, each as it stood then: November a 4 h repair, December a close with no action",
     [nov.resolved, nov.meanResolutionHours, nov.closedWithoutAction, dec.resolved, dec.closedWithoutAction], [1, 4, 0, 0, 1]);
}

// owner, 2026-10-20: work done and money spent are kept for the record's window, said under their lists
{
  const { recordsKeptNote } = await import("@/fm/fmEngine");
  const { parseRetention } = await import("@/fm/fmApi");
  eq("the window of work done and money spent is read beside the record; an older add-on (none said) kept them for ever",
     [parseRetention({ clearedDays: 90, repairedDays: 365, recordsDays: 365 }).recordsDays,
      parseRetention({ clearedDays: 90, repairedDays: 365 }).recordsDays], [365, 0]);
  eq("  ...and said under the list it shortens; nothing said when kept for ever or not known",
     [recordsKeptNote({ clearedDays: 90, repairedDays: 365, recordsDays: 365 }, "Spend"),
      recordsKeptNote({ clearedDays: 90, repairedDays: 0, recordsDays: 0 }, "Work"), recordsKeptNote(null, "Work")],
     ["Spend older than 365 days is no longer kept (Advanced Settings › System).", null, null]);
}

console.log("\n  the Tickets tab counts tickets, not every fault (owner, 2026-11-01: \"189 closed … are you mixing faults with tickets?\"):");
{
  // driven through the one way in for every change (fmCommands applyFmCommand), as the store runs it
  const { applyFmCommand } = await import("@/fm/fmCommands");
  const { recordLife, closedTickets } = await import("@/fm/fmEngine");
  const wasTicket = (t) => recordLife(t).ticket;
  const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
  let n = 0;
  const k = (min) => ({ now: new Date(Date.UTC(2026, 9, 31, 0, min)).toISOString(), id: (p) => p + (++n), by: "owner" });
  const agentFault = { id: "a1", title: "Offline", status: "open", openedAt: "2026-10-31T00:00:00Z", photoIds: [],
    updates: [{ at: "2026-10-31T00:00:00Z", status: "open", by: "VESTA Agent", photoIds: [] }] };
  let d = { ...EMPTY_FM_DATA, tickets: [agentFault, { ...agentFault, id: "a2" }] };
  d = applyFmCommand(d, { type: "addTicket", ticket: { title: "Tap drips", photoIds: [] }, asTicket: true }, k(1));
  d = applyFmCommand(d, { type: "advanceTickets", ids: ["a2"], to: "in_progress", step: { photoIds: [] } }, k(2));
  // the Agent clears a1 by itself; the owner resolves both tickets, and closes another fault with no action
  d = { ...d, tickets: d.tickets.map((t) => (t.id === "a1" ? { ...t, status: "resolved", resolvedAt: "2026-10-31T00:05:00Z",
    updates: [...t.updates, { at: "2026-10-31T00:05:00Z", status: "resolved", kind: "cleared", by: "VESTA Agent", photoIds: [] }] } : t)) };
  const mine = d.tickets.find((t) => t.title === "Tap drips").id;
  d = applyFmCommand(d, { type: "advanceTickets", ids: [mine, "a2"], to: "resolved", step: { photoIds: [] } }, k(3));
  const by = Object.fromEntries(d.tickets.map((t) => [t.title === "Tap drips" ? "mine" : t.id, wasTicket(t)]));
  eq("a fault the VESTA Agent cleared by itself was never a ticket; one taken on (Open Ticket) or opened as one was",
     by, { a1: false, a2: true, mine: true });
  eq("  ...closed, still a ticket: the step that took it on is kept", d.tickets.filter((t) => t.status === "resolved" && wasTicket(t)).length, 2);
  const tab = readFileSync(new URL("../../src/components/fm/TicketsTab.tsx", import.meta.url), "utf8");
  eq("  ...the tab's Closed list is the closed tickets', never every record (the Agent's own clear, the open ticket out)",
     closedTickets(d.tickets).map((t) => (t.title === "Tap drips" ? "mine" : t.id)).sort(), ["a2", "mine"]);
  eq("  ...and the tab lists that", /const closed = useMemo\(\(\) => closedTickets\(data\.tickets\), \[data\.tickets\]\);/.test(tab), true);
  // owner, 2026-11-01: "nothing shall be counted as a closed ticket if a ticket hasn't been opened first"
  const ticketTimeMs = (t) => recordLife(t).ticketMs;
  const reopenedThenCleared = applyFmCommand(applyFmCommand(d, { type: "advanceTickets", ids: ["a2"], to: "open",
    step: { photoIds: [] } }, k(4)), { type: "closeTickets", ids: ["a2"] }, k(5)).tickets.find((t) => t.id === "a2");
  eq("  ...a ticket reopened (a fault again) and then closed is a closed FAULT, not a closed ticket",
     [reopenedThenCleared.status, wasTicket(reopenedThenCleared)], ["resolved", false]);
  eq("  ...a closed ticket's time runs from its Open Ticket to its close (1min here), not from when the fault was raised",
     ticketTimeMs(d.tickets.find((t) => t.id === "a2")), 60_000);
}

console.log("\n  a record's life, read once (architecture review round 13: \"is this a ticket?\" was worked out in nine places):");
{
  const { recordLife, recordsByStage, monthBounds } = await import("@/fm/fmEngine");
  // raised by VESTA, taken on (Open Ticket), done with work, reopened by VESTA, then cleared with no action
  const life = { id: "l1", title: "Pump", status: "resolved", openedAt: "2026-09-01T00:00:00Z", resolvedAt: "2026-10-03T00:00:00Z",
    photoIds: [], updates: [
      { at: "2026-09-01T00:00:00Z", status: "open", by: "VESTA Agent", photoIds: [] },
      { at: "2026-09-02T00:00:00Z", status: "in_progress", photoIds: [] },
      { at: "2026-09-02T06:00:00Z", status: "resolved", photoIds: [] },
      { at: "2026-09-02T07:00:00Z", status: "resolved", kind: "noted", note: "Reminder sent", photoIds: [] },
      { at: "2026-10-02T00:00:00Z", status: "open", kind: "reopened", photoIds: [] },
      { at: "2026-10-03T00:00:00Z", status: "resolved", kind: "cleared", note: "Closed without action", photoIds: [] }] };
  const pick = (l) => ({ stage: l.stage, ticket: l.ticket, ticketFrom: l.ticketFrom ?? null, how: l.how ?? null,
    faultSince: l.faultSince, reopened: l.reopened, ticketMs: l.ticketMs, openMs: l.openMs, resolvedAt: l.resolvedAt ?? null });
  const H = 3_600_000;
  eq("now: reopened and cleared, a closed FAULT (not a ticket), closed with no action, a fault again since its reopening",
     pick(recordLife(life)), { stage: "closed", ticket: false, ticketFrom: null, how: "no-action", faultSince: "2026-10-02T00:00:00Z",
       reopened: 1, ticketMs: null, openMs: 30 * H + 24 * H, resolvedAt: "2026-10-03T00:00:00Z" });
  eq("  ...at September's end: a closed TICKET, from its Open Ticket to its close (6h), closed with work done",
     pick(recordLife(life, monthBounds("2026-09").end)), { stage: "closed", ticket: true, ticketFrom: "2026-09-02T00:00:00Z", how: "work",
       faultSince: "2026-09-01T00:00:00Z", reopened: 0, ticketMs: 6 * H, openMs: 30 * H, resolvedAt: "2026-09-02T06:00:00Z" });
  eq("  ...taken on, not done yet: a ticket in progress, from its Open Ticket",
     pick(recordLife(life, Date.parse("2026-09-02T01:00:00Z"))), { stage: "ticket", ticket: true, ticketFrom: "2026-09-02T00:00:00Z",
       how: null, faultSince: "2026-09-01T00:00:00Z", reopened: 0, ticketMs: null, openMs: null, resolvedAt: null });
  eq("  ...before anyone took it on: a fault", pick(recordLife(life, Date.parse("2026-09-01T12:00:00Z"))).stage, "fault");
  eq("  ...before its first step: open, with no close date of a later month (it read \"Open\" beside one)",
     pick(recordLife({ ...life, openedAt: "2026-08-31T00:00:00Z" }, Date.parse("2026-08-31T12:00:00Z"))).resolvedAt, null);
  eq("  ...every close it had, the one it was reopened from included", recordLife(life).resolutions, ["2026-09-02T06:00:00Z", "2026-10-03T00:00:00Z"]);
  eq("the tablet's log counts the faults and the tickets in progress apart (it called every record not closed an open ticket)",
     recordsByStage([{ status: "open" }, { status: "in_progress" }, { status: "resolved" }, { status: "weird" }]),
     { fault: 2, ticket: 1, closed: 1 });
  const ctx = readFileSync(new URL("../../src/fm/FmDataContext.tsx", import.meta.url), "utf8");
  eq("  ...on both its lines, pulled and pushed", [(ctx.match(/\.\.\.syncStages\(/g) ?? []).length, /openTickets/.test(ctx),
     /return \{ records: records\.length, openFaults: n\.fault, ticketsInProgress: n\.ticket \};/.test(ctx)], [2, false, true]);
}

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ the owner's numbers hold"}`);
process.exit(fail ? 1 : 0);
