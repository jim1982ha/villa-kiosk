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
import { PERIOD_MS, statisticsSeries, type StatisticField, type StatisticsPeriod } from "@/utils/statisticsSeries";
import { fiveMinuteSeries, intervalSeries } from "@/utils/trendInterval";
import { windowEndingAt } from "@/utils/lineChart";
import { isNoHistory, NO_RECORD, NOT_KEPT, UNKNOWN_STATES } from "@/utils/stateColors";
import type { HistorySeries, StateHistoryPoint, StatisticPeriod } from "@/types/ha.types";
import { dayTime } from "@/utils/dateText";
import { HOUR_MS } from "@/utils/localDay";
import { bandEnd } from "@/utils/timelineCells";
import { TREND_INTERVAL_MS } from "@/utils/trendInterval";
import { FINER, type FinerSeries } from "@/utils/rangeFilter";

/** One row of Home Assistant's state history, as the REST endpoint sends it. */
export interface StateRow {
  state: string | null;
  last_changed: string;
}

/** What the history source needs from Home Assistant — the seam. */
export interface HistoryPort {
  /** Every state `entityId` reported between `from` and `to` (epoch ms),
   *  led by the state it was already in at `from`. Rejects on failure.
   *  `back`: how far back the report a window opening asleep holds may be looked for (a device asleep by design,
   *  unavailableByDesign.heldWindow) — readBackFrom, the depth every read shares. */
  stateRows(entityId: string, from: number, to: number, back?: number): Promise<StateRow[]>;
  /** The recorder's statistics for `ids` from `start` (ISO), one bucket per
   *  `period`, with the fields asked for. Rejects on failure. */
  getStatisticsDuringPeriod(
    ids: string[], start: string, period: StatisticsPeriod, end?: string,
    types?: ReadonlyArray<StatisticField>,
  ): Promise<Record<string, StatisticPeriod[]>>;
  /** Where the villa's system's detail begins at `now` (keptFromRows over KEPT_PROBE's history) — undefined when not
   *  known. Optional: a port without it (a test's fake) greys nothing. */
  keptFrom?(now: number): Promise<number | undefined>;
}

/** A history a chart asks for. `hours` is a window ending now; `since` (epoch
 *  ms) a window from a fixed start — a calendar period — to now. */
export type HistoryRequest =
  /** Numeric, in the range's step (historyRange `period`: five minutes up to a day, an hour for a week, a day, a week): the recorder's
   *  long-term figures for a day or a week, else what is kept of every change, in that step. */
  | { kind: "trend"; ids: readonly string[]; hours: number; period?: StatisticsPeriod }
  /** The finer values a "trend" of `period` is made of, for its range filter (utils/rangeFilter FINER): the readings
   *  for a five-minute step, else the recorder's figures of the finer period (or, for a device it keeps none of, every
   *  change kept, in that finer step). Asked only while a chart's filter leaves something out, over the trend's OWN
   *  window (its answer's `window`), never one of its own: read minutes later, "the last 24 hours" would start later and
   *  the chart's first steps would have no detail (architecture review N, 2026-10-27). */
  | { kind: "finer"; ids: readonly string[]; window: { from: number; to: number }; period?: StatisticsPeriod }
  /** Numeric, every change as reported (the pressure tendency). */
  | { kind: "readings"; id: string; hours: number }
  /** Raw states — no numeric parse — for each id (the camera's status bar). */
  | { kind: "states"; ids: readonly string[]; hours: number }
  /** One entity's states, moved back to end at its last sighting when the
   *  window is entirely dead (the device panels' timelines) — and, `follow`,
   *  the states of the entities whose bands sit under it (a lock's door sensor,
   *  a camera's motion sensor) over THAT window, moved or not. */
  | { kind: "stateWindow"; id: string; hours: number; follow?: readonly string[] }
  /** The recorder's statistics, one series per id per field. */
  | { kind: "statistics"; ids: readonly string[]; period: StatisticsPeriod;
      fields: readonly StatisticField[]; hours?: number; since?: number }
  /** When each id's CURRENT state began, as far back as the villa keeps (stateSince). */
  | { kind: "since"; ids: readonly string[]; hours?: undefined }
  /** When each id was last in the villa's system, as far back as the villa keeps (lastRecorded): a device the villa's
   *  system no longer has at all. */
  | { kind: "lastSeen"; ids: readonly string[]; hours?: undefined };

export interface StateWindow {
  data: StateHistoryPoint[];
  /** Set when the window had to move back to find any real data: the moment
   *  the device was last seen reporting. The UI says so. */
  lastSeen?: number;
  /** Where a moved window ENDS: the step edge after `lastSeen` (timelineCells.bandEnd, the rule a band "until now"
   *  ends by), so the state that last report set is drawn. Ending AT the report gave it no width: the band ended on
   *  the state before it while the pill above said the new one (owner, 2026-10-22: "before 21 Oct, 14:57", Closed
   *  under Open). Undefined: the window ends now. */
  end?: number;
  /** Each `follow` entity's states over the SAME window as `data` — never moved on its own: one silent over it
   *  shows its outage there (owner, 2026-10-21: the linked band "taking the same width … over the same scale"). */
  followers?: Record<string, StateHistoryPoint[]>;
}

/** What each kind of request answers with. */
export type HistoryAnswer<R extends HistoryRequest> =
  R extends { kind: "trend" } ? Record<string, HistorySeries>
  : R extends { kind: "finer" } ? Record<string, FinerSeries>
  : R extends { kind: "readings" } ? HistorySeries
  : R extends { kind: "states" } ? Record<string, StateHistoryPoint[]>
  : R extends { kind: "stateWindow" } ? StateWindow
  : R extends { kind: "statistics" } ? Record<string, Partial<Record<StatisticField, HistorySeries>>>
  : R extends { kind: "since" } ? Record<string, StateSince | null>
  : R extends { kind: "lastSeen" } ? Record<string, number | null>
  : never;

/** Several requests answered together, over ONE `now`. */
export type HistoryRequests = Record<string, HistoryRequest>;
export type HistoryAnswers<Q extends HistoryRequests> = { [K in keyof Q]: HistoryAnswer<Q[K]> };

/** The window a request covers at `now`. */
export function requestWindow(r: HistoryRequest, now: number): { from: number; to: number } {
  if (r.kind === "finer") return r.window;
  const since = r.kind === "statistics" ? r.since : undefined;
  return { from: since ?? now - (r.hours ?? 0) * HOUR_MS, to: now };
}

/** What a request IS, as a string — the cache and effect key. Two requests
 *  with the same key are the same history; one that differs in any id, range
 *  or field is not (a key built by hand per panel is how a 7-day chart kept
 *  cancelling itself, 2.496.86). */
export function historyKey(q: HistoryRequest | HistoryRequests): string {
  const one = (r: HistoryRequest) => {
    const ids = "ids" in r ? [...r.ids].join(",") : r.kind === "stateWindow" && r.follow?.length ? `${r.id}>${r.follow.join(",")}` : r.id;
    const extra = r.kind === "statistics"
      ? `|${r.period}|${[...r.fields].join(",")}|${r.since ?? ""}`
      : r.kind === "trend" || r.kind === "finer" ? `|${r.period ?? "5minute"}` : "";
    const span = r.kind === "finer" ? `${r.window.from}-${r.window.to}` : r.hours ?? "";
    return `${r.kind}:${ids}|${span}${extra}`;
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
 * business (stateColors.paintState: unavailable amber, unknown idle).
 */
async function states(port: HistoryPort, id: string, window: { from: number; to: number },
  kept: number | undefined, now: number): Promise<StateHistoryPoint[]> {
  const points = (await port.stateRows(id, window.from, window.to, readBackFrom(kept, now)))
    // ⚠️ COERCED AT THE DOOR: Home Assistant sends a null `state` on a freshly
    // added entity's early rows, and every consumer believed the declared type.
    // a row with no state (null or empty: the villa's system had none for it then) is nothing to show, never a state
    // of its own — a camera's week drew it as a second green with no word in its legend (owner, 2026-10-25)
    .map((s) => ({ t: new Date(s.last_changed).getTime(), state: s.state == null || s.state === "" ? NO_RECORD : String(s.state) }))
    .filter((p) => Number.isFinite(p.t));
  return keptBand(points, window, kept);
}

/**
 * A window's states as a band draws them: consecutive equal states (only attributes changed) are one segment, and
 * the part of the window older than the villa keeps opens on NOT_KEPT until its first change kept.
 *
 * ⚠️ OLDER THAN THE VILLA KEEPS (owner, 2026-10-20): grey "No longer kept", never a blank, an "unknown" or an outage.
 * ONE rule for every band: the asked window, a follower's, and a window moved back to a silent device's last report
 * (until 2.496.499 the moved one skipped it: a lock dead for 8 days, on a week's chart, drew its band blank where the
 * door sensor's band under it read "No longer kept").
 * ⚠️ BEFORE ITS FIRST RECORD (owner, 2026-10-24): the read carries the state at the window's start for anything that
 * existed then, so a first record later than that start is the device's first ever: the window opens on NO_RECORD
 * ("No record yet") until it — never blank, which a band paints in the grey of its resting state.
 */
export function keptBand(points: readonly StateHistoryPoint[], window: { from: number; to: number },
  kept: number | undefined): StateHistoryPoint[] {
  const covered = points.length > 0 && points[0].t <= window.from + 1000;      // the start state, to the second
  const out: StateHistoryPoint[] = covered ? []
    : kept !== undefined && kept > window.from ? [{ t: window.from, state: NOT_KEPT }]
    : points.length ? [{ t: window.from, state: NO_RECORD }] : [];
  for (const p of points) {
    if (out.length === 0 || out[out.length - 1].state !== p.state) out.push(p);
  }
  return out;
}

/**
 * The window to chart, and — when it is entirely dead — the same window moved
 * back to END just after the device's last sighting, so the chart answers
 * "when did this stop" rather than showing an empty strip. The `follow`
 * entities are read over that ONE window: the bands under the device's
 * compare with it over the same scale, and the move is decided once, here.
 */
async function stateWindow(port: HistoryPort, id: string, hours: number, now: number,
  follow: readonly string[] = []): Promise<StateWindow> {
  const kept = await keptFrom(port, now);
  const followers = async (to: number) => follow.length === 0 ? undefined : Object.fromEntries(await Promise.all(
    follow.map(async (f) => [f, await states(port, f, { from: to - hours * HOUR_MS, to }, kept, now)] as const)));
  const alive = (h: StateHistoryPoint[]) => h.some((pt) => !UNKNOWN_STATES.has(pt.state) && !isNoHistory(pt.state));
  const h = await states(port, id, { from: now - hours * HOUR_MS, to: now }, kept, now);
  const asked = async (): Promise<StateWindow> => ({ data: h, ...(follow.length ? { followers: await followers(now) } : {}) });
  if (alive(h)) return asked();
  // as far back as the villa keeps: the ONE depth (readBackFrom), the same the entity store's recall reads to
  const deep = await states(port, id, { from: readBackFrom(kept, now), to: now }, kept, now);
  let seen = 0;
  for (const pt of deep) {
    if (!UNKNOWN_STATES.has(pt.state) && !isNoHistory(pt.state) && pt.t > seen) seen = pt.t;
  }
  if (seen === 0) return asked();
  // Keep the window's own length; only move where it ENDS — on the step edge
  // after the sighting, so its state has width — with the row BEFORE it that
  // says what state the window opened in.
  const end = Math.min(now, bandEnd(seen, TREND_INTERVAL_MS));
  const from = end - hours * HOUR_MS;
  return { data: keptBand(windowEndingAt(deep, end, hours), { from, to: end }, kept), lastSeen: seen, end,
    ...(follow.length ? { followers: await followers(end) } : {}) };
}

/** The section header's title: the range, and — when the window had to be
 *  moved to find data — the device's last report, which it ends just after,
 *  because an unlabelled chart of a different period is worse than no chart. */
export function historyTitle(rangeTitle: string, lastSeen: number | undefined): string {
  // ⚠️ "LAST REPORT", NOT "BEFORE": the band ends on the step after it, with its state drawn (StateWindow.end)
  return lastSeen
    ? `${rangeTitle}, last report ${dayTime(lastSeen)}`
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

// ── When the current state began ──────────────────────────────────────────
/** When a state began: `at` (epoch ms), or — `before` — some time before `at`, the oldest moment the villa still
 *  keeps (or the look-back's start). `state` is the state the history ends in. */
export interface StateSince { at: number; before: boolean; state: string }

/**
 * When the state an entity is in NOW began, from its recorded history — never its `last_changed`.
 *
 * ⚠️ A RESTART IS NOT A CHANGE (owner, 2026-10-20: "Occupied · since 20 Oct, 15:01", the moment of his restart, while
 * the villa had been occupied all day). The villa's system rewrites a template's or a person's state on a restart —
 * unavailable or unknown for a moment, then the same state again — and stamps a new `last_changed` on it. So a run of
 * one state is read across any stretch of unavailable/unknown and across rewrites of the same state; it starts where
 * a DIFFERENT real state ended. A run that reaches the oldest row kept started "before" it — said so, not invented.
 * An entity that is unavailable or unknown NOW: since the start of that stretch.
 */
export function stateSince(rows: readonly StateRow[], kept?: number): StateSince | null {
  const pts = rows.map((r) => ({ t: new Date(r.last_changed).getTime(), state: String(r.state ?? "") }))
    .filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  if (!pts.length) return null;
  const now = pts[pts.length - 1].state;
  const blip = (st: string) => UNKNOWN_STATES.has(st) || st === "";
  let start = pts[pts.length - 1].t;
  for (let i = pts.length - 1; i >= 0; i--) {
    const st = pts[i].state;
    if (st === now || (blip(st) && !blip(now))) {
      if (st === now) start = pts[i].t;
      continue;
    }
    return { at: start, before: false, state: now };
  }
  return { at: Math.max(pts[0].t, kept ?? -Infinity), before: true, state: now };
}

/** The live entity over the history's answer: a change the recorder has not written yet is a real change, at its
 *  `last_changed`; otherwise the history's start of the run. undefined when the history has no answer for it. */
export function stateSinceNow(h: StateSince | null | undefined, live: { state: string; last_changed?: string } | undefined): StateSince | null | undefined {
  if (h === undefined) return undefined;
  if (live && (!h || live.state !== h.state)) {
    const t = Date.parse(live.last_changed ?? "");
    return Number.isFinite(t) ? { at: t, before: false, state: live.state } : null;
  }
  return h;
}

async function since(port: HistoryPort, id: string, now: number): Promise<StateSince | null> {
  const from = readBackFrom(await keptFrom(port, now), now);
  return stateSince(await port.stateRows(id, from, now, from), from);
}

// ── When a device the villa's system no longer has was last in it ─────────
/**
 * The last moment `rows` show the entity in the villa's system: its last row WITH a state (unavailable included: it
 * was there, out of contact). null when nothing is kept: never in it, or gone longer than the villa keeps.
 *
 * ⚠️ THE REMOVAL ROW IS NOT A SIGHTING (owner, 2026-10-31: a door lock the villa's system dropped at night, when its
 * hub stopped sharing it, read "Rename or remove its object in the 3D model"). Removing an entity records one last row
 * with no state, at the moment it went: the state before it is the last time it was seen.
 */
export function lastRecorded(rows: readonly StateRow[]): number | null {
  let seen: number | null = null;
  for (const r of rows) {
    const t = new Date(r.last_changed).getTime();
    if (r.state != null && r.state !== "" && Number.isFinite(t) && (seen === null || t > seen)) seen = t;
  }
  return seen;
}

async function lastSeen(port: HistoryPort, id: string, now: number): Promise<number | null> {
  const from = readBackFrom(await keptFrom(port, now), now);
  return lastRecorded(await port.stateRows(id, from, now, from));
}

// ── How far back the villa's system keeps every change ────────────────────
/** A device every villa's system has, changing twice a day: its oldest change kept is where the detail begins. */
export const KEPT_PROBE = "sun.sun";
/** How far back the probe looks: past it, every window is taken as kept. */
export const KEPT_LOOKBACK_DAYS = 400;
const KEPT_CACHE_MS = HOUR_MS;
const keptCache = new WeakMap<HistoryPort, { at: number; value: number | undefined }>();

/** How far back the probe looks, from `now`. */
export function keptLookFrom(now: number): number {
  return now - KEPT_LOOKBACK_DAYS * 24 * HOUR_MS;
}

/**
 * How far back a read looks at `now` for what came before a window — a silent device's last report (the moved band),
 * when a state began ("since"), the report a device asleep by design holds (the entity store's recall and its chart):
 * to where the villa's system's detail begins (`kept`, keptFrom). Not known (no probe, or it reaches the probe's own
 * look-back, past which everything is taken as kept): the probe's look-back.
 *
 * ⚠️ ONE DEPTH (2.496.499). There were three: the detail kept (measured, about 10.9 days on the owner's villa), a
 * fixed 10 days for the store's recall and 60 days for the last sighting. A sleeping door contact whose last report
 * was 10.5 days old read "Unknown" on its pill (10 days back: nothing) and "Closed" on its week's chart (read from
 * further back).
 */
export function readBackFrom(kept: number | undefined, now: number): number {
  return kept ?? keptLookFrom(now);
}

/** Where the detail begins, from the probe's rows: its oldest change — undefined when it has none (no probe on this
 *  villa: nothing is greyed) or when its history reaches the look-back's start (everything asked is kept). */
export function keptFromRows(rows: readonly StateRow[], lookFrom: number): number | undefined {
  let oldest = Infinity;
  for (const r of rows) {
    const t = new Date(r.last_changed).getTime();
    if (Number.isFinite(t) && t < oldest) oldest = t;
  }
  return Number.isFinite(oldest) && oldest > lookFrom ? oldest : undefined;
}

/**
 * Where the villa's system's detail begins now — the oldest change it still keeps (its recorder's purge_keep_days,
 * 10 by default; Settings change it) — or undefined when not known. Read once an hour.
 *
 * ⚠️ OLDER IS "NO LONGER KEPT", NOT "NOTHING HAPPENED" (owner, 2026-10-20). A month's or a year's window reaches past
 * it: a state band greys that part, a numeric line reads the recorder's long-term figures (or shades it grey).
 */
export async function keptFrom(port: HistoryPort, now: number): Promise<number | undefined> {
  const c = keptCache.get(port);
  if (c && now - c.at < KEPT_CACHE_MS) return c.value;
  let value: number | undefined;
  try {
    value = port.keptFrom ? await port.keptFrom(now) : undefined;
  } catch {
    return undefined;                       // not known: nothing greyed, and asked again next time (never cached)
  }
  keptCache.set(port, { at: now, value });
  return value;
}

/** A numeric series with the part of its window older than `kept` marked "no longer kept". */
export function withNotKept(s: HistorySeries, kept: number | undefined): HistorySeries {
  if (kept === undefined || kept <= s.window.from) return s;
  const to = Math.min(kept, s.window.to);
  return { ...s, gaps: [{ from: s.window.from, to, notKept: true }, ...s.gaps.filter((g) => g.to > to)] };
}

/** A numeric trend in the range's step: five minutes from every change kept; a day or a week from the recorder's
 *  long-term figures (they are kept for good) — or, for a device it keeps none of, from every change kept, in that
 *  step. Whatever is older than the detail kept and not in the figures is marked "no longer kept". */
async function trend(port: HistoryPort, ids: readonly string[], period: StatisticsPeriod,
  window: { from: number; to: number }, now: number): Promise<Record<string, HistorySeries>> {
  const kept = await keptFrom(port, now);
  const figures = period === "5minute" ? {} : await statistics(port, ids, period, ["mean"], window);
  const out: Record<string, HistorySeries> = {};
  for (const id of ids) {
    const fig = figures[id]?.mean;
    if (fig && fig.points.length) { out[id] = fig; continue; }
    const raw = await readings(port, id, window);
    out[id] = withNotKept(period === "5minute" ? fiveMinuteSeries(raw) : intervalSeries(raw, PERIOD_MS[period]), kept);
  }
  return out;
}

/** The finer values of a trend of `period` (rangeFilter FINER), over the same window: one reader with `trend` (the
 *  readings, the recorder's figures, and the same fallback to every change kept for a device with no figures). */
async function finer(port: HistoryPort, ids: readonly string[], period: StatisticsPeriod,
  window: { from: number; to: number }): Promise<Record<string, FinerSeries>> {
  const source = FINER[period];
  const out: Record<string, FinerSeries> = {};
  if (source === "readings") {
    for (const id of ids) out[id] = { of: period, window, series: await readings(port, id, window) };
    return out;
  }
  const stepMs = PERIOD_MS[source];
  const figures = await statistics(port, ids, source, ["mean"], window);
  for (const id of ids) {
    const fig = figures[id]?.mean;
    out[id] = { of: period, window, stepMs,
      series: fig && fig.points.length ? fig : intervalSeries(await readings(port, id, window), stepMs) };
  }
  return out;
}

/** Answer one request at `now`. */
export async function loadOne<R extends HistoryRequest>(port: HistoryPort, r: R, now: number): Promise<HistoryAnswer<R>> {
  const window = requestWindow(r, now);
  const each = async <T>(ids: readonly string[], f: (id: string) => Promise<T>) =>
    Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await f(id)] as const)));
  switch (r.kind) {
    case "trend":
      return await trend(port, r.ids, r.period ?? "5minute", window, now) as HistoryAnswer<R>;
    case "finer":
      return await finer(port, r.ids, r.period ?? "5minute", window) as HistoryAnswer<R>;
    case "readings":
      return await readings(port, r.id, window) as HistoryAnswer<R>;
    case "states": {
      const kept = await keptFrom(port, now);
      return await each(r.ids, (id) => states(port, id, window, kept, now)) as HistoryAnswer<R>;
    }
    case "stateWindow":
      return await stateWindow(port, r.id, r.hours, now, r.follow) as HistoryAnswer<R>;
    case "statistics":
      return await statistics(port, r.ids, r.period, r.fields, window) as HistoryAnswer<R>;
    case "since":
      return await each(r.ids, (id) => since(port, id, now)) as HistoryAnswer<R>;
    case "lastSeen":
      return await each(r.ids, (id) => lastSeen(port, id, now)) as HistoryAnswer<R>;
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
