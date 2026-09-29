// src/fm/fmEngine.ts
// Pure logic behind the Facility Manager screens: when a task is due, how a
// month's spend sits against the owner's monthly cap, and how long faults
// take to resolve.
//
// Deliberately free of React, Babylon and the network so the parts that carry
// contractual meaning can be reasoned about — and tested — on their own. Every
// threshold here traces to a clause; see fmTypes.ts for the citations.

import {
  NO_FM_TERMS,
  type FmTerms,
  type FmCompletion, type FmCost, type FmData, type FmSchedule, type FmTicket, type FmTicketStatus,
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
  /** The other category's spend, tracked separately and explicitly NOT part
   *  of the cap. */
  majorSpend: number;
  cap: number;
  /** 0–1+ against the cap; can exceed 1. */
  fraction: number;
  state: "ok" | "approaching" | "exceeded";
  entries: FmCost[];
}

/**
 * Where this month's maintenance spend sits against the owner's monthly cap
 * on the capped category (FmTerms.monthlyCap; 0 = no cap).
 *
 * "approaching" (at terms.warnAt, 80 % unless the owner set another share)
 * exists because the decision a cap forces — keep this in the capped
 * category, or record it in the other one — has to be made BEFORE the money
 * is spent. With no cap that decision doesn't apply, so spend reads "ok"
 * regardless of amount rather than permanently "exceeded" against a zero cap.
 */
export function budgetStatus(
  costs: readonly FmCost[], month = monthKey(Date.now()),
  terms: Pick<FmTerms, "monthlyCap" | "warnAt"> = NO_FM_TERMS,
): BudgetStatus {
  const cap = terms.monthlyCap;
  const entries = costs.filter((c) => monthKey(c.at) === month);
  const minorSpend = entries.filter((c) => c.category === "minor")
    .reduce((s, c) => s + c.amountIdr, 0);
  const majorSpend = entries.filter((c) => c.category === "major")
    .reduce((s, c) => s + c.amountIdr, 0);
  const fraction = cap > 0 ? minorSpend / cap : 0;
  return {
    month, minorSpend, majorSpend, cap, fraction,
    state: cap <= 0 ? "ok" : minorSpend >= cap ? "exceeded" : fraction >= terms.warnAt ? "approaching" : "ok",
    entries,
  };
}

/**
 * What the capped category's month would come to with one more expense — or
 * with one entry CHANGED: `replacing` names an existing entry whose own
 * amount is taken out first. The ONE cap check every form asks (SpendTab used
 * to compute its own, and counted an edited entry's old amount twice).
 *
 * The month is the one the expense lands in: a new entry's is today's (it is
 * stamped now), an edited entry keeps its own date.
 */
export function projectedSpend(
  costs: readonly FmCost[],
  change: { amount: number; category: "minor" | "major"; replacing?: string },
  terms: Pick<FmTerms, "monthlyCap" | "warnAt"> = NO_FM_TERMS,
  now = Date.now(),
): { month: string; minorSpend: number; cap: number; over: boolean } {
  const edited = change.replacing ? costs.find((c) => c.id === change.replacing) : undefined;
  const month = monthKey(edited ? edited.at : now);
  const others = edited ? costs.filter((c) => c.id !== edited.id) : costs;
  const minorSpend = budgetStatus(others, month, terms).minorSpend
    + (change.category === "minor" ? change.amount : 0);
  const cap = terms.monthlyCap;
  return { month, minorSpend, cap, over: cap > 0 && minorSpend >= cap };
}

/** Whether a new capped expense of `amount` would reach the cap — warned
 *  about before it is committed. Never true with no cap. */
export function wouldExceedCap(
  costs: readonly FmCost[], amount: number,
  terms: Pick<FmTerms, "monthlyCap" | "warnAt"> = NO_FM_TERMS, now = Date.now(),
): boolean {
  return projectedSpend(costs, { amount, category: "minor" }, terms, now).over;
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

/** Write a money amount for display, in the install's currency (FmTerms.
 *  currency, which is Home Assistant's own; "" prints the number alone rather
 *  than mislabelling it). `[]` hands the digit grouping to the viewer's own
 *  locale. The rounding is unchanged — these are whole-unit amounts. */
export function formatMoney(n: number, currency = ""): string {
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


// ── Rules that lived in the screens (round 13, 2.496.183) ─────────────────
// Each was written in a component or the store's context, where only a regex
// could reach it, and several already disagreed with the engine or with each
// other. tests/oracles/fm_rules.mjs drives them by value.

/** Where a fault goes next from the Faults tab. Resolved is final there. */
export const TICKET_NEXT: Readonly<Record<FmTicketStatus, FmTicketStatus | null>> = {
  open: "in_progress", in_progress: "resolved", resolved: null,
};

/** A fault's place in the list: open, then in progress, then resolved. A
 *  status this build does not know is treated as OPEN — the engine's own
 *  reading (isTicketOpen) — where the list used to rank it beside resolved. */
export function ticketRank(t: Pick<FmTicket, "status">): number {
  if (isTicketResolved(t)) return 2;
  return t.status === "in_progress" ? 1 : 0;
}

/**
 * An amount typed by an operator, as a whole number of the currency's units.
 * Grouping separators are dropped; a trailing ".xx" / ",xx" (one or two
 * digits) is a FRACTION and is rounded, not glued on — "12.50" was 1250.
 * Written three times before (Today, Spend, the fault resolution).
 */
export function parseAmount(text: string): number {
  const t = text.replace(/\s/g, "");
  const frac = /^(.*\d)[.,](\d{1,2})$/.exec(t);
  const whole = Number((frac ? frac[1] : t).replace(/[^\d]/g, "")) || 0;
  return frac ? Math.round(whole + Number(`0.${frac[2]}`)) : whole;
}

/** Erase a fault WITH its history: the completion that resolved it and the
 *  cost logged against it — the store's own docstring promised this, and the
 *  context only removed the ticket, leaving the rows "a fault since erased". */
export function withoutTicket(d: FmData, id: string): FmData {
  const t = d.tickets.find((x) => x.id === id);
  const fromIt = d.completions.filter((c) => c.ticketId === id);
  const costIds = new Set([t?.costId, ...fromIt.map((c) => c.costId)].filter((x): x is string => !!x));
  return {
    ...d,
    tickets: d.tickets.filter((x) => x.id !== id),
    completions: d.completions.filter((c) => c.ticketId !== id),
    costs: d.costs.filter((c) => !costIds.has(c.id)),
  };
}

/** What a completion answered: a scheduled task, a fault, or something since
 *  removed — one reading for the report and the recent-work list. */
export function completionSource(
  d: Pick<FmData, "schedules" | "tickets">, c: Pick<FmCompletion, "scheduleId" | "ticketId">,
): { kind: "schedule" | "fault"; title: string | undefined } {
  if (c.ticketId) return { kind: "fault", title: d.tickets.find((t) => t.id === c.ticketId)?.title };
  return { kind: "schedule", title: d.schedules.find((s) => s.id === c.scheduleId)?.title };
}

/**
 * What NEEDS ATTENTION in the Facility record — ONE rule for the HUD badge,
 * the Cockpit and the Today tab: open faults, and tasks overdue or never
 * recorded. Due-soon is not attention (it is not late yet); Today counted it
 * under the same words, so its number and the HUD's could differ.
 */
export function fmAttention(d: FmData, now = Date.now()): {
  openFaults: FmTicket[]; lateTasks: ReturnType<typeof scheduleBoard>; total: number;
} {
  const openFaults = d.tickets.filter(isTicketOpen);
  const lateTasks = scheduleBoard(d, now).filter((s) => s.state === "overdue" || s.state === "never");
  return { openFaults, lateTasks, total: openFaults.length + lateTasks.length };
}
