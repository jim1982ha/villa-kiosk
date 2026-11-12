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
// 02:00", and a Close pressed in the Cockpit says "Cleared on … (Owner)" (since architecture review 23 the button's own
// words, "No action needed on … (Owner)"): only a problem that is really over says Closed.
//
// Which of Open issues, Watch and Closed a fault is in, and until when, is fm/faultStanding's; how each says it, here.

import { AGENT_STAMP, type AgentCadence } from "@/agent/agentApi";
import { clockTime, momentText } from "@/utils/dateText";
import { withinLook } from "./faultTiming";
import { NO_ACTION_NEEDED, NOT_A_PROBLEM } from "./deviceWork";
import { agentOwned } from "./issueSource";
import { closedAsLasting, isClearedStep, isTicketResolved, lastResolution } from "./fmEngine";
import type { FmTicket } from "./fmTypes";
import { authorWords } from "@/auth/roles";

/** How a closed fault was closed, in the words of its card. */
export interface ClosedFault {
  ticket: FmTicket;
  /** How it was cleared, by the action that cleared it: "Done" (a Done on Telegram, a repair recorded), "No action
   *  needed" (the Cockpit's, nothing done, with who pressed it), "Not a problem", "Cleared" (the VESTA Agent's own
   *  clearing, no name: what it reported is over). Never "Closed": it is not closed until VESTA lets it go (owner,
   *  2026-10-31). */
  word: "Done" | "Cleared" | typeof NO_ACTION_NEEDED | typeof NOT_A_PROBLEM;
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
  /** About to be watched: closed, the Agent's moment (confirmsBy) not written yet; `at` is NaN, no moment is said. */
  awaiting: boolean;
  /** STILL OPEN, RIGHT AGAIN (owner, 2026-11-12): waiting out the VESTA Agent's clear wait (closesAt), `at` its moment;
   *  `said` what its device reads and since when ("Locked since 01:29", or "Back to normal"), `word` that reading
   *  ("Locked"); absent on a closed fault. `expected`: held by the Agent because it is expected (FmTicket.expected),
   *  `said` the Agent's words and `at` NaN: no moment is known, it lasts until the Agent says otherwise. */
  holds?: { said: string; word?: string; expected?: true };
}

/** A fault held on Watch while still open (fm/faultStanding): still open, right again and closed by the VESTA Agent at `at` (its
 *  closesAt) if it stays so, or held while it is expected (`holds.expected`, `at` NaN); its reading `holds`. */
export function clearingFault(t: FmTicket, at: number, holds: NonNullable<ConfirmingFault["holds"]>, cadence: AgentCadence | null,
  now: number = Date.now()): ConfirmingFault {
  const lookMinutes = cadence && cadence.checkMinutes > 0 ? cadence.checkMinutes : null;
  return { ticket: t, word: "Cleared", who: "", closedAt: NaN, at, due: now >= at, lookMinutes, awaiting: false, holds };
}

/** ⚠️ ONE TELLING OF A CLOSE, ON EVERY TAB (architecture review 23): Inbox › Closed said "Cleared on … (Owner)" with no
 *  Reopen, Tickets › Closed "Closed by Owner, on … · Resolved" with one, of the same record. How `t` was closed (its
 *  last resolution: the word of the action, who, when), read by both Closed sections, the Watch list and every card's
 *  strip (faultNotes.faultMove); `reopen`: it may be taken back, exactly when nothing will check it again: closed as
 *  "Not a problem while it lasts" (owner, 2026-11-04), or a record a person raised, which VESTA has no check of. */
export function closedTold(t: FmTicket): ClosedFault & { reopen: boolean } {
  const close = lastResolution(t);
  const cleared = !!close && isClearedStep(close);
  const agents = cleared && !close.who && close.by === AGENT_STAMP;
  return {
    ticket: t,
    word: close?.lasting ? NOT_A_PROBLEM : agents ? "Cleared" : cleared ? NO_ACTION_NEEDED : "Done",
    who: agents ? "" : close?.who || authorWords(close),
    closedAt: Date.parse(close?.at ?? t.resolvedAt ?? ""),
    reopen: isTicketResolved(t) && (closedAsLasting(t) || !agentOwned(t)),
  };
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
  // ⚠️ ABOUT TO BE WATCHED, THE SAME FIELDS (owner, 2026-11-07: #136-P1 on Watch with no state line and no (i), every
  // other Watch card "Closes 02:00" with its (i)): no moment until the Agent writes it, so its state is the Agent's next
  // look, when it says one
  if (c.awaiting) {
    return { did: closedWords(c), when: `Closes ${c.lookMinutes ? withinLook({ checkMinutes: c.lookMinutes }) : "at VESTA's next look"}`,
      tip: "VESTA says at its next look whether this is watched or closed." };
  }
  // held because it is expected (owner, 2026-11-12): VESTA's reason, no moment — it lasts until VESTA says otherwise
  if (c.holds?.expected) {
    return { did: c.holds.said, when: "Expected",
      tip: "VESTA holds this alert while it is expected: nobody is asked. It becomes an open issue again if it is still there once that changes." };
  }
  const by = clockTime(c.at);
  // right again, still open: what it reads now, and what happens if it changes (it is an open issue again)
  if (c.holds) {
    const stays = c.holds.word ? `stays ${c.holds.word.toLowerCase()}` : "stays so";
    return {
      did: c.holds.said,
      when: `Closes ${c.due && c.lookMinutes ? withinLook({ checkMinutes: c.lookMinutes }) : by}`,
      tip: c.due ? `VESTA closes this at its next look if it ${stays}.`
        : `VESTA closes this at ${by} if it ${stays}; if it changes before then, it is back in Open issues as the same problem.`,
    };
  }
  return {
    did: closedWords(c),
    when: `Closes ${c.due && c.lookMinutes ? withinLook({ checkMinutes: c.lookMinutes }) : by}`,
    tip: c.due ? "VESTA closes this at its next look if all is still well."
      : `VESTA closes this at ${by} if all is still well; if the problem is back before then, it reopens as the same problem.`,
  };
}
