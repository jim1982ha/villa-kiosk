// src/fm/faultStanding.ts
// WHERE A FAULT STANDS IN ITS LIFE: Open issues › Watch › Closed, and until when. ONE answer per record, from the record
// and what its alert's line reads of its device (its `closing`): every list, count and mark of the Cockpit reads it.
// The words of each place (how it was closed, "Closes 02:00") are fm/faultConfirm's; which place, here only.
//
// ⚠️ FIVE FILES DECIDED IT (architecture review, 2026-11-13): attention took a fault right again or held as expected
// out of Open issues, faultConfirm placed a closed one, cockpitIssues rebuilt the Watch card of the first kind and
// cockpitCard drew both; each change of the week (an expected alert on Watch, a fault right again on Watch, a visit
// straight to Closed) touched three to five of them. And the rebuild looked the fault up again by its id in the fault
// records: when the lookup missed (the records not arrived yet on that side), the fault was taken out of Open issues
// and never put on Watch, in neither list. Its Watch card is now made here, from the very record its line was made of,
// in the same answer that takes it out of Open issues: the two can no longer part.

import type { AgentCadence } from "@/agent/agentApi";
import { sinceText, type Since } from "@/config/presence";
import { clockTime, docDate } from "@/utils/dateText";
import { clearingFault, closedTold, type ClosedFault, type ConfirmingFault } from "./faultConfirm";
import { nextAt } from "./faultTiming";
import { agentOwned } from "./issueSource";
import { closedAsLasting, isTicketResolved } from "./fmEngine";
import type { FmData, FmTicket } from "./fmTypes";

/** How many of the Agent's looks (cadence.checkMinutes) a fault past its moment is still shown for: its verdict lands
 *  at its next look, the second covers a look that ran long. */
const CONFIRM_GRACE_LOOKS = 2;

/** What an open fault's device reads while the VESTA Agent waits to close it (FmTicket.closesAt): its moment, and what
 *  its device reads now and since when (attention's closingOf, read with the device's state and its history). */
export interface FaultClosing { at: string; word?: string; since?: Since }

/** Where a fault stands: an open issue; on Watch (`fault`: its Watch card's fields, `fault.at` the moment it closes,
 *  NaN when none is known); closed (`fault`: how). */
export type FaultStanding =
  | { place: "open" }
  | { place: "watch"; fault: ConfirmingFault }
  | { place: "closed"; fault: ClosedFault };

/** The last moment a fault watched until `at` is still shown: two of the Agent's looks after it while the Agent says its
 *  cadence (it is online), `at` itself otherwise. ⚠️ A WATCH NOBODY ENDS NEVER STAYS ON THE SCREEN. */
export function shownUntil(at: number, cadence: AgentCadence | null): number {
  const look = cadence && cadence.checkMinutes > 0 ? cadence.checkMinutes * 60_000 : 0;
  return at + CONFIRM_GRACE_LOOKS * look;
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

/** What a fault right again reads, on its Watch card: "Locked since 14:38", or "Back to normal" when the device cannot
 *  say; `word` the reading ("Locked"). The open card's closing line says the same, with its close (cockpitCard). */
export function holdsText(c: FaultClosing): { said: string; word?: string } {
  if (!c.word) return { said: "Back to normal" };
  const said = sinceText(c.since ?? null, clockTime, docDate);
  return { said: `${c.word}${said ? ` since ${said}` : ""}`, word: c.word };
}

/** Where `t` stands as of `now`; `closing`: what its alert's line reads while the Agent waits to close it (absent: it is
 *  not waiting, or the record is resolved).
 *  - Open, it is an open issue, ⚠️ unless RIGHT AGAIN (owner, 2026-11-12: "move it directly in the Watch section, as soon
 *    as it enters this state … for every kind of 10min clear period"): waiting out the Agent's clear wait, on Watch until
 *    two of its looks past that moment (a moment the Agent never acted on is an open issue again); or ⚠️ HELD AS
 *    EXPECTED (owner, 2026-11-12: "a 'has not run' alert raised while the villa was empty … is held. It goes to Watch"):
 *    on Watch while the Agent is online (a cadence: offline, nobody would end the hold), no moment said.
 *  - Resolved, ⚠️ ONE PLACE AT EVERY MOMENT (architecture review round 16, 2026-11-03: closed at 02:49:25, the Agent's
 *    confirmsBy written at 02:49:33, and in between it sat under Closed then jumped to Watch): on Watch while it is
 *    watched (its confirmsBy, not shown past shownUntil), or about to be (`fault.awaiting`: the Agent's fault just
 *    closed, its confirmsBy not written yet, for two of its looks); else closed ("Not a problem while it lasts" among
 *    them: nothing is watched), ⚠️ at once when the Agent closed it watching nothing (`notWatched`: a visit ends once;
 *    owner's drills 2026-11-06, one on Watch with no "Closes" line, another in Closed). */
export function faultStanding(t: FmTicket, cadence: AgentCadence | null, now: number = Date.now(),
  closing?: FaultClosing): FaultStanding {
  if (!isTicketResolved(t)) {
    const waiting = !!closing && now <= shownUntil(Date.parse(closing.at), cadence);
    if (!waiting && !(t.expected && cadence)) return { place: "open" };
    // held as expected: the Agent's words, no moment (sorted last); else right again, its close's moment
    return { place: "watch", fault: t.expected
      ? clearingFault(t, NaN, { said: t.expected, expected: true }, cadence, now)
      : clearingFault(t, Date.parse(closing!.at), holdsText(closing!), cadence, now) };
  }
  const closed = closedTold(t);
  const lookMinutes = cadence && cadence.checkMinutes > 0 ? cadence.checkMinutes : null;
  const at = watchedUntil(t, cadence);
  if (!Number.isNaN(at)) {
    return now > shownUntil(at, cadence) ? { place: "closed", fault: closed }
      : { place: "watch", fault: { ...closed, at, due: now >= at, lookMinutes, awaiting: false } };
  }
  const resolvedAt = Date.parse(t.resolvedAt ?? "");
  if (!closedAsLasting(t) && !t.notWatched && agentOwned(t) && now <= shownUntil(resolvedAt, cadence)) {
    return { place: "watch", fault: { ...closed, at: NaN, due: false, lookMinutes, awaiting: true } };
  }
  return { place: "closed", fault: closed };
}

/** A Watch card's fields read again at `now` (the Cockpit reads its cards every minute): its moment past or not. */
export const watchAsOf = (c: ConfirmingFault, now: number): ConfirmingFault =>
  (Number.isNaN(c.at) ? c : { ...c, due: now >= c.at });

/** The soonest close first, those with no moment (about to be watched, held as expected) last. */
export function watchOrder(a: ConfirmingFault, b: ConfirmingFault): number {
  const order = (c: ConfirmingFault) => (Number.isNaN(c.at) ? Infinity : c.at);
  return order(a) - order(b) || (a.closedAt || 0) - (b.closedAt || 0) || a.ticket.id.localeCompare(b.ticket.id);
}

/** Every resolved fault on Watch now (being confirmed, or about to be), in watchOrder. The open ones on Watch come with
 *  their alert's line (attention's `clearing`): their place needs what their device reads. */
export function confirmingFaults(d: FmData, cadence: AgentCadence | null, now: number = Date.now()): ConfirmingFault[] {
  return d.tickets.flatMap((t) => {
    if (!isTicketResolved(t)) return [];
    const s = faultStanding(t, cadence, now);
    return s.place === "watch" ? [s.fault] : [];
  }).sort(watchOrder);
}

/** ⚠️ WHAT LEFT THE WATCH LIST GOES TO CLOSED (owner, 2026-11-01: "i expect to see them go in the closed section"):
 *  every resolved fault closed now, the last closed first; the server drops them after their retention window. */
export function closedFaults(d: FmData, cadence: AgentCadence | null, now: number = Date.now()): ClosedFault[] {
  return d.tickets.flatMap((t) => { const s = faultStanding(t, cadence, now); return s.place === "closed" ? [s.fault] : []; })
    .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
}

/** The resolved records whose device's live state is no open issue: exactly those on Watch. ⚠️ THOSE ABOUT TO BE TOO
 *  (owner, 2026-11-02: in the seconds before the Agent's confirmsBy the card came back as a live state with its own
 *  Done, and that second press raised a second fault). */
export function watchedRecords(d: FmData, cadence: AgentCadence | null, now: number = Date.now()): FmTicket[] {
  return d.tickets.filter((t) => isTicketResolved(t) && faultStanding(t, cadence, now).place === "watch");
}
