// src/fm/faultConfirm.ts
// A FAULT BEING CONFIRMED (owner, 2026-10-23): "keep the Fault card visible in the Cockpit when a fault is still being
// monitored … until VESTA finally closes it, in a different style, so that it's easy to quickly see what are the
// 'About-to-close' Faults". A person closed it (Done on Telegram, Close in the Cockpit) and the VESTA Agent reads it
// again after its alert desk's wait: the fault is RESOLVED, as before — no count, no badge, no recap and no map mark
// takes it for an open problem — and the Overview lists it LAST among the open issues, uncounted, until the Agent's verdict.
//
// ⚠️ ONE SOURCE OF TRUTH, THE AGENT'S (agent-contract.json ticket.fields.confirmsBy): the Agent writes the moment it
// reads it again on the resolved fault and takes it away once read (right: it stays closed; still bad: it reopens, an
// open fault again as ever). This app only displays it, and never for longer than that moment plus two of the Agent's
// looks (its heartbeat cadence) — or that moment alone while the Agent is offline (no cadence): a watch nobody ends
// never stays on the screen. A fault without the field (an older Agent, a fault nobody watches) is resolved as before.
//
// ⚠️ EVERY CLOSE ALIKE (owner, 2026-10-25: "it shall consistently exist for all cleared faults"): the Agent now writes
// the field on every fault it watches after a close, whoever closed it: an alert the villa or the Agent cleared ("Watch
// 1h" on Telegram, its reopen window) and a night-check fault (until the next night check). This file did not change
// its rule for that, only its word for the Agent's own clearing: "Cleared".
//
// ⚠️ OPEN › CLEARED (ON THE WATCH LIST) › CLOSED (owner, 2026-10-31): a card here is NOT closed yet. Its pill said
// "VESTA confirms by 02:00" beside the open cards' refresh icon, read as "next check" ("will it be closed at 2am?"), and a
// Close pressed in the Cockpit said "Closed on …" on a card that was not. Its pill now says what happens then, "Closes
// 02:00", and a Close pressed in the Cockpit says "Cleared on … (Owner)": only a
// problem that is really over says Closed.

import { AGENT_STAMP, type AgentCadence } from "@/agent/agentApi";
import { clockTime, momentText } from "@/utils/dateText";
import { nextAt, withinLook } from "./faultTiming";
import { agentOwned } from "./issueSource";
import { isClearedStep, isTicketResolved, lastResolution } from "./fmEngine";
import type { FmData, FmTicket } from "./fmTypes";
import { authorWords } from "@/auth/roles";

/** How many of the Agent's looks (cadence.checkMinutes) a fault past its confirms-by moment is still shown for: its
 *  verdict lands at its next look, the second covers a look that ran long. */
const CONFIRM_GRACE_LOOKS = 2;

/** How a closed fault was closed, in the words of its card. */
interface ClosedFault {
  ticket: FmTicket;
  /** How it was cleared: "Done" (a Done on Telegram, a repair recorded), "Cleared" (the Cockpit's No action needed, nothing done,
   *  with who pressed it; or the VESTA Agent's own clearing, no name: what it reported is over). Never "Closed": it is
   *  not closed until VESTA lets it go (owner, 2026-10-31). */
  word: "Done" | "Cleared";
  /** Who did it — the person named on its close (`who`), else the profile that recorded it (`by`); "" when unsaid or
   *  the Agent's own clearing. */
  who: string;
  /** When it closed (its last resolution's moment), in ms; NaN when unrecorded. */
  closedAt: number;
}

export interface ConfirmingFault extends ClosedFault {
  /** When the VESTA Agent reads it again (confirmsBy), in ms. */
  at: number;
  /** That moment is past: its verdict is due at the Agent's next look. */
  due: boolean;
  /** The Agent's look, in minutes (its cadence), null offline: "within 5 min" once the moment is past. */
  lookMinutes: number | null;
}

/** The last moment a fault confirmed by `at` is still shown: two of the Agent's looks after it while the Agent says its
 *  cadence (it is online), `at` itself otherwise. */
export function shownUntil(at: number, cadence: AgentCadence | null): number {
  const look = cadence && cadence.checkMinutes > 0 ? cadence.checkMinutes * 60_000 : 0;
  return at + CONFIRM_GRACE_LOOKS * look;
}

/** How `t` was closed: from its last resolution. */
function closedOf(t: FmTicket): ClosedFault {
  const close = lastResolution(t);
  const agents = !!close && isClearedStep(close) && !close.who && close.by === AGENT_STAMP;
  return {
    ticket: t,
    word: close && isClearedStep(close) ? "Cleared" : "Done",
    who: agents ? "" : close?.who || authorWords(close),
    closedAt: Date.parse(close?.at ?? t.resolvedAt ?? ""),
  };
}

/** ⚠️ EVERY DONE GOES TO WATCH (owner, 2026-11-02: "if a user clicks on done, the associated card and fault shall be
 *  considered as a watchlist for the relevant amount of time"): the Agent writes `confirmsBy` on the faults it follows;
 *  one a person raised has no task of its, so nothing wrote it and it left at once. Its watch is a night-check finding's,
 *  until the nightly check after its close, the time being the Agent's own: with no Agent, nothing watches. */
function watchedUntil(t: FmTicket, cadence: AgentCadence | null): number {
  if (t.confirmsBy) return Date.parse(t.confirmsBy);
  if (agentOwned(t) || !t.resolvedAt || !cadence) return NaN;
  return nextAt(cadence.nightlyAt, new Date(t.resolvedAt))?.getTime() ?? NaN;
}

/** The fault `t` as being confirmed now, or null: resolved, watched until a moment, and not shown past shownUntil. */
function confirmingOf(t: FmTicket, cadence: AgentCadence | null, now: number = Date.now()): ConfirmingFault | null {
  if (!isTicketResolved(t)) return null;
  const at = watchedUntil(t, cadence);
  if (Number.isNaN(at) || now > shownUntil(at, cadence)) return null;
  return {
    ...closedOf(t),
    at,
    due: now >= at,
    lookMinutes: cadence && cadence.checkMinutes > 0 ? cadence.checkMinutes : null,
  };
}

/** Every fault being confirmed now, the soonest verdict first. */
export function confirmingFaults(d: FmData, cadence: AgentCadence | null, now: number = Date.now()): ConfirmingFault[] {
  return d.tickets.flatMap((t) => confirmingOf(t, cadence, now) ?? []).sort((a, b) => a.at - b.at || a.ticket.id.localeCompare(b.ticket.id));
}

/** ⚠️ WHAT LEFT THE WATCH LIST GOES TO CLOSED (owner, 2026-11-01: "i expect to see them go in the closed section"): a
 *  fault with no VESTA message of its own just left the Inbox. Every resolved fault no longer watched, the last closed
 *  first; the server drops them after their retention window. */
export function closedFaults(d: FmData, cadence: AgentCadence | null, now: number = Date.now()): ClosedFault[] {
  return d.tickets.filter((t) => isTicketResolved(t) && !confirmingOf(t, cadence, now)).map(closedOf)
    .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
}

/** How it was closed, as the Agent's Telegram lines say it: what, when, then who. */
export function closedWords(c: ClosedFault): string {
  return `${c.word}${Number.isNaN(c.closedAt) ? "" : ` on ${momentText(c.closedAt)}`}${c.who ? ` (${c.who})` : ""}`;
}

/** The row's parts: how it was cleared and when, as the Agent's Telegram lines say it ("Done on 25/10/2026 14:10 (JM)",
 *  "Cleared on 25/10/2026 14:10": what, when, then who; owner 2026-10-25: "complete it to mention the clear time"),
 *  and its pill — the card's one pill (RecordCard CheckPill: the same refresh icon, owner 2026-11-01, this being its next
 *  check, the one that closes it): `when` its words ("Closes 15:06", once past "Closes
 *  within 5 min", the Agent's next look, as faultTiming says it), `tip` what touching it says. */
export function confirmParts(c: ConfirmingFault): { did: string; when: string; tip: string } {
  const by = clockTime(c.at);
  return {
    did: closedWords(c),
    when: `Closes ${c.due && c.lookMinutes ? withinLook({ checkMinutes: c.lookMinutes }) : by}`,
    tip: c.due ? "VESTA closes this at its next look if all is still well."
      : `VESTA closes this at ${by} if all is still well; if the problem is back before then, it reopens as the same problem.`,
  };
}
