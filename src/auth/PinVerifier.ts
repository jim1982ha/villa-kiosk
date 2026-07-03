// src/auth/PinVerifier.ts
// Passcode verification behind an interface, so the UI depends on the
// abstraction and not on WHERE the PINs live (Dependency Inversion):
//   - Add-on / Ingress: the supervisor-proxy holds the PINs (add-on options)
//     and verifies server-side — secrets never reach the browser.
//   - Standalone / dev: PINs come from VITE_*_PIN env vars. Vite bakes env
//     values into the client bundle, so standalone PINs are a courtesy gate
//     for a trusted kiosk device, not a security boundary — the add-on path
//     is the secure one.

import { ingressPath, isIngress } from "@/ha/ingress";
import { ROLE_ORDER, type Role } from "./roles";

export interface VerifyResult {
  ok: boolean;
  /** Seconds until this role accepts attempts again (rate-limited). */
  retryAfter?: number;
}

export interface PinVerifier {
  /** Which roles are gated behind a PIN at all. */
  pinRequired(): Promise<Record<Role, boolean>>;
  verify(role: Role, pin: string): Promise<VerifyResult>;
}

const PIN_SHAPE = /^[0-9]{4}$/;

class IngressPinVerifier implements PinVerifier {
  async pinRequired(): Promise<Record<Role, boolean>> {
    const resp = await fetch(ingressPath("auth/roles"));
    if (!resp.ok) throw new Error(`auth service unavailable (HTTP ${resp.status})`);
    const data = (await resp.json()) as { roles?: Record<string, { pinRequired?: boolean }> };
    const out = {} as Record<Role, boolean>;
    for (const r of ROLE_ORDER) out[r] = Boolean(data.roles?.[r]?.pinRequired);
    return out;
  }

  async verify(role: Role, pin: string): Promise<VerifyResult> {
    if (!PIN_SHAPE.test(pin)) return { ok: false };
    const resp = await fetch(ingressPath("auth/verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, pin }),
    });
    if (resp.status === 429) {
      const data = (await resp.json().catch(() => ({}))) as { retryAfter?: number };
      return { ok: false, retryAfter: data.retryAfter ?? 60 };
    }
    if (!resp.ok) throw new Error(`auth service unavailable (HTTP ${resp.status})`);
    const data = (await resp.json()) as { ok?: boolean };
    return { ok: Boolean(data.ok) };
  }
}

class EnvPinVerifier implements PinVerifier {
  // Same rate-limit shape as the server (5 fails → 5-minute cooldown) so the
  // two modes behave identically; state is per-page-load, bounded to 3 roles.
  private failures: Record<Role, { count: number; last: number }> = {
    guest: { count: 0, last: 0 }, owner: { count: 0, last: 0 }, ops: { count: 0, last: 0 },
  };
  private static MAX_FAILURES = 5;
  private static LOCKOUT_MS = 300_000;

  private configured(role: Role): string {
    const env = import.meta.env;
    const raw = String(
      (role === "guest" ? env.VITE_GUEST_PIN : role === "owner" ? env.VITE_OWNER_PIN : env.VITE_OPS_PIN) ?? "",
    ).trim();
    return PIN_SHAPE.test(raw) ? raw : "";
  }

  async pinRequired(): Promise<Record<Role, boolean>> {
    return {
      guest: Boolean(this.configured("guest")),
      owner: Boolean(this.configured("owner")),
      ops: Boolean(this.configured("ops")),
    };
  }

  async verify(role: Role, pin: string): Promise<VerifyResult> {
    if (!PIN_SHAPE.test(pin)) return { ok: false };
    const st = this.failures[role];
    if (st.count >= EnvPinVerifier.MAX_FAILURES) {
      const remaining = EnvPinVerifier.LOCKOUT_MS - (Date.now() - st.last);
      if (remaining > 0) return { ok: false, retryAfter: Math.ceil(remaining / 1000) };
      st.count = 0;
    }
    const configured = this.configured(role);
    const ok = !configured || pin === configured;
    if (ok) {
      st.count = 0;
    } else {
      st.count += 1;
      st.last = Date.now();
    }
    return { ok };
  }
}

let _verifier: PinVerifier | null = null;

/** The verifier for the current runtime (add-on vs standalone). Singleton. */
export function getPinVerifier(): PinVerifier {
  if (!_verifier) _verifier = isIngress() ? new IngressPinVerifier() : new EnvPinVerifier();
  return _verifier;
}
