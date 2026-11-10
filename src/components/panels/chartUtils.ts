// src/components/panels/chartUtils.ts
// Shared formatters for every history chart. What the pointer is over is
// utils/chartGeometry's hover answer, not a helper here.

import { wallClock } from "@/utils/villaClock";
import type { HistoryGap, HistorySeries, StateHistoryPoint } from "@/types/ha.types";
import { clockTime, dayShort, docDate, momentText, monthShort } from "@/utils/dateText";
import { NOT_KEPT_COLOR, NOT_KEPT_WORDS, STATUS_COLOR } from "@/utils/stateColors";
import { cellBackground, nextEdge } from "@/utils/timelineCells";
import { DAY_MS, HOUR_MS } from "@/utils/localDay";
import { PERIOD_MS } from "@/utils/statisticsSeries";

export function fmtChartValue(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

export function fmtChartTime(t: number): string {
  return clockTime(t);
}

/** A duration, as a person says it: "2s", "3min", "1h 20min", "2d 3h" (owner, 2026-10-24: the unit joined to its
 *  number) — rounded to the minute from a minute
 *  on, whole hours from a day on (never an hour more than it has been).
 *  ⚠️ ONE RULE ON BOTH APPS (architecture review round 2, 2026-10-16): the VESTA Agent's timeutil.lasting writes the
 *  same words — 89s was "1min" here and "89s" in its messages. The agreement's `duration.cases`
 *  (agent-contract.json) are the words, checked on both sides (tests/oracles/duration_words.mjs here). */
export function fmtDuration(ms: number): string {
  // no number, no words (architecture review K: NaN read "NaNd", an endless one "Infinityd")
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${Math.max(1, s)}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}min` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

/** What a state band's slice covers, at the band's own step (owner, 2026-10-20: "adjust the tooltip to the time
 *  aggregation"): "14:20 – 14:25" for five minutes, the day ("15 Oct") for a day, "13 Oct – 19 Oct" for a week. */
export function fmtCellSpan(from: number, to: number, stepMs: number, spanHours: number): string {
  if (stepMs < DAY_MS) return `${fmtChartStamp(from, spanHours)} – ${fmtChartTime(to)}`;
  return fmtStepStamp(from, stepMs, spanHours);
}


/** ⚠️ A VALUE'S MOMENT AT ITS OWN STEP (owner, 2026-10-20: a daily value read "231 W · 15 Oct, 00:00"): under a day,
 *  its time (with the day when the window needs it); a day's value, the day alone; a week's, its first and last day;
 *  a month's, the month. Never a clock time for a day or longer — every chart's tooltip says it this way. */
export function fmtStepStamp(t: number, stepMs: number, spanHours: number): string {
  if (stepMs >= 28 * DAY_MS) return monthShort(t);
  if (stepMs >= 7 * DAY_MS) return `${docDate(t)} – ${docDate(nextEdge(t, stepMs) - 1)}`;
  if (stepMs >= DAY_MS) return docDate(t);
  return fmtChartStamp(t, spanHours);
}

/** How a chart's values were made from the readings, said beside its title (owner, 2026-10-20: "show the aggregation
 *  used … avg or sum"): its step ("5min", "hourly", "daily", "weekly", "monthly") and, for a measured value, "avg" (the
 *  mean over the step), for a total "sum"; an on/off band has neither — its step alone. */
type Aggregation = "avg" | "sum" | null;
export function stepWords(stepMs: number): string {
  if (stepMs >= 28 * DAY_MS) return "monthly";
  if (stepMs >= 7 * DAY_MS) return "weekly";
  if (stepMs >= DAY_MS) return "daily";
  if (stepMs >= HOUR_MS) return "hourly";
  return fmtDuration(stepMs);
}
/** What a chart draws in each step: a measured value's mean, a device's states, or a total. */
export type ChartShows = "average" | "states" | "total";

/** A step's one word: "hour", "day", "week", "month", or its duration ("5min"). */
function stepNoun(stepMs: number): string {
  if (stepMs >= 28 * DAY_MS) return "month";
  if (stepMs >= 7 * DAY_MS) return "week";
  if (stepMs >= DAY_MS) return "day";
  if (stepMs >= HOUR_MS) return "hour";
  return fmtDuration(stepMs);
}

/**
 * ⚠️ WHAT A CHART SHOWS, AND WHAT IT MAY NOT (owner, 2026-11-05: a meter offline 22min showed nothing on its 1w chart):
 * the words of the (i) beside every chart's title (ChartStep), for its step (`stepMs`) and what it draws. `from`: where
 * its window starts; `kept`: where the villa's system's finer record begins (historySource.keptFrom): before it, only
 * an outage of a whole finer step shows (statisticsSeries.finerOutages). The five minutes are the recorder's finest
 * figures (PERIOD_MS). Pure: tests/oracles/history_ranges.mjs drives every range.
 *
 * ⚠️ `unkept`: THE CHART DRAWS "NO LONGER KEPT" BEFORE `kept` (architecture review 25): a sensor the villa's system
 * keeps no figures of is drawn from its changes, and before `kept` its chart is the "No longer kept" band — while its
 * (i) said "only an outage of a whole hour shows" there, of figures it has none of. Said as drawn.
 */
export function chartAbout(shows: ChartShows, stepMs: number, from?: number, kept?: number, unkept = false): string {
  const step = stepNoun(stepMs), finest = PERIOD_MS["5minute"];
  const before = kept !== undefined && from !== undefined && from < kept ? docDate(kept) : null;
  if (shows === "total") {
    // ⚠️ SAID AS DRAWN (architecture review 24): it read "left empty" over the grey "No reading" bar (barChart)
    return `${cap(stepWords(stepMs))} totals. Grey: no total, "No reading". No outage shows: a meter keeps counting through it.`;
  }
  if (shows === "states") {
    return `Each ${step} shows its states: striped when several, grey when unavailable.${before ? ` Before ${before}: no longer kept.` : ""}`;
  }
  // ⚠️ AS WIDE AS DRAWN (architecture review 25): it said "at its real length" over a band five minutes wide for a 0.46s
  // drop (trendInterval.widenGaps: every outage covers the five minutes it touched); the tooltip says the real length
  if (stepMs <= finest) return `Every reading, in ${fmtDuration(finest)} steps. Striped: unavailable at least once in those ${fmtDuration(finest)}.`;
  const finer = stepMs >= 7 * DAY_MS ? "day" : stepMs >= DAY_MS ? "hour" : null;
  // ⚠️ SHORT (owner, 2026-11-05: "make this tooltip description shorter"): what is drawn, what may not show, in a few words
  // ⚠️ EVERY OUTAGE WHILE THE DETAIL IS KEPT (owner, 2026-11-06): it said "Outages under 5min may not show", true while
  // only the five-minute figures told them (historySource.outagesInside reads the detail now); before it, the figures'
  return `${cap(stepWords(stepMs))} averages. Striped: unavailable at least once that ${step}.${
    !before ? "" : unkept ? ` Before ${before}: no longer kept.`
      : ` Before ${before}: ${finer ? `only whole-${finer} outages show` : "no outages show"}.`}`;
}

/** Does a chart of these series draw "No longer kept" (a series with no figures, before `kept`)? chartAbout's `unkept`,
 *  asked by every chart of averages (NumericHistory, the Weather window). */
export function drawsUnkept(series: readonly (Pick<HistorySeries, "gaps"> | undefined)[]): boolean {
  return series.some((s) => !!s?.gaps.some((g) => g.notKept));
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export function aggregationWords(stepMs: number, aggregation: Aggregation): string {
  return aggregation ? `${stepWords(stepMs)} ${aggregation}` : stepWords(stepMs);
}

/** A day's or a week's slice in words, one line per state: how long it held, and how many times it began when more
 *  than once — the states that held longest first. Its changes one by one are a five-minute slice's. */
export function cellSummary(spent: Record<string, number>, entered: Record<string, number>,
  words: (state: string) => string): { state: string; text: string }[] {
  return Object.entries(spent).sort((a, b) => b[1] - a[1]).map(([state, ms]) => ({
    state, text: `${words(state)} · ${fmtDuration(ms)}${(entered[state] ?? 0) > 1 ? ` · ${entered[state]} times` : ""}`,
  }));
}

/** The words of a step of the figures offline inside it (HistoryGap.within), when only the averages tell it. */
const DURING: Record<NonNullable<HistoryGap["within"]>, string> = { "5minute": `in those ${fmtDuration(PERIOD_MS["5minute"])}`, hour: "that hour", day: "that day", week: "that week" };

/** How an outage is painted, on the chart and as its tooltip row's key (LineChart): a step of the figures offline
 *  inside it, and every outage, in the stripes of a state timeline's cell that saw more than one state, unavailable
 *  and clear; what is no longer kept its own colour. ⚠️ ONE LOOK FOR THE BAND AND ITS KEY (owner, 2026-11-05: "make sure the
 *  legend is correct for this second line"): the outage row was keyed by the line's green dot. */
export function outageLook(gap: Pick<HistoryGap, "within" | "notKept">): { background: string; opacity: number } {
  // ⚠️ ONE LOOK AT EVERY STEP (owner, 2026-11-05: "is unavailable handled the same way here?"): the 24h chart's
  // five minutes were a faint grey band where the week's hours were striped
  if (gap.notKept) return { background: NOT_KEPT_COLOR, opacity: 0.5 };
  return { background: cellBackground(["unavailable", ""], (s) => (s ? STATUS_COLOR.unavailable : "transparent")), opacity: 0.45 };
}

/** An outage in a chart's tooltip: "Unavailable · 05:21–05:24 (3min)", "Unavailable since 05:21" for one still
 *  running at `now` (the window's end), "Unavailable 3 times, 40s in all, the first at 06:58" for several in one band,
 *  "Unavailable at least once that day" for a step of the figures offline inside it that only the averages tell (no
 *  `drops`: older than the detail kept). ⚠️ ONE MINUTE, NOT A SPAN (owner, 2026-11-05: "Unavailable · 13:40–13:40 (1s)"
 *  for a 0.46s drop): within one minute it says when and how long, "Unavailable at 13:40, under 1s". `spanHours`: the
 *  chart's window, a time naming its day beyond one day (fmtChartStamp), as a "13:40" on a week's chart names none.
 *  ⚠️ ONE WAY AT EVERY RANGE (owner, 2026-11-05): the week's hour said "at least once that hour" of a drop the 24h chart
 *  said "at 06:58, for 10s"; both say the drops now (HistoryGap.drops), the same words of the same drop. */
export function fmtOutage(gap: Pick<HistoryGap, "from" | "to" | "actual" | "notKept" | "within" | "drops">,
  now: number, spanHours = 24): string {
  // older than the villa's system keeps: not an outage (historySource.keptFrom, owner 2026-10-20)
  if (gap.notKept) return `${NOT_KEPT_WORDS} · before ${momentText(gap.to)}`;
  // a step with its value: the tooltip's own stamp names its day, its drops that day say only their time (its day once)
  const at = (t: number) => (gap.within && sameVillaDay(t, gap.from) ? fmtChartTime(t) : fmtChartStamp(t, spanHours));
  const drops = gap.drops?.length ? gap.drops : gap.within ? null : [gap.actual ?? gap];
  // ⚠️ AT LEAST ONCE, ITS DAY ONCE (owner, 2026-11-05): "Unavailable during this day · 3 Nov" over the tooltip's own
  // "3 Nov" said the day twice, and "during" read as the whole day
  if (!drops) return `Unavailable at least once ${DURING[gap.within!]}`;
  const end = (d: { to: number }) => (!Number.isFinite(d.to) || d.to >= now ? now : d.to);
  if (drops.length > 1) {
    const first = Math.min(...drops.map((d) => d.from));
    const total = drops.reduce((sum, d) => sum + Math.max(0, end(d) - d.from), 0);
    return `Unavailable ${drops.length} times, ${total < 1000 ? "under 1s" : fmtDuration(total)} in all, the first at ${at(first)}`;
  }
  const g = drops[0];
  if (!Number.isFinite(g.to) || g.to >= now) return `Unavailable since ${at(g.from)} (${fmtDuration(now - g.from)})`;
  const ms = g.to - g.from;
  if (at(g.from) === at(g.to)) return `Unavailable at ${at(g.from)}, ${ms < 1000 ? "under 1s" : `for ${fmtDuration(ms)}`}`;
  // ⚠️ ITS DAY ONCE (architecture review 24): "Unavailable · 3 Nov, 06:13–3 Nov, 06:40" said the day twice
  return `Unavailable · ${at(g.from)}–${sameVillaDay(g.from, g.to) ? fmtChartTime(g.to) : at(g.to)} (${fmtDuration(ms)})`;
}

/** An x-axis tick: the time of day while the window is two days or less,
 *  the date beyond — a "14:20" under a 7-day chart names no day at all. One
 *  labeller for every chart; the Weather charts had a second. */
export function fmtChartTick(t: number, spanHours: number): string {
  if (spanHours <= 48) return fmtChartTime(t);
  // ⚠️ THE APP'S DAY (owner, 2026-11-05: "29 Oct" under a week's chart): its short form, the year in the tooltip
  return dayShort(t);
}

/**
 * A timestamp for a chart TOOLTIP, with the day included only when it adds
 * something: a bare "14:20" is unambiguous while the chart covers today, and
 * meaningless on a 7-day window where the reader cannot tell which 14:20 it is.
 *
 * Driven off the window the chart is showing rather than off the timestamp's
 * own age, so every point in one chart is formatted the same way — a tooltip
 * that gained and lost a date as the pointer moved would be worse than either
 * form. The one exception is a point that is not from today, which earns the
 * date even inside a short window (an unavailable device's history is anchored
 * to when it was last seen, so a "24h" chart there can sit entirely in the
 * past).
 */
/** Whether two moments fall on the same day of the villa's clock. */
function sameVillaDay(a: number, b: number): boolean {
  const x = wallClock(a), y = wallClock(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

export function fmtChartStamp(t: number, spanHours: number): string {
  // the villa's day (utils/villaClock), as every time on the chart is the villa's
  const d = wallClock(t), today = wallClock(Date.now());
  const sameDay = d.year === today.year && d.month === today.month && d.day === today.day;
  if (spanHours <= 24 && sameDay) return fmtChartTime(t);
  return momentText(t);
}

/**
 * Merge several NAMED state-history series into ONE composite StateTimeline
 * series — e.g. a camera's own online/offline history layered with its
 * linked motion sensor's on/off history into a single "offline / online /
 * motion" bar, reusing StateTimeline itself rather than a bespoke chart.
 *
 * Walks every distinct timestamp across all input series (ascending), keeping
 * each series' most-recently-known state as of that instant, and asks
 * `resolve` to derive the ONE composite state from that snapshot — emitting a
 * new output point only when the composite actually changes, exactly like a
 * real StateHistoryPoint series (one point per genuine transition, not one
 * per input sample).
 */
export function mergeStateHistories(
  series: Record<string, StateHistoryPoint[]>,
  resolve: (current: Record<string, string | undefined>) => string,
): StateHistoryPoint[] {
  const names = Object.keys(series);
  const allTimes = [...new Set(names.flatMap((n) => series[n].map((p) => p.t)))].sort((a, b) => a - b);
  const idx: Record<string, number> = Object.fromEntries(names.map((n) => [n, -1]));
  const current: Record<string, string | undefined> = {};
  const out: StateHistoryPoint[] = [];
  let last: string | null = null;
  for (const t of allTimes) {
    for (const n of names) {
      const pts = series[n];
      while (idx[n] + 1 < pts.length && pts[idx[n] + 1].t <= t) idx[n]++;
      if (idx[n] >= 0) current[n] = pts[idx[n]].state;
    }
    const composite = resolve(current);
    if (composite !== last) {
      out.push({ t, state: composite });
      last = composite;
    }
  }
  return out;
}

/** How much of the chart a range keeps, at its step (owner, 2026-10-26): "7 of 30 days", "18 of 24 hours", "3 of 52
 *  weeks"; five-minute steps as the time they make, "3h 20min of 1d". */
export function keptWords(count: number, of: number, stepMs: number): string {
  if (stepMs < HOUR_MS) return `${count ? fmtDuration(count * stepMs) : "0min"} of ${fmtDuration(of * stepMs)}`;
  const noun = stepMs >= 28 * DAY_MS ? "months" : stepMs >= 7 * DAY_MS ? "weeks" : stepMs >= DAY_MS ? "days" : "hours";
  return `${count} of ${of} ${noun}`;
}
