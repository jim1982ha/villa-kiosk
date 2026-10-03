// src/ha/historySource.ts
// THE history source: every chart asks it "this history over this window" and
// gets one answer shape back, from either of Home Assistant's recorder paths:
//   * STATES over REST — each change an entity reported: the device panels'
//     timelines (raw, or with the last-sighting look-back), their numeric
//     trends, and the raw numeric series a few readers want (the pressure
//     tendency);
//   * STATISTICS over the websocket — the recorder's 5-minute / hourly / daily
//     buckets: the Weather and Energy windows.
//
// ⚠️ THE WINDOW IS DECIDED HERE, ONCE, FROM ONE `now` THE CALLER PASSES. The
// adapter used to read the clock itself, per request, and each panel read it
// again for its own sums and labels — "which window does this chart show?"
// was fixed four times (2.496.62, .86, .188, and the Weather window's
// two-clock width) and still had three answers. Every series here carries the
// window it was computed for; nothing in this module reads Date.now().
//
// ⚠️ HOME ASSISTANT IS BEHIND A PORT (`HistoryPort`), with two adapters: the
// real one (HAHistoryAPI.haHistoryPort — REST through the add-on, statistics
// through the socket) and the fake the oracles pass. Before it, the only way
// to drive the states path offline was to stub `globalThis.fetch` and
// `window.location` (tests/oracles/history_offline.mjs did exactly that).
//
// Pure apart from the port: tests/oracles/history_source.mjs.

import { gapsFrom } from "@/utils/historyGaps";
import { statisticsSeries, type StatisticField, type StatisticsPeriod } from "@/utils/statisticsSeries";
import { fiveMinuteSeries } from "@/utils/trendInterval";
import { windowEndingAt } from "@/utils/lineChart";
import { UNKNOWN_STATES } from "@/utils/stateColors";
import type { HistorySeries, StateHistoryPoint, StatisticPeriod } from "@/types/ha.types";
import { dayTime } from "@/utils/dateText";

/** One row of Home Assistant's state history, as the REST endpoint sends it. */
export interface StateRow {
  state: string | null;
  last_changed: string;
}

/** What the history source needs from Home Assistant — the seam. */
export interface HistoryPort {
  /** Every state `entityId` reported between `from` and `to` (epoch ms),
   *  led by the state it was already in at `from`. Rejects on failure. */
  stateRows(entityId: string, from: number, to: number): Promise<StateRow[]>;
  /** The recorder's statistics for `ids` from `start` (ISO), one bucket per
   *  `period`, with the fields asked for. Rejects on failure. */
  getStatisticsDuringPeriod(
    ids: string[], start: string, period: StatisticsPeriod, end?: string,
    types?: ReadonlyArray<StatisticField>,
  ): Promise<Record<string, StatisticPeriod[]>>;
}

/** A history a chart asks for. `hours` is a window ending now; `since` (epoch
 *  ms) a window from a fixed start — a calendar period — to now. */
export type HistoryRequest =
  /** Numeric, in the one five-minute trend interval every device chart uses. */
  | { kind: "trend"; ids: readonly string[]; hours: number }
  /** Numeric, every change as reported (the pressure tendency). */
  | { kind: "readings"; id: string; hours: number }
  /** Raw states — no numeric parse — for each id (the camera's status bar). */
  | { kind: "states"; ids: readonly string[]; hours: number }
  /** One entity's states, moved back to end at its last sighting when the
   *  window is entirely dead (the device panels' timelines). */
  | { kind: "stateWindow"; id: string; hours: number }
  /** The recorder's statistics, one series per id per field. */
  | { kind: "statistics"; ids: readonly string[]; period: StatisticsPeriod;
      fields: readonly StatisticField[]; hours?: number; since?: number };

export interface StateWindow {
  data: StateHistoryPoint[];
  /** Set when the window had to move back to find any real data: the moment
   *  the device was last seen reporting. The UI says so. */
  lastSeen?: number;
}

/** What each kind of request answers with. */
export type HistoryAnswer<R extends HistoryRequest> =
  R extends { kind: "trend" } ? Record<string, HistorySeries>
  : R extends { kind: "readings" } ? HistorySeries
  : R extends { kind: "states" } ? Record<string, StateHistoryPoint[]>
  : R extends { kind: "stateWindow" } ? StateWindow
  : R extends { kind: "statistics" } ? Record<string, Partial<Record<StatisticField, HistorySeries>>>
  : never;

/** Several requests answered together, over ONE `now`. */
export type HistoryRequests = Record<string, HistoryRequest>;
export type HistoryAnswers<Q extends HistoryRequests> = { [K in keyof Q]: HistoryAnswer<Q[K]> };

/** How far back to look for a device's last sighting when the requested window
 *  is entirely dead. Long enough to cover a device that failed weeks ago, short
 *  enough that the query stays cheap; beyond it, "not enough history" is the
 *  honest answer. */
export const LAST_SEEN_LOOKBACK_HOURS = 24 * 60;

const HOUR_MS = 3600 * 1000;

/** The window a request covers at `now`. */
export function requestWindow(r: HistoryRequest, now: number): { from: number; to: number } {
  const since = r.kind === "statistics" ? r.since : undefined;
  return { from: since ?? now - (r.hours ?? 0) * HOUR_MS, to: now };
}

/** What a request IS, as a string — the cache and effect key. Two requests
 *  with the same key are the same history; one that differs in any id, range
 *  or field is not (a key built by hand per panel is how a 7-day chart kept
 *  cancelling itself, 2.496.86). */
export function historyKey(q: HistoryRequest | HistoryRequests): string {
  const one = (r: HistoryRequest) => {
    const ids = "ids" in r ? [...r.ids].join(",") : r.id;
    const extra = r.kind === "statistics"
      ? `|${r.period}|${[...r.fields].join(",")}|${r.since ?? ""}` : "";
    return `${r.kind}:${ids}|${r.hours ?? ""}${extra}`;
  };
  if ("kind" in q && typeof q.kind === "string") return one(q as HistoryRequest);
  return Object.keys(q).sort().map((k) => `${k}=${one((q as HistoryRequests)[k])}`).join("&");
}

/** A history row's numeric value, or NaN when there was no reading at all.
 *
 *  ⚠️ BLANK AND NULL ARE NOT ZERO. Kept as a named function rather than inlined
 *  because "absent" vs "zero" is the distinction the whole numeric path turns
 *  on, and `Number(x)` quietly answers 0 for both. */
export function numericState(raw: unknown): number {
  if (raw == null) return NaN;
  const s = String(raw).trim();
  return s === "" ? NaN : Number(s);
}

/**
 * The NUMERIC history of an entity AND the stretches in which it reported
 * nothing usable.
 *
 * ⚠️ THE GAPS ARE PART OF THE ANSWER, NOT AN OPTION. Dropping the unusable
 * rows and saying nothing is what drew a pump "ramping up" all night while it
 * was offline — the chart joined the last reading before the outage to the
 * first one after it and called that a measurement.
 */
async function readings(port: HistoryPort, id: string, window: { from: number; to: number }): Promise<HistorySeries> {
  const rows = (await port.stateRows(id, window.from, window.to))
    // ⚠️ A MISSING READING MUST BECOME NaN, NEVER 0. `Number(null)` is 0 and so
    // is `Number("")`, and both are finite, so a filter meant to drop
    // unparseable rows passed them through as a real measurement of zero — a
    // line to the floor on a power sensor, 0°C on a temperature.
    .map((s) => ({ t: new Date(s.last_changed).getTime(), v: numericState(s.state) }));
  return {
    points: rows.filter((p) => Number.isFinite(p.v)),
    // The window's end rather than the last row's stamp: an entity that is
    // unavailable NOW has an outage that has not ended (2.496.62).
    gaps: gapsFrom(rows, window.to),
    window,
  };
}

/**
 * The RAW state history of an entity — no numeric parse, so on/off, enum and
 * free-text states all survive (a numeric parse drops every row of an access
 * point reporting "connected").
 *
 * ⚠️ `unavailable` AND `unknown` ARE KEPT, ALWAYS. Dropping them deleted every
 * period a device was offline before the chart saw it: a 1h window rendered
 * blank up to its first change, a 12h window as one solid band of the state
 * that survived (2026-09-14, a flapping lock) — and it made the look-back's
 * own "is anything alive in here" test vacuous. Colour is not this module's
 * business (stateColors.historyStateColor paints these amber).
 */
async function states(port: HistoryPort, id: string, window: { from: number; to: number }): Promise<StateHistoryPoint[]> {
  const points = (await port.stateRows(id, window.from, window.to))
    // ⚠️ COERCED AT THE DOOR: Home Assistant sends a null `state` on a freshly
    // added entity's early rows, and every consumer believed the declared type.
    .map((s) => ({ t: new Date(s.last_changed).getTime(), state: String(s.state ?? "") }))
    .filter((p) => Number.isFinite(p.t));
  // Consecutive equal states (only attributes changed) are one segment.
  const out: StateHistoryPoint[] = [];
  for (const p of points) {
    if (out.length === 0 || out[out.length - 1].state !== p.state) out.push(p);
  }
  return out;
}

/**
 * The window to chart, and — when it is entirely dead — the same window moved
 * back to END at the device's last sighting, so the chart answers "when did
 * this stop" rather than showing an empty strip.
 */
async function stateWindow(port: HistoryPort, id: string, hours: number, now: number): Promise<StateWindow> {
  const alive = (h: StateHistoryPoint[]) => h.some((pt) => !UNKNOWN_STATES.has(pt.state));
  const h = await states(port, id, { from: now - hours * HOUR_MS, to: now });
  if (alive(h)) return { data: h };
  const deep = await states(port, id, { from: now - LAST_SEEN_LOOKBACK_HOURS * HOUR_MS, to: now });
  let seen = 0;
  for (const pt of deep) {
    if (!UNKNOWN_STATES.has(pt.state) && pt.t > seen) seen = pt.t;
  }
  if (seen === 0) return { data: h };
  // Keep the window's own length; only move where it ENDS — at the sighting —
  // with the row BEFORE it that says what state the window opened in.
  return { data: windowEndingAt(deep, seen, hours), lastSeen: seen };
}

/** The section header's title: the range, and — when the window had to be
 *  moved to find data — the moment it ends, because an unlabelled chart of a
 *  different period is worse than no chart. */
export function historyTitle(rangeTitle: string, lastSeen: number | undefined): string {
  return lastSeen
    ? `${rangeTitle} before ${dayTime(lastSeen)}`
    : rangeTitle;
}

/**
 * The recorder's statistics for `ids`, one series per id per field — gaps
 * included, and an id the recorder has nothing for is an outage the width of
 * the window, never an empty "zero". A failed request REJECTS; the caller's
 * status says "failed", not "no data".
 */
async function statistics(
  port: HistoryPort, ids: readonly string[], period: StatisticsPeriod,
  fields: readonly StatisticField[], window: { from: number; to: number },
): Promise<Record<string, Partial<Record<StatisticField, HistorySeries>>>> {
  if (ids.length === 0) return {};
  const res = await port.getStatisticsDuringPeriod(
    [...ids], new Date(window.from).toISOString(), period, undefined, fields);
  return Object.fromEntries(ids.map((id) => [id, Object.fromEntries(
    fields.map((f) => [f, statisticsSeries(res[id], f, period, window)]))]));
}

/** Answer one request at `now`. */
export async function loadOne<R extends HistoryRequest>(port: HistoryPort, r: R, now: number): Promise<HistoryAnswer<R>> {
  const window = requestWindow(r, now);
  const each = async <T>(ids: readonly string[], f: (id: string) => Promise<T>) =>
    Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await f(id)] as const)));
  switch (r.kind) {
    case "trend":
      return await each(r.ids, async (id) => fiveMinuteSeries(await readings(port, id, window))) as HistoryAnswer<R>;
    case "readings":
      return await readings(port, r.id, window) as HistoryAnswer<R>;
    case "states":
      return await each(r.ids, (id) => states(port, id, window)) as HistoryAnswer<R>;
    case "stateWindow":
      return await stateWindow(port, r.id, r.hours, now) as HistoryAnswer<R>;
    case "statistics":
      return await statistics(port, r.ids, r.period, r.fields, window) as HistoryAnswer<R>;
  }
}

/** Answer several requests together, over the SAME `now` — so two charts
 *  drawn side by side (the Weather window's measurements and its rain) cover
 *  exactly the same span. Rejects if any one fails. */
export async function loadHistory<Q extends HistoryRequests>(port: HistoryPort, q: Q, now: number): Promise<HistoryAnswers<Q>> {
  const keys = Object.keys(q) as (keyof Q)[];
  const answers = await Promise.all(keys.map((k) => loadOne(port, q[k], now)));
  return Object.fromEntries(keys.map((k, i) => [k, answers[i]])) as unknown as HistoryAnswers<Q>;
}
