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

import {
  budgetStatus, capNotes, completionsInMonth, dueLine, DUE_WORDS, fmAttention, localStamp, monthBounds, monthKey,
  monthLabel, resolvedInMonth, scheduleBoard, STAGE_WORDS, stageOf, ticketAt, ticketStats, workedBy,
} from "./fmEngine";
import { COST_CATEGORY_NAMES, NO_FM_TERMS, type FmData, type FmTerms } from "./fmTypes";
import type { BudgetStatus } from "./fmEngine";
import { AVAILABILITY_CHECK_LABEL, CHECK_WORDS, VERDICT_WORDS, type ReadinessResult } from "./readiness";
import { openCounts } from "./deviceWork";
import { docDate } from "@/utils/dateText";
import { formatMoney } from "@/utils/money";

// ⚠️ EVERY DATE IN A DOCUMENT IS dateText.docDate ("2026-09-05"), THE FORM "Generated:" ALREADY USED (owner's decision,
// 2026-10-19): a saved recap or statement is read years later, on any device; its rows were written in the generating
// phone's locale ("05 Sept 2026" / "Sep 5, 2026") beside a fixed stamp. Screens keep the reader's locale (shortDate).

export interface RecapInput {
  fm: FmData;
  month: string;
  villaName: string;
  /** The villa's one answer to "which device does this record's entity field name" (VillaModel.useDeviceIdentity
   *  deviceOfRecord) — the open faults and tickets are counted per DEVICE card, as the Overview and Tickets count. */
  deviceOfRecord: (field: string) => string;
  /** Optional live readiness snapshot, included as the closing section — and the device availability section's
   *  figures (its `availability`: the devices its "All devices reporting" check covers). ⚠️ THE COUNTS CAME TWICE
   *  (architecture review, 2026-10-19): offlineDeviceCount and totalDeviceCount were passed beside the readiness that
   *  already held them, from a role-blind list the check did not use. */
  readiness?: ReadinessResult | null;
  /** The owner's contract terms (cap, currency, category names). */
  terms?: FmTerms;
  /** The recap date — "as at recap date" in the standing and readiness sections. The clock, unless a test passes one. */
  now?: number;
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
      ? `- **${COST_CATEGORY_NAMES.minor} maintenance this month:** ${money(b.minorSpend)} of the `
        + `${money(b.cap)} monthly cap (${Math.round(b.fraction * 100)}%)`
      : `- **${COST_CATEGORY_NAMES.minor} maintenance this month:** ${money(b.minorSpend)} `
        + `(no monthly cap configured)`,
  ];
  if (b.majorSpend > 0) {
    out.push(`- **${COST_CATEGORY_NAMES.major} maintenance (outside the cap):** ${money(b.majorSpend)}`);
  }
  // the cap's sentence, the Spend tab's own (fmEngine.capNotes) — this wrote a third one, and none for "approaching"
  out.push(...capNotes(b).map((note) => `- ⚠️ ${note}`));
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
      (c) => `| ${docDate(c.at)} | ${cell(c.label)} `
        + `| ${COST_CATEGORY_NAMES[c.category]} | ${formatMoney(c.amountIdr, terms.currency)} |`),
  ];
}

/** The readiness checks as a table — the recap's §5 and the snapshot print the SAME rows: each check's word
 *  (readiness.CHECK_WORDS, a failing one in bold) and its finding. ⚠️ TWO TABLES (architecture review, 2026-10-19):
 *  "Pass / Attention / **Fail**" under "Detail" in the recap, "Pass / Warning / Fail" under "Finding" in the snapshot. */
export function readinessTable(readiness: Pick<ReadinessResult, "checks">): string[] {
  return [
    `| Check | Result | Finding |`,
    `|---|---|---|`,
    ...readiness.checks.map((c) => {
      const w = CHECK_WORDS[c.state];
      return `| ${cell(c.label)} | ${w.tone === "danger" ? `**${w.word}**` : w.word} | ${cell(c.detail)} |`;
    }),
  ];
}

/** Shared `# title` / Period / Generated / Scope preamble every document opens with — kept in one place so the
 *  financial-reporting disclaimer can't drift between them. */
export function documentHeader(titleSuffix: string, villaName: string, month: string, scopeDescription: string): string[] {
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
  const now = input.now ?? Date.now();
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
      L.push(`| ${docDate(c.at)} | ${cell(s?.title ?? "(removed task)")} | ${cell(s?.clause ?? "—")} `
        + `| ${cell(workedBy(c))} | ${c.photoIds.length} photo(s) | ${cell(c.note ?? "")} |`);
    }
  }
  L.push("");

  // Current standing against the schedule — the evidence trail for whether the
  // villa is being kept to the agreed maintenance standard. THE BOARD, worst first (fmEngine.scheduleBoard — the
  // Schedule tab's list), and its count of late tasks (fmAttention — the tab's "N tasks need attention", the HUD's).
  // ⚠️ IT WALKED THE STORED ORDER WITH A FILTER OF ITS OWN (architecture review, 2026-10-19): an overdue task sat
  // under on-schedule ones, and the tab's headline number had no line here.
  L.push(`### Standing against schedule (as at recap date)`);
  const board = scheduleBoard(fm, now);
  if (board.length === 0) {
    L.push(`_No maintenance schedule configured._`);
  } else {
    const late = fmAttention(fm, now).lateTasks.length;
    L.push(`- Tasks needing attention: **${late}** (overdue or never recorded)`);
    L.push("");
    L.push(`| Task | Required every | Last done | Status | Due |`);
    L.push(`|---|---|---|---|---|`);
    for (const st of board) {
      const s = st.schedule;
      // its state's ONE word (DUE_WORDS, the Schedule tab's pill's), the late ones in bold; its sentence (dueLine,
      // the tab's) with the date in the document's form
      const w = DUE_WORDS[st.state];
      const by = Number.isFinite(st.dueAt) && st.dueAt ? ` (by ${docDate(st.dueAt)})` : "";
      // s.title is operator-entered free text (see ScheduleEditor) and, unlike
      // every other table in this file, was never pipe-escaped — a task
      // title containing "|" silently split into extra table columns. Caught
      // by rendering this output as an actual table instead of raw text.
      L.push(`| ${cell(s.title)} | ${s.everyDays} days | `
        + `${st.last ? docDate(st.last.at) : "—"} | ${w.tone === "danger" ? `**${w.word}**` : w.word} | ${dueLine(st)}${by} |`);
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
  // ⚠️ THE MONTH AS IT WAS (review 31): chosen and shown from the fault's steps — reopened in October, a fault fixed in
  // September left September's recap while its cost stayed in §2
  const monthEnd = monthBounds(month).end;
  const inMonth = fm.tickets.filter((t) => monthKey(t.openedAt) === month || resolvedInMonth(t, month))
    .map((t) => ({ ...t, ...ticketAt(t, monthEnd) }));
  // the resolution figures are THE MONTH'S, as its table is (architecture review, 2026-10-19: "Resolved (all time)" was
  // the record the server still keeps — September's recap made in January read "Closed without action: 0")
  const stats = ticketStats(fm.tickets, monthBounds(month));
  // open work counted per DEVICE card, as the Tickets tab and §5 count it (deviceWork.openCounts); the figures that
  // are per record — resolved, the mean — are ticketStats'. ⚠️ This line counted records (architecture review,
  // 2026-10-19): a pump with two faults read "Open: 2" here and "1 detected fault" in §5 of the same recap.
  const open = openCounts(fm.tickets, input.deviceOfRecord);
  L.push(`## 3. Faults and response`);
  L.push(`- Open faults: **${open.faults}** · Tickets in progress: **${open.tickets}** (one per device, as the Overview `
    + `and Tickets count them) · Resolved this month: **${stats.resolved}**`);
  if (stats.meanResolutionHours !== null) {
    // Named when it covers fewer tickets than "Resolved" reports, so the two
    // figures cannot be read as describing the same set when they do not.
    const covers = stats.meanCoversTickets === stats.resolved
      ? "" : ` (from ${stats.meanCoversTickets} of ${stats.resolved} — the rest `
        + `carry no usable resolution time)`;
    L.push(`- Mean time to resolution this month: **${stats.meanResolutionHours.toFixed(1)} hours**${covers}`);
  }
  if (stats.closedWithoutAction) L.push(`- Closed without action this month (not counted as repairs): **${stats.closedWithoutAction}**`);
  L.push("");
  if (inMonth.length) {
    L.push(`| Opened | Fault | Status | Resolved | Evidence |`);
    L.push(`|---|---|---|---|---|`);
    for (const t of inMonth.sort((x, y) => Date.parse(x.openedAt) - Date.parse(y.openedAt))) {
      L.push(`| ${docDate(t.openedAt)} | ${cell(t.title)} `
        // its stage's one word, the Tickets tab's pill's (STAGE_WORDS) — it printed the stored status ("in progress")
        + `| ${STAGE_WORDS[stageOf(t)].word} | ${t.resolvedAt ? docDate(t.resolvedAt) : "—"} `
        + `| ${t.photoIds.length} photo(s) |`);
    }
    L.push("");
  } else {
    L.push(`_No faults opened or resolved in this period._`);
    L.push("");
  }

  // ── 4. Device availability ───────────────────────────────────────────────
  // the readiness check's own devices (ReadinessResult.availability) — the ones §5's "All devices reporting" counts
  const avail = readiness?.availability;
  if (avail?.total) {
    const off = avail.offline.length;
    const pct = ((avail.total - off) / avail.total) * 100;
    L.push(`## 4. Device availability (at recap date)`);
    L.push(`- **${avail.total - off} of ${avail.total}** devices reporting `
      + `(${pct.toFixed(1)}%)`);
    // ⚠️ "SEE THE FAULTS SECTION ABOVE" POINTED AT NOTHING (architecture review, 2026-10-19): a device not answering is
    // not a fault record; it is a row of the Overview's Open issues, and the readiness check names it below.
    if (off > 0) L.push(`- ${off} device(s) currently offline — listed under "Open issues" on the Overview, `
      + `and under "${AVAILABILITY_CHECK_LABEL}" below.`);
    L.push("");
  }

  // ── 5. Readiness ─────────────────────────────────────────────────────────
  if (readiness) {
    L.push(`## 5. Guest-readiness check (at recap date)`);
    L.push(...readinessTable(readiness));
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
/** `month`: the month it is filed under (the saved list's; a snapshot is of now — monthlyDocument.monthsOffered). The
 *  same header as the recap and the statement (documentHeader: its "Generated:" is the moment taken), the verdict in
 *  the tab's words (readiness.VERDICT_WORDS), the checks as the recap's §5 prints them (readinessTable).
 *  ⚠️ IT HAD A HEADER, A VERDICT AND A TABLE OF ITS OWN (architecture review, 2026-10-19): "READY, WITH FINDINGS"
 *  over a tab saying "Ready, with things worth fixing", "Warning" where the recap said "Attention", and a "Taken"
 *  line in the phone's locale beside the other documents' fixed stamp. */
export function buildReadinessSnapshot(readiness: ReadinessResult, villaName: string, month: string): string {
  const lines = [
    ...documentHeader("readiness snapshot", villaName, month,
      "the guest-readiness checks as they stood when generated, from live device state."),
    `**${VERDICT_WORDS[readiness.overall]}** — ${readiness.passed} of ${readiness.total} checks passing.`,
    "",
    ...readinessTable(readiness),
    "",
    "_Generated by VESTA, from live device state at the moment shown above._",
  ];
  return lines.join("\n");
}
