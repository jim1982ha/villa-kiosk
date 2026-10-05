// src/ha/serviceOutcome.ts
// What a service call came to. HAWebSocket.callService RESOLVES with one of
// these and never rejects: a button that fires a command and forgets it is
// the normal case, and a rejection nobody catches is the "I tap and nothing
// happens" bug. The HUD's error toast stays a listener (onServiceError);
// this lets the control that sent the command react too.
//
// Before 2.496.226 callService resolved `void` either way, so the two
// button-feedback hooks could only undo themselves by timeout (4 s and 10 s)
// — a refused command showed its new state for ten seconds, then flipped back.

export type ServiceOutcome = { ok: true } | { ok: false; error: Error };

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
