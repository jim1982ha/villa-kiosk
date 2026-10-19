// src/utils/timelineCells.ts
// What a state timeline DRAWS, as values: the five-minute cells a history
// falls into, and the painted runs those cells merge into. Pure, so the rules
// ("any state in force during a slice marks it", "the resting state paints
// but never stripes or lists", "one tooltip line per state per minute") are
// driven by value (timeline_cells.mjs) instead of being pinned as source text
// inside StateTimeline's render (round 12, 2.496.193).

import type { StateHistoryPoint } from "@/types/ha.types";
import { localMidnight } from "@/utils/localDay";

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

export const DAY_MS = 24 * 3600 * 1000;

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
  const midnight = localMidnight(start);
  return bucketMs >= 7 * DAY_MS ? localMidnight(midnight, -((new Date(midnight).getDay() + 6) % 7)) : midnight;
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
  const start = now - hours * 3600 * 1000;
  const span = now - start;
  const first = firstCellStart(start, bucketMs);
  const count = Math.ceil((now - first) / bucketMs);
  const idxOf = (t: number) => Math.floor((t - first) / bucketMs);
  const out: Cell[] = [];
  for (let k = 0; k < count; k++) {
    const from = first + k * bucketMs;
    out.push({
      left: ((from - start) / span) * 100,
      width: (bucketMs / span) * 100,
      from, to: from + bucketMs, states: [], events: [], spent: {}, entered: {},
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
