// src/fm/fmReport.ts
// Builds the OPERATIONAL annex to Kozystay's monthly owner report.
//
// Clause 3.11 requires the owner report by the 10th of the following month;
// Clause 3.12 gives the Owner 2 working days to query it before payout.
// Appendix C §7(a) makes late or missing reporting a material breach that lets
// the Owner terminate without penalty.
//
// This deliberately produces the OPERATIONAL annex only — device uptime,
// maintenance performed against Clause 3.7, spend against the Clause 3.3(i)
// cap, fault resolution. The financial report (revenue, OTA commissions,
// payout) stays Kozystay's: duplicating their ledger badly would be worse than
// not having it, and competing with their core product is not the goal.
//
// Output is Markdown: it pastes into an email, a WhatsApp message or a
// document unchanged, needs no viewer, and stays readable if it is ever
// archived as plain text years later for a dispute.

import {
  budgetStatus, completionsInMonth, formatIdr, monthKey, scheduleStatus, shortDate, ticketStats,
} from "./fmEngine";
import type { FmData } from "./fmTypes";
import type { ReadinessReport } from "./readiness";

export interface ReportInput {
  fm: FmData;
  month: string;
  villaName: string;
  /** Optional live readiness snapshot, included as the closing section. */
  readiness?: ReadinessReport;
  /** Devices currently unavailable, for the uptime section. */
  offlineDeviceCount?: number;
  totalDeviceCount?: number;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1)
    .toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function buildMonthlyReport(input: ReportInput): string {
  const { fm, month, villaName, readiness } = input;
  const now = Date.now();
  const L: string[] = [];

  L.push(`# ${villaName} — operational report`);
  L.push(`**Period:** ${monthLabel(month)}  `);
  L.push(`**Generated:** ${new Date().toLocaleString("en-GB")}  `);
  L.push(`**Scope:** operational annex to the monthly owner report (Clause 3.11). `
    + `Financial reporting — revenue, commissions and payout — is provided separately by Kozystay.`);
  L.push("");

  // ── 1. Preventive maintenance (Clause 3.7) ───────────────────────────────
  L.push(`## 1. Preventive maintenance — Clause 3.7`);
  const done = completionsInMonth(fm, month);
  if (done.length === 0) {
    L.push(`_No maintenance recorded in this period._`);
  } else {
    L.push(`| Date | Task | Clause | By | Evidence | Note |`);
    L.push(`|---|---|---|---|---|---|`);
    for (const { completion: c, schedule: s } of done) {
      L.push(`| ${shortDate(c.at)} | ${s?.title ?? "(removed task)"} | ${s?.clause ?? "—"} `
        + `| ${c.by || "—"} | ${c.photoIds.length} photo(s) | ${c.note?.replace(/\|/g, "/") ?? ""} |`);
    }
  }
  L.push("");

  // Current standing against the schedule — the part that evidences Appendix C
  // §7(b) ("condition materially below the agreed standard") one way or another.
  L.push(`### Standing against schedule (as at report date)`);
  const active = fm.schedules.filter((s) => s.enabled);
  if (active.length === 0) {
    L.push(`_No maintenance schedule configured._`);
  } else {
    L.push(`| Task | Required every | Last done | Status |`);
    L.push(`|---|---|---|---|`);
    for (const s of active) {
      const st = scheduleStatus(s, fm.completions, now);
      const status = st.state === "ok" ? "On schedule"
        : st.state === "due-soon" ? "Due soon"
          : st.state === "overdue" ? `**Overdue by ${Math.abs(Math.round(st.daysUntilDue ?? 0))}d**`
            : "**Never recorded**";
      // s.title is operator-entered free text (see ScheduleEditor) and, unlike
      // every other table in this file, was never pipe-escaped — a task
      // title containing "|" silently split into extra table columns. Caught
      // by rendering this output as an actual table instead of raw text.
      L.push(`| ${s.title.replace(/\|/g, "/")} | ${s.everyDays} days | `
        + `${st.last ? shortDate(st.last.at) : "—"} | ${status} |`);
    }
  }
  L.push("");

  // ── 2. Maintenance spend (Clause 3.3(i) / 6.2) ───────────────────────────
  const b = budgetStatus(fm.costs, month);
  L.push(`## 2. Maintenance spend — Clause 3.3(i)`);
  L.push(`- **Minor Maintenance this month:** ${formatIdr(b.minorIdr)} of the `
    + `${formatIdr(b.capIdr)} monthly cap (${Math.round(b.fraction * 100)}%)`);
  if (b.majorIdr > 0) {
    L.push(`- **Major maintenance (Owner's account, Clause 6.2(iii)):** ${formatIdr(b.majorIdr)}`);
  }
  if (b.state === "exceeded") {
    L.push(`- ⚠️ The Minor Maintenance cap was reached. Spend beyond it is Major `
      + `maintenance and falls to the Owner under Clause 6.2(iii).`);
  }
  L.push("");
  if (b.entries.length) {
    L.push(`| Date | Item | Category | Amount |`);
    L.push(`|---|---|---|---|`);
    for (const c of b.entries.sort((x, y) => Date.parse(x.at) - Date.parse(y.at))) {
      L.push(`| ${shortDate(c.at)} | ${c.label.replace(/\|/g, "/")} `
        + `| ${c.category === "minor" ? "Minor" : "Major"} | ${formatIdr(c.amountIdr)} |`);
    }
    L.push("");
  }

  // ── 3. Faults (Clause 1.1(iv)(b)) ────────────────────────────────────────
  const inMonth = fm.tickets.filter(
    (t) => monthKey(t.openedAt) === month
      || (t.resolvedAt && monthKey(t.resolvedAt) === month));
  const stats = ticketStats(fm.tickets);
  L.push(`## 3. Faults and response — Clause 1.1(iv)(b)`);
  L.push(`- Open: **${stats.open}** · In progress: **${stats.inProgress}** · Resolved (all time): **${stats.resolved}**`);
  if (stats.meanResolutionHours !== null) {
    L.push(`- Mean time to resolution: **${stats.meanResolutionHours.toFixed(1)} hours**`);
  }
  L.push("");
  if (inMonth.length) {
    L.push(`| Opened | Fault | Status | Resolved | Evidence |`);
    L.push(`|---|---|---|---|---|`);
    for (const t of inMonth.sort((x, y) => Date.parse(x.openedAt) - Date.parse(y.openedAt))) {
      L.push(`| ${shortDate(t.openedAt)} | ${t.title.replace(/\|/g, "/")} `
        + `| ${t.status.replace("_", " ")} | ${t.resolvedAt ? shortDate(t.resolvedAt) : "—"} `
        + `| ${t.photoIds.length} photo(s) |`);
    }
    L.push("");
  } else {
    L.push(`_No faults opened or resolved in this period._`);
    L.push("");
  }

  // ── 4. Device availability ───────────────────────────────────────────────
  if (input.totalDeviceCount) {
    const off = input.offlineDeviceCount ?? 0;
    const pct = ((input.totalDeviceCount - off) / input.totalDeviceCount) * 100;
    L.push(`## 4. Device availability (at report date)`);
    L.push(`- **${input.totalDeviceCount - off} of ${input.totalDeviceCount}** devices reporting `
      + `(${pct.toFixed(1)}%)`);
    if (off > 0) L.push(`- ${off} device(s) currently offline — see the faults section above.`);
    L.push("");
  }

  // ── 5. Readiness ─────────────────────────────────────────────────────────
  if (readiness) {
    L.push(`## 5. Guest-readiness check (at report date)`);
    L.push(`| Check | Result | Detail |`);
    L.push(`|---|---|---|`);
    for (const c of readiness.checks) {
      const icon = c.state === "pass" ? "Pass" : c.state === "warn" ? "Attention" : "**Fail**";
      L.push(`| ${c.label} | ${icon} | ${c.detail.replace(/\|/g, "/")} |`);
    }
    L.push("");
  }

  L.push(`---`);
  L.push(`_Generated by Villa Kiosk. Maintenance intervals follow Clause 3.7; the `
    + `Minor Maintenance cap follows Clause 3.3(i). Photographic evidence for each entry `
    + `is retained in the kiosk and available on request._`);
  return L.join("\n");
}

/** A standalone spend statement for one month — the Clause 3.3(i) cap section
 *  of buildMonthlyReport, on its own, for whenever the operator wants that
 *  handed over without the rest of the operational annex. Same data, same
 *  section, deliberately not re-derived separately so the two can never
 *  disagree about what a given month's Minor Maintenance total is. */
export function buildSpendStatement(fm: FmData, month: string, villaName: string): string {
  const L: string[] = [];
  const b = budgetStatus(fm.costs, month);

  L.push(`# ${villaName} — maintenance spend statement`);
  L.push(`**Period:** ${monthLabel(month)}  `);
  L.push(`**Generated:** ${new Date().toLocaleString("en-GB")}  `);
  L.push(`**Scope:** maintenance spend against the Clause 3.3(i) Minor Maintenance cap. `
    + `Financial reporting — revenue, commissions and payout — is provided separately by Kozystay.`);
  L.push("");

  L.push(`- **Minor Maintenance this month:** ${formatIdr(b.minorIdr)} of the `
    + `${formatIdr(b.capIdr)} monthly cap (${Math.round(b.fraction * 100)}%)`);
  if (b.majorIdr > 0) {
    L.push(`- **Major maintenance (Owner's account, Clause 6.2(iii)):** ${formatIdr(b.majorIdr)}`);
  }
  if (b.state === "exceeded") {
    L.push(`- ⚠️ The Minor Maintenance cap was reached. Spend beyond it is Major `
      + `maintenance and falls to the Owner under Clause 6.2(iii).`);
  }
  L.push("");

  if (b.entries.length) {
    L.push(`| Date | Item | Category | Amount |`);
    L.push(`|---|---|---|---|`);
    for (const c of b.entries.sort((x, y) => Date.parse(x.at) - Date.parse(y.at))) {
      L.push(`| ${shortDate(c.at)} | ${c.label.replace(/\|/g, "/")} `
        + `| ${c.category === "minor" ? "Minor" : "Major"} | ${formatIdr(c.amountIdr)} |`);
    }
  } else {
    L.push(`_No spend recorded in this period._`);
  }
  L.push("");

  L.push(`---`);
  L.push(`_Generated by Villa Kiosk. Cap follows Clause 3.3(i). `
    + `Receipt evidence for each entry is retained in the kiosk and available on request._`);
  return L.join("\n");
}
