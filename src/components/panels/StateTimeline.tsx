// src/components/panels/StateTimeline.tsx
// A horizontal "last N hours" state-history bar: one coloured segment per
// state the entity held, sized to how long it held it — the equivalent of
// Sparkline/DualSparkline for entities whose meaningful history is discrete
// states (on/off, locked/unlocked, open/closed, or an arbitrary text state
// like an access point's "connected"/"disconnected") rather than a numeric
// series. Renders div segments (not SVG) since flat colour blocks, not a
// line, are the whole point.

import type { StateHistoryPoint } from "@/types/ha.types";

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
}

export default function StateTimeline({ data, hours = 24, colorFor, height, legend }: Props) {
  if (data.length === 0) {
    return <div className="muted body-text">Not enough history yet.</div>;
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

  return (
    <>
      <div className="state-timeline" style={height ? { height } : undefined}>
        {segments.map((s, i) => (
          <div
            key={i}
            className="state-timeline-seg"
            style={{ left: `${s.left}%`, width: `${Math.max(s.width, 0.3)}%`, background: colorFor(s.state) }}
            title={`${s.state} — ${new Date(s.from).toLocaleTimeString()} to ${new Date(s.to).toLocaleTimeString()}`}
          />
        ))}
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
