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
import { ROLE_ORDER, type Role } from "./roles";

export interface VerifyResult {
  ok: boolean;
  /** Seconds until this role accepts attempts again (rate-limited). */
  retryAfter?: number;
}

const PIN_SHAPE = /^[0-9]{4}$/;

/** Which roles are gated behind a PIN at all. */
export async function pinRequired(): Promise<Record<Role, boolean>> {
  const resp = await fetch(ingressPath("auth/roles"));
  if (!resp.ok) throw new Error(`auth service unavailable (HTTP ${resp.status})`);
  const data = (await resp.json()) as { roles?: Record<string, { pinRequired?: boolean }> };
  const out = {} as Record<Role, boolean>;
  for (const r of ROLE_ORDER) out[r] = Boolean(data.roles?.[r]?.pinRequired);
  return out;
}

/** Check a PIN-gated profile's passcode; sets the session cookie on success. */
export async function verify(role: Role, pin: string): Promise<VerifyResult> {
  if (!PIN_SHAPE.test(pin)) return { ok: false };
  return postVerify({ role, pin });
}

/** Establish a session for an un-PIN'd profile (no passcode configured). */
export async function openSession(role: Role): Promise<VerifyResult> {
  return postVerify({ role });
}

async function postVerify(body: { role: Role; pin?: string }): Promise<VerifyResult> {
  const resp = await fetch(ingressPath("auth/verify"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (resp.status === 429) {
    const data = (await resp.json().catch(() => ({}))) as { retryAfter?: number };
    return { ok: false, retryAfter: data.retryAfter ?? 60 };
  }
  if (resp.status === 403) {
    // A privileged (owner/ops) profile with no PIN configured — the server
    // refuses to auto-grant it (see supervisor-proxy.py's auth_verify_handler).
    // Surface the server's specific reason instead of a generic retry prompt.
    const data = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "this profile is not available");
  }
  if (!resp.ok) throw new Error(`auth service unavailable (HTTP ${resp.status})`);
  const data = (await resp.json()) as { ok?: boolean };
  return { ok: Boolean(data.ok) };
}
