// src/auth/pinOutcome.ts
// What a passcode attempt came to — ONE answer for the profile passcode
// (/auth/verify) and the superadmin code (/auth/elevate), 2.496.233.
//
// ⚠️ THE TWO USED TO ANSWER IN DIFFERENT SHAPES, AND ERROR TEXT WAS THE SIGNAL.
// The profile path returned {ok, retryAfter} but THREW for a closed profile
// (the server's reason as the message) and for a service failure ("auth
// service unavailable (HTTP n)"); the superadmin path returned a tagged
// union, which its gate translated back into the first shape — down to
// throwing a made-up Error. A helper then told the two throws apart by a
// string PREFIX. And a lockout without a number waited 60 s on one path and
// nothing on the other.

export type PinOutcome =
  | { kind: "accepted"; token?: string }
  | { kind: "wrong" }
  | { kind: "locked"; retryAfter: number }
  /** The server refuses this profile/code on purpose — its own words. */
  | { kind: "closed"; text: string }
  /** No usable answer: offline, an error page, a body that is not ours. */
  | { kind: "unavailable" };

/** Seconds a lockout lasts when the server did not say. */
export const DEFAULT_LOCKOUT_SECONDS = 60;

/** The server's answer (status + parsed body, or null) as an outcome. Pure. */
export function readPinAnswer(status: number, body: unknown): PinOutcome {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (status === 429) {
    const n = Number(b.retryAfter);
    return { kind: "locked", retryAfter: Number.isFinite(n) && n > 0 ? Math.ceil(n) : DEFAULT_LOCKOUT_SECONDS };
  }
  if (status === 401) return { kind: "wrong" };
  if (status === 403) {
    return { kind: "closed", text: typeof b.error === "string" && b.error ? b.error : "This is not available on this kiosk." };
  }
  if (status < 200 || status >= 300) return { kind: "unavailable" };
  if (typeof b.token === "string" && b.token) return { kind: "accepted", token: b.token };
  if (b.ok === true) return { kind: "accepted" };
  if (b.ok === false) return { kind: "wrong" };
  return { kind: "unavailable" };
}

/** POST a passcode request; never throws. */
export async function askPin(url: string, body: Record<string, unknown>): Promise<PinOutcome> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return readPinAnswer(resp.status, await resp.json().catch(() => null));
  } catch {
    return { kind: "unavailable" };
  }
}
