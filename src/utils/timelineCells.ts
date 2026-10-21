// src/utils/timelineCells.ts
// What a state timeline DRAWS, as values: the five-minute cells a history
// falls into, and the painted runs those cells merge into. Pure, so the rules
// ("any state in force during a slice marks it", "the resting state paints
// but never stripes or lists", "one tooltip line per state per minute") are
// driven by value (timeline_cells.mjs) instead of being pinned as source text
// inside StateTimeline's render (round 12, 2.496.193).

import type { StateHistoryPoint } from "@/types/ha.types";
import { DAY_MS, HOUR_MS, localMidnight, localMonthStart } from "@/utils/localDay";

/** One drawn cell — a time bucket. */
export interface Cell {
  /** Position and size along the bar, in percent. */
  left: number;
  width: number;
  from: number;
  to: number;
  /** NOTABLE states in this cell, in order of first appearance. */
  states: string[];
  /** The resting state in force here, if any. Still painted — a camera that is
   *  online and recording is active, not nothing — but never stripes and never
   *  appears as an event. */
  baseline?: string;
  /** Every transition inside this cell — the tooltip lists all of them. */
  events: StateHistoryPoint[];
  /** How long each state was in force in this cell, and how many times it began in it — what a day's or a week's
   *  tooltip says instead of listing every change (owner, 2026-10-20: the tooltip follows the chart's step). */
  spent: Record<string, number>;
  entered: Record<string, number>;
}

/** Where a band drawn "until now" ends: the next edge of its step — but never more than five minutes ahead. A day's or a
 *  week's next edge counted from 1970 is days away, and the last state was drawn into the future (2026-10-20). */
export function bandEnd(now: number, bucketMs: number): number {
  const tick = Math.min(bucketMs, 5 * 60_000);
  return (Math.floor(now / tick) + 1) * tick;
}

/** Where the first cell begins: on the clock's own edges (:00, :05 …) for a step under a day; a day's or a week's on
 *  the villa's LOCAL midnight (a week's on a Monday), as the recorder's daily and weekly figures — never on UTC's
 *  midnight, which read "15 Oct, 08:00" at the villa. */
export function firstCellStart(start: number, bucketMs: number): number {
  if (bucketMs < DAY_MS) return Math.floor(start / bucketMs) * bucketMs;
  if (bucketMs >= 28 * DAY_MS) return localMonthStart(start);
  const midnight = localMidnight(start);
  return bucketMs >= 7 * DAY_MS ? localMidnight(midnight, -((new Date(midnight).getDay() + 6) % 7)) : midnight;
}

/** The edge after `edge`: a step under a day is a fixed length; a day ends at the NEXT local midnight, a week at the
 *  next Monday's, a month on the next 1st — counted on the calendar, never as 24 h × n, which put every edge after a
 *  summer-time change at 01:00 or 23:00 (owner, 2026-10-20: "a week from Monday to Sunday, a day from midnight to
 *  midnight … everywhere"). */
export function nextEdge(edge: number, bucketMs: number): number {
  if (bucketMs < DAY_MS) return edge + bucketMs;
  if (bucketMs >= 28 * DAY_MS) return localMonthStart(edge, 1);
  return localMidnight(edge, bucketMs >= 7 * DAY_MS ? 7 : 1);
}

/** ⚠️ THE ONE RULE FOR A CHART'S STEP EDGES — every cell, value and widened outage of every chart is cut on these:
 *  from the edge at or before `from` to the first edge at or after `to`. */
export function cellEdges(from: number, to: number, bucketMs: number): number[] {
  const edges = [firstCellStart(from, bucketMs)];
  while (edges[edges.length - 1] < to) edges.push(nextEdge(edges[edges.length - 1], bucketMs));
  if (edges.length === 1) edges.push(nextEdge(edges[0], bucketMs));
  return edges;
}

/** The cell `t` falls in: k with edges[k] <= t < edges[k + 1]; -1 before the first, edges.length - 1 after the last. */
export function cellIndex(edges: readonly number[], t: number): number {
  let lo = 0, hi = edges.length - 1;
  if (t < edges[0]) return -1;
  if (t >= edges[hi]) return hi;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (edges[mid] <= t) lo = mid; else hi = mid; }
  return lo;
}

/**
 * The cells of the window ending at `now`, `hours` long, in `bucketMs` slices
 * anchored to absolute time (bucket edges are the same wall-clock instants for
 * everyone, whenever the panel opened). `data[i]` holds from its `t` until
 * the next row (the last until `now`). Cells with nothing in force are dropped.
 */
export function timelineCells(
  data: readonly StateHistoryPoint[], now: number, hours: number, bucketMs: number,
  baselineStates: readonly string[] = [],
): Cell[] {
  if (data.length === 0) return [];
  const start = now - hours * HOUR_MS;
  const span = now - start;
  const edges = cellEdges(start, now, bucketMs);
  const count = edges.length - 1;
  const idxOf = (t: number) => cellIndex(edges, t);
  const out: Cell[] = [];
  for (let k = 0; k < count; k++) {
    const from = edges[k], to = edges[k + 1];
    out.push({
      left: ((from - start) / span) * 100,
      width: ((to - from) / span) * 100,
      from, to, states: [], events: [], spent: {}, entered: {},
    });
  }
  for (let i = 0; i < data.length; i++) {
    const segStart = data[i].t;
    const segEnd = i + 1 < data.length ? data[i + 1].t : now;
    if (segEnd <= start || segStart >= now || segEnd <= segStart) continue;
    // Every bucket this state was in force during gets marked — "at least
    // one event in this slice" is the whole rule.
    const a = Math.max(0, idxOf(Math.max(segStart, start)));
    const b = Math.min(count - 1, idxOf(Math.min(segEnd, now) - 1));
    for (let k = a; k <= b; k++) {
      if (!out[k].states.includes(data[i].state)) out[k].states.push(data[i].state);
      const ms = Math.min(segEnd, now, out[k].to) - Math.max(segStart, start, out[k].from);
      if (ms > 0) out[k].spent[data[i].state] = (out[k].spent[data[i].state] ?? 0) + ms;
    }
    // The transition itself is an EVENT, filed under the bucket it fell in
    // so the tooltip can list exactly what happened and when.
    const e = idxOf(segStart);
    if (e >= 0 && e < count && segStart >= start) {
      out[e].events.push(data[i]);
      out[e].entered[data[i].state] = (out[e].entered[data[i].state] ?? 0) + 1;
    }
  }
  // Drop the resting state from both the paint and the event list, then
  // discard any bucket that had nothing else in it.
  const baseline = new Set(baselineStates);
  for (const c of out) {
    c.baseline = c.states.find((st) => baseline.has(st));
    c.states = c.states.filter((st) => !baseline.has(st));
    const seen = new Set<string>();
    c.events = c.events.filter((ev) => {
      if (baseline.has(ev.state)) return false;
      // ONE line per state per MINUTE. A sensor that trips four times in the
      // same minute is still just "someone was there at 10:44", and listing
      // each trip separately padded the tooltip to a full-height column of
      // near-identical rows carrying no extra information.
      const k = `${ev.state}|${Math.floor(ev.t / 60_000)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return out.filter((c) => c.states.length > 0 || c.baseline !== undefined);
}

/** Stripe a cell that saw more than one state, so "there was motion AND it
 *  dropped offline in these five minutes" is one readable cell rather than a
 *  choice between two half-truths. */
export function cellBackground(states: readonly string[], colorFor: (s: string) => string): string {
  if (states.length === 1) return colorFor(states[0]);
  const w = 3;
  const stops = states.map((s, i) => `${colorFor(s)} ${i * w}px ${(i + 1) * w}px`).join(", ");
  return `repeating-linear-gradient(45deg, ${stops})`;
}

/** Adjacent cells of the same paint, merged into one drawn run. */
export function timelineRuns(
  cells: readonly Cell[], colorFor: (s: string) => string,
): { left: number; width: number; bg: string }[] {
  const out: { left: number; width: number; bg: string }[] = [];
  for (const c of cells) {
    const bg = c.states.length ? cellBackground(c.states, colorFor) : colorFor(c.baseline ?? "");
    const last = out[out.length - 1];
    if (last && last.bg === bg && Math.abs(last.left + last.width - c.left) < 1e-6) last.width += c.width;
    else out.push({ left: c.left, width: c.width, bg });
  }
  return out;
}

/** THE LEGEND OF A BAND: every state it paints, in the order it first appears, its colour and its words (owner,
 *  2026-10-21: "how come I see a legend in some bar chart and not in other … centrally defined and consistent
 *  everywhere"). It was a prop only a sensor in words passed: an occupancy sensor striped red and green said neither,
 *  a camera beside it said both. Now every band says its own, from what it draws. */
export function timelineLegend(
  cells: readonly Cell[], colorFor: (s: string) => string, wordsFor: (s: string) => string,
): { state: string; color: string; label: string }[] {
  const seen: string[] = [];
  for (const c of cells) {
    for (const st of c.states.length ? c.states : c.baseline !== undefined ? [c.baseline] : []) {
      if (!seen.includes(st)) seen.push(st);
    }
  }
  return seen.map((st) => ({ state: st, color: colorFor(st), label: wordsFor(st) }));
}
