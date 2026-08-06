// src/components/panels/StateTimeline.tsx
// A horizontal "last N hours" state-history bar: one coloured segment per
// state the entity held, sized to how long it held it — the equivalent of
// Sparkline/DualSparkline for entities whose meaningful history is discrete
// states (on/off, locked/unlocked, open/closed, or an arbitrary text state
// like an access point's "connected"/"disconnected") rather than a numeric
// series. Renders div segments (not SVG) since flat colour blocks, not a
// line, are the whole point. Hover/touch shows the state + time at the pointer
// (the discrete-history counterpart of the numeric charts' crosshair tooltip).

import { useMemo, useState } from "react";
import type { StateHistoryPoint } from "@/types/ha.types";
import { fmtChartTime } from "./chartUtils";

export interface TimelineLegendEntry {
  state: string;
  color: string;
  label?: string;
}

interface Props {
  /** Ascending by time. The state at data[0] is assumed to hold from before
   *  the window starts (typical of HA's history API, which includes the
   *  state active AT the window start as the first point). */
  data: StateHistoryPoint[];
  hours?: number;
  colorFor: (state: string) => string;
  height?: number;
  /** Optional legend row below the bar — pass this for states whose colour
   *  isn't already self-evident (e.g. a generic text sensor); skip it for a
   *  plain on/off device, whose current-state pill above already says which
   *  colour means what. */
  legend?: TimelineLegendEntry[];
  /** True while the history fetch is still in flight — distinguishes "still
   *  loading" from "HA genuinely has no history for this entity" (both used
   *  to render as the same empty state, so a slow network looked identical
   *  to a device that's never reported). */
  loading?: boolean;
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
  /**
   * Render fixed time buckets of this many minutes instead of one segment per
   * state change. A bucket is painted if AT LEAST ONE event of a state landed
   * in it, and shows every state it saw (striped when more than one), so it
   * answers "was there presence / was it offline during this slice" rather
   * than "exactly how long did each state last".
   *
   * This exists because the per-change rendering degenerates for a
   * high-frequency entity. Segments are absolutely positioned and floored to a
   * minimum width for legibility — 0.3%, which on a 24h window is 4.3 MINUTES
   * — so a camera's motion sensor firing dozens of brief blips drew each one
   * ~100x too wide, overlapping its neighbours into a solid red mass that
   * wildly overstated how much motion there had been. Worse, which of those
   * overlapping segments won a given pixel depended on sub-pixel positions
   * that shift as `now` advances, so the bar visibly reshuffled on every
   * re-render while showing the same data (reported as the bar "changing while
   * displaying the same view").
   *
   * Buckets fix both: they tile, so nothing overlaps and no minimum width is
   * needed, and they are anchored to ABSOLUTE wall-clock time rather than to
   * `now`, so the layout is bit-identical between renders and only changes
   * when the clock actually crosses a boundary.
   */
  bucketMinutes?: number;
}

/** One drawn cell — a state segment, or a time bucket. Both modes reduce to
 *  this so there is a single render path and a single tooltip. */
interface Cell {
  left: number;
  width: number;
  from: number;
  to: number;
  /** Distinct states in this cell, in order of first appearance. */
  states: string[];
  /** Every transition inside this cell — the tooltip lists all of them. */
  events: StateHistoryPoint[];
}

/** Stripe a cell that saw more than one state, so "there was motion AND it
 *  dropped offline in these five minutes" is one readable cell rather than a
 *  choice between two half-truths. */
function cellBackground(states: string[], colorFor: (s: string) => string): string {
  if (states.length === 1) return colorFor(states[0]);
  const w = 3;
  const stops = states.map((s, i) => `${colorFor(s)} ${i * w}px ${(i + 1) * w}px`).join(", ");
  return `repeating-linear-gradient(45deg, ${stops})`;
}

/** Tidy a raw HA state for display: "not_home" → "Not home", "on" → "On". */
function prettyState(s: string): string {
  const t = s.replace(/_/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : s;
}

export default function StateTimeline({
  data, hours = 24, colorFor, height, legend, loading, vertical, bucketMinutes,
}: Props) {
  const [hover, setHover] = useState<{ x: number; cell: Cell } | null>(null);

  const bucketMs = (bucketMinutes ?? 0) * 60_000;
  // Recomputed only when the wall clock crosses a bucket boundary — NOT on
  // every render. This is what makes a bucketed bar stable: `now` advancing a
  // few milliseconds no longer nudges anything, so identical data renders
  // identically every time. Falls back to a 1s key for the segment mode, whose
  // last segment legitimately grows toward `now`.
  const timeKey = bucketMs
    ? Math.floor(Date.now() / bucketMs)
    : Math.floor(Date.now() / 1000);

  const cells = useMemo<Cell[]>(() => {
    if (data.length === 0) return [];
    const now = timeKey * (bucketMs || 1000) + (bucketMs || 1000);
    const start = now - hours * 3600 * 1000;
    const span = now - start;

    if (bucketMs) {
      // Anchored to absolute time, so bucket edges are the same wall-clock
      // instants for everyone and do not drift with when the panel opened.
      const first = Math.floor(start / bucketMs) * bucketMs;
      const count = Math.ceil((now - first) / bucketMs);
      const idxOf = (t: number) => Math.floor((t - first) / bucketMs);
      const out: Cell[] = [];
      for (let k = 0; k < count; k++) {
        const from = first + k * bucketMs;
        out.push({
          left: ((from - start) / span) * 100,
          width: (bucketMs / span) * 100,
          from, to: from + bucketMs, states: [], events: [],
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
        }
        // The transition itself is an EVENT, filed under the bucket it fell in
        // so the tooltip can list exactly what happened and when.
        const e = idxOf(segStart);
        if (e >= 0 && e < count) out[e].events.push(data[i]);
      }
      return out.filter((c) => c.states.length > 0);
    }

    const out: Cell[] = [];
    for (let i = 0; i < data.length; i++) {
      const segStart = data[i].t;
      const segEnd = i + 1 < data.length ? data[i + 1].t : now;
      if (segEnd <= start) continue;
      const clippedStart = Math.max(segStart, start);
      const clippedEnd = Math.min(segEnd, now);
      if (clippedEnd <= clippedStart) continue;
      out.push({
        left: ((clippedStart - start) / span) * 100,
        width: ((clippedEnd - clippedStart) / span) * 100,
        from: clippedStart, to: clippedEnd,
        states: [data[i].state], events: [],
      });
    }
    return out;
  }, [data, hours, bucketMs, timeKey]);

  if (data.length === 0) {
    return loading
      ? <div className="state-timeline-skeleton" style={height ? { height } : undefined} />
      : <div className="muted body-text">Not enough history yet.</div>;
  }
  if (cells.length === 0) {
    return <div className="muted body-text">Not enough history yet.</div>;
  }

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Read whichever axis the bar actually runs along.
    const frac = vertical
      ? Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
      : Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const pct = frac * 100;
    const cell = cells.find((c) => pct >= c.left && pct <= c.left + c.width) ?? cells[cells.length - 1];
    setHover({ x: vertical ? e.clientY - rect.top : e.clientX - rect.left, cell });
  };

  return (
    <>
      <div className="spark-wrap">
        <div
          className={`state-timeline${vertical ? " state-timeline-vertical" : ""}`}
          style={{ ...(height && !vertical ? { height } : undefined), touchAction: "none" }}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {cells.map((c, i) => {
            // The minimum width is only needed where cells do NOT tile: in
            // bucket mode they do, and forcing one wider would reintroduce the
            // overlap this mode exists to remove.
            const size = bucketMs ? `${c.width}%` : `${Math.max(c.width, 0.3)}%`;
            const bg = cellBackground(c.states, colorFor);
            return (
              <div
                key={i}
                className="state-timeline-seg"
                style={
                  vertical
                    ? { top: `${c.left}%`, height: size, background: bg }
                    : { left: `${c.left}%`, width: size, background: bg }
                }
              />
            );
          })}
          {hover && (
            <div
              className="state-timeline-cursor"
              style={vertical ? { top: hover.x } : { left: hover.x }}
            />
          )}
        </div>
        {hover && (
          <div
            className="spark-tip"
            // vertical: hover.x is a Y-offset (see onMove) — the horizontal
            // styling below (left: hover.x, bottom: 100%) misused that as an
            // X-offset AND anchored the tip's bottom edge to the wrap's own
            // top edge, which for a tall, narrow rail (the camera panel's
            // phone-landscape side bar) put the tooltip at the extreme top
            // of the rail regardless of where the touch actually was.
            // Opening rightward off the rail's edge with top pinned to the
            // real touch offset (centred on it, so it never depends on a
            // width/height guess the way the horizontal flip threshold does)
            // fixes both at once.
            style={{
              ...(vertical
                ? { top: hover.x, left: "100%", marginLeft: 6, transform: "translateY(-50%)" }
                : { left: hover.x, bottom: "100%", marginBottom: 6, transform: `translateX(${hover.x > 160 ? "-100%" : "0"})` }),
              // Deliberately NOT capped with overflow: .spark-tip is
              // pointer-events:none, so a scroll area could never be scrolled
              // and a max-height would just silently truncate the event list
              // this mode exists to show in full.
            }}
          >
            {bucketMs ? (
              <>
                <strong>{fmtChartTime(hover.cell.from)} – {fmtChartTime(hover.cell.to)}</strong>
                {hover.cell.events.length === 0 ? (
                  // No transition landed here, so nothing "happened" — the bar
                  // is coloured because a state was already in force throughout.
                  hover.cell.states.map((st) => (
                    <span className="spark-tip-event" key={st}>
                      <span style={{ color: colorFor(st) }}>●</span> {prettyState(st)} (ongoing)
                    </span>
                  ))
                ) : (
                  hover.cell.events.map((ev, k) => (
                    <span className="spark-tip-event" key={k}>
                      <span style={{ color: colorFor(ev.state) }}>●</span> {prettyState(ev.state)}
                      {" · "}{fmtChartTime(ev.t)}
                    </span>
                  ))
                )}
              </>
            ) : (
              <>
                <strong>
                  <span style={{ color: colorFor(hover.cell.states[0]) }}>●</span> {prettyState(hover.cell.states[0])}
                </strong>
                <span>{fmtChartTime(hover.cell.from)}</span>
              </>
            )}
          </div>
        )}
      </div>
      {legend && legend.length > 1 && (
        <div className="row" style={{ gap: 16, marginTop: 8, fontSize: "var(--text-xs)", flexWrap: "wrap" }}>
          {legend.map((l) => (
            <span className="muted" key={l.state}>
              <span style={{ color: l.color }}>●</span> {l.label ?? l.state}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
