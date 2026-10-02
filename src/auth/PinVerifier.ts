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
import { PIN_LENGTH, isPinShape } from "./pinShape";
import { ROLE_ORDER, isRole, type Role } from "./roles";
import type { ServerSession } from "./sessionLost";


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
  if (!isPinShape(pin, PIN_LENGTH)) return { kind: "wrong" };
  return askPin(ingressPath("auth/verify"), { role, pin });
}

/** Establish a session for an un-PIN'd profile (no passcode configured). A
 *  privileged profile with no passcode is refused by the server ("closed",
 *  with its reason: set a passcode in the add-on's options). */
export async function openSession(role: Role): Promise<PinOutcome> {
  return askPin(ingressPath("auth/verify"), { role });
}
