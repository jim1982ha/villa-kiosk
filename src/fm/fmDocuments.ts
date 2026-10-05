// src/fm/fmDocuments.ts
// Builds an OPERATIONAL annex, suitable for handing to whoever a villa's
// owner statement already goes to — device uptime, maintenance performed
// against the configured schedule, spend against the configured Minor
// Maintenance cap, fault resolution. Deliberately does NOT attempt a
// financial statement (revenue, OTA commissions, payout): that ledger belongs
// to whatever booking/accounting system the property already uses, and
// duplicating it badly here would be worse than leaving it out. Any
// clause/contract reference shown per task is free-text the operator typed
// in (see fmTypes.ts's Schedule.clause) — this file never asserts one of
// its own.
//
// Output is Markdown: it pastes into an email, a WhatsApp message or a
// document unchanged, needs no viewer, and stays readable if it is ever
// archived as plain text years later for a dispute.

import { budgetStatus, completionsInMonth, localStamp, monthKey, monthLabel, scheduleStatus, shortDate, ticketStats } from "./fmEngine";
import { categoryName, NO_FM_TERMS, type FmData, type FmTerms } from "./fmTypes";
import type { BudgetStatus } from "./fmEngine";
import type { ReadinessResult } from "./readiness";
import { stampText } from "@/utils/dateText";
import { formatMoney } from "@/utils/money";

export interface RecapInput {
  fm: FmData;
  month: string;
  villaName: string;
  /** Optional live readiness snapshot, included as the closing section. */
  readiness?: ReadinessResult;
  /** Devices currently unavailable, for the uptime section. */
  offlineDeviceCount?: number;
  totalDeviceCount?: number;
  /** The owner's contract terms (cap, currency, category names). */
  terms?: FmTerms;
}

/**
 * The maintenance-spend lines, for whichever document is asking.
 *
 * ⚠️ WRITTEN TWICE, AND ONLY ONE COPY WOULD HAVE BEEN FIXED. The facility
 * recap and the standalone spend statement each carried this block verbatim —
 * the cap line, the major-maintenance line and the cap warning — so the two
 * documents an owner receives could describe one month's money two ways.
 *
 * ⚠️ AND THE CAP LINE WAS THE "of 0" DEFECT AGAIN. budgetStatus treats
 * cap <= 0 as "no cap configured yet" and reports state "ok" with fraction
 * 0; this line printed the unset value regardless, so an unconfigured villa
 * read "0 of the 0 monthly cap (0%)" in the document it keeps as a record.
 * SpendTab and TodayTab were corrected in 2.496.31 — the pin written alongside
 * them listed only those two files, which is exactly how the rule's third and
 * fourth readers survived the sweep meant to catch them. Roll a shared rule out
 * by what it APPLIES to, not by the call sites you happen to have open.
 */
/**
 * One free-text cell of a markdown table — every title, label, clause, name,
 * note and detail these documents print goes through here.
 *
 * A guest types ticket titles. A pipe would end the CELL; a line break would
 * end the ROW, and whatever followed it — "## Paid in full", "_no faults this
 * month_" — would be laid out as a heading or a notice in the owner's recap,
 * authored by the guest. Before 2.496.206 the pipe was replaced in five
 * hand-written copies and the line break nowhere; the check labels had neither.
 */
export function cell(v: string, max = 200): string {
  const flat = v.replace(/[\r\n\u2028\u2029\u0085]+/g, " ").replace(/\|/g, "/").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function spendSummary(b: BudgetStatus, terms: FmTerms = NO_FM_TERMS): string[] {
  const money = (n: number) => formatMoney(n, terms.currency);
  const out: string[] = [
    b.cap > 0
      ? `- **${cell(terms.cappedName, 60)} maintenance this month:** ${money(b.minorSpend)} of the `
        + `${money(b.cap)} monthly cap (${Math.round(b.fraction * 100)}%)`
      : `- **${cell(terms.cappedName, 60)} maintenance this month:** ${money(b.minorSpend)} `
        + `(no monthly cap configured)`,
  ];
  if (b.majorSpend > 0) {
    out.push(`- **${cell(terms.uncappedName, 60)} maintenance (outside the cap):** ${money(b.majorSpend)}`);
  }
  if (b.state === "exceeded") {
    out.push(`- ⚠️ The monthly cap was reached. Spend beyond it belongs to `
      + `${cell(terms.uncappedName, 60)} maintenance, on whatever terms the agreement sets.`);
  }
  return out;
}

/** The itemised spend rows, oldest first. Same two callers as spendSummary.
 *
 *  ⚠️ EVERY FREE-TEXT COLUMN IS PIPE-ESCAPED. An operator's label containing a
 *  "|" splits the markdown row and shifts every column after it — found once by
 *  rendering the table, and the fix that followed escaped some columns and not
 *  others. Anything an operator typed gets the same treatment here. */
export function spendTable(b: BudgetStatus, terms: FmTerms = NO_FM_TERMS): string[] {
  return [
    `| Date | Item | Category | Amount |`,
    `|---|---|---|---|`,
    ...b.entries.slice().sort((x, y) => Date.parse(x.at) - Date.parse(y.at)).map(
      (c) => `| ${shortDate(c.at)} | ${cell(c.label)} `
        + `| ${cell(categoryName(terms, c.category), 60)} | ${formatMoney(c.amountIdr, terms.currency)} |`),
  ];
}

export 
/** Shared `# title` / Period / Generated / Scope preamble both document flavours below
 *  open with — kept in one place so the financial-reporting disclaimer can't drift
 *  between them. */
function documentHeader(titleSuffix: string, villaName: string, month: string, scopeDescription: string): string[] {
  return [
    `# ${villaName} — ${titleSuffix}`,
    `**Period:** ${monthLabel(month)}  `,
    // localStamp: a fixed, unambiguous YYYY-MM-DD HH:MM in the reader's own
    // time — an archived document should not change shape with a browser.
    `**Generated:** ${localStamp()}  `,
    `**Scope:** ${scopeDescription} `
      + `Financial reporting — revenue, commissions and payout — is out of scope and provided separately.`,
    "",
  ];
}

export function buildMonthlyRecap(input: RecapInput): string {
  const { fm, month, villaName, readiness } = input;
  const now = Date.now();
  const L: string[] = [];

  L.push(...documentHeader(
    "operations recap", villaName, month,
    "operational status only — maintenance, spend, faults and device uptime.",
  ));

  // ── 1. Preventive maintenance ─────────────────────────────────────────────
  L.push(`## 1. Preventive maintenance`);
  // Scheduled work only: a fault's resolution is filed as a completion with
  // no schedule and printed here as "(removed task)" — it is in §3.
  const done = completionsInMonth(fm, month).filter(({ completion: c }) => !c.ticketId);
  if (done.length === 0) {
    L.push(`_No maintenance recorded in this period._`);
  } else {
    L.push(`| Date | Task | Clause | By | Evidence | Note |`);
    L.push(`|---|---|---|---|---|---|`);
    for (const { completion: c, schedule: s } of done) {
      L.push(`| ${shortDate(c.at)} | ${cell(s?.title ?? "(removed task)")} | ${cell(s?.clause ?? "—")} `
        + `| ${cell(c.by || "—")} | ${c.photoIds.length} photo(s) | ${cell(c.note ?? "")} |`);
    }
  }
  L.push("");

  // Current standing against the schedule — the evidence trail for whether the
  // villa is being kept to the agreed maintenance standard.
  L.push(`### Standing against schedule (as at recap date)`);
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
      L.push(`| ${cell(s.title)} | ${s.everyDays} days | `
        + `${st.last ? shortDate(st.last.at) : "—"} | ${status} |`);
    }
  }
  L.push("");

  // ── 2. Maintenance spend ──────────────────────────────────────────────────
  const terms = input.terms ?? NO_FM_TERMS;
  const b = budgetStatus(fm.costs, month, terms);
  L.push(`## 2. Maintenance spend`);
  L.push(...spendSummary(b, terms));
  L.push("");
  if (b.entries.length) {
    L.push(...spendTable(b, terms));
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
    // Named when it covers fewer tickets than "Resolved" reports, so the two
    // figures cannot be read as describing the same set when they do not.
    const covers = stats.meanCoversTickets === stats.resolved
      ? "" : ` (from ${stats.meanCoversTickets} of ${stats.resolved} — the rest `
        + `carry no usable resolution time)`;
    L.push(`- Mean time to resolution: **${stats.meanResolutionHours.toFixed(1)} hours**${covers}`);
  }
  L.push("");
  if (inMonth.length) {
    L.push(`| Opened | Fault | Status | Resolved | Evidence |`);
    L.push(`|---|---|---|---|---|`);
    for (const t of inMonth.sort((x, y) => Date.parse(x.openedAt) - Date.parse(y.openedAt))) {
      L.push(`| ${shortDate(t.openedAt)} | ${cell(t.title)} `
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
    L.push(`## 4. Device availability (at recap date)`);
    L.push(`- **${input.totalDeviceCount - off} of ${input.totalDeviceCount}** devices reporting `
      + `(${pct.toFixed(1)}%)`);
    if (off > 0) L.push(`- ${off} device(s) currently offline — see the faults section above.`);
    L.push("");
  }

  // ── 5. Readiness ─────────────────────────────────────────────────────────
  if (readiness) {
    L.push(`## 5. Guest-readiness check (at recap date)`);
    L.push(`| Check | Result | Detail |`);
    L.push(`|---|---|---|`);
    for (const c of readiness.checks) {
      const icon = c.state === "pass" ? "Pass" : c.state === "warn" ? "Attention" : "**Fail**";
      L.push(`| ${cell(c.label)} | ${icon} | ${cell(c.detail)} |`);
    }
    L.push("");
  }

  L.push(`---`);
  L.push(`_Generated by VESTA. Photographic evidence for each entry `
    + `is retained in the kiosk and available on request._`);
  return L.join("\n");
}

/** A standalone spend statement for one month — the maintenance spend
 *  section of buildMonthlyRecap, on its own, for whenever the operator wants
 *  that handed over without the rest of the operational annex. Same data,
 *  same section, deliberately not re-derived separately so the two can never
 *  disagree about what a given month's capped total is. */
export function buildSpendStatement(
  fm: FmData, month: string, villaName: string, terms: FmTerms = NO_FM_TERMS,
): string {
  const L: string[] = [];
  const b = budgetStatus(fm.costs, month, terms);

  L.push(...documentHeader(
    "maintenance spend statement", villaName, month,
    "maintenance spend against the configured monthly cap.",
  ));

  L.push(...spendSummary(b, terms));
  L.push("");

  if (b.entries.length) {
    L.push(...spendTable(b, terms));
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
 * looks. Saving one freezes it, exactly like the monthly recap and the spend
 * statement — same store, same "generate then save" shape, so a handover pack
 * can include the check that was actually run on the day.
 */
export function buildReadinessSnapshot(readiness: ReadinessResult, villaName: string): string {
  const now = new Date();
  const verdict = readiness.overall === "pass"
    ? "READY"
    : readiness.overall === "warn" ? "READY, WITH FINDINGS" : "NOT READY";
  const lines = [
    `# Readiness snapshot — ${villaName}`,
    "",
    `**${verdict}** — ${readiness.passed} of ${readiness.total} checks passing.`,
    "",
    `Taken ${stampText(now)}.`,
    "",
    "| Check | Result | Finding |",
    "| --- | --- | --- |",
  ];
  for (const c of readiness.checks) {
    const state = c.state === "pass" ? "Pass" : c.state === "warn" ? "Warning" : "Fail";
    lines.push(`| ${cell(c.label)} | ${state} | ${cell(c.detail)} |`);
  }
  lines.push("", "_Computed from live device state at the moment shown above._");
  return lines.join("\n");
}
