// src/ha/serviceOutcome.ts
// What a service call came to. HAWebSocket.callService RESOLVES with one of
// these and never rejects: a button that fires a command and forgets it is
// the normal case, and a rejection nobody catches is the "I tap and nothing
// happens" bug. The villa view's notice stays a listener (onServiceError, said by failedCommandLine);
// this lets the control that sent the command react too.
//
// Before 2.496.226 callService resolved `void` either way, so the two
// button-feedback hooks could only undo themselves by timeout (4 s and 10 s)
// — a refused command showed its new state for ten seconds, then flipped back.

import { countOf } from "@/utils/countOf";

export type ServiceOutcome = { ok: true } | { ok: false; error: Error };

/** A command the add-on refused to this profile, answered in its own sentence ("This profile may not send this
 *  command."): what the person reads, as it is. */
export class CommandRefused extends Error {}

/**
 * What a person reads when a command failed, naming the devices it was for as every screen names them.
 * ⚠️ PLAIN WORDS, NEVER THE SOCKET'S (UI scan, 2026-11-10): the notice read "Not connected", "No answer from the
 * server" or the villa's system's own error text, and named no device. A refusal keeps its own sentence: trying again
 * would not help.
 */
export function failedCommandLine(error: Error, names: readonly string[]): string {
  if (error instanceof CommandRefused) return error.message;
  const who = names.length === 0 ? "The villa's system"
    : names.length === 1 ? names[0] : `${names[0]} and ${countOf(names.length - 1, "other")}`;
  return `${who} did not respond. Try again.`;
}

/** Several commands sent as one press (a whole group switched, one call per kind of device): failed when any did. */
export function allSent(sent: readonly Promise<ServiceOutcome>[]): Promise<ServiceOutcome> {
  return Promise.all(sent).then((outcomes) => outcomes.find((o) => !o.ok) ?? { ok: true });
}

/** A command that was never sent (nothing to send — e.g. a switch whose
 *  position is unknown). Not an error to report, but the intent will not
 *  arrive either. */
export const NOT_SENT: ServiceOutcome = { ok: false, error: new Error("not sent") };

/**
 * Run `onFailed` when what a control's send returned turns out to have
 * failed — the one rule both feedback hooks follow. A send that returns
 * nothing (an older caller that does not pass the outcome on) keeps the
 * timeout as its only way back, as before.
 */
export function onFailure(sent: unknown, onFailed: () => void): void {
  if (!sent || typeof (sent as Promise<unknown>).then !== "function") return;
  (sent as Promise<ServiceOutcome | undefined>).then(
    (outcome) => { if (outcome && outcome.ok === false) onFailed(); },
    () => onFailed(),
  );
}
