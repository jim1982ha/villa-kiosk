// src/ha/HAHistoryAPI.ts
// Fetch recent sensor history via the REST API for SensorPanel sparklines.

import type { HistoryPoint } from "@/types/ha.types";
import { ingressApiBase } from "./ingress";

interface RawHistoryState {
  state: string;
  last_changed: string;
  last_updated?: string;
}

/** Fetch the last `hours` of numeric history for an entity. */
export async function fetchHistory(
  entityId: string,
  hours = 24,
): Promise<HistoryPoint[]> {
  // The add-on's Supervisor proxy injects the token server-side, so we hit it
  // token-less (session cookie carries the browser's authorization).
  const apiBase = ingressApiBase();
  const start = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const url =
    `${apiBase}/history/period/${encodeURIComponent(start)}` +
    `?filter_entity_id=${encodeURIComponent(entityId)}&minimal_response&no_attributes`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`History request failed: ${res.status}`);

  const data = (await res.json()) as RawHistoryState[][];
  const series = data[0] ?? [];
  return series
    .map((s) => ({ t: new Date(s.last_changed).getTime(), v: Number(s.state) }))
    .filter((p) => Number.isFinite(p.v));
}
