// src/ha/testConnection.ts
// One-shot connection test for onboarding / settings. Opens a throwaway socket,
// authenticates, fetches states, and reports the entity count.

import { HAWebSocket } from "./HAWebSocket";
import { diagnoseConnection } from "./connectionDiagnostics";

export interface TestResult {
  ok: boolean;
  message: string;
  entityCount?: number;
  /** When set, the user should open this origin in a new tab and accept the
   *  certificate warning before retrying (self-signed HTTPS HA). */
  trustUrl?: string | null;
}

export async function testConnection(url: string, token: string): Promise<TestResult> {
  // Catch impossible configurations (mixed content) before even trying.
  const pre = diagnoseConnection(url, false);
  if (pre.blocking) {
    return { ok: false, message: pre.hint ?? "Connection blocked", trustUrl: pre.trustUrl };
  }

  const ws = new HAWebSocket();
  try {
    await withTimeout(ws.connect(url, token), 8000, "Connection timed out");
    const states = await withTimeout(ws.getStates(), 8000, "Could not fetch states");
    ws.disconnect();
    return { ok: true, message: `Connected — ${states.length} entities found.`, entityCount: states.length };
  } catch (err) {
    ws.disconnect();
    const base = (err as Error).message || "Connection failed";
    const diag = diagnoseConnection(url, true);
    // Authentication failures are unambiguous — don't muddy them with network hints.
    const isAuth = /token|auth/i.test(base);
    const message = !isAuth && diag.hint ? `${base}\n\n${diag.hint}` : base;
    return { ok: false, message, trustUrl: isAuth ? null : diag.trustUrl };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}
