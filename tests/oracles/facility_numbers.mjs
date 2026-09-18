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
register("../consistency/alias-hook.mjs", import.meta.url);

const {
  ticketStats, scheduleStatus, budgetStatus, monthLabel, shortDate, formatMoney,
} = await import("@/fm/fmEngine");
const { spendSummary } = await import("@/fm/fmReport");

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
// An unknown status counts as OPEN, never resolved — the rule fmEngine states.
eq("a corrupt status counts as open", ticketStats([t({ status: "" })]).open, 1);
eq("...and is not silently resolved", ticketStats([t({ status: "" })]).resolved, 0);

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
// capIdr <= 0 as "not configured" — state ok, fraction 0 — and the two report
// documents printed the unset value anyway: "0 of the 0 monthly cap (0%)".
// SpendTab and TodayTab were corrected in 2.496.31; the pin written with them
// named only those two files, which is how fmReport survived it.
const noCap = budgetStatus([], "2026-09", 0);
eq("no cap configured reads as ok, not exceeded", noCap.state, "ok");
eq("...with fraction 0, never NaN or Infinity", noCap.fraction, 0);
eq("...and the report says so in words, not as a zero",
   spendSummary(noCap)[0].includes("no monthly cap configured"), true);
eq("...and does not print a cap figure at all",
   /of the .* monthly cap/.test(spendSummary(noCap)[0]), false);
const withCap = budgetStatus(
  [{ id: "c", at: "2026-09-02T00:00:00Z", label: "Pump seal", category: "minor", amountIdr: 900 }],
  "2026-09", 1000);
eq("a configured cap still reports the fraction", withCap.fraction, 0.9);
eq("...and reads as approaching at 80%", withCap.state, "approaching");
eq("...and the report prints the cap", spendSummary(withCap)[0].includes("monthly cap"), true);

console.log("\n  a malformed month does not become 'Invalid Date':");
eq("a garbled month key is echoed, not rendered", monthLabel("not-a-month"), "not-a-month");
eq("month 13 is refused", monthLabel("2026-13"), "2026-13");
eq("a real month renders", /2026/.test(monthLabel("2026-07")), true);

console.log("\n  nothing prints a currency nobody configured:");
eq("no currency configured shows the amount alone", formatMoney(450000, ""), "450,000");
eq("a configured one prefixes it", formatMoney(450000, "EUR"), "EUR 450,000");
eq("a short date renders without throwing", typeof shortDate("2026-07-24T00:00:00Z"), "string");

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ the owner's numbers hold"}`);
process.exit(fail ? 1 : 0);
