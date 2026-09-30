// src/auth/PinVerifier.ts
// Passcode verification + session establishment against the add-on backend.
//
// The kiosk is always served by the add-on (HA sidebar OR its own hostname), so
// the PINs live in the add-on options and are verified server-side by the
// supervisor-proxy — they never reach the browser. A successful check (or an
// un-PIN'd profile's openSession) mints an httpOnly session cookie server-side;
// that cookie, not this client-side UI, is what actually authorizes /core and
// /model on the directly-exposed port.

import { ingressPath } from "@/ha/ingress";
import { askPin, type PinOutcome } from "./pinOutcome";
import { ROLE_ORDER, isRole, type Role } from "./roles";
import type { ServerSession } from "./sessionLost";


const PIN_SHAPE = /^[0-9]{4}$/;

/** What the picker needs to know about a profile: whether it asks for a
 *  passcode, and whether it can be entered from here at all. A profile with
 *  no passcode is unavailable — except Guest from inside Home Assistant, where
 *  the person is already signed in (the server decides; see _profile_enabled). */
export interface ProfileAccess { pin: boolean; enabled: boolean }

export function parseProfileAccess(data: unknown): Record<Role, ProfileAccess> {
  const roles = (data as { roles?: Record<string, { pinRequired?: unknown; enabled?: unknown }> } | null)?.roles ?? {};
  const out = {} as Record<Role, ProfileAccess>;
  for (const r of ROLE_ORDER) {
    const e = roles[r] ?? {};
    const pin = e.pinRequired === true;
    out[r] = { pin, enabled: typeof e.enabled === "boolean" ? e.enabled : pin };
  }
  return out;
}

/** Ask the add-on which profiles can be entered from here, and how. */
export async function profileAccess(): Promise<Record<Role, ProfileAccess>> {
  const resp = await fetch(ingressPath("auth/roles"));
  if (!resp.ok) throw new Error(`auth service unavailable (HTTP ${resp.status})`);
  return parseProfileAccess(await resp.json());
}

/** Which profile the server's own session cookie already authorizes, if any.
 *
 *  The cookie — not anything this browser stores — is what actually authorizes
 *  /core, /model and the config stores, and it outlives the document (its life
 *  is the add-on's `session_days`). Asking the server on boot is what stops a
 *  relaunched PWA re-prompting for a passcode it has already answered; see the
 *  server's auth_session_handler for why it reads the cookie rather than
 *  treating an Ingress request as owner.
 *
 *  Never throws: any failure (offline, older add-on with no such route, bad
 *  payload) resolves to null, which simply means "show the profile picker" —
 *  the pre-existing behaviour, so a stale add-on degrades instead of breaking. */
export async function currentSession(): Promise<Role | null> {
  const s = await serverSession();
  return typeof s === "object" ? (s.role as Role) : null;
}

/** The same question, answered in three (sessionLost.ServerSession): a role,
 *  definitely none (the server answered and named no role), or unknown (it
 *  could not be asked). Signing out needs "none" — see sessionLostDecision. */
export async function serverSession(): Promise<ServerSession> {
  try {
    const resp = await fetch(ingressPath("auth/session"), { credentials: "same-origin" });
    if (!resp.ok) return "unknown";
    const data = (await resp.json()) as { role?: unknown };
    return isRole(data.role) ? { role: data.role } : "none";
  } catch {
    return "unknown";
  }
}

/** Check a PIN-gated profile's passcode; sets the session cookie on success.
 *  Never throws — see pinOutcome. */
export async function verify(role: Role, pin: string): Promise<PinOutcome> {
  if (!PIN_SHAPE.test(pin)) return { kind: "wrong" };
  return askPin(ingressPath("auth/verify"), { role, pin });
}

/** Establish a session for an un-PIN'd profile (no passcode configured). A
 *  privileged profile with no passcode is refused by the server ("closed",
 *  with its reason: set a passcode in the add-on's options). */
export async function openSession(role: Role): Promise<PinOutcome> {
  return askPin(ingressPath("auth/verify"), { role });
}
