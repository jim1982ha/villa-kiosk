// The Facility rules that lived in the screens (round 13, 2.496.183), driven
// by value: fault transitions and rank, amounts, erasing a fault with its
// history, what a completion answered, and ONE "needs attention".
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const E = await import("@/fm/fmEngine");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const R = await import("@/fm/fmDocuments");


ck("a status this build does not know reads as OPEN (the engine's reading)", E.isTicketOpen({ status: "escalated" }));

ck("amounts: grouping dropped (450.000 → 450000, 1,250,000 → 1250000)", E.parseAmount("450.000") === 450000 && E.parseAmount("1,250,000") === 1250000);
ck("  ...a fraction is rounded, never glued on: 12.50 → 13 (it was 1250), 99,4 → 99", E.parseAmount("12.50") === 13 && E.parseAmount("99,4") === 99, [E.parseAmount("12.50"), E.parseAmount("99,4")]);
ck("  ...text with no digits is 0; spaces and a currency are ignored", E.parseAmount("abc") === 0 && E.parseAmount("IDR 45 000") === 45000);

const d = {
  ...EMPTY_FM_DATA,
  schedules: [{ id: "s1", title: "Pool filter", everyDays: 7, enabled: true }],
  tickets: [{ id: "t1", title: "AC leaking", status: "resolved", openedAt: "2026-09-01T00:00:00Z", photoIds: [], costId: "k1" },
            { id: "t2", title: "Gate stuck", status: "open", openedAt: "2026-09-02T00:00:00Z", photoIds: [] }],
  completions: [{ id: "c1", scheduleId: "", ticketId: "t1", at: "2026-09-03T00:00:00Z", by: "Tech", photoIds: [], costId: "k1" },
                { id: "c2", scheduleId: "s1", at: "2026-09-04T00:00:00Z", by: "Op", photoIds: [] }],
  costs: [{ id: "k1", label: "AC repair", amountIdr: 500, category: "minor", at: "2026-09-03T00:00:00Z" },
          { id: "k2", label: "Chlorine", amountIdr: 50, category: "minor", at: "2026-09-04T00:00:00Z" }],
};
const gone = E.withoutTicket(d, "t1");
ck("erasing a fault takes its resolution and its cost with it (they were left as 'a fault since erased')",
   !gone.tickets.some((t) => t.id === "t1") && !gone.completions.some((c) => c.ticketId === "t1") && !gone.costs.some((c) => c.id === "k1"));
ck("  ...and nothing else", gone.tickets.length === 1 && gone.completions.length === 1 && gone.costs.length === 1);

ck("what a completion answered: a fault by its title, a task by its title, a removed one as undefined",
   E.completionSource(d, d.completions[0]).kind === "fault" && E.completionSource(d, d.completions[0]).title === "AC leaking"
   && E.completionSource(d, d.completions[1]).title === "Pool filter" && E.completionSource(d, { scheduleId: "gone" }).title === undefined);
const byRecord = (id) => id;   // the device fold: one record per device here
const report = R.buildMonthlyRecap({ fm: d, month: "2026-09", villaName: "V", readiness: null, deviceOfRecord: byRecord });
ck("the monthly report's preventive maintenance lists scheduled work only — no '(removed task)' for a fault's resolution",
   !report.includes("(removed task)") && report.includes("Pool filter"), report.split("\n").filter((l) => l.includes("removed")));

const now = Date.parse("2026-09-27T00:00:00Z");
const att = E.fmAttention({ ...d, schedules: [...d.schedules, { id: "s2", title: "Due soon", everyDays: 30, enabled: true }],
  completions: [...d.completions, { id: "c3", scheduleId: "s2", at: new Date(now - 26 * 86400000).toISOString(), by: "Op", photoIds: [] }] }, now);
ck("ONE attention rule: open faults + tasks overdue or never — a task merely due soon is not attention",
   att.unresolved.map((t) => t.id).join() === "t2" && att.lateTasks.map((s) => s.schedule.id).join() === "s1" && att.total === 2,
   { faults: att.unresolved.map((t) => t.id), late: att.lateTasks.map((s) => `${s.schedule.id}:${s.state}`) });

// The one-step close, "no action needed" (2.496.239).
{
  const k = { now: "2026-09-30T10:00:00Z" };
  const inProgress = { ...d, tickets: [...d.tickets, { id: "t3", title: "Old alert", status: "in_progress",
    openedAt: "2026-09-05T00:00:00Z", photoIds: ["p1"], updates: [{ at: "2026-09-06T00:00:00Z", status: "in_progress", photoIds: [] }] }] };
  const closed = E.withTicketClosed(d, "t2", k);
  const t2 = closed.tickets.find((t) => t.id === "t2");
  ck("closing an open fault in one step: resolved, stamped now, one 'Closed without action' update",
     t2.status === "resolved" && t2.resolvedAt === k.now && t2.updates.length === 1
     && t2.updates[0].at === k.now && t2.updates[0].status === "resolved"
     && t2.updates[0].note === "Closed without action" && t2.updates[0].photoIds.length === 0, t2);
  ck("  ...and NO completion or cost: nothing was done (it would count as work)",
     closed.completions.length === d.completions.length && closed.costs.length === d.costs.length);
  const t3 = E.withTicketClosed(inProgress, "t3", k).tickets.find((t) => t.id === "t3");
  ck("  ...an in-progress one too, its history kept and appended to",
     t3.status === "resolved" && t3.updates.length === 2 && t3.updates[0].status === "in_progress" && t3.photoIds.join() === "p1");
  ck("  ...a resolved or unknown fault is left exactly as it is",
     E.withTicketClosed(d, "t1", k) === d && E.withTicketClosed(d, "nope", k) === d);
  ck("  ...and is never stamped resolved without a resolvedAt (the proxy refuses that)", !!t2.resolvedAt && !!t3.resolvedAt);
  // owner, 2026-10-10: the agent's note on the alert's Telegram messages says who closed it, and when
  const byFm = E.withTicketClosed(d, "t2", k, "Facility manager").tickets.find((t) => t.id === "t2");
  ck("  ...and says which profile closed it, for the agent's note on Telegram",
     byFm.updates.at(-1).by === "Facility manager" && !("by" in t2.updates[0]), byFm.updates);
}

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
ck("the Cockpit (whose count the top bar shows) and the Today tab count through fmAttention; the top bar keeps no count of its own",
   !/fmAttention/.test(src("components/hud/HUD.tsx")) && /const fm = fmAttention\(fmData\);/.test(src("config/attention.ts"))
   && /fmAttention\(data\)\.lateTasks/.test(src("components/fm/TodayTab.tsx")));
ck("no screen parses an amount by itself",
   ["components/fm/TodayTab.tsx", "components/fm/SpendTab.tsx", "components/fm/FaultStageModal.tsx"].every((f) => /parseAmount\(/.test(src(f)) && !/replace\(\/\[\^\\d\]\/g, ""\)\) \|\| 0/.test(src(f))));
ck("the store erases a fault through its one command, with the elevation", /run\(\{ type: "removeTicket", id \}, elevation\)/.test(src("fm/FmDataContext.tsx")));
// both screens close through ONE piece (WorkButtons.useConfirmedClose, architecture review 2026-10-16); what each
// Close closes and asks is fm/deviceWork's, checked by value in live_issues.mjs
ck("the one-step close is one command, and both screens call it — through the one shared close",
   /run\(\{ type: "closeTickets", ids \}\)/.test(src("fm/FmDataContext.tsx"))
   && /closeTickets\(ids\)/.test(src("components/fm/WorkButtons.tsx"))
   && ["components/fm/TicketsTab.tsx", "components/cockpit/CockpitOverview.tsx"].every((f) => /useConfirmedClose\(\)/.test(src(f)) && !/closeTickets/.test(src(f)))
   && /ticketId: t\.id/.test(src("config/attention.ts")));

{
  // review 31: what the Cockpit counts and tells
  const T = (id, updates, extra = {}) => ({ id, title: id, status: "resolved", openedAt: "2026-09-01T00:00:00.000Z",
    resolvedAt: updates.at(-1).at, photoIds: [], updates, ...extra });
  const st = (at, status, x = {}) => ({ at, status, photoIds: [], ...x });
  const twice = T("pump", [st("2026-09-01T02:00:00.000Z", "resolved", { who: "Made" }),
    st("2026-10-01T00:00:00.000Z", "open", { kind: "reopened" }), st("2026-10-01T02:00:00.000Z", "resolved", { who: "Made" })]);
  ck("time to repair counts only the time a fault was open (2 h + 2 h, a month apart: 4 h)",
     E.ticketStats([twice]).meanResolutionHours === 4, E.ticketStats([twice]));
  const blips = Array.from({ length: 10 }, (_, i) => T(`ap${i}`, [st("2026-09-01T00:10:00.000Z", "resolved",
    { note: "Cleared: the check no longer sees it." })]));
  const fridge = T("fridge", [st("2026-09-03T00:00:00.000Z", "resolved", { who: "Made" })]);
  const dup = T("dup", [st("2026-12-02T00:00:00.000Z", "resolved", { kind: "cleared", note: "Closed without action" })]);
  const s4 = E.ticketStats([...blips, fridge, dup]);
  ck("a close with no work is not a repair: apart, never in the mean (an old step read by its note once)",
     s4.resolved === 1 && s4.closedWithoutAction === 11 && s4.meanResolutionHours === 48, s4);
  const closedNow = E.withTicketClosed({ ...EMPTY_FM_DATA, tickets: [{ id: "x", title: "x", status: "open",
    openedAt: "2026-09-01T00:00:00.000Z", photoIds: [] }] }, "x", { now: "2026-09-02T00:00:00.000Z" }).tickets[0];
  ck("  ...\"Close — no action needed\" writes the kind cleared", closedNow.updates.at(-1).kind === "cleared", closedNow.updates);
  ck("who did the work: the person a completion is for, else who recorded it",
     E.workedBy({ by: "VESTA Agent", who: "Made" }) === "Made" && E.workedBy({ by: "Wayan" }) === "Wayan" && E.workedBy({ by: "" }) === "—");
  // a fault fixed in September, reopened in October: September's recap still tells it, as it stood then
  const sept = { ...EMPTY_FM_DATA, tickets: [{ id: "tk3", title: "Pool pump seized", status: "open", openedAt: "2026-08-28T12:00:00.000Z",
    photoIds: ["p"], updates: [st("2026-09-05T12:00:00.000Z", "resolved", { who: "Made" }),
      st("2026-10-02T12:00:00.000Z", "open", { kind: "reopened" })] }] };
  const recap = R.buildMonthlyRecap({ fm: sept, month: "2026-09", villaName: "V", readiness: null, deviceOfRecord: byRecord });
  // its Status column in the stage's one word (STAGE_WORDS, the Tickets tab's pill's), as it stood then; its date
  // cells in the document's fixed form (dateText.docDate — owner's decision, 2026-10-19: 2.496.424 died of a cell
  // written in the runner's locale, "05 Sept 2026" here and "Sep 5, 2026" on CI). Midday, so any runner's day is the 5th.
  ck("a past month's recap tells a fault fixed that month, as it stood then, even reopened since — its dates as 2026-09-05",
     recap.includes(`| 2026-08-28 | Pool pump seized | ${E.STAGE_WORDS.closed.word} | 2026-09-05 |`), recap.split("## 3.")[1]);
  // ⚠️ THE FIGURES ARE THE MONTH'S (architecture review, 2026-10-19): "Resolved (all time)" and "Closed without action"
  // counted every record the server still kept — September's recap regenerated in January read "Closed without action: 0"
  const blip = (id, at) => ({ id, title: id, status: "resolved", openedAt: at, resolvedAt: at, photoIds: [],
    updates: [st(at, "resolved", { kind: "cleared", note: "Closed without action" })] });
  const months = { ...EMPTY_FM_DATA, tickets: [...sept.tickets, blip("b1", "2026-09-10T12:00:00.000Z"), blip("b2", "2026-08-10T12:00:00.000Z"),
    blip("b3", "2026-08-11T12:00:00.000Z")] };
  const s3 = (m) => R.buildMonthlyRecap({ fm: months, month: m, villaName: "V", readiness: null, deviceOfRecord: byRecord }).split("## 3.")[1].split("## ")[0];
  ck("the recap's resolution figures are its month's: September one repair and one close with no action, August none and two",
     s3("2026-09").includes("Resolved this month: **1**") && s3("2026-09").includes("Closed without action this month (not counted as repairs): **1**")
     && s3("2026-08").includes("Resolved this month: **0**") && s3("2026-08").includes("Closed without action this month (not counted as repairs): **2**")
     && s3("2026-09").includes("Mean time to resolution this month: **") && !/all time/.test(s3("2026-09")), [s3("2026-09"), s3("2026-08")]);
}

console.log("\n  a document's dates are locale-free; the month's bounds computed once (owner's decision, 2026-10-19):");
{
  const { docDate } = await import("@/utils/dateText");
  ck("docDate: the local day as 2026-09-05, whatever the reader's language; nothing for a date that cannot be read",
     docDate("2026-09-05T12:00:00Z") === "2026-09-05" && docDate(Date.parse("2026-12-31T12:00:00Z")) === "2026-12-31" && docDate("garbage") === "",
     [docDate("2026-09-05T12:00:00Z"), docDate("garbage")]);
  const b = E.monthBounds("2026-09");
  ck("monthBounds: local midnight on the 1st, and on the 1st of the month after — NaN for a key that is not a month",
     b.start === new Date(2026, 8, 1).getTime() && b.end === new Date(2026, 9, 1).getTime()
     && Number.isNaN(E.monthBounds("2026-13").start) && Number.isNaN(E.monthBounds("not-a-month").end) && Number.isNaN(E.monthBounds("2026-9").start), b);
  ck("  ...the Period heading and the documents' default month read them (a malformed key is echoed)",
     E.monthLabel("2026-13") === "2026-13" && /2026/.test(E.monthLabel("2026-09"))
     && (await import("@/fm/monthlyDocument")).defaultMonth("recap", new Date(2026, 0, 15).getTime()) === "2025-12");
  // a fault as it stood at a month's end: resolved mid-September, reopened mid-October
  const t = { id: "m", title: "m", status: "open", openedAt: "2026-09-01T12:00:00.000Z", photoIds: [], updates: [
    { at: "2026-09-15T12:00:00.000Z", status: "resolved", photoIds: [] }, { at: "2026-10-15T12:00:00.000Z", status: "open", kind: "reopened", photoIds: [] }] };
  ck("  ...and the recap's month end is the bound itself: resolved at September's end, open at October's",
     E.ticketAt(t, E.monthBounds("2026-09").end).status === "resolved" && E.ticketAt(t, E.monthBounds("2026-10").end).status === "open");
  const docs = src("fm/fmDocuments.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  ck("every date cell of a document is docDate: no locale date, no hand-parsed month, in fm/fmDocuments",
     /docDate\(/.test(docs) && !/shortDate\(|stampText\(|fullDate\(|dayTime\(|toLocale|split\("-"\)\.map\(Number\)|toISOString\(\)/.test(docs)
     && !/split\("-"\)\.map\(Number\)|setMonth\(/.test(src("fm/monthlyDocument.ts") + src("fm/fmEngine.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")));
}

done("✅ the Facility rules, in the engine");
