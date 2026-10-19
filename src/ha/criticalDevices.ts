// The villa's critical devices — ONE list, the one its "critical devices offline" rule watches
// (agent-contract.json criticalDevices; owner, 2026-10-18 — architecture review, offline devices #2).
// The add-on's proxy reads the rule (GET /critical-devices) and answers the entity ids only; the Cockpit
// paints a critical device offline red, any other offline device amber (attention.attentionTone).

import { useSyncExternalStore } from "react";
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

// ⚠️ ONE READ FOR EVERY READER (2.496.428). The villa model folds this list for the Cockpit; the map, the open
// window's header and the device lists paint a critical device that lost contact red too, and the page that feeds the
// map sits outside the villa model. Each caller of the hook shares this one answer and this one poll — a second
// `useState` per caller would have read the rule twice every five minutes and could disagree between two reads.
let shared: ReadonlySet<string> = NONE;
const listeners = new Set<() => void>();
let inflight = false;
let readAt = 0;
/** Two callers' timers and wake-ups land within moments of each other: one read answers both. */
const FRESH_MS = 30 * 1000;

function refreshShared(): void {
  if (inflight || Date.now() - readAt < FRESH_MS) return;
  inflight = true;
  void fetchCriticalDevices().then((got) => {
    inflight = false;
    readAt = Date.now();
    if (!got || (shared.size === got.length && got.every((e) => shared.has(e)))) return;
    shared = new Set(got);
    for (const l of listeners) l();
  });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** The villa's critical entities; empty until read (nothing is critical then — never a guess). Every caller shares
 *  one answer and one poll. */
export function useCriticalDevices(): ReadonlySet<string> {
  useStoreRefresh(refreshShared, CRITICAL_POLL_MS);
  return useSyncExternalStore(subscribe, () => shared);
}
