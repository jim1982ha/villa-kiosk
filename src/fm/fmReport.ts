// src/fm/fmReport.ts
// Builds an OPERATIONAL annex, suitable for handing to whoever a villa's
// owner report already goes to — device uptime, maintenance performed
// against the configured schedule, spend against the configured Minor
// Maintenance cap, fault resolution. Deliberately does NOT attempt a
// financial report (revenue, OTA commissions, payout): that ledger belongs
// to whatever booking/accounting system the property already uses, and
// duplicating it badly here would be worse than leaving it out. Any
// clause/contract reference shown per task is free-text the operator typed
// in (see fmTypes.ts's Schedule.clause) — this file never asserts one of
// its own.
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

/** Shared `# title` / Period / Generated / Scope preamble both report flavours below
 *  open with — kept in one place so the financial-reporting disclaimer can't drift
 *  between them. */
function reportHeader(titleSuffix: string, villaName: string, month: string, scopeDescription: string): string[] {
  return [
    `# ${villaName} — ${titleSuffix}`,
    `**Period:** ${monthLabel(month)}  `,
    `**Generated:** ${new Date().toLocaleString("en-GB")}  `,
    `**Scope:** ${scopeDescription} `
      + `Financial reporting — revenue, commissions and payout — is out of scope and provided separately.`,
    "",
  ];
}

export function buildMonthlyReport(input: ReportInput): string {
  const { fm, month, villaName, readiness } = input;
  const now = Date.now();
  const L: string[] = [];

  L.push(...reportHeader(
    "operational report", villaName, month,
    "operational status only — maintenance, spend, faults and device uptime.",
  ));

  // ── 1. Preventive maintenance ─────────────────────────────────────────────
  L.push(`## 1. Preventive maintenance`);
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

  // Current standing against the schedule — the evidence trail for whether the
  // villa is being kept to the agreed maintenance standard.
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

  // ── 2. Maintenance spend ──────────────────────────────────────────────────
  const b = budgetStatus(fm.costs, month);
  L.push(`## 2. Maintenance spend`);
  L.push(`- **Minor Maintenance this month:** ${formatIdr(b.minorIdr)} of the `
    + `${formatIdr(b.capIdr)} monthly cap (${Math.round(b.fraction * 100)}%)`);
  if (b.majorIdr > 0) {
    L.push(`- **Major maintenance (Owner's account):** ${formatIdr(b.majorIdr)}`);
  }
  if (b.state === "exceeded") {
    L.push(`- ⚠️ The Minor Maintenance cap was reached. Spend beyond it is Major `
      + `maintenance and falls to the Owner.`);
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

  // ── 3. Faults ──────────────────────────────────────────────────────────────
  const inMonth = fm.tickets.filter(
    (t) => monthKey(t.openedAt) === month
      || (t.resolvedAt && monthKey(t.resolvedAt) === month));
  const stats = ticketStats(fm.tickets);
  L.push(`## 3. Faults and response`);
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
  L.push(`_Generated by VESTA. Photographic evidence for each entry `
    + `is retained in the kiosk and available on request._`);
  return L.join("\n");
}

/** A standalone spend statement for one month — the Minor Maintenance spend
 *  section of buildMonthlyReport, on its own, for whenever the operator wants
 *  that handed over without the rest of the operational annex. Same data,
 *  same section, deliberately not re-derived separately so the two can never
 *  disagree about what a given month's Minor Maintenance total is. */
export function buildSpendStatement(fm: FmData, month: string, villaName: string): string {
  const L: string[] = [];
  const b = budgetStatus(fm.costs, month);

  L.push(...reportHeader(
    "maintenance spend statement", villaName, month,
    "maintenance spend against the configured Minor Maintenance cap.",
  ));

  L.push(`- **Minor Maintenance this month:** ${formatIdr(b.minorIdr)} of the `
    + `${formatIdr(b.capIdr)} monthly cap (${Math.round(b.fraction * 100)}%)`);
  if (b.majorIdr > 0) {
    L.push(`- **Major maintenance (Owner's account):** ${formatIdr(b.majorIdr)}`);
  }
  if (b.state === "exceeded") {
    L.push(`- ⚠️ The Minor Maintenance cap was reached. Spend beyond it is Major `
      + `maintenance and falls to the Owner.`);
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
  L.push(`_Generated by VESTA. Receipt evidence for each entry is retained `
    + `in the kiosk and available on request._`);
  return L.join("\n");
}


/** A point-in-time readiness snapshot, as markdown.
 *
 * Readiness is computed live from device state, which makes it useless as
 * evidence: "was the villa ready before the last guest arrived?" cannot be
 * answered after the fact, because the answer is recomputed every time anyone
 * looks. Saving one freezes it, exactly like the monthly report and the spend
 * statement — same store, same "generate then save" shape, so a handover pack
 * can include the check that was actually run on the day.
 */
export function buildReadinessSnapshot(report: ReadinessReport, villaName: string): string {
  const now = new Date();
  const verdict = report.overall === "pass"
    ? "READY"
    : report.overall === "warn" ? "READY, WITH FINDINGS" : "NOT READY";
  const lines = [
    `# Readiness snapshot — ${villaName}`,
    "",
    `**${verdict}** — ${report.passed} of ${report.total} checks passing.`,
    "",
    `Taken ${now.toLocaleString()}.`,
    "",
    "| Check | Result | Finding |",
    "| --- | --- | --- |",
  ];
  for (const c of report.checks) {
    const state = c.state === "pass" ? "Pass" : c.state === "warn" ? "Warning" : "Fail";
    // Pipes inside a finding would break the table row.
    lines.push(`| ${c.label} | ${state} | ${c.detail.replace(/\|/g, "/")} |`);
  }
  lines.push("", "_Computed from live device state at the moment shown above._");
  return lines.join("\n");
}
