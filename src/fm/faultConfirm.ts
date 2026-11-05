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

import { AGENT_STAMP, type AgentCadence } from "@/agent/agentApi";
import { clockTime, momentText } from "@/utils/dateText";
import { nextAt, withinLook } from "./faultTiming";
import { NO_ACTION_NEEDED, NOT_A_PROBLEM } from "./deviceWork";
import { agentOwned } from "./issueSource";
import { closedAsLasting, isClearedStep, isTicketResolved, lastResolution } from "./fmEngine";
import type { FmData, FmTicket } from "./fmTypes";
import { authorWords } from "@/auth/roles";

/** How many of the Agent's looks (cadence.checkMinutes) a fault past its confirms-by moment is still shown for: its
 *  verdict lands at its next look, the second covers a look that ran long. */
const CONFIRM_GRACE_LOOKS = 2;

/** How a closed fault was closed, in the words of its card. */
interface ClosedFault {
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
}

/** The last moment a fault confirmed by `at` is still shown: two of the Agent's looks after it while the Agent says its
 *  cadence (it is online), `at` itself otherwise. */
export function shownUntil(at: number, cadence: AgentCadence | null): number {
  const look = cadence && cadence.checkMinutes > 0 ? cadence.checkMinutes * 60_000 : 0;
  return at + CONFIRM_GRACE_LOOKS * look;
}

/** ⚠️ ONE TELLING OF A CLOSE, ON EVERY TAB (architecture review 23): Inbox › Closed said "Cleared on … (Owner)" with no
 *  Reopen, Tickets › Closed "Closed by Owner, on … · Resolved" with one, of the same record. How `t` was closed (its
 *  last resolution: the word of the action, who, when), read by both Closed sections, the Watch list and every card's
 *  pill (faultNotes.faultLatest); `reopen`: it may be taken back, exactly when nothing will check it again: closed as
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

/** ⚠️ EVERY DONE GOES TO WATCH (owner, 2026-11-02: "if a user clicks on done, the associated card and fault shall be
 *  considered as a watchlist for the relevant amount of time"): the Agent writes `confirmsBy` on the faults it follows;
 *  one a person raised has no task of its, so nothing wrote it and it left at once. Its watch is a night-check finding's,
 *  until the nightly check after its close, the time being the Agent's own: with no Agent, nothing watches. */
function watchedUntil(t: FmTicket, cadence: AgentCadence | null): number {
  // "Not a problem while it lasts": nothing is watched, it is closed (FmTicketUpdate.lasting)
  if (closedAsLasting(t)) return NaN;
  if (t.confirmsBy) return Date.parse(t.confirmsBy);
  if (!t.resolvedAt || !cadence) return NaN;
  if (agentOwned(t)) return NaN;
  return nextAt(cadence.nightlyAt, new Date(t.resolvedAt))?.getTime() ?? NaN;
}

/** Where a resolved record stands after its close, as of `now`: "watch", being confirmed (watched until a moment, not shown
 *  past shownUntil); "awaiting", about to be watched: a fault of the Agent's just closed whose confirmsBy is not written
 *  yet, until it is or two of the Agent's looks pass (shownUntil of its close); "closed", over ("Not a problem while it
 *  lasts" among them: nothing is watched). null: not resolved.
 *  ⚠️ ONE PLACE PER RECORD (architecture review round 16, 2026-11-03): the Watch list, the Closed section and the
 *  records whose live state is hidden each had their own rule, and a fault the Agent owns, closed by Done, was in Closed
 *  for the seconds before the Agent wrote its confirmsBy (owner, 2026-11-02: closed at 02:49:25, confirmsBy at
 *  02:49:33), then jumped to Watch. confirmingFaults, closedFaults and watchedRecords all read this. */
export type AfterClose =
  | { place: "watch" | "awaiting"; fault: ConfirmingFault }
  | { place: "closed"; fault: ClosedFault };

export function afterClose(t: FmTicket, cadence: AgentCadence | null, now: number = Date.now()): AfterClose | null {
  if (!isTicketResolved(t)) return null;
  const closed = closedTold(t);
  const lookMinutes = cadence && cadence.checkMinutes > 0 ? cadence.checkMinutes : null;
  const at = watchedUntil(t, cadence);
  if (!Number.isNaN(at)) {
    return now > shownUntil(at, cadence) ? { place: "closed", fault: closed }
      : { place: "watch", fault: { ...closed, at, due: now >= at, lookMinutes, awaiting: false } };
  }
  // its confirmsBy not written yet: on Watch, with no moment to say, until the Agent answers
  const resolvedAt = Date.parse(t.resolvedAt ?? "");
  if (!closedAsLasting(t) && agentOwned(t) && now <= shownUntil(resolvedAt, cadence)) {
    return { place: "awaiting", fault: { ...closed, at: NaN, due: false, lookMinutes, awaiting: true } };
  }
  return { place: "closed", fault: closed };
}

/** On Watch: being confirmed, or about to be. */
const onWatch = (p: AfterClose | null): p is Extract<AfterClose, { place: "watch" | "awaiting" }> =>
  p?.place === "watch" || p?.place === "awaiting";

/** Every fault on Watch now, the soonest verdict first, those still awaiting their moment last. */
export function confirmingFaults(d: FmData, cadence: AgentCadence | null, now: number = Date.now()): ConfirmingFault[] {
  const order = (c: ConfirmingFault) => (Number.isNaN(c.at) ? Infinity : c.at);
  return d.tickets.flatMap((t) => { const p = afterClose(t, cadence, now); return onWatch(p) ? [p.fault] : []; })
    .sort((a, b) => order(a) - order(b) || (a.closedAt || 0) - (b.closedAt || 0) || a.ticket.id.localeCompare(b.ticket.id));
}

/** ⚠️ WHAT LEFT THE WATCH LIST GOES TO CLOSED (owner, 2026-11-01: "i expect to see them go in the closed section"): a
 *  fault with no VESTA message of its own just left the Inbox. Every resolved fault no longer watched nor about to be,
 *  the last closed first; the server drops them after their retention window. */
export function closedFaults(d: FmData, cadence: AgentCadence | null, now: number = Date.now()): ClosedFault[] {
  return d.tickets.flatMap((t) => { const p = afterClose(t, cadence, now); return p?.place === "closed" ? [p.fault] : []; })
    .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
}

/** The records whose device's live state is no open issue: those on Watch, and ⚠️ THOSE ABOUT TO BE (owner, 2026-11-02:
 *  closed at 02:49:25, the Agent's confirmsBy written at 02:49:33; in between the card came back as a live state with its
 *  own Done, and that second press raised a second fault): a fault of the Agent's just closed, until it answers
 *  (shownUntil: two of its looks). Exactly the records afterClose puts on Watch. */
export function watchedRecords(d: FmData, cadence: AgentCadence | null, now: number = Date.now()): FmTicket[] {
  return d.tickets.filter((t) => onWatch(afterClose(t, cadence, now)));
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
  // about to be watched: how it was cleared alone, no moment until the Agent writes it (its card has no pill)
  if (c.awaiting) return { did: closedWords(c), when: "", tip: "" };
  const by = clockTime(c.at);
  return {
    did: closedWords(c),
    when: `Closes ${c.due && c.lookMinutes ? withinLook({ checkMinutes: c.lookMinutes }) : by}`,
    tip: c.due ? "VESTA closes this at its next look if all is still well."
      : `VESTA closes this at ${by} if all is still well; if the problem is back before then, it reopens as the same problem.`,
  };
}
