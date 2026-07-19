// src/ha/HAHistoryAPI.ts
// Fetch recent entity history via the REST API for panel sparklines/timelines.

import type { HistoryPoint, StateHistoryPoint } from "@/types/ha.types";
import { ingressApiBase } from "./ingress";

interface RawHistoryState {
  state: string;
  last_changed: string;
  last_updated?: string;
}

async function fetchRaw(entityId: string, hours: number): Promise<RawHistoryState[]> {
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
  return data[0] ?? [];
}

/** Fetch the last `hours` of NUMERIC history for an entity (line sparklines). */
export async function fetchHistory(entityId: string, hours = 24): Promise<HistoryPoint[]> {
  const series = await fetchRaw(entityId, hours);
  return series
    .map((s) => ({ t: new Date(s.last_changed).getTime(), v: Number(s.state) }))
    .filter((p) => Number.isFinite(p.v));
}

/**
 * Fetch the last `hours` of RAW state history for an entity (StateTimeline) —
 * no numeric parsing, so this also works for on/off, enum, and free-text
 * sensor states (e.g. an access point reporting "connected"/"disconnected").
 * fetchHistory's numeric filter silently drops every point for such an
 * entity, which is why a text-state sensor previously showed "Not enough
 * history yet" even though HA had real history for it.
 */
export async function fetchStateHistory(entityId: string, hours = 24): Promise<StateHistoryPoint[]> {
  const series = await fetchRaw(entityId, hours);
  const points = series
    .map((s) => ({ t: new Date(s.last_changed).getTime(), state: s.state }))
    .filter((p) => Number.isFinite(p.t) && p.state !== "unavailable" && p.state !== "unknown");
  // Collapse consecutive duplicate states (can happen when only attributes
  // changed between two reported points) so segment rendering doesn't draw
  // redundant boundaries.
  const out: StateHistoryPoint[] = [];
  for (const p of points) {
    if (out.length === 0 || out[out.length - 1].state !== p.state) out.push(p);
  }
  return out;
}
