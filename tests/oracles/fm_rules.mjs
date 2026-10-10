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


ck("a fault goes open → in progress → resolved, and resolved is final on the Faults tab",
   E.TICKET_NEXT.open === "in_progress" && E.TICKET_NEXT.in_progress === "resolved" && E.TICKET_NEXT.resolved === null);
ck("rank: open, in progress, resolved — and a status this build does not know ranks as OPEN (the engine's reading)",
   E.ticketRank({ status: "open" }) === 0 && E.ticketRank({ status: "in_progress" }) === 1 && E.ticketRank({ status: "resolved" }) === 2
   && E.ticketRank({ status: "escalated" }) === 0 && E.isTicketOpen({ status: "escalated" }));

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
const report = R.buildMonthlyRecap({ fm: d, month: "2026-09", villaName: "V", readiness: null });
ck("the monthly report's preventive maintenance lists scheduled work only — no '(removed task)' for a fault's resolution",
   !report.includes("(removed task)") && report.includes("Pool filter"), report.split("\n").filter((l) => l.includes("removed")));

const now = Date.parse("2026-09-27T00:00:00Z");
const att = E.fmAttention({ ...d, schedules: [...d.schedules, { id: "s2", title: "Due soon", everyDays: 30, enabled: true }],
  completions: [...d.completions, { id: "c3", scheduleId: "s2", at: new Date(now - 26 * 86400000).toISOString(), by: "Op", photoIds: [] }] }, now);
ck("ONE attention rule: open faults + tasks overdue or never — a task merely due soon is not attention",
   att.openFaults.map((t) => t.id).join() === "t2" && att.lateTasks.map((s) => s.schedule.id).join() === "s1" && att.total === 2,
   { faults: att.openFaults.map((t) => t.id), late: att.lateTasks.map((s) => `${s.schedule.id}:${s.state}`) });

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
}

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
ck("the Cockpit (whose count the top bar shows) and the Today tab count through fmAttention; the top bar keeps no count of its own",
   !/fmAttention/.test(src("components/hud/HUD.tsx")) && /const fm = fmAttention\(fmData\);/.test(src("config/attention.ts"))
   && /fmAttention\(data\)\.lateTasks/.test(src("components/fm/TodayTab.tsx")));
ck("no screen parses an amount or ranks/moves a fault by itself",
   ["components/fm/TodayTab.tsx", "components/fm/SpendTab.tsx", "components/fm/FaultStageModal.tsx"].every((f) => /parseAmount\(/.test(src(f)) && !/replace\(\/\[\^\\d\]\/g, ""\)\) \|\| 0/.test(src(f)))
   && /ticketRank\(a\)/.test(src("components/fm/FaultsTab.tsx")) && !/const NEXT:/.test(src("components/fm/FaultsTab.tsx")));
ck("the store erases a fault through withoutTicket", /mutate\(\(d\) => withoutTicket\(d, id\), elevation\)/.test(src("fm/FmDataContext.tsx")));
ck("the one-step close goes through the store's one writer (mutate), and both screens call it",
   /mutate\(\(d\) => withTicketClosed\(d, id, stamp\(\)\)\)/.test(src("fm/FmDataContext.tsx"))
   && /closeTicket\(id\)/.test(src("components/fm/FaultsTab.tsx"))
   && /closeTicket\(fault\.ticketId/.test((src("components/cockpit/CockpitModal.tsx") + src("components/cockpit/CockpitOverview.tsx")))
   && /ticketId: t\.id/.test(src("config/attention.ts")));

done("✅ the Facility rules, in the engine");
