// tests/oracles/ticket_status.mjs
//
// Does a fault with a missing or corrupt status still reach the facility report?
//
// ⚠️ THIS FILE USED TO REPLAY BOTH RULES AND COMPARE THEM. It declared an OLD
// lambda (the bare `else` main shipped) and a NEW one (the explicit ladder) and
// ran both over its own fixture — proving the decision, and pinning nothing.
// `ticketStats` could have regressed to the bare `else` without a line going
// red, which is exactly the regression this file is named for.
//
// It calls the shipped function now. The contrast is kept as prose, because the
// REASON is the valuable part: an unknown status counting as resolved removes a
// fault from the report silently, and "a fault wrongly shown as open is a
// question someone asks; a fault wrongly shown as resolved is one nobody ever
// asks again."
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { ticketStats, isTicketOpen, isTicketResolved } = await import("@/fm/fmEngine");

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};
const t = (status) => ({ id: "t", title: "x", status, openedAt: "2026-09-01T00:00:00Z" });

console.log("  the three real statuses:");
const real = ticketStats([t("open"), t("in_progress"), t("resolved")]);
eq("open", real.open, 1);
eq("in progress", real.inProgress, 1);
eq("resolved", real.resolved, 1);

console.log("\n  and everything else counts as OPEN, never resolved:");
// The bare `else` this replaced sent every one of these to `resolved`.
for (const bad of ["", "  ", "unknown", "REOPENED", "closed?", null, undefined]) {
  const s = ticketStats([t(bad)]);
  eq(`status ${JSON.stringify(bad)} → open`, [s.open, s.resolved], [1, 0]);
}

console.log("\n  the two predicates agree with the tally:");
// ⚠️ THREE OWNERS OF ONE QUESTION MUST NOT DISAGREE. isTicketOpen and
// isTicketResolved are read by FaultsTab, the Cockpit list and readiness;
// ticketStats is read by the report. A ticket both or neither predicate claims
// would be counted differently by different screens.
for (const st of ["open", "in_progress", "resolved", "", "garbage"]) {
  const tk = t(st);
  eq(`${JSON.stringify(st)} is open xor resolved`,
     isTicketOpen(tk) !== isTicketResolved(tk), true);
}
eq("what the predicates call open is what the tally calls open",
   ticketStats([t("open"), t("garbage"), t("resolved")]).open,
   [t("open"), t("garbage"), t("resolved")].filter(isTicketOpen).length);

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ no fault leaves the report by bad data"}`);
process.exit(fail ? 1 : 0);
