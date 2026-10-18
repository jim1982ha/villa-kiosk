// The villa's critical devices — ONE list, the one its "critical devices offline" rule watches
// (agent-contract.json criticalDevices; owner, 2026-10-18 — architecture review, offline devices #2).
// The add-on's proxy reads the rule (GET /critical-devices) and answers the entity ids only; the Cockpit
// paints a critical device offline red, any other offline device amber (attention.attentionTone).

import { useCallback, useState } from "react";
import { ingressPath } from "@/ha/ingress";
import { backendFetch } from "@/auth/sessionLost";
import { useStoreRefresh } from "@/hooks/useStoreRefresh";

/** The rule changes when the owner edits it: read again every 5 minutes, the proxy's own cache. */
export const CRITICAL_POLL_MS = 5 * 60 * 1000;

/** The entity ids of GET /critical-devices, or null for an answer that is not one. Pure. */
export function parseCriticalDevices(body: unknown): string[] | null {
  const ents = (body as { entities?: unknown } | null)?.entities;
  return Array.isArray(ents) ? ents.filter((e): e is string => typeof e === "string") : null;
}

/** null = not reached (the last answer stays). */
export async function fetchCriticalDevices(): Promise<string[] | null> {
  try {
    const r = await backendFetch(ingressPath("critical-devices"), { credentials: "same-origin" });
    return r.ok ? parseCriticalDevices(await r.json()) : null;
  } catch {
    return null;
  }
}

const NONE: ReadonlySet<string> = new Set();

/** The villa's critical entities; empty until read (nothing is critical then — never a guess). */
export function useCriticalDevices(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(NONE);
  const refresh = useCallback(() => {
    void fetchCriticalDevices().then((got) => {
      if (got) setIds((was) => (was.size === got.length && got.every((e) => was.has(e)) ? was : new Set(got)));
    });
  }, []);
  useStoreRefresh(refresh, CRITICAL_POLL_MS);
  return ids;
}
