// src/ai/notifyTargets.ts
// Which notify services this Home Assistant actually has.
//
// ⚠️ SERVED BY THE ADD-ON'S OWN PROXY, NOT FETCHED FROM CORE HERE. Core's
// service catalogue is every service of every integration; the screen needs one
// domain's names, and the proxy already holds the token to ask.

import { ingressPath } from "@/ha/ingress";

export interface NotifyTargets {
  targets: string[];
  /** Why the list is empty, when it is. The screen must still let an operator
   *  type a target when this lookup could not run. */
  error?: string;
}

export async function fetchNotifyTargets(): Promise<NotifyTargets> {
  try {
    const r = await fetch(ingressPath("ai-notify-targets"), { credentials: "same-origin" });
    if (!r.ok) return { targets: [], error: `HTTP ${r.status}` };
    return (await r.json()) as NotifyTargets;
  } catch (e) {
    return { targets: [], error: e instanceof Error ? e.message : String(e) };
  }
}
