// src/auth/elevation.ts
// Client for the one-shot superadmin elevation (POST /auth/elevate).
//
// This is NOT a login and deliberately looks nothing like one: it mints no
// session, changes no profile, and there is nothing to sign out of. A correct
// code returns a single token that authorises exactly ONE destructive write —
// the server consumes it on use, so it cannot be replayed or saved for later.
//
// The privilege is real because the SERVER enforces it: it rejects any write
// that removes a Facility Manager record without a fresh token, whatever the
// client believes. This module only carries the token; it grants nothing.

import { ingressPath } from "@/ha/ingress";

export type ElevationResult =
  | { ok: true; token: string }
  | { ok: false; reason: "wrong-code" | "disabled" | "locked-out" | "error"; retryAfter?: number };

/** Exchange the 6-digit code for one single-use token. */
export async function requestElevation(pin: string): Promise<ElevationResult> {
  try {
    const r = await fetch(ingressPath("auth/elevate"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (r.ok) {
      const d = (await r.json()) as { token?: unknown };
      return typeof d.token === "string" && d.token
        ? { ok: true, token: d.token }
        : { ok: false, reason: "error" };
    }
    if (r.status === 401) return { ok: false, reason: "wrong-code" };
    // 403 here means the capability is switched off (no code configured),
    // which is an operator state worth saying out loud rather than letting
    // someone hunt for a code that does not exist.
    if (r.status === 403) return { ok: false, reason: "disabled" };
    if (r.status === 429) {
      const d = (await r.json().catch(() => ({}))) as { retryAfter?: unknown };
      return {
        ok: false,
        reason: "locked-out",
        retryAfter: typeof d.retryAfter === "number" ? d.retryAfter : undefined,
      };
    }
    return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
