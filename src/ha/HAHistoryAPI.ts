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
  const now = Date.now();
  const start = new Date(now - hours * 3600 * 1000).toISOString();
  // end_time is REQUIRED for any window longer than a day. Home Assistant's
  // history endpoint defaults it to start + 24h when it is omitted, so a 7-day
  // request silently came back with the FIRST day of that week and nothing
  // since — a chart whose newest point was six days old while the 24h view of
  // the same sensor was full of data.
  const end = new Date(now).toISOString();
  const url =
    `${apiBase}/history/period/${encodeURIComponent(start)}` +
    `?filter_entity_id=${encodeURIComponent(entityId)}` +
    `&end_time=${encodeURIComponent(end)}&minimal_response&no_attributes`;

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
export async function fetchStateHistory(
  entityId: string,
  hours = 24,
  opts: {
    /**
     * Keep `unavailable`/`unknown` points instead of dropping them.
     *
     * Dropping them is right for a panel asking "what values did this report",
     * where a gap is noise — but wrong for any caller whose whole question IS
     * whether the entity was reachable. The camera panel's status bar was the
     * second kind and got the first behaviour: it maps `unavailable` to a black
     * "offline" band, but those points had already been deleted here, so that
     * branch could never fire. An outage was not drawn as an outage; the state
     * on either side simply continued across the gap, and a camera that had
     * dropped for an hour rendered as an hour of ordinary green.
     */
    keepUnavailable?: boolean;
  } = {},
): Promise<StateHistoryPoint[]> {
  const series = await fetchRaw(entityId, hours);
  const points = series
    .map((s) => ({ t: new Date(s.last_changed).getTime(), state: s.state }))
    .filter((p) => Number.isFinite(p.t)
      && (opts.keepUnavailable || (p.state !== "unavailable" && p.state !== "unknown")));
  // Collapse consecutive duplicate states (can happen when only attributes
  // changed between two reported points) so segment rendering doesn't draw
  // redundant boundaries.
  const out: StateHistoryPoint[] = [];
  for (const p of points) {
    if (out.length === 0 || out[out.length - 1].state !== p.state) out.push(p);
  }
  return out;
}
