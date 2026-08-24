// src/fm/fmEngine.ts
// Pure logic behind the Facility Manager screens: when a task is due, how a
// month's spend sits against the Minor Maintenance cap, and how long faults
// take to resolve.
//
// Deliberately free of React, Babylon and the network so the parts that carry
// contractual meaning can be reasoned about — and tested — on their own. Every
// threshold here traces to a clause; see fmTypes.ts for the citations.

import {
  MINOR_MAINTENANCE_CAP_IDR,
  type FmCompletion, type FmCost, type FmData, type FmSchedule, type FmTicket,
} from "./fmTypes";

const DAY_MS = 86_400_000;

export type DueState = "never" | "overdue" | "due-soon" | "ok";

export interface ScheduleStatus {
  schedule: FmSchedule;
  /** Most recent completion, or null if never performed. */
  last: FmCompletion | null;
  /** When it next falls due. null when never performed (due immediately). */
  dueAt: number | null;
  /** Negative = days overdue. null when never performed. */
  daysUntilDue: number | null;
  state: DueState;
}

/**
 * "Due soon" opens when 80% of the interval has elapsed, so a 90-day AC service
 * warns with ~18 days left and a 3-day pool visit warns within the same day.
 * Proportional rather than a fixed number of days: a fixed lead time would be
 * meaningless at both ends of a range this wide.
 */
const DUE_SOON_FRACTION = 0.8;

/** The latest completion of a schedule, by the time the work was DONE (`at`),
 *  not by when it happened to be logged — a task logged late is still evidence
 *  of on-time work, and the contract cares about the work. */
function lastCompletion(
  completions: readonly FmCompletion[], scheduleId: string,
): FmCompletion | null {
  let best: FmCompletion | null = null;
  for (const c of completions) {
    if (c.scheduleId !== scheduleId) continue;
    if (!best || Date.parse(c.at) > Date.parse(best.at)) best = c;
  }
  return best;
}

export function scheduleStatus(
  schedule: FmSchedule, completions: readonly FmCompletion[], now = Date.now(),
): ScheduleStatus {
  const last = lastCompletion(completions, schedule.id);
  if (!last) {
    // Never performed. `state` is deliberately "never" rather than "overdue":
    // the two need different words in the UI — one is a gap in the record,
    // the other is a missed obligation — even though both demand action.
    //
    // dueAt/daysUntilDue are NOT null, though (a change from the original
    // never-null contract, safe because every existing caller already treats
    // both as "possibly absent" via `?? 0`/`?? Infinity`): a schedule with no
    // completion yet still needs a target date to SHOW, so the UI isn't stuck
    // saying only "no completion recorded" forever. The baseline is
    // `createdAt` — the date the obligation started existing — falling back
    // to `now` for schedules created before that field existed, which reads
    // as "due in `everyDays`" rather than a wrong date.
    const baseline = schedule.createdAt ? Date.parse(schedule.createdAt) : now;
    const dueAt = baseline + schedule.everyDays * DAY_MS;
    return { schedule, last: null, dueAt, daysUntilDue: (dueAt - now) / DAY_MS, state: "never" };
  }
  const dueAt = Date.parse(last.at) + schedule.everyDays * DAY_MS;
  const daysUntilDue = (dueAt - now) / DAY_MS;
  const state: DueState =
    daysUntilDue < 0 ? "overdue"
      : daysUntilDue <= schedule.everyDays * (1 - DUE_SOON_FRACTION) ? "due-soon"
        : "ok";
  return { schedule, last, dueAt, daysUntilDue, state };
}

/** Every enabled schedule's status, worst first — what the FM home screen shows.
 *  Ordering is by urgency, not alphabetically: this list exists to be actioned
 *  from the top. */
export function scheduleBoard(data: FmData, now = Date.now()): ScheduleStatus[] {
  const rank: Record<DueState, number> = { overdue: 0, never: 1, "due-soon": 2, ok: 3 };
  return data.schedules
    .filter((s) => s.enabled)
    .map((s) => scheduleStatus(s, data.completions, now))
    .sort((a, b) =>
      rank[a.state] - rank[b.state]
      || (a.daysUntilDue ?? -Infinity) - (b.daysUntilDue ?? -Infinity));
}

/** "2026-07" for the month containing `at`, in LOCAL time — the villa's month
 *  boundary is the one the operator and the monthly report both mean. */
export function monthKey(at: string | number | Date): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface BudgetStatus {
  month: string;
  /** Minor-category spend this month — what the configured cap applies to. */
  minorIdr: number;
  /** Major spend, tracked separately: it is the Owner's account and
   *  explicitly NOT part of the cap. */
  majorIdr: number;
  capIdr: number;
  /** 0–1+ against the cap; can exceed 1. */
  fraction: number;
  state: "ok" | "approaching" | "exceeded";
  entries: FmCost[];
}

/**
 * Where this month's maintenance spend sits against the configured Minor
 * Maintenance cap (0 = not configured — see MINOR_MAINTENANCE_CAP_IDR).
 *
 * "approaching" at 80% exists because the decision a cap forces — do this as
 * shared Minor Maintenance, or raise it as Major — has to be made BEFORE the
 * money is spent. A warning that only arrives at 100% arrives after the
 * choice is gone. With no cap configured (capIdr <= 0) that decision doesn't
 * apply yet, so spend is tracked as "ok" regardless of amount rather than
 * reading as permanently "exceeded" against a zero cap.
 */
export function budgetStatus(
  costs: readonly FmCost[], month = monthKey(Date.now()),
  capIdr = MINOR_MAINTENANCE_CAP_IDR,
): BudgetStatus {
  const entries = costs.filter((c) => monthKey(c.at) === month);
  const minorIdr = entries.filter((c) => c.category === "minor")
    .reduce((s, c) => s + c.amountIdr, 0);
  const majorIdr = entries.filter((c) => c.category === "major")
    .reduce((s, c) => s + c.amountIdr, 0);
  const fraction = capIdr > 0 ? minorIdr / capIdr : 0;
  return {
    month, minorIdr, majorIdr, capIdr, fraction,
    state: capIdr <= 0 ? "ok" : minorIdr >= capIdr ? "exceeded" : fraction >= 0.8 ? "approaching" : "ok",
    entries,
  };
}

/** What a new minor expense of `amountIdr` would do to the cap — used to warn
 *  before it is committed rather than after. Never true with no cap
 *  configured (capIdr <= 0). */
export function wouldExceedCap(
  costs: readonly FmCost[], amountIdr: number,
  month = monthKey(Date.now()), capIdr = MINOR_MAINTENANCE_CAP_IDR,
): boolean {
  return capIdr > 0 && budgetStatus(costs, month, capIdr).minorIdr + amountIdr >= capIdr;
}

export interface TicketStats {
  open: number;
  inProgress: number;
  resolved: number;
  /** Mean hours from opening to resolution across resolved tickets, or null
   *  when nothing has been resolved yet. This is the number that evidences
   *  the property's own "inspections and supervision" obligation, whatever
   *  the source of that obligation is. */
  meanResolutionHours: number | null;
}

/** Is this fault finished? ⚠️ THE STATUS DECIDES, NEVER `resolvedAt`, and an
 *  UNKNOWN STATUS IS OPEN.
 *
 *  ⚠️ EXPORTED SO THERE IS ONE RULE, NOT A SHAPE REPEATED WHEREVER TICKETS ARE
 *  COUNTED (D12, 2026-08-22). `ticketStats` had it inline as a bare `else`,
 *  which counted any row with a missing or corrupt status as RESOLVED — a fault
 *  removed from the Facility Report by bad data. The add-on's
 *  `ledger.ticket_is_resolved` is the same sentence in Python and
 *  `test_consistency_parity` diffs the two over fixtures built to disagree.
 *
 *  `resolvedAt` still answers WHEN a fault closed; it does not answer WHETHER,
 *  and real stores carry rows with one and not the other. */
export function isTicketResolved(t: Pick<FmTicket, "status">): boolean {
  return t.status === "resolved";
}

/** Not resolved — which INCLUDES `in_progress`. The report shows those two
 *  separately; their SUM is this predicate, which is what the brief lists.
 *
 *  ⚠️ /dry-audit's unused-export probe FLAGS THIS ON EVERY RUN and it is a
 *  false positive of the probe's SCOPE, not dead code: the only consumer is
 *  `tests/consistency/kiosk_view.ts`, and the probe scans `src/` alone. That
 *  consumer is the shipped-TypeScript half of the kiosk/briefing parity pin
 *  (`tests/py/test_consistency_parity.py`), so deleting this to quiet the
 *  probe would break the test that exists to stop the tablet and the briefing
 *  describing the same villa differently. Verdict recorded here so the next
 *  run reads it instead of re-deriving it. */
export function isTicketOpen(t: Pick<FmTicket, "status">): boolean {
  return !isTicketResolved(t);
}

export function ticketStats(tickets: readonly FmTicket[]): TicketStats {
  let open = 0, inProgress = 0, resolved = 0, totalMs = 0, timed = 0;
  for (const t of tickets) {
    if (t.status === "open") open++;
    else if (t.status === "in_progress") inProgress++;
    // ⚠️ EXPLICIT, AND AN UNKNOWN STATUS COUNTS AS OPEN (D12, 2026-08-22).
    // This was a bare `else`, so ANY row whose status was missing or corrupt
    // was counted RESOLVED — a fault silently removed from the report by bad
    // data, which is the one direction this must never fail in. The add-on's
    // `ledger.ticket_is_resolved` is the same rule stated the same way, and
    // `test_consistency_parity` now diffs the two over fixtures that include a
    // status-less row precisely because it is the case the two sides used to
    // answer differently.
    else if (!isTicketResolved(t)) open++;
    else {
      resolved++;
      if (t.resolvedAt) {
        const ms = Date.parse(t.resolvedAt) - Date.parse(t.openedAt);
        if (Number.isFinite(ms) && ms >= 0) { totalMs += ms; timed++; }
      }
    }
  }
  return {
    open, inProgress, resolved,
    meanResolutionHours: timed ? totalMs / timed / 3_600_000 : null,
  };
}

/** Completions falling inside a calendar month — the maintenance section of
 *  the monthly report annex. */
export function completionsInMonth(
  data: FmData, month: string,
): Array<{ completion: FmCompletion; schedule: FmSchedule | undefined }> {
  return data.completions
    .filter((c) => monthKey(c.at) === month)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((completion) => ({
      completion,
      schedule: data.schedules.find((s) => s.id === completion.scheduleId),
    }));
}

/** Local-time ISO-ish stamp for a filename or a report heading. Avoids
 *  toISOString(), which silently shifts a Bali evening into the previous UTC
 *  day and would put a completion in the wrong month at the boundary. */
export function localStamp(at: string | number | Date = Date.now()): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatIdr(n: number): string {
  return `IDR ${Math.round(n).toLocaleString("en-US")}`;
}

/** Short human date, local time (e.g. "24 Jul 2026") — for a target/due date
 *  or a report table row, where the full time-of-day in localStamp() is more
 *  precision than the reader needs. Was previously private to fmReport.ts;
 *  moved here (and imported back from there) so TodayTab and ScheduleEditor
 *  can show the exact same date format the report annex uses, rather than
 *  each screen inventing its own. */
export function shortDate(at: string | number | Date): string {
  const d = new Date(at);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
