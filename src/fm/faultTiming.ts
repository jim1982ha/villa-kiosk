// src/fm/faultTiming.ts
// What the Overview's (i) beside "Open a ticket" says (components/fm/FaultTiming.tsx): for each source of a problem —
// the icon its card shows (fm/issueSource) — what it is, when it appears and when it goes; then how a fault becomes a
// ticket and how often the list is read again (owner, 2026-10-14). Pure, so tests/oracles/info_tip.mjs reads the very
// words the card shows.
//
// ⚠️ ONE TABLE, NOT TWO (owner, 2026-10-14: "I don't see when these issues are cleared or updated anymore"): the icons'
// legend and the "when faults open and close" table were two lists of the same sources, in different words — and the
// legend was what one read. Each source is now ONE row: icon, what it is, opens, goes.
//
// ⚠️ WITH OR WITHOUT THE VESTA AGENT: the Agent is optional in a Kiosk, and without it nothing opens or closes a fault
// by itself — the card says only what a person does. With it, the Agent's timing is the one IT says (its heartbeat:
// agentApi AgentCadence) — ⚠️ never a copy (architecture review, 2026-10-15): "every 5 minutes … 02:00 by default"
// stood here whatever the villa had set; an Agent that does not say gets no number. The list's own refresh is this app's
// (useStoreRefresh: STORE_ACTIVE_MS while the Cockpit is open, else the heartbeat).

import { momentText } from "@/utils/dateText";
import { villaTime, wallClock } from "@/utils/villaClock";
import { STORE_ACTIVE_MS, STORE_HEARTBEAT_MS } from "@/hooks/useStoreRefresh";
import { AGENT_SOURCES, ISSUE_SOURCES, type IssueSource } from "./issueSource";
import type { AgentCadence } from "@/agent/agentApi";
import { WORK_ACTIONS } from "./deviceWork";

/** The button a person opens a ticket with, in its one wording (fm/deviceWork): the (i) said "Open a ticket" after the
 *  button became "Open Ticket" (owner, 2026-10-31). */
const OPEN_TICKET = WORK_ACTIONS.raiseTicket.label;
import { AGENT_CHECKS, type FmTicketCheck } from "./fmTypes";
import { fmtDuration } from "@/components/panels/chartUtils";
import { ROLE_LABELS } from "@/auth/roles";

/** "within 5min": the Agent's next look, in the one duration's words (fmtDuration; architecture review K, 2026-10-24:
 *  written by hand at each place) — the open issues' pill, this table's rows and a watched fault's "Closes" pill once its
 *  moment passed (fm/faultConfirm.confirmParts: it was written there a second time, architecture review, 2026-10-26). */
export const withinLook = (c: Pick<AgentCadence, "checkMinutes">): string => `within ${fmtDuration(c.checkMinutes * 60_000)}`;

interface SourceRow {
  source: IssueSource;
  /** What it is, in a few words. */
  what: string;
  /** When it appears on the list. */
  opens: string;
  /** When it goes — or is brought up to date. */
  goes: string;
}

/** When a person's problem opens: a ticket in progress with Open Ticket, else a fault (Done or Need help on a card). */
const PERSON_OPENS = `At once: a ticket in progress with ${OPEN_TICKET}, a fault with Done or Need help on a card`;

const ROWS: Record<IssueSource, Omit<SourceRow, "source">> = {
  live: { what: "What the map shows right now: unavailable, missing, unlocked, too hot… Nobody is told", opens: "At once",
    goes: "As soon as the device is back to normal" },
  alert: { what: "A VESTA alert from one of the villa's VESTA automations, numbered as on Telegram (#5)",
    opens: "As soon as the alert is raised",
    goes: "Within minutes of it being back to normal" },
  night: { what: "The VESTA Agent's maintenance check: a device offline or deleted, a battery, a silent sensor, energy "
      + "use, Wi-Fi drops, run time",
    // worded from the Agent's cadence (nightOpens / nightGoes); these are the sentences without its numbers
    opens: "Within minutes for a device that goes offline; at the nightly check for everything else",
    // ⚠️ NO COPY OF WHICH PROBLEMS ARE READ AGAIN WHEN (architecture review, 2026-10-15): each card's Next check says
    // it, from the fault itself — the (i) names the clocks, never which problem uses which
    goes: "When the VESTA Agent no longer finds it. Each card's Next check says when it looks again" },
  chat: { what: "From a Telegram chat with the VESTA Agent (\"Create this fault\")",
    opens: "When someone presses Create this fault", goes: "When someone resolves or closes it" },
  // ⚠️ A PERSON RAISES A FAULT OR OPENS A TICKET (owner, 2026-11-01): Done or Need help on a card with no record raises
  // a FAULT stamped with the profile (WorkButtons); only Open Ticket makes a ticket. These rows said "A ticket … already
  // in progress" for both.
  owner: { what: `A problem the ${ROLE_LABELS.owner} raised in the Kiosk`, opens: PERSON_OPENS,
    goes: "When someone resolves or closes it" },
  fm: { what: `A problem the ${ROLE_LABELS.ops} raised in the Kiosk`, opens: PERSON_OPENS,
    goes: "When someone resolves or closes it" },
  person: { what: "A problem raised in the Kiosk", opens: PERSON_OPENS, goes: "When someone resolves or closes it" },
  guest: { what: "A problem a guest reported (Report a problem)", opens: "At once, as a fault",
    goes: "When someone closes it" },
  schedule: { what: "Maintenance overdue (Schedule tab)", opens: "When its due date passes",
    goes: "When the work is recorded" },
};

const REFRESH = `This list is read again every ${fmtDuration(STORE_ACTIVE_MS)} while it is open (every `
  + `${fmtDuration(STORE_HEARTBEAT_MS)} otherwise), and as soon as you come back to the app.`;
const TICKET = "A fault becomes a ticket only when someone presses Open Ticket on its card in Inbox › Open issues; it then moves to Tickets.";

/** How often the Agent looks, in its own numbers when it said them. */
function agentClock(c: AgentCadence | null): string {
  if (!c) return "it checks regularly, and runs its nightly check at the time set in the VESTA Agent";
  return `it checks every ${fmtDuration(c.checkMinutes * 60_000)}, and its nightly check runs at ${c.nightlyAt}`;
}

/** When a maintenance-check problem appears (owner, 2026-10-19: the (i) said "Nightly check" while a device that goes
 *  offline gets its fault within minutes, from the Agent's 5-minute look) — the nightly time in its own numbers. */
function nightOpens(c: AgentCadence | null): string {
  return c ? `Within minutes for a device that goes offline; at the nightly check (${c.nightlyAt}) for everything else`
    : ROWS.night.opens;
}

/** When a maintenance-check problem goes: when the VESTA Agent no longer finds it, at the clock its card's Next check
 *  names — every few minutes, or at its nightly check — in its own numbers when its heartbeat said them. ⚠️ THE
 *  CLOCKS, NEVER WHICH PROBLEM USES WHICH (owner, 2026-10-19: that list is the Agent's skill's, and a copy here would
 *  drift). */
function nightGoes(c: AgentCadence | null): string {
  if (!c) return `${ROWS.night.goes}: every few minutes, or at its nightly check`;
  return `${ROWS.night.goes}: ${withinLook(c)}, or at the nightly check (${c.nightlyAt})`;
}

/** The table's two groups (owner, 2026-10-15): what the Kiosk and its people produce, then what the VESTA Agent does. */
interface SourceGroup { title: string; rows: readonly SourceRow[] }

/** ⚠️ THE CHECK ON A CLEARED PROBLEM VESTA STILL WATCHES IS EXPLAINED TOO (owner, 2026-10-23: "include the new icon
 *  (validated ones)"): the last row of the VESTA Agent's group — a cleared fault on the Watch list (fm/faultConfirm), no
 *  source of its own; its pill's words in the Agent's own numbers when its heartbeat said them. Its words follow the
 *  owner's life of a problem, Open › Cleared (on the Watch list) › Closed (2026-10-31): it said "Being confirmed". */
interface ConfirmingRow { words: string; what: string; opens: string; goes: string }
export function confirmingRow(c: AgentCadence | null): ConfirmingRow {
  const look = c ? withinLook(c) : "at its next look";
  return {
    words: "On watch",
    what: "A problem cleared (Done on Telegram, Close here, or VESTA's own clearing) that the VESTA Agent still watches. In the Watch section, not counted",
    opens: "When a problem is cleared",
    goes: `VESTA closes it at the time on its refresh pill ("Closes"), ${look} once that time is past, if all is still well. Back before then: open again, as the same problem`,
  };
}

/** The table's three columns after the source, in their one wording: its head (FaultTiming) and each line of an icon's
 *  own tip (sourceIcons IconTip) — owner, 2026-11-06: "each card shows the specific icon's tooltip". */
export const TIMING_HEADS = { what: "What it is", opens: "Appears", goes: "Goes" } as const;

/** What a tip can explain: a problem's source, or the check of a cleared problem on the Watch list. */
export type TimingKey = IssueSource | "watch";

/** ONE icon's row of the table, the very row the (i) shows for it (owner, 2026-11-06): a source's from faultTiming —
 *  its Agent rows are always there, as an Agent's icon on a card is always explained — the Watch check's from
 *  confirmingRow; `cadence` the Agent's own timing, as the table reads it. */
export function timingRow(key: TimingKey, cadence: AgentCadence | null): { what: string; opens: string; goes: string } {
  const t = faultTiming(true, cadence);
  const row = key === "watch" ? t.confirming! : t.rows.find((r) => r.source === key)!;
  return { what: row.what, opens: row.opens, goes: row.goes };
}

/** Every source's row — the VESTA Agent's only with an Agent — in its group, and the note under them; `cadence`: the
 *  Agent's own timing (null: it did not say). */
export function faultTiming(agent: boolean, cadence: AgentCadence | null = null):
  { rows: readonly SourceRow[]; groups: readonly SourceGroup[]; note: string; confirming: ConfirmingRow | null } {
  const rows = ISSUE_SOURCES.filter((s) => agent || !AGENT_SOURCES.has(s))
    .map((source) => ({ source, ...ROWS[source], ...(source === "night" ? { opens: nightOpens(cadence), goes: nightGoes(cadence) } : {}) }));
  const groups = [{ title: "From the Kiosk", rows: rows.filter((r) => !AGENT_SOURCES.has(r.source)) },
    { title: "From the VESTA Agent", rows: rows.filter((r) => AGENT_SOURCES.has(r.source)) }].filter((g) => g.rows.length);
  return {
    rows,
    groups,
    confirming: agent ? confirmingRow(cadence) : null,
    note: agent
      ? `${TICKET} The VESTA Agent closes the faults it raised, and a ticket opened on one of them, when the problem goes away; ${agentClock(cadence)}. `
        + REFRESH
      : `${TICKET} ${REFRESH}`,
  };
}

/** One problem of a card, as nextCheck reads it: where it comes from, how the VESTA Agent reads it again (its fault's
 *  `check`), and the fault merged onto it (attention.mergeFaults). */
interface CheckedProblem { source?: IssueSource; check?: FmTicketCheck; fault?: CheckedProblem }

type Clock = FmTicketCheck | "hand";

/** Who reads one fault again to close it: the VESTA Agent at its next look or at its nightly check (the fault's
 *  `check`), else only a person. A fault without a check the agreement declares — an older one, or one an older Agent
 *  wrote with a check since retired — reads at its source's usual clock: an alert's and a nightly-check fault's is
 *  every look (owner, 2026-10-20: the Agent reads every open nightly-check finding again every few minutes). */
function clockOf(p: CheckedProblem): Clock {
  if (p.check && AGENT_CHECKS.includes(p.check)) return p.check;
  return p.source === "alert" || p.source === "night" ? "minutes" : "hand";
}

/** The clocks of a card's faults (a problem and the fault merged onto it); empty for a card that is only what the map
 *  shows now. */
function clocksOf(problems: readonly CheckedProblem[]): Clock[] {
  return problems.flatMap((p) => [p, ...(p.fault ? [p.fault] : [])]).filter((p) => p.source !== "live").map(clockOf);
}

/** The next moment after `now` at villa time `hhmm` (today, else tomorrow) — on the villa's clock (utils/villaClock),
 *  as the Agent reads its nightlyAt; null for a time that is not HH:MM. ⚠️ IT WAS THE DEVICE'S CLOCK (owner,
 *  2026-10-28): a phone abroad put the nightly check at another hour than Telegram did. */
export function nextAt(hhmm: string, now: Date): Date | null {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const w = wallClock(now);
  const today = villaTime(w.year, w.month, w.day, h, m);
  return new Date(today > now.getTime() ? today : villaTime(w.year, w.month, w.day + 1, h, m));
}

/** The Agent's next look after `now`: its last look plus whole steps of `checkMinutes` (owner, 2026-10-21: hovering
 *  "within 5 min" said "now + 5 min", so its time moved every minute while the Agent looks at fixed moments). An
 *  Agent that does not say its last look: `now` plus one step, as before. */
function nextLook(c: AgentCadence, now: Date): Date {
  const step = c.checkMinutes * 60_000;
  const last = c.lastLookAt ? Date.parse(c.lastLookAt) : NaN;
  if (!Number.isFinite(last) || step <= 0) return new Date(now.getTime() + step);
  const steps = Math.max(1, Math.floor((now.getTime() - last) / step) + 1);
  return new Date(last + steps * step);
}

/** When the VESTA Agent next reads a fault of `clock`, and the card's words for it: its next look ("within 5 min"),
 *  its nightly check ("02:00"). */
function nextOf(clock: FmTicketCheck, c: AgentCadence, now: Date): { at: Date; words: string } | null {
  if (clock === "minutes") return { at: nextLook(c, now), words: withinLook(c) };
  const at = nextAt(c.nightlyAt, now);
  return at && { at, words: c.nightlyAt };
}

/** ⚠️ THE SOONEST BY MOMENT, NOT BY RANK (owner, 2026-10-19): a card can hold an alert's fault and a night check's
 *  ("Alert and Night check"), each read at its own clock — the next look or the nightly 02:00. Each fault's next moment
 *  is computed and the card says the soonest. null: nothing has a time: the card is only what the map shows now, only a
 *  person closes it, or the Agent did not say its cadence. */
function soonest(problems: readonly CheckedProblem[], cadence: AgentCadence | null, now: Date): { at: Date; words: string } | null {
  if (!cadence) return null;
  let best: { at: Date; words: string } | null = null;
  for (const k of new Set(clocksOf(problems).filter((c): c is FmTicketCheck => c !== "hand"))) {
    const next = nextOf(k, cadence, now);
    if (next && (!best || next.at < best.at)) best = next;
  }
  return best;
}

/** WHEN the card's next check happens, as a moment (owner, 2026-10-19: hovering it shows "20/10/2026 02:00"): the
 *  soonest of its faults' next reads; null when it has none. */
export function nextCheckAt(problems: readonly CheckedProblem[], cadence: AgentCadence | null, now: Date = new Date()): Date | null {
  return soonest(problems, cadence, now)?.at ?? null;
}

/** A card's check, as its pill says it: `pill` its words beside the refresh icon ("next check within 5min", "checked
 *  live"), `tip` what hovering it says, `text`/`at`/`when` the timed check's sentence, moment and words. */
export interface CheckSaid { text: string; at: string | null; when: string; pill: string; tip: string }

/** ⚠️ ONE ANSWER FOR THE NEXT-CHECK PILL (owner, 2026-11-01: "the time each fault ticket will be rechecked", on every
 *  fault card): an Inbox card's and a ticket's, from their problems: its words ("within 5min", "02:00", the Agent's own
 *  numbers, never a copy), what hovering it says. A pill with a time; a problem watched live says so (livePill, by
 *  cardCheck); one only a person closes has none (owner, 2026-11-01: a refresh icon beside "by hand" announced a check
 *  no one will make). */
export function checkPill(problems: readonly CheckedProblem[], cadence: AgentCadence | null, now: Date = new Date()): CheckSaid | null {
  const next = soonest(problems, cadence, now);
  if (!next) return null;
  const text = `Next check: ${next.words}`, at = momentText(next.at);
  return { text, at, when: next.words, pill: `next check ${next.words}`, tip: `${text} (${at})` };
}

/** A problem that is only what the map shows now (no fault on it): this tablet reads it again all the time. */
export const watchedLive = (p: CheckedProblem): boolean => p.source === "live" && !p.fault;

/** ⚠️ A PROBLEM WATCHED LIVE SAYS SO TOO (owner, 2026-11-06: an Inbox card for a device "Unavailable" with no VESTA
 *  fault had no pill): the tablet re-reads live states continuously, so its pill says "checked live", its tip when the
 *  card goes in the Live row's own words (ROWS.live.goes, the table's). */
export const LIVE_CHECK: CheckSaid = {
  text: "Checked live", at: null, when: "checked live", pill: "checked live",
  tip: `This tablet watches it all the time: the card goes ${ROWS.live.goes.charAt(0).toLowerCase()}${ROWS.live.goes.slice(1)}`,
};

/** A card's pill: its faults' next check when one has a time (a card with a live state AND a VESTA fault says the
 *  fault's: the live state is read continuously, so the later check, the fault's, is the one to wait for); else
 *  "checked live" when every problem is watched live; else none. */
export function cardCheck(problems: readonly CheckedProblem[], cadence: AgentCadence | null, now: Date = new Date()): CheckSaid | null {
  return checkPill(problems, cadence, now) ?? (problems.length > 0 && problems.every(watchedLive) ? LIVE_CHECK : null);
}
