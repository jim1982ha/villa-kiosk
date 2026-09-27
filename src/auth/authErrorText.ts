// src/auth/authErrorText.ts
// What a person is told when signing in fails for a reason other than a wrong
// code — ONE rule for both sign-in paths (2.496.194).
//
// PinVerifier throws two kinds of Error: the server's own reason on a 403 (an
// owner/ops profile with no passcode configured — "this profile is not
// available"), and "auth service unavailable (HTTP n)" when the service did
// not answer properly. ProfileGate's un-gated path already showed the first
// and hid the second; PinPad's `catch {}` threw both away and blamed the
// connection, so the one actionable message (set a passcode in the add-on's
// options) never reached the person it was written for.

const UNAVAILABLE_PREFIX = "auth service unavailable";

export function authErrorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message && !err.message.startsWith(UNAVAILABLE_PREFIX)
    ? err.message
    : fallback;
}
