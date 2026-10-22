// src/components/panels/StateTimeline.tsx
// A horizontal "last N hours" state-history bar: one coloured segment per
// state the entity held, sized to how long it held it — the equivalent of
// LineChart for entities whose meaningful history is discrete
// states (on/off, locked/unlocked, open/closed, or an arbitrary text state
// like an access point's "connected"/"disconnected") rather than a numeric
// series. Renders div segments (not SVG) since flat colour blocks, not a
// line, are the whole point. Hover/touch shows the state + time at the pointer
// (the discrete-history counterpart of the numeric charts' crosshair tooltip).

import { useMemo } from "react";
import type { StateHistoryPoint } from "@/types/ha.types";
import { cellSummary, fmtCellSpan, fmtChartStamp } from "./chartUtils";
import ChartTip from "./ChartTip";
import { useChartPointer } from "./useChartPointer";
// ⚠️ NOT A LOCAL COPY. This file carried its own `prettyState` — same two
// operations, and already disagreeing with the owner on the empty string (it
// returned the raw input, the owner returns ""). It feeds every tooltip in
// every panel's history bar and the camera's status rail, so the drift would
// have shown as one word spelled two ways on one screen. Its words and its
// offline colour come from config/reading, like every other surface's.
import { readableState, chartColours, NOT_KEPT, NOT_KEPT_WORDS } from "@/config/reading";
import { TREND_INTERVAL_MS } from "@/utils/trendInterval";
import { bandEnd, timelineCells, timelineLegend, timelineRuns } from "@/utils/timelineCells";
import { DAY_MS } from "@/utils/localDay";
import type { HistoryStatus } from "@/utils/statisticsSeries";
import { ChartEmpty } from "./LineChart";

interface Props {
  /** Ascending by time. The state at data[0] is assumed to hold from before
   *  the window starts (typical of HA's history API, which includes the
   *  state active AT the window start as the first point). */
  data: StateHistoryPoint[];
  /** The window the bar spans, in hours — REQUIRED, because it is what the
   *  x-axis means. It used to default to 24, and every caller let it: picking
   *  "1h" then fetched an hour of history and drew it across a 24-hour axis, so
   *  it appeared as a sliver at the right-hand edge with 23 hours of empty
   *  track beside it. The data and the axis have to come from the same range. */
  hours: number;
  /** Where the window ENDS (epoch ms), when that is not now — a device that
   *  has been down longer than the window is shown ending just after its last
   *  sighting (historySource StateWindow.end), and so are the bands under it. The bar used to draw
   *  [now − hours, now] regardless, so the data it had been handed lay off
   *  its left edge while the header said "… before <date>". */
  end?: number;
  colorFor: (state: string) => string;
  /** How a state is worded in the tooltip — config/BinarySensorClasses'
   *  stateLabelFor, so it reads what the pill above it reads ("No leak", not
   *  "Off"). Defaults to the readable raw state. */
  labelFor?: (state: string) => string;
  height?: number;
  /** false: no legend row (a band too thin to carry one: a linked sensor's row, which names its state beside it).
   *  Otherwise the band lists every state it paints, its colour and its words (timelineLegend) — never a caller's
   *  choice (owner, 2026-10-21). */
  legend?: false;
  /** Where the fetch stands (useHistory's own status) — "still loading",
   *  "HA has no history" and "the request failed" are three different facts,
   *  and this used to take a `loading` flag that could say only the first. */
  status: HistoryStatus;
  /** Run top-to-bottom instead of left-to-right (the camera panel's side rail
   *  on a phone in landscape). Segments are laid out on the other axis and the
   *  pointer read switches axis with them, so this is a genuinely vertical
   *  bar — NOT the horizontal one rotated with a CSS transform, which was the
   *  first attempt: a rotated box has to be sized from its container's height
   *  in a property that means width, which needs that height known up front,
   *  and every way of supplying it (a viewport unit, then a measured one) was
   *  an assumption that could disagree with the real box. Laying the segments
   *  out on the correct axis in the first place has no such coupling — the bar
   *  simply fills its container like any other block. */
  vertical?: boolean;
  /* ⚠️ `bucketMinutes` IS GONE (2.496.179). Every timeline is drawn in the
   ONE five-minute interval (utils/trendInterval) — it was 1, 5, 10 or 60
   minutes by range, and a binary sensor drew per-change segments floored to
   0.3% of the bar, the rendering whose overlaps the camera bar had already
   had to leave. Buckets tile and are anchored to the clock, so nothing
   overlaps and identical data renders identically. */
  /**
   * States that mean "nothing to report" — never painted, never listed in the
   * tooltip, and a bucket containing only these is left as bare track.
   *
   * Without this every bucket of the camera bar contained both `online` and
   * `motion` (the sensor returns to rest after each trip), so every bucket was
   * striped and the bar was uniform noise — while the tooltip alternated
   * "Online 14:00 / Motion 14:00 / Online 14:00 / Motion 14:01…", burying the
   * handful of real events in their own return-to-baseline. Treating the
   * resting state as the absence of news leaves the bar showing only what
   * actually happened.
   *
   * Bucket mode only: a per-change timeline is a duration chart, where the
   * resting state is a legitimate reading rather than background.
   */
  baselineStates?: string[];
  /** The step its slices are cut in: the range's (historyRange `grainMs` — five minutes up to a day, an hour for a week, a day for a
   *  month, a week for a year: owner, 2026-10-20); five minutes when not said (the camera's rail). */
  grainMs?: number;
}

export default function StateTimeline({
  data, hours, end, colorFor: ownColour, labelFor = readableState, height, legend, status, vertical,
  baselineStates, grainMs,
}: Props) {
  // Unavailable/unknown are the legend's colour on EVERY timeline, whatever
  // the panel's mapping (config/reading.chartColours).
  const colorFor = useMemo(() => chartColours(ownColour), [ownColour]);
  // the part older than the villa's system keeps: its own words, whatever the device's (historySource.keptFrom)
  const wordsFor = (s: string) => (s === NOT_KEPT ? NOT_KEPT_WORDS : labelFor(s));
  // Where the pointer is along the bar, as a fraction (the app's one rule:
  // useChartPointer) — along whichever axis the bar runs.
  const { frac, handlers } = useChartPointer<HTMLDivElement>(vertical ? "y" : "x");

  const bucketMs = grainMs ?? TREND_INTERVAL_MS;
  // Joined so the memo below has a stable primitive dep rather than a new
  // array identity on every render.
  const baselineKey = (baselineStates ?? []).join("\u0000");
  // Recomputed only when the wall clock crosses a bucket boundary — NOT on
  // every render. This is what makes a bucketed bar stable: `now` advancing a
  // few milliseconds no longer nudges anything, so identical data renders
  // identically every time.
  // ⚠️ A DAY'S OR A WEEK'S STEP STILL ENDS AT NOW (2026-10-20): timelineCells.bandEnd
  const timeKey = bandEnd(Date.now(), bucketMs);

  const cells = useMemo(
    () => timelineCells(data, end ?? timeKey, hours, bucketMs, baselineKey ? baselineKey.split("\u0000") : []),
    [data, hours, end, bucketMs, timeKey, baselineKey]);

  const runs = useMemo(() => timelineRuns(cells, colorFor), [cells, colorFor]);
  const key = legend === false ? [] : timelineLegend(cells, colorFor, wordsFor);

  if (data.length === 0 || cells.length === 0) return <ChartEmpty status={status} height={height} bar />;

  // No "?? last cell" fallback: falling back reported the most RECENT
  // detection while the pointer was over an earlier, empty slice — the
  // tooltip claiming motion at a time nothing had happened.
  const pct = frac === null ? null : frac * 100;
  const cell = pct === null ? null : cells.find((c) => pct >= c.left && pct <= c.left + c.width) ?? null;
  const hover = cell && frac !== null ? { frac, cell } : null;
  const dot = (st: string) => <span style={{ color: colorFor(st), marginRight: 4 }}>●</span>;

  return (
    <>
      <div className="spark-wrap">
        <div
          className={`state-timeline${vertical ? " state-timeline-vertical" : ""}`}
          style={{ ...(height && !vertical ? { height } : undefined), touchAction: "none" }}
          {...handlers}
        >
          {/* One strip per RUN of intervals that paint the same — a 7-day bar
              is 2,016 five-minute intervals, and a div each was the cost of a
              resolution nobody can see drawn. The tooltip still reads the
              interval under the pointer (`cells`), not the run. */}
          {runs.map((r, i) => (
            <div
              key={i}
              className="state-timeline-seg"
              // ⚠️ THE EXTRA PIXEL IS WHAT CLOSES THE SEAMS: `left` and `width`
              // round to device pixels independently, so a boundary landing
              // mid-pixel showed the track through as a hairline ("white lines
              // between two green values"). One pixel of overlap cannot leave a
              // gap; the track's overflow clips the last strip's.
              style={vertical
                ? { top: `${r.left}%`, height: `calc(${r.width}% + 1px)`, background: r.bg }
                : { left: `${r.left}%`, width: `calc(${r.width}% + 1px)`, background: r.bg }}
            />
          ))}
          {hover && (
            <div
              className="state-timeline-cursor"
              style={vertical ? { top: `${hover.frac * 100}%` } : { left: `${hover.frac * 100}%` }}
            />
          )}
        </div>
        {hover && (
          // The app's tooltip (ChartTip): beside a vertical rail, under a
          // horizontal bar — never over the cells being pointed at.
          <ChartTip x={vertical ? 1 : hover.frac} y={vertical ? hover.frac : 1}
            rows={[
                    { key: "_range", text: fmtCellSpan(hover.cell.from, hover.cell.to, bucketMs, hours) },
                    // ⚠️ A DAY OR A WEEK IS SAID AS TIME PER STATE (owner, 2026-10-20): a week's slice listed its every
                    // change — 34 lines over the panel; its step decides what the tooltip says
                    ...(bucketMs >= DAY_MS
                      ? cellSummary(hover.cell.spent, hover.cell.entered, wordsFor)
                          .map((r) => ({ key: r.state, event: true, marker: dot(r.state), text: r.text }))
                    // Only the resting state here: the state alone IS the answer.
                    : hover.cell.states.length === 0
                      ? [{ key: "_base", event: true, marker: dot(hover.cell.baseline ?? ""), text: wordsFor(hover.cell.baseline ?? "") }]
                      // No transition landed here: a state in force throughout
                      // the span (the time range above already says so).
                      : hover.cell.events.length === 0
                        ? hover.cell.states.map((st) => ({ key: st, event: true, marker: dot(st), text: wordsFor(st) }))
                        : hover.cell.events.map((ev, k) => ({ key: `e${k}`, event: true, marker: dot(ev.state), text: `${wordsFor(ev.state)} · ${fmtChartStamp(ev.t, hours)}` }))),
                  ]} />
        )}
      </div>
      {key.length > 0 && (
        <div className="row state-timeline-legend" style={{ gap: 16, marginTop: 8, fontSize: "var(--text-xs)", flexWrap: "wrap" }}>
          {key.map((l) => (
            <span className="muted" key={l.state}>
              <span style={{ color: l.color }}>●</span> {l.label}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
