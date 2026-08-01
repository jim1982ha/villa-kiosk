// src/components/panels/StateTimeline.tsx
// A horizontal "last N hours" state-history bar: one coloured segment per
// state the entity held, sized to how long it held it — the equivalent of
// Sparkline/DualSparkline for entities whose meaningful history is discrete
// states (on/off, locked/unlocked, open/closed, or an arbitrary text state
// like an access point's "connected"/"disconnected") rather than a numeric
// series. Renders div segments (not SVG) since flat colour blocks, not a
// line, are the whole point. Hover/touch shows the state + time at the pointer
// (the discrete-history counterpart of the numeric charts' crosshair tooltip).

import { useState } from "react";
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
}

/** Tidy a raw HA state for display: "not_home" → "Not home", "on" → "On". */
function prettyState(s: string): string {
  const t = s.replace(/_/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : s;
}

export default function StateTimeline({ data, hours = 24, colorFor, height, legend, loading, vertical }: Props) {
  const [hover, setHover] = useState<{ x: number; state: string; t: number } | null>(null);

  if (data.length === 0) {
    return loading
      ? <div className="state-timeline-skeleton" style={height ? { height } : undefined} />
      : <div className="muted body-text">Not enough history yet.</div>;
  }

  const now = Date.now();
  const start = now - hours * 3600 * 1000;
  const span = now - start;

  const segments: { left: number; width: number; state: string; from: number; to: number }[] = [];
  for (let i = 0; i < data.length; i++) {
    const segStart = data[i].t;
    const segEnd = i + 1 < data.length ? data[i + 1].t : now;
    if (segEnd <= start) continue; // entirely before the window
    const clippedStart = Math.max(segStart, start);
    const clippedEnd = Math.min(segEnd, now);
    if (clippedEnd <= clippedStart) continue;
    segments.push({
      left: ((clippedStart - start) / span) * 100,
      width: ((clippedEnd - clippedStart) / span) * 100,
      state: data[i].state,
      from: clippedStart,
      to: clippedEnd,
    });
  }

  if (segments.length === 0) {
    return <div className="muted body-text">Not enough history yet.</div>;
  }

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Read whichever axis the bar actually runs along.
    const frac = vertical
      ? Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
      : Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const t = start + frac * span;
    const seg = segments.find((s) => t >= s.from && t <= s.to) ?? segments[segments.length - 1];
    setHover({ x: vertical ? e.clientY - rect.top : e.clientX - rect.left, state: seg.state, t });
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
          {segments.map((s, i) => (
            <div
              key={i}
              className="state-timeline-seg"
              style={
                vertical
                  ? { top: `${s.left}%`, height: `${Math.max(s.width, 0.3)}%`, background: colorFor(s.state) }
                  : { left: `${s.left}%`, width: `${Math.max(s.width, 0.3)}%`, background: colorFor(s.state) }
              }
            />
          ))}
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
            style={vertical
              ? { top: hover.x, left: "100%", marginLeft: 6, transform: "translateY(-50%)" }
              : { left: hover.x, bottom: "100%", marginBottom: 6, transform: `translateX(${hover.x > 160 ? "-100%" : "0"})` }}
          >
            <strong><span style={{ color: colorFor(hover.state) }}>●</span> {prettyState(hover.state)}</strong>
            <span>{fmtChartTime(hover.t)}</span>
          </div>
        )}
      </div>
      {legend && legend.length > 1 && (
        <div className="row" style={{ gap: 16, marginTop: 8, fontSize: 12, flexWrap: "wrap" }}>
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
