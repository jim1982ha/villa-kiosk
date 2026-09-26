// src/fm/fmEngine.ts
// Pure logic behind the Facility Manager screens: when a task is due, how a
// month's spend sits against the Minor Maintenance cap, and how long faults
// take to resolve.
//
// Deliberately free of React, Babylon and the network so the parts that carry
// contractual meaning can be reasoned about — and tested — on their own. Every
// threshold here traces to a clause; see fmTypes.ts for the citations.

import {
  MINOR_MAINTENANCE_CAP,
  MONEY_CURRENCY,
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
  // ⚠️ AN UNREADABLE DATE MUST NOT READ AS COMPLIANT. An unparseable `last.at`
  // makes dueAt NaN, and every comparison against NaN is false — so the ladder
  // below fell through to "ok" and the report printed "On schedule" for a task
  // whose last completion could not be read at all. That is the direction
  // ticketStats' own comment forbids further down this file: "a fault wrongly
  // shown as open is a question someone asks; a fault wrongly shown as resolved
  // is one nobody ever asks again." A maintenance obligation is the same.
  // Reported as "never recorded" — the honest reading of an unusable record,
  // and the state the board already ranks worst.
  if (!Number.isFinite(daysUntilDue)) {
    return { schedule, last: null, dueAt: NaN, daysUntilDue: 0, state: "never" };
  }
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
  minorSpend: number;
  /** Major spend, tracked separately: it is the Owner's account and
   *  explicitly NOT part of the cap. */
  majorSpend: number;
  cap: number;
  /** 0–1+ against the cap; can exceed 1. */
  fraction: number;
  state: "ok" | "approaching" | "exceeded";
  entries: FmCost[];
}

/**
 * Where this month's maintenance spend sits against the configured Minor
 * Maintenance cap (0 = not configured — see MINOR_MAINTENANCE_CAP).
 *
 * "approaching" at 80% exists because the decision a cap forces — do this as
 * shared Minor Maintenance, or raise it as Major — has to be made BEFORE the
 * money is spent. A warning that only arrives at 100% arrives after the
 * choice is gone. With no cap configured (cap <= 0) that decision doesn't
 * apply yet, so spend is tracked as "ok" regardless of amount rather than
 * reading as permanently "exceeded" against a zero cap.
 */
export function budgetStatus(
  costs: readonly FmCost[], month = monthKey(Date.now()),
  cap = MINOR_MAINTENANCE_CAP,
): BudgetStatus {
  const entries = costs.filter((c) => monthKey(c.at) === month);
  const minorSpend = entries.filter((c) => c.category === "minor")
    .reduce((s, c) => s + c.amountIdr, 0);
  const majorSpend = entries.filter((c) => c.category === "major")
    .reduce((s, c) => s + c.amountIdr, 0);
  const fraction = cap > 0 ? minorSpend / cap : 0;
  return {
    month, minorSpend, majorSpend, cap, fraction,
    state: cap <= 0 ? "ok" : minorSpend >= cap ? "exceeded" : fraction >= 0.8 ? "approaching" : "ok",
    entries,
  };
}

/** What a new minor expense of `amountIdr` would do to the cap — used to warn
 *  before it is committed rather than after. Never true with no cap
 *  configured (cap <= 0). */
export function wouldExceedCap(
  costs: readonly FmCost[], amountIdr: number,
  month = monthKey(Date.now()), cap = MINOR_MAINTENANCE_CAP,
): boolean {
  return cap > 0 && budgetStatus(costs, month, cap).minorSpend + amountIdr >= cap;
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
  /** Tickets the mean is computed from — see ticketStats. Equal to `resolved`
   *  unless some resolved ticket carries no usable resolution time. */
  meanCoversTickets: number;
}

/** Is this fault closed?
 *
 *  ⚠️ THE STATUS DECIDES, NOT `resolvedAt`. A ticket can carry a resolution
 *  timestamp from an earlier close and be reopened; the status is the field the
 *  UI writes and the field a person sets.
 *
 *  ⚠️ AND ANYTHING ELSE IS OPEN. Missing, empty, or a value this build does not
 *  recognise all mean "not resolved" — a fault wrongly shown open is a question
 *  someone asks, while one wrongly shown resolved is one nobody ever asks
 *  again. `ticketStats` used to disagree with the other seven readers of this
 *  rule via a bare `else`; see 2.496.6. */
// ⚠️ THE STATUS IS OPTIONAL IN THE PARAMETER TYPE, DELIBERATELY. The write
// path in `FmDataContext` asks this of a `Partial<FmTicket>` patch, and a
// signature requiring the field would push that one caller back to an inline
// comparison — which is the exact drift this predicate exists to stop. It also
// matches what the rule already SAYS: a missing status is not resolved.
export function isTicketResolved(t: { status?: FmTicket["status"] }): boolean {
  return t.status === "resolved";
}

export function isTicketOpen(t: { status?: FmTicket["status"] }): boolean {
  return !isTicketResolved(t);
}

export function ticketStats(tickets: readonly FmTicket[]): TicketStats {
  let open = 0, inProgress = 0, resolved = 0, totalMs = 0, timed = 0;
  for (const t of tickets) {
    if (t.status === "open") open++;
    else if (t.status === "in_progress") inProgress++;
    // ⚠️ EXPLICIT, AND AN UNKNOWN STATUS COUNTS AS OPEN. This was a bare
    // `else`, so ANY row whose status was missing, empty or corrupt was counted
    // RESOLVED — a fault silently removed from the facility report by bad data,
    // which is the one direction this must never fail in. A fault wrongly shown
    // as open is a question someone asks; a fault wrongly shown as resolved is
    // one nobody ever asks again.
    else if (isTicketOpen(t)) open++;
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
    // ⚠️ HOW MANY TICKETS THE MEAN ACTUALLY COVERS. `resolved` and `timed` are
    // independent counters: a ticket resolved with no resolvedAt, or with a
    // resolvedAt before its openedAt, counts as resolved and is skipped by the
    // mean. Without this the report could print "Resolved: 20" beside "Mean
    // time to resolution: 1.4 hours" where the mean covered three, with no
    // signal that the two numbers describe different sets.
    meanCoversTickets: timed,
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

/** Write a money amount for display.
 *
 *  ⚠️ NEITHER THE CURRENCY NOR THE GROUPING IS BAKED IN ANY MORE. This was
 *  `IDR ${n.toLocaleString("en-US")}` — one site's currency and one country's
 *  digit grouping, in a redistributable add-on, applied to every install.
 *  `MONEY_CURRENCY` is empty by default, so an unconfigured install prints the
 *  number alone rather than mislabelling it; `[]` hands the grouping to the
 *  viewer's own locale, which is what a reader in front of the screen expects.
 *  The rounding is unchanged — these are whole-unit amounts by contract. */
export function formatMoney(n: number, currency: string = MONEY_CURRENCY): string {
  const amount = Math.round(n).toLocaleString([]);
  return currency ? `${currency} ${amount}` : amount;
}

/** Short human date, local time (e.g. "24 Jul 2026") — for a target/due date
 *  or a report table row, where the full time-of-day in localStamp() is more
 *  precision than the reader needs. Was previously private to fmReport.ts;
 *  moved here (and imported back from there) so TodayTab and ScheduleEditor
 *  can show the exact same date format the report annex uses, rather than
 *  each screen inventing its own. */
export function shortDate(at: string | number | Date): string {
  // ⚠️ THE READER'S LOCALE, NOT "en-GB". A fixed locale here is the same
  // per-site assumption formatMoney's currency was: this report is generated on
  // the reader's own device and read there, and every other clock and date in
  // the app already asks the platform. The FIELDS stay fixed — day, short
  // month, year — so the shape is stable and unambiguous wherever it renders;
  // only the ordering and spelling follow the reader.
  const d = new Date(at);
  return d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

/** The month a report covers, spelled for a heading (e.g. "July 2026").
 *  Same reasoning as shortDate: fixed fields, reader's locale. Lived in
 *  fmReport.ts with its own hardcoded "en-GB". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  // A malformed month key would otherwise render "Invalid Date" into the
  // report's own Period heading; say what was actually stored instead.
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return month;
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: "long", year: "numeric" });
}

// ── How a record changes (round 10, 2.496.159) ──────────────────────────────
// These lived inside FmDataContext's React mutators, where no check could
// reach them — and each carries a rule someone's report depends on. Pure: the
// clock and the id maker are passed in (FmDataContext passes the real ones;
// tests/oracles/fm_changes.mjs passes fixed ones).

/** "Now" and a fresh id for a record of `prefix` — the only impure inputs. */
export interface FmStamp { now: string; id: (prefix: string) => string }

/** Log a completion, with what it cost in the same action: the cost inherits
 *  the completion's photos and date — one event, and the report lines them up. */
export function withCompletion(
  d: FmData, c: Omit<FmCompletion, "id" | "costId">, cost: Omit<FmCost, "id" | "at" | "photoIds"> | undefined, k: FmStamp,
): FmData {
  const costId = cost ? k.id("co") : undefined;
  return {
    ...d,
    completions: [...d.completions, { ...c, id: k.id("cp"), costId }],
    costs: cost ? [...d.costs, { ...cost, id: costId!, at: c.at, photoIds: c.photoIds }] : d.costs,
  };
}

/** Erase a spend entry. A completion pointing at it keeps the work but loses
 *  the link — a job "with an unknown price" otherwise. */
export function withoutCost(d: FmData, id: string): FmData {
  return {
    ...d,
    costs: d.costs.filter((c) => c.id !== id),
    completions: d.completions.map((c) => (c.costId === id ? { ...c, costId: undefined } : c)),
  };
}

/** Erase a completion AND the cost logged with it — one event; money left
 *  behind would be attributed to work with no record. */
export function withoutCompletion(d: FmData, id: string): FmData {
  const gone = d.completions.find((c) => c.id === id);
  return {
    ...d,
    completions: d.completions.filter((c) => c.id !== id),
    costs: gone?.costId ? d.costs.filter((c) => c.id !== gone.costId) : d.costs,
  };
}

/** Patch a fault. The resolution time is stamped when — and only when — the
 *  status becomes resolved (the operator marks it done, the app records WHEN:
 *  the mean-time-to-resolution evidence rests on it). */
export function withTicketPatch(d: FmData, id: string, patch: Partial<FmTicket>, k: Pick<FmStamp, "now">): FmData {
  return {
    ...d,
    tickets: d.tickets.map((t) => {
      if (t.id !== id) return t;
      const next = { ...t, ...patch };
      if (isTicketResolved(patch) && !next.resolvedAt) next.resolvedAt = k.now;
      return next;
    }),
  };
}

/**
 * Move a fault to its next stage and record the proof. The resolution time is
 * stamped on the way IN to resolved and cleared on reopening (a stale one
 * corrupts every MTTR figure); the step's photos join the fault's own; and
 * only a RESOLUTION files a completion (with its cost) — picking a fault up is
 * a step, not work done, and counting it would inflate every "work done" figure.
 */
export function withTicketAdvanced(
  d: FmData, id: string, to: FmTicket["status"],
  step: { by?: string; note?: string; photoIds: string[] },
  cost: Omit<FmCost, "id" | "at" | "photoIds"> | undefined, k: FmStamp,
): FmData {
  if (!d.tickets.some((t) => t.id === id)) return d;
  const at = k.now;
  const resolving = to === "resolved";
  const costId = resolving && cost ? k.id("co") : undefined;
  return {
    ...d,
    tickets: d.tickets.map((t) => (t.id !== id ? t : {
      ...t,
      status: to,
      resolvedAt: resolving ? at : undefined,
      photoIds: [...t.photoIds, ...step.photoIds],
      costId: costId ?? t.costId,
      updates: [...(t.updates ?? []), { at, status: to, ...step }],
    })),
    completions: resolving
      ? [...d.completions, {
          id: k.id("cp"), scheduleId: "", ticketId: id, at,
          by: step.by ?? "—", note: step.note, photoIds: step.photoIds, costId,
        }]
      : d.completions,
    costs: costId ? [...d.costs, { ...cost!, id: costId, at, photoIds: step.photoIds }] : d.costs,
  };
}
