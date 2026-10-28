// src/fm/fmEngine.ts
// Pure logic behind the Facility Manager screens: when a task is due, how a
// month's spend sits against the owner's monthly cap, and how long faults
// take to resolve.
//
// Deliberately free of React, Babylon and the network so the parts that carry
// contractual meaning can be reasoned about — and tested — on their own. Every
// threshold here traces to a clause; see fmTypes.ts for the citations.

import {
  CLEARED_NOTES, CLEARED_NOTE_PREFIXES, COST_CATEGORY_NAMES, NOT_STATUS_CHANGE_KINDS, NO_FM_TERMS,
  type FmTerms,
  type FmCompletion, type FmCost, type FmData, type FmSchedule, type FmTicket, type FmTicketUpdate,
} from "./fmTypes";
import { fullDate, monthYear } from "@/utils/dateText";
import { addLocalDays, DAY_MS, HOUR_MS, localMonthStart } from "@/utils/localDay";
import { villaTime, wallClock } from "@/utils/villaClock";
import { fmtDuration } from "@/components/panels/chartUtils";
import type { Tone } from "./tone";
import { countOf } from "@/utils/countOf";
import AGENT_CONTRACT from "../../rootfs/usr/share/vesta/agent-contract.json" with { type: "json" };

export type DueState = "never" | "overdue" | "due-soon" | "ok";
/** Where the month's minor spending stands against its cap. */
export type SpendCapState = "ok" | "approaching" | "exceeded";

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
    const dueAt = addLocalDays(baseline, schedule.everyDays);
    return { schedule, last: null, dueAt, daysUntilDue: (dueAt - now) / DAY_MS, state: "never" };
  }
  const dueAt = addLocalDays(Date.parse(last.at), schedule.everyDays);
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

/** Each due state's ONE word and tone, as every screen and document says it: the Schedule's pill (its colour: fm/tone
 *  pillClass), the Overview's late-task line (config/attention), the recap's Standing table. The twin of STAGE_WORDS.
 *  ⚠️ THREE SPELLINGS (architecture review, 2026-10-19): the tab held STATE_LABEL, the recap wrote "**Overdue by 3d**"
 *  and "**Never recorded**" of its own, the Overview a third copy — and the tone sat apart in fm/tone. */
export const DUE_WORDS: Record<DueState, { word: string; tone: Tone }> = {
  overdue: { word: "Overdue", tone: "danger" },
  never: { word: "Never recorded", tone: "danger" },
  "due-soon": { word: "Due soon", tone: "warn" },
  ok: { word: "On schedule", tone: "ok" },
};

/** How a task stands, as a sentence WITHOUT its date — "3 days overdue", "Due today", "Due in 12 days", "No completion
 *  recorded yet". The date is the reader's: a screen appends it in its locale (shortDate), a document in the fixed
 *  form (dateText.docDate). ⚠️ The sentence lived in the Schedule tab alone; the recap said "Overdue by 3d". */
export function dueLine(st: Pick<ScheduleStatus, "state" | "daysUntilDue">): string {
  if (st.state === "never") return "No completion recorded yet";
  const d = Math.round(st.daysUntilDue ?? 0);
  if (d < 0) return `${countOf(Math.abs(d), "day")} overdue`;
  if (d === 0) return "Due today";
  return `Due in ${countOf(d, "day")}`;
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
  const w = wallClock(new Date(at));   // the villa's month (utils/villaClock)
  return `${w.year}-${String(w.month).padStart(2, "0")}`;
}

/** The first instant of a month key ("2026-09") and of the month after it, in LOCAL time — the one parsing of a
 *  month, on utils/localDay. ⚠️ PARSED THREE TIMES (architecture review, 2026-10-19): the recap's month end, the
 *  documents' default month and the Period heading each split the key by hand. A malformed key gives NaN bounds, and
 *  every reader says so rather than printing "Invalid Date". */
export function monthBounds(month: string): { start: number; end: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const y = Number(m?.[1]), mo = Number(m?.[2]);
  if (!m || mo < 1 || mo > 12) return { start: NaN, end: NaN };
  const start = villaTime(y, mo, 1);
  return { start, end: localMonthStart(start, 1) };
}

export interface BudgetStatus {
  month: string;
  /** Minor-category spend this month — what the configured cap applies to. */
  minorSpend: number;
  /** The other category's spend, tracked separately and explicitly NOT part
   *  of the cap. */
  majorSpend: number;
  /** Both — the month's whole maintenance spend (the Spend tab shows all three, owner 2026-10-14). */
  totalSpend: number;
  cap: number;
  /** 0–1+ against the cap; can exceed 1. */
  fraction: number;
  state: SpendCapState;
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
    month, minorSpend, majorSpend, totalSpend: minorSpend + majorSpend, cap, fraction,
    state: capState(minorSpend, cap, terms.warnAt),
    entries,
  };
}

/** Where a capped total stands against the cap: the one ladder budgetStatus and projectedSpend climb. */
function capState(minorSpend: number, cap: number, warnAt: number): SpendCapState {
  return cap <= 0 ? "ok" : minorSpend >= cap ? "exceeded" : minorSpend / cap >= warnAt ? "approaching" : "ok";
}

/** What the month's cap state asks of the reader, one sentence per state — none when all is well. The ONE wording
 *  for the Spend tab's note, the statement's and the recap's line, and a form's cost banner.
 *  ⚠️ THREE SENTENCES (architecture review, 2026-10-19): the Spend tab, the statement (which had none for
 *  "approaching") and the cost fields each wrote their own. */
export function capNotes(b: Pick<BudgetStatus, "state">): string[] {
  switch (b.state) {
    case "exceeded":
      return [`Cap reached. Further spend this month belongs to ${COST_CATEGORY_NAMES.major}, on whatever terms your `
        + "own agreement sets for spend beyond it."];
    case "approaching":
      return [`Approaching the cap, decide now whether upcoming work is ${COST_CATEGORY_NAMES.minor} or should be `
        + `recorded as ${COST_CATEGORY_NAMES.major}.`];
    default:
      return [];
  }
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
): { month: string; minorSpend: number; cap: number; over: boolean; state: SpendCapState } {
  const edited = change.replacing ? costs.find((c) => c.id === change.replacing) : undefined;
  const month = monthKey(edited ? edited.at : now);
  const others = edited ? costs.filter((c) => c.id !== edited.id) : costs;
  const minorSpend = budgetStatus(others, month, terms).minorSpend
    + (change.category === "minor" ? change.amount : 0);
  const cap = terms.monthlyCap;
  const state = capState(minorSpend, cap, terms.warnAt);
  return { month, minorSpend, cap, over: state === "exceeded", state };
}

/** The figures that are PER RECORD — a repair's time, the closed ones. What is OPEN is counted per DEVICE card, as
 *  the Overview and the Tickets tab draw it (deviceWork.openCounts) — the recap's "Open" line read this per record
 *  while its own readiness section and the Tickets tab counted cards (architecture review, 2026-10-19). */
export interface TicketStats {
  resolved: number;
  /** Mean hours from opening to resolution across resolved tickets, or null
   *  when nothing has been resolved yet. This is the number that evidences
   *  the property's own "inspections and supervision" obligation, whatever
   *  the source of that obligation is. */
  meanResolutionHours: number | null;
  /** Tickets the mean is computed from — see ticketStats. Equal to `resolved`
   *  unless some resolved ticket carries no usable resolution time. */
  meanCoversTickets: number;
  /** Resolved with no work done (isClearedStep): counted apart, never in `resolved` nor the mean. */
  closedWithoutAction: number;
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

/** Where a record stands (owner, 2026-10-14): a FAULT waits on the Overview until someone takes it on, then it is a
 *  TICKET (the Tickets tab), then CLOSED. ONE answer for every screen and count.
 *  ⚠️ SEVEN SCREENS DECIDED IT EACH (architecture review, 2026-10-14): a record with a status this build does not know
 *  showed as a fault on the Overview, titled itself "Edit ticket" and was in no Tickets list. Unknown is a FAULT here,
 *  everywhere — never hidden, never closed. */
export type FmStage = "fault" | "ticket" | "closed";
export function stageOf(t: { status?: FmTicket["status"] }): FmStage {
  if (isTicketResolved(t)) return "closed";
  return t.status === "in_progress" ? "ticket" : "fault";
}

/** Each stage's ONE word and tone, as every screen and report says it: the Tickets tab's pill (its colour: fm/tone
 *  pillClass), the recap's Status column, the Overview's line (config/attention faultStatus — which says NOTHING for an
 *  open fault, owner 2026-10-14: "OPEN FAULT:" before every fault said nothing; the open word is for a table).
 *  ⚠️ THREE SPELLINGS (architecture review, 2026-10-19): the pill said "In progress" in the Schedule's due-soon colour,
 *  the recap printed the stored status ("in progress"), and the Overview's item carried a "Fault" nothing read. */
export const STAGE_WORDS: Record<FmStage, { word: string; tone: Tone }> = {
  fault: { word: "Open", tone: "warn" },
  ticket: { word: "In progress", tone: "warn" },
  closed: { word: "Resolved", tone: "ok" },
};

/** A fault's alert number when it carries a real one (a positive integer), else undefined — the one reading of
 *  FmTicket.alertNumber (faultTitle, the open issue's and the Watch line's link to VESTA's card). */
export const alertNumberOf = (t: Pick<FmTicket, "alertNumber">): number | undefined =>
  typeof t.alertNumber === "number" && Number.isInteger(t.alertNumber) && t.alertNumber > 0 ? t.alertNumber : undefined;

/** An alert's name as Telegram writes it — "#5-P2", or "#5" without a priority — in the agreement's one form
 *  (agent-contract.json ticket.alertLabel, the form the VESTA Agent titles its messages with). Pure. */
export function alertLabel(number: number, priority?: string): string {
  const known = priority !== undefined && (AGENT_CONTRACT.ticket.priorities as readonly string[]).includes(priority);
  const form = known ? AGENT_CONTRACT.ticket.alertLabel : AGENT_CONTRACT.ticket.alertLabelNoPriority;
  return form.replace("{number}", String(number)).replace("{priority}", priority ?? "");
}

/** A fault's title as every list shows it: "#5-P2 · House Pump Power …" when it came from a VESTA Agent alert — its name
 *  as its Telegram messages carry it (alertLabel) — else its title alone. A duration in it is worded now,
 *  from its `since` ("offline for 6 d 2 h"), in the Kiosk's duration words (chartUtils.fmtDuration): the title the
 *  Agent wrote at 02:00 said "129 h" all day (architecture review, 2026-10-15). */
export function faultTitle(t: Pick<FmTicket, "title" | "alertNumber" | "alertPriority" | "titlePattern" | "since">,
  now: number = Date.now()): string {
  const from = t.since ? Date.parse(t.since) : NaN;
  const title = t.titlePattern?.includes("{since}") && Number.isFinite(from)
    ? t.titlePattern.replace("{since}", fmtDuration(now - from)) : t.title;
  const n = alertNumberOf(t);
  return n !== undefined ? `${alertLabel(n, t.alertPriority)} · ${title}` : title;
}

/** Who did a piece of work: the person, when someone else recorded it (a VESTA Agent completion for a Done on
 *  Telegram), else who recorded it. One reading for every list and report. */
export function workedBy(c: Pick<FmCompletion, "by" | "who">): string {
  return c.who || c.by || "—";
}

/** A step that resolved a fault with no work done: the Kiosk's "Close" (nothing done), the VESTA Agent's own
 *  clearing of a problem gone (kind "cleared", agent-contract.json). ⚠️ The one place a step written before the kind
 *  existed is read by its note (review 31: such closes counted as repairs in every figure). */
export function isClearedStep(u: FmTicketUpdate): boolean {
  if (u.kind) return u.kind === "cleared";
  const n = u.note ?? "";
  return isTicketResolved(u) && (CLEARED_NOTES.includes(n) || CLEARED_NOTE_PREFIXES.some((p) => n.startsWith(p)));
}

/** The steps that CHANGED a fault's status, in time order — ONE reading for every figure and the card (architecture
 *  review, 2026-10-15). A line from Telegram ("noted": "Reminder sent…") and a title step (retitled, reading) carry
 *  the status the fault had when they were written, and a "noted" line is written minutes after its moment, at the end
 *  of the list: read as a status change, a reminder at 23:50 written after a take-on at 00:10 made September's report
 *  count a fault still OPEN at month end as in progress. A step without a kind changes the status; so do reopened and
 *  cleared. */
const NOT_A_STATUS_CHANGE: ReadonlySet<string> = new Set(NOT_STATUS_CHANGE_KINDS);   // the agreement's (the proxy reads it too)
export function statusChanges(t: Pick<FmTicket, "updates">): FmTicketUpdate[] {
  return stepsInTimeOrder(t).filter((u) => u.status && !(u.kind && NOT_A_STATUS_CHANGE.has(u.kind)));
}

/** The step that last resolved the fault — of its status changes, never a title or a Telegram line written after it
 *  (those carry "resolved" too): what tells how it was closed. ⚠️ ONE ANSWER (architecture review, 2026-10-15): the
 *  Tickets figures took the last step saying "resolved", so a closed Wi-Fi blip renamed afterwards counted as a repair,
 *  and its hours went into the mean. */
export function lastResolution(t: Pick<FmTicket, "updates">): FmTicketUpdate | undefined {
  const done = statusChanges(t).filter((u) => isTicketResolved(u));
  return done[done.length - 1];
}

/** A fault's steps in time order (stable: steps at the same moment keep their order) — a line from Telegram is
 *  written minutes after its moment, at the end of the list. A step whose time cannot be read sorts FIRST, as the
 *  proxy's _fm_last_resolution reads it (agent-contract.json `ticketUpdate.histories`): its NaN compared as "same
 *  moment" and fell back to list position, an order that is no order at all (a before b before c before a). */
export function stepsInTimeOrder(t: Pick<FmTicket, "updates">): FmTicketUpdate[] {
  return (t.updates ?? []).map((u, i) => ({ u, i, at: Date.parse(u.at) || 0 }))
    .sort((a, b) => (a.at - b.at) || (a.i - b.i)).map(({ u }) => u);
}

/** The time a fault was really open, in ms: from its opening (or a reopening) to each resolution, never the time it
 *  sat resolved in between (review 31: fixed in 2 h, reopened a month later, fixed in 2 h read 722 h). Without
 *  steps: opened → resolved. Null when it cannot be told. */
export function openTimeMs(t: FmTicket): number | null {
  const steps = statusChanges(t);
  if (!steps.some((u) => isTicketResolved(u))) {
    const ms = t.resolvedAt ? Date.parse(t.resolvedAt) - Date.parse(t.openedAt) : NaN;
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
  }
  let since: number | null = Date.parse(t.openedAt), total = 0;
  for (const u of steps) {
    const at = Date.parse(u.at);
    if (!Number.isFinite(at)) continue;
    if (isTicketResolved(u)) {
      if (since !== null && Number.isFinite(since) && at >= since) total += at - since;
      since = null;
    } else if (since === null) since = at;                       // open again
  }
  return total;
}

/** A fault as it stood at `iso`: its status, and when it was resolved if it was by then — a past month's report tells
 *  that month, never the fault as it is today (review 31: reopened in October, it vanished from September's recap). */
export function ticketAt(t: FmTicket, at: string | number): { status: FmTicket["status"]; resolvedAt?: string } {
  const until = typeof at === "number" ? at : Date.parse(at);
  const all = statusChanges(t);
  if (!all.length) return { status: t.status, resolvedAt: t.resolvedAt };     // no history: as it is
  const steps = all.filter((u) => Date.parse(u.at) <= until);
  const last = steps[steps.length - 1];
  if (!last) return { status: "open" };
  return { status: last.status, resolvedAt: isTicketResolved(last) ? last.at : undefined };
}

/** Did the fault resolve in `month` ("2026-09")? From its steps — a resolution the fault was later reopened from
 *  counts — else its resolvedAt. */
export function resolvedInMonth(t: FmTicket, month: string): boolean {
  const steps = statusChanges(t).filter((u) => isTicketResolved(u));
  const ats = steps.length ? steps.map((u) => u.at) : (t.resolvedAt ? [t.resolvedAt] : []);
  return ats.some((a) => monthKey(a) === month);
}

/** A period the figures are about: [start, end) in ms. */
export interface TicketWindow { start: number; end: number }

/** How long the server keeps a closed fault (GET /fm-data's `retention`, supervisor-proxy _fm_retention): a close with
 *  no work done, and a repair (the evidence window); and the completions and costs (`recordsDays`, owner 2026-10-20:
 *  "it shouldn't be kept forever" — the repair's window). Days; 0 = for ever. */
export interface FmRetention { clearedDays: number; repairedDays: number; recordsDays: number }

/** The line under a list of work done or money spent: how long it is kept — null when kept for ever or not said. */
export function recordsKeptNote(r: FmRetention | null, what: string): string | null {
  return r && r.recordsDays > 0
    ? `${what} older than ${r.recordsDays} days is no longer kept (Advanced Settings › System).` : null;
}

/** The days the record still holds BOTH kinds of close — the shorter window (0 = for ever, so not a bound); null when
 *  neither expires. The Tickets figures are about this period, and say so. */
export function keptDays(r: FmRetention): number | null {
  const bounded = [r.clearedDays, r.repairedDays].filter((d) => Number.isFinite(d) && d > 0);
  return bounded.length ? Math.min(...bounded) : null;
}

/** A fault as it stood at `end`: its status changes up to then, its status and resolution then (ticketAt). */
function ticketUpTo(t: FmTicket, end: number): FmTicket {
  const at = ticketAt(t, end);
  return { ...t, ...at, resolvedAt: at.resolvedAt, updates: t.updates?.filter((u) => Date.parse(u.at) <= end) };
}

/**
 * The resolution figures. `window`: only the faults whose last close (as they stood at its end) falls inside it —
 * the recap's month (monthBounds), the Tickets tab's kept record (keptDays). Without one: every record given.
 *
 * ⚠️ "RESOLVED (ALL TIME)" WAS THE KEPT RECORD (architecture review, 2026-10-19): the server drops a no-action close
 * after 90 days and a repair after the evidence window (_fm_expire), so September's recap regenerated in January read
 * "Closed without action: 0". A figure names its period now, and the period is one the record still holds.
 */
export function ticketStats(tickets: readonly FmTicket[], window?: TicketWindow): TicketStats {
  let resolved = 0, cleared = 0, totalMs = 0, timed = 0;
  for (const whole of tickets) {
    const t = window ? ticketUpTo(whole, window.end) : whole;
    // ⚠️ AN UNKNOWN STATUS COUNTS AS OPEN (stageOf). A bare `else` once counted ANY row whose status was missing,
    // empty or corrupt as RESOLVED — a fault silently removed from the facility report by bad data, the one
    // direction this must never fail in. The open ones are deviceWork.openCounts', per device.
    if (stageOf(t) !== "closed") continue;
    // ⚠️ A CLOSE WITH NO WORK IS NOT A REPAIR (review 31): ten 10-minute Wi-Fi blips cleared by the agent made a
    // 48 h fridge repair read "4.5 h", one duplicate closed after 92 days "2208 h"
    const lastResolve = lastResolution(t);
    if (window) {
      const closedAt = Date.parse(lastResolve?.at ?? t.resolvedAt ?? "");
      if (!(closedAt >= window.start && closedAt < window.end)) continue;
    }
    if (lastResolve && isClearedStep(lastResolve)) { cleared++; continue; }
    resolved++;
    const ms = openTimeMs(t);
    if (ms !== null) { totalMs += ms; timed++; }
  }
  return {
    resolved, closedWithoutAction: cleared,
    meanResolutionHours: timed ? totalMs / timed / HOUR_MS : null,
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
  const w = wallClock(new Date(at));   // the villa's clock (utils/villaClock), wherever the report is made
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${p(w.month)}-${p(w.day)} ${p(w.hour)}:${p(w.minute)}`;
}


/** Short human date, local time (e.g. "24 Jul 2026") — for a target/due date
 *  or a report table row, where the full time-of-day in localStamp() is more
 *  precision than the reader needs. Was previously private to fmDocuments.ts;
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
  return fullDate(at);
}

/** The month a report covers, spelled for a heading (e.g. "July 2026").
 *  Same reasoning as shortDate: fixed fields, reader's locale. Lived in
 *  fmDocuments.ts with its own hardcoded "en-GB". */
export function monthLabel(month: string): string {
  const { start } = monthBounds(month);
  // A malformed month key would otherwise render "Invalid Date" into the
  // report's own Period heading; say what was actually stored instead.
  return Number.isFinite(start) ? monthYear(start) : month;
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

/**
 * ⚠️ WHAT A FAULT'S CLOSE LEAVES ON IT, AND A STAGE CHANGE TAKES AWAY, IN ONE PLACE (architecture review i_k1,
 * 2026-10-23): when it was resolved, and when the VESTA Agent reads the close again (`confirmsBy`). Both belong to ONE
 * close. The Kiosk's Reopen kept every field but `resolvedAt`, so a later Cockpit Close showed "Closed (Owner) · VESTA
 * confirms it at its next look" with the earlier close's watch time, while the Agent watched nothing: a watch is the
 * Agent's to write on THIS close (agent-contract.json ticket.fields.confirmsBy). The Agent's own reopen drops the same
 * two (kiosk.py reopen_ticket). Not `closesAt`: an OPEN fault's field, set and taken away by the Agent at each look.
 * Every stage move here starts from this (withTicketAdvanced, withTicketClosed, withTicketPatch): a close also drops a
 * watch left by a Reopen made before this build. tests/oracles/fault_confirm.mjs.
 */
export const CLOSE_ONLY_FIELDS = ["resolvedAt", "confirmsBy"] as const satisfies readonly (keyof FmTicket)[];

/** `t` without what its last close left on it (CLOSE_ONLY_FIELDS). */
export function withoutClose(t: FmTicket): FmTicket {
  const out = { ...t };
  for (const k of CLOSE_ONLY_FIELDS) delete out[k];
  return out;
}

/** Patch a fault. The resolution time is stamped when — and only when — the
 *  status becomes resolved (the operator marks it done, the app records WHEN:
 *  the mean-time-to-resolution evidence rests on it). A status that moves takes the last close's fields away
 *  (withoutClose). */
export function withTicketPatch(d: FmData, id: string, patch: Partial<FmTicket>, k: Pick<FmStamp, "now">, by?: string): FmData {
  return {
    ...d,
    tickets: d.tickets.map((t) => {
      if (t.id !== id) return t;
      const moves = patch.status !== undefined && patch.status !== t.status;
      const next = { ...(moves ? withoutClose(t) : t), ...patch };
      if (isTicketResolved(patch) && !next.resolvedAt) next.resolvedAt = k.now;
      // ⚠️ A PERSON'S RENAME IS A STEP (review 29): it left no trace — the card's "Was: …" named the title two renames
      // back, and the VESTA Agent could only guess a person's title by comparing titles
      if (patch.title !== undefined && patch.title !== t.title) {
        next.updates = [...(t.updates ?? []), {
          at: k.now, status: next.status, kind: "retitled" as const, title: patch.title, was: t.title, photoIds: [],
          ...(by ? { by } : {}),
        }];
        // ⚠️ THEIR TITLE, AS IT IS, AT ONCE (architecture review, 2026-10-19): the Agent's duration pattern kept winning
        // over the new title (faultTitle) until the Agent read this step and cleared it — never with the Agent off.
        // Absent is the contract's shape for a retitled fault (agent-contract.json ticket.fields.titlePattern); the
        // Agent's own clearing stays the same rule for a fault renamed before this build.
        delete next.titlePattern;
        delete next.since;
      }
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
/**
 * `step.who` is the name typed for who handles it; `by` the signed-in profile that recorded it — the same as the
 * one-step close records (architecture review 26: "Mark resolved" kept only the typed name, often empty, so the
 * agent's Telegram note and the card said "by Facility manager" for one close and nothing for the other).
 * Reopening a resolved fault is a step of its own kind ("reopened"): the VESTA Agent reads it, never guesses it.
 */
/** A stage change's own record (who, what, photos) and, when resolving, what it cost. */
export type TicketStep = { who?: string; note?: string; photoIds: string[] };
export type TicketCost = Omit<FmCost, "id" | "at" | "photoIds">;

export function withTicketAdvanced(
  d: FmData, id: string, to: FmTicket["status"], step: TicketStep, cost: TicketCost | undefined, k: FmStamp, by?: string,
): FmData {
  if (!d.tickets.some((t) => t.id === id)) return d;
  const at = k.now;
  const resolving = to === "resolved";
  const costId = resolving && cost ? k.id("co") : undefined;
  return {
    ...d,
    tickets: d.tickets.map((t) => (t.id !== id ? t : {
      ...withoutClose(t),
      status: to,
      ...(resolving ? { resolvedAt: at } : {}),
      photoIds: [...t.photoIds, ...step.photoIds],
      costId: costId ?? t.costId,
      updates: [...(t.updates ?? []), {
        at, status: to, ...step, ...(by ? { by } : {}),
        ...(to === "open" && isTicketResolved(t) ? { kind: "reopened" as const } : {}),
      }],
    })),
    completions: resolving
      ? [...d.completions, {
          // ⚠️ WRITTEN AS THE STEP IS (owner, 2026-10-19): `by` the profile that recorded it, `who` the name typed for
          // who did the work — the shape a VESTA Agent completion has had all along (its `by` the agent's, `who` the
          // person). The typed name went into `by` (to 2.496.427), so the same field meant "did it" for a person and
          // "recorded it" for the Agent. workedBy reads both, old rows included.
          id: k.id("cp"), scheduleId: "", ticketId: id, at,
          by: by ?? "—", ...(step.who ? { who: step.who } : {}), note: step.note, photoIds: step.photoIds, costId,
        }]
      : d.completions,
    costs: costId ? [...d.costs, { ...cost!, id: costId, at, photoIds: step.photoIds }] : d.costs,
  };
}

/** One device's faults moved together, in ONE edit (owner, 2026-10-14: "Mark in progress" takes on a whole card —
 *  one ticket per device, each fault still its own record so the VESTA Agent can clear it alone). The cost, when
 *  resolving, is filed once, on the first. */
export function withTicketsAdvanced(
  d: FmData, ids: readonly string[], to: FmTicket["status"], step: TicketStep, cost: TicketCost | undefined,
  k: FmStamp, by?: string,
): FmData {
  return ids.reduce((acc, id, i) => withTicketAdvanced(acc, id, to, step, i === 0 ? cost : undefined, k, by), d);
}

/** The note a one-step close leaves on the fault's history. */
export const CLOSED_WITHOUT_ACTION = "Closed without action";

/**
 * Close a fault in ONE step, nothing done: an obsolete or duplicate fault
 * (often one the VESTA Agent raised automatically and that has since gone
 * away). Resolved, stamped now, with a "Closed without action" update — and
 * deliberately NO completion and NO cost: nothing was done, and counting it
 * as work would inflate every "work done" figure (see withTicketAdvanced).
 * A fault already resolved, or unknown, is left exactly as it is.
 */
/** `by`: the profile that closed it ("Owner", "Facility manager") — the VESTA Agent's note on the alert's Telegram
 *  messages says who and when (owner, 2026-10-10). */
export function withTicketClosed(d: FmData, id: string, k: Pick<FmStamp, "now">, by?: string): FmData {
  const t = d.tickets.find((x) => x.id === id);
  if (!t || isTicketResolved(t)) return d;
  const at = k.now;
  return {
    ...d,
    tickets: d.tickets.map((x) => (x.id !== id ? x : {
      ...withoutClose(x),
      status: "resolved",
      resolvedAt: at,
      updates: [...(x.updates ?? []), { at, status: "resolved", kind: "cleared" as const, note: CLOSED_WITHOUT_ACTION, photoIds: [], ...(by ? { by } : {}) }],
    })),
  };
}


/** One device's faults closed together, in ONE edit ("no action needed"). */
export function withTicketsClosed(d: FmData, ids: readonly string[], k: Pick<FmStamp, "now">, by?: string): FmData {
  return ids.reduce((acc, id) => withTicketClosed(acc, id, k, by), d);
}

// ── Rules that lived in the screens (round 13, 2.496.183) ─────────────────
// Each was written in a component or the store's context, where only a regex
// could reach it, and several already disagreed with the engine or with each
// other. tests/oracles/fm_rules.mjs drives them by value.

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
  /** Every record not closed — the faults and the tickets both stand on the Overview's list. */
  unresolved: FmTicket[]; lateTasks: ReturnType<typeof scheduleBoard>; total: number;
} {
  const unresolved = d.tickets.filter((t) => stageOf(t) !== "closed");
  const lateTasks = scheduleBoard(d, now).filter((s) => s.state === "overdue" || s.state === "never");
  return { unresolved, lateTasks, total: unresolved.length + lateTasks.length };
}
