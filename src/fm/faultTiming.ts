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
import type { FmTicketCheck } from "./fmTypes";

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
    goes: "Offline or deleted: within minutes of it coming back or going. The others: at the next nightly check that "
      + "no longer finds them; until then each night updates the figures" },
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

/** The table's two groups (owner, 2026-10-15): what the Kiosk and its people produce, then what the VESTA Agent does. */
export interface SourceGroup { title: string; rows: readonly SourceRow[] }

/** Every source's row — the VESTA Agent's only with an Agent — in its group, and the note under them; `cadence`: the
 *  Agent's own timing (null: it did not say). */
export function faultTiming(agent: boolean, cadence: AgentCadence | null = null):
  { rows: readonly SourceRow[]; groups: readonly SourceGroup[]; note: string } {
  const rows = ISSUE_SOURCES.filter((s) => agent || !AGENT_SOURCES.has(s)).map((source) => ({ source, ...ROWS[source] }));
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

type Clock = "minutes" | "nightly" | "hand";
const SOONEST: readonly Clock[] = ["minutes", "nightly", "hand"];

/** Who reads one fault again to close it: the VESTA Agent at its next look or its nightly check (the fault's `check`;
 *  an older fault without one: its source's usual clock), else only a person. */
function clockOf(p: CheckedProblem): Clock {
  if (p.check) return p.check;
  return p.source === "alert" ? "minutes" : p.source === "night" ? "nightly" : "hand";
}

/** A card's "Next check" (owner, 2026-10-15: "when the next test for this card will be done"), beside its room: the
 *  soonest of its faults' clocks — the VESTA Agent's next look ("within 5 min"), its nightly check ("02:00"), or "by
 *  hand" when only a person closes it; a card that is only what the map shows now: "live". The Agent's numbers are the
 *  ones it says (its heartbeat's `cadence`) — never a copy: one that does not say gets none. */
export function nextCheck(problems: readonly CheckedProblem[], cadence: AgentCadence | null): string {
  const faults = problems.flatMap((p) => [p, ...(p.fault ? [p.fault] : [])]).filter((p) => p.source !== "live");
  if (!faults.length) return "Next check: live";
  const clock = SOONEST.find((c) => faults.some((p) => clockOf(p) === c)) as Clock;
  if (clock === "hand") return "Next check: by hand";
  if (!cadence) return "Next check: by the VESTA Agent";
  return `Next check: ${clock === "minutes" ? `within ${cadence.checkMinutes} min` : cadence.nightlyAt}`;
}
