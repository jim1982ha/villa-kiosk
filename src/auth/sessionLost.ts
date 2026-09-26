// src/auth/sessionLost.ts
// "The server no longer honours this device's session" — raised by whatever
// notices it, answered in ONE place (ProfileContext), which confirms it with
// the server and returns the kiosk to its profile screen.
//
// ⚠️ NOBODY OWNED IT (round 10, 2.496.152). Since 2.496.24 (627b165e) the
// proxy closes a socket whose session has ended with 4401 "session ended" and
// answers 401 to its API calls. HAWebSocket logged the code and reconnected
// forever; the stores read their 401 as "unreachable". After "log out
// everywhere", or once `session_days` ran out, a wall kiosk sat on the villa
// saying "connecting" and "couldn't reach" and never showed the PIN screen.
//
// Only DEFINITE signals are raised: a 401 from the add-on, a 4401 close.
// Repeated socket failures are not one — Home Assistant restarting looks the
// same — and a 401 before anyone has signed in is expected (/addon-config
// answers 401 until a session exists), which is why the listener, not the
// reporter, decides. Pure; tests/oracles/session_lost.mjs.

type Listener = (source: string) => void;
const listeners = new Set<Listener>();

/** Tell whoever answers for the session that `source` was refused as signed out. */
export function reportSessionLost(source: string): void {
  for (const l of listeners) l(source);
}

/** Listen; returns the unsubscribe. */
export function onSessionLost(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** What the server says about this device's session: a role, definitely
 *  none, or unknown (unreachable, an error) — never guessed. */
export type ServerSession = { role: string } | "none" | "unknown";

/**
 * Whether a signal means signing out: only with a profile active and the
 * server CONFIRMING there is no session. Unknown keeps the profile — an
 * offline wall kiosk must never sign itself out because it cannot ask.
 */
export function sessionLostDecision(activeRole: string | null, server: ServerSession): "sign-out" | "keep" {
  if (activeRole === null) return "keep";
  return server === "none" ? "sign-out" : "keep";
}

/**
 * fetch() against the add-on's own routes: a 401 reports the session lost
 * (and is still returned — the caller answers its own request as before).
 */
export async function backendFetch(input: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(input, init);
  if (r.status === 401) reportSessionLost(`http ${input.replace(/^.*\/(?=[^/]+$)/, "").split("?")[0]}`);
  return r;
}
