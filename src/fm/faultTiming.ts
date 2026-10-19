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

import { STORE_ACTIVE_MS, STORE_HEARTBEAT_MS } from "@/hooks/useStoreRefresh";
import { AGENT_SOURCES, ISSUE_SOURCES, type IssueSource } from "./issueSource";
import type { AgentCadence } from "@/agent/agentApi";
import { AGENT_CHECKS, type FmTicketCheck } from "./fmTypes";

export interface SourceRow {
  source: IssueSource;
  /** What it is, in a few words. */
  what: string;
  /** When it appears on the list. */
  opens: string;
  /** When it goes — or is brought up to date. */
  goes: string;
}

const ROWS: Record<IssueSource, Omit<SourceRow, "source">> = {
  live: { what: "What the Kiosk shows right now on its map — a device with a red badge: unavailable, missing, unlocked, "
      + "too hot… Seen on this screen only: nobody is told", opens: "At once, as the map shows it",
    goes: "By itself, as soon as the device is back to normal" },
  alert: { what: "A VESTA alert from one of the villa's rules, numbered as on Telegram (#5)",
    opens: "As soon as the alert is raised",
    goes: "Within minutes of it being back to normal; its words and Telegram's reminders follow" },
  night: { what: "Found by the nightly check: a device offline or deleted, a battery, energy use, Wi-Fi drops, run time",
    opens: "Nightly check",
    // ⚠️ NO COPY OF WHICH PROBLEMS ARE READ AGAIN WHEN (architecture review, 2026-10-15): "Offline or deleted: within
    // minutes" stood here beside the Agent's own list — each card's Next check says it, from the fault itself. The
    // Agent's day times are worded from its cadence (nightGoes), this is the sentence without them
    goes: "When the VESTA Agent no longer finds it, at the time its card's Next check says; until then each nightly "
      + "check updates the figures" },
  chat: { what: "Created from a Telegram chat with the VESTA Agent (\"Create this fault\")",
    opens: "When someone presses Create this fault", goes: "When someone resolves or closes it" },
  owner: { what: "A ticket the Owner opened (Open a ticket)", opens: "At once, already in progress",
    goes: "When someone resolves or closes it" },
  fm: { what: "A ticket the Facility manager opened (Open a ticket)", opens: "At once, already in progress",
    goes: "When someone resolves or closes it" },
  person: { what: "A ticket opened in the Kiosk", opens: "At once", goes: "When someone resolves or closes it" },
  guest: { what: "A problem a guest reported (Report a problem)", opens: "At once, as a fault",
    goes: "When someone closes it" },
  schedule: { what: "Maintenance overdue (Schedule tab)", opens: "When its due date passes",
    goes: "When the work is recorded" },
};

const REFRESH = `This list is read again every ${STORE_ACTIVE_MS / 1000} seconds while it is open (every `
  + `${STORE_HEARTBEAT_MS / 60_000} minutes otherwise), and as soon as you come back to the app.`;
const TICKET = "A fault becomes a ticket when someone presses Open Ticket on its card (Tickets tab).";

/** How often the Agent looks, in its own numbers when it said them. */
function agentClock(c: AgentCadence | null): string {
  if (!c) return "it checks regularly, and runs its nightly check at the time set in the VESTA Agent";
  const every = c.checkMinutes === 1 ? "every minute" : `every ${c.checkMinutes} minutes`;
  return `it checks ${every}, and its nightly check runs at ${c.nightlyAt}`;
}

/** "08:00, 12:00 and 16:00". */
function timesWords(times: readonly string[]): string {
  return times.length < 2 ? times.join("") : `${times.slice(0, -1).join(", ")} and ${times[times.length - 1]}`;
}

/** When a night-check problem goes (owner, 2026-10-19: "refresh the open ones every 4 hours during the days … by
 *  closing the ones that are not active anymore"): the VESTA Agent reads it again during the day at its times and at
 *  its nightly check — in its own numbers when its heartbeat said them; an Agent that said a cadence with no day times
 *  (an older one) reads it at its nightly check only; one that said nothing gets generic words. */
function nightGoes(c: AgentCadence | null): string {
  const after = "and closes it once it no longer finds it — its card's Next check says when; each check also updates "
    + "the figures";
  if (!c) return `The VESTA Agent reads it again during the day at the times set in it, and at its nightly check, ${after}`;
  const day = c.dayChecksAt ?? [];
  if (!day.length) return `The VESTA Agent reads it again at its nightly check (${c.nightlyAt}), ${after}`;
  return `The VESTA Agent reads it again during the day at ${timesWords(day)}, and at its nightly check `
    + `(${c.nightlyAt}), ${after}`;
}

/** The table's two groups (owner, 2026-10-15): what the Kiosk and its people produce, then what the VESTA Agent does. */
export interface SourceGroup { title: string; rows: readonly SourceRow[] }

/** Every source's row — the VESTA Agent's only with an Agent — in its group, and the note under them; `cadence`: the
 *  Agent's own timing (null: it did not say). */
export function faultTiming(agent: boolean, cadence: AgentCadence | null = null):
  { rows: readonly SourceRow[]; groups: readonly SourceGroup[]; note: string } {
  const rows = ISSUE_SOURCES.filter((s) => agent || !AGENT_SOURCES.has(s))
    .map((source) => ({ source, ...ROWS[source], ...(source === "night" ? { goes: nightGoes(cadence) } : {}) }));
  const groups = [{ title: "From the Kiosk", rows: rows.filter((r) => !AGENT_SOURCES.has(r.source)) },
    { title: "From the VESTA Agent", rows: rows.filter((r) => AGENT_SOURCES.has(r.source)) }].filter((g) => g.rows.length);
  return {
    rows,
    groups,
    note: agent
      ? `${TICKET} The VESTA Agent closes its own faults and tickets when the problem goes away; ${agentClock(cadence)}. `
        + REFRESH
      : `${TICKET} ${REFRESH}`,
  };
}

/** One problem of a card, as nextCheck reads it: where it comes from, how the VESTA Agent reads it again (its fault's
 *  `check`), and the fault merged onto it (attention.mergeFaults). */
export interface CheckedProblem { source?: IssueSource; check?: FmTicketCheck; fault?: CheckedProblem }

type Clock = FmTicketCheck | "hand";

/** Who reads one fault again to close it: the VESTA Agent at its next look, during the day at its times, or at its
 *  nightly check (the fault's `check`; an older fault without one: its source's usual clock), else only a person. */
function clockOf(p: CheckedProblem): Clock {
  if (p.check && AGENT_CHECKS.includes(p.check)) return p.check;   // one the agreement does not declare: its source's
  return p.source === "alert" ? "minutes" : p.source === "night" ? "nightly" : "hand";
}

/** The clocks of a card's faults (a problem and the fault merged onto it); empty for a card that is only what the map
 *  shows now. */
function clocksOf(problems: readonly CheckedProblem[]): Clock[] {
  return problems.flatMap((p) => [p, ...(p.fault ? [p.fault] : [])]).filter((p) => p.source !== "live").map(clockOf);
}

/** The next moment after `now` at villa time `hhmm` (today, else tomorrow) — the device's clock, as nightlyAt has
 *  always been read; null for a time that is not HH:MM. */
function nextAt(hhmm: string, now: Date): Date | null {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  return at;
}

/** When the VESTA Agent next reads a fault of `clock`, and the card's words for it: its next look ("within 5 min"),
 *  the soonest of its day times and its nightly check for "day" (an Agent that said no day times: the nightly check),
 *  its nightly check ("02:00"). */
function nextOf(clock: FmTicketCheck, c: AgentCadence, now: Date): { at: Date; words: string } | null {
  if (clock === "minutes") return { at: new Date(now.getTime() + c.checkMinutes * 60_000), words: `within ${c.checkMinutes} min` };
  const times = clock === "day" ? [...(c.dayChecksAt ?? []), c.nightlyAt] : [c.nightlyAt];
  let best: { at: Date; words: string } | null = null;
  for (const t of times) {
    const at = nextAt(t, now);
    if (at && (!best || at < best.at)) best = { at, words: t };
  }
  return best;
}

/** ⚠️ THE SOONEST BY MOMENT, NOT BY RANK (owner, 2026-10-19): a card can hold an alert's fault and a night check's
 *  ("Alert and Night check"), and a night fault is now read again during the day — a fixed order of clocks cannot say
 *  whether 16:00 comes before the nightly 02:00 or after the next look. Each fault's next moment is computed and the
 *  card says the soonest. `undefined`: the card is only what the map shows now; `hand`: only a person closes it;
 *  `agent`: the Agent does but did not say when. */
function soonest(problems: readonly CheckedProblem[], cadence: AgentCadence | null, now: Date):
  { at: Date; words: string } | "hand" | "agent" | undefined {
  const clocks = clocksOf(problems);
  if (!clocks.length) return undefined;
  const agent = clocks.filter((k): k is FmTicketCheck => k !== "hand");
  if (!agent.length) return "hand";
  if (!cadence) return "agent";
  let best: { at: Date; words: string } | null = null;
  for (const k of new Set(agent)) {
    const next = nextOf(k, cadence, now);
    if (next && (!best || next.at < best.at)) best = next;
  }
  return best ?? "agent";
}

/** WHEN the card's "Next check" happens, as a moment (owner, 2026-10-19: hovering it shows "20/10/2026 02:00"): the
 *  soonest of its faults' next reads — `now` plus the Agent's `checkMinutes`, its next day time, its next `nightlyAt`;
 *  null when it has no time (live, by hand, or an Agent that did not say its cadence) — the same moment nextCheck words. */
export function nextCheckAt(problems: readonly CheckedProblem[], cadence: AgentCadence | null, now: Date = new Date()): Date | null {
  const next = soonest(problems, cadence, now);
  return typeof next === "object" ? next.at : null;
}

/** A card's "Next check" (owner, 2026-10-15: "when the next test for this card will be done"), beside its room: the
 *  soonest of its faults' next reads — the VESTA Agent's next look ("within 5 min"), its next day time or nightly
 *  check ("16:00", "02:00"), or "by hand" when only a person closes it; a card that is only what the map shows now:
 *  "live". The Agent's numbers are the ones it says (its heartbeat's `cadence`) — never a copy: one that does not say
 *  gets none. */
export function nextCheck(problems: readonly CheckedProblem[], cadence: AgentCadence | null, now: Date = new Date()): string {
  const next = soonest(problems, cadence, now);
  if (next === undefined) return "Next check: live";
  if (next === "hand") return "Next check: by hand";
  if (next === "agent") return "Next check: by the VESTA Agent";
  return `Next check: ${next.words}`;
}
