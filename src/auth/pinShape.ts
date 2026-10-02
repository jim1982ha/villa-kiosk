// src/auth/pinShape.ts
// How many digits a passcode has — the proxy's rule, stated once on this side.
//
// ⚠️ IT WAS COPIED THREE TIMES (until 2.496.251): PinVerifier's `^[0-9]{4}$`,
// PinPad's DEFAULT_PIN_LENGTH = 4 and SuperadminGate's `length={6}`, each a
// separate guess at supervisor-proxy.py's PIN_RE / SUPERADMIN_PIN_RE with
// nothing comparing them. tests/oracles/pin_shape.mjs reads the proxy's own
// two patterns and fails the day either side changes alone.

/** A profile passcode (Owner, Facility Manager, Guest): the proxy's PIN_RE. */
export const PIN_LENGTH = 4;
/** The superadmin code that elevates a session: the proxy's SUPERADMIN_PIN_RE. */
export const SUPERADMIN_PIN_LENGTH = 6;

/** Exactly `length` digits — anything else is not worth a round trip. */
export function isPinShape(pin: string, length: number): boolean {
  return pin.length === length && /^[0-9]+$/.test(pin);
}
