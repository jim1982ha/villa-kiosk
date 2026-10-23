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

import type { AgentCadence } from "@/agent/agentApi";
import { clockTime } from "@/utils/dateText";
import { isClearedStep, isTicketResolved, lastResolution } from "./fmEngine";
import type { FmData, FmTicket } from "./fmTypes";

/** How many of the Agent's looks (cadence.checkMinutes) a fault past its confirms-by moment is still shown for: its
 *  verdict lands at its next look, the second covers a look that ran long. */
export const CONFIRM_GRACE_LOOKS = 2;

export interface ConfirmingFault {
  ticket: FmTicket;
  /** What the person did: "Done" (a Done on Telegram, a repair recorded), "Closed" (the Cockpit's Close, nothing done). */
  word: "Done" | "Closed";
  /** Who did it — the person named on its close (`who`), else the profile that recorded it (`by`); "" when unsaid. */
  who: string;
  /** When the VESTA Agent reads it again (confirmsBy), in ms. */
  at: number;
  /** That moment is past: its verdict is due at the Agent's next look. */
  due: boolean;
}

/** The last moment a fault confirmed by `at` is still shown: two of the Agent's looks after it while the Agent says its
 *  cadence (it is online), `at` itself otherwise. */
export function shownUntil(at: number, cadence: AgentCadence | null): number {
  const look = cadence && cadence.checkMinutes > 0 ? cadence.checkMinutes * 60_000 : 0;
  return at + CONFIRM_GRACE_LOOKS * look;
}

/** The fault `t` as being confirmed now, or null: resolved, its confirmsBy a moment, and not shown past shownUntil. */
export function confirmingOf(t: FmTicket, cadence: AgentCadence | null, now: number = Date.now()): ConfirmingFault | null {
  if (!isTicketResolved(t) || !t.confirmsBy) return null;
  const at = Date.parse(t.confirmsBy);
  if (Number.isNaN(at) || now > shownUntil(at, cadence)) return null;
  const close = lastResolution(t);
  return {
    ticket: t,
    word: close && isClearedStep(close) ? "Closed" : "Done",
    who: close?.who || close?.by || "",
    at,
    due: now >= at,
  };
}

/** Every fault being confirmed now, the soonest verdict first. */
export function confirmingFaults(d: FmData, cadence: AgentCadence | null, now: number = Date.now()): ConfirmingFault[] {
  return d.tickets.flatMap((t) => confirmingOf(t, cadence, now) ?? []).sort((a, b) => a.at - b.at || a.ticket.id.localeCompare(b.ticket.id));
}

/** Its line on the card: "Done (JM) · VESTA confirms by 15:06" — the moment past, "· VESTA confirms it at its next
 *  check". The time is the villa's clock (the tablet's, as every other time on the card: dateText.clockTime). */
export function confirmLine(c: ConfirmingFault): string {
  const { did, when } = confirmParts(c);
  return `${did} · ${when}`;
}

/** The line's two halves: what the person did ("Done (JM)") and when the VESTA Agent confirms it ("VESTA confirms by
 *  15:06") — the compact row says them apart, its pill holding the second (owner, 2026-10-23: option 4). */
export function confirmParts(c: ConfirmingFault): { did: string; when: string } {
  return {
    did: c.who ? `${c.word} (${c.who})` : c.word,
    when: c.due ? "VESTA confirms it at its next check" : `VESTA confirms by ${clockTime(c.at)}`,
  };
}
