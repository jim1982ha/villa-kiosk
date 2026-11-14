// src/components/panels/LastDayTimeline.tsx
// THE state-history section of a device panel: the shared range header, the
// fetch with its last-sighting look-back, where that fetch stands, and the
// StateTimeline. Every panel that charts STATES uses it — Generic and the
// binary/text Sensor panels had their own copies, and each had lost a piece:
// Generic drew an offline device's look-back window against "now" (its data
// fell off the chart), and Sensor had no look-back at all (2.496.188).
// Panels with two timelines (the camera's rail) compose StateTimeline
// directly.
//
// It owns the fetch rather than receiving `data`, which is what lets the range
// live here instead of being duplicated as state in every panel.

import { useHA } from "@/ha/HAStateStore";
import { stateWords } from "@/config/reading";
import StateTimeline from "./StateTimeline";
import { useStateHistory } from "@/hooks/useStateHistory";
import { lastReportNote } from "@/ha/historySource";
import { useHistoryRange, useDeviceBand, HistoryHeader, useKeptFrom } from "./historyRange";
import { aggregationWords, chartAbout } from "./chartUtils";
import { HOUR_MS } from "@/utils/localDay";
import { STATUS_COLOR, isNoHistory, paletteColorFor, statusKeyFor } from "@/utils/stateColors";
import { useStatusRule } from "./PanelActionsContext";
import { useTrendColor } from "./trendHue";

export default function LastDayTimeline({
  entityId, colorFor, palette = false, words, trend = false,
}: {
  entityId: string;
  /** Optional — the entity's own domain rules are used by default, which is
   *  what every simple panel wants. Each of them used to pass a hand-picked
   *  per-domain helper instead, and passing the wrong one was both easy and
   *  silent (a lock coloured by cover rules paints "locked" in the green a
   *  cover uses for OPEN). Only override for a genuinely non-standard read —
   *  binary_sensor's configurable alert state is the one real case. */
  colorFor?: (state: string) => string;
  /** States with no colour rule of their own (a text sensor, an unknown
   *  domain): a palette over the states the window actually holds. Ignored
   *  when `colorFor` is given. Every band lists its colours below it, palette
   *  or not (StateTimeline, timelineLegend). */
  palette?: boolean;
  /** How a state is said, when the entity's own words are not the ones (the villa's presence: "Empty"/"Occupied",
   *  never its sensor's "Detected"/"Clear"). */
  words?: (state: string) => string;
  /** A sensor's reading in words (an access point's "Connected"): its usual state in the window's family colour, as
   *  its numbers would be (trendHue). Never a device's on/off band: its "Off" is the status table's, as its pill and
   *  its button say it (owner, 2026-11-14: a fan's "Off" band was orange beside a purple "Turn off"). */
  trend?: boolean;
}) {
  const { range, picker } = useHistoryRange();
  const kept = useKeptFrom();
  // the window's device with bands under it: the window's one answer, theirs over the same window (useDeviceBand)
  const band = useDeviceBand(entityId);
  const own = useStateHistory(band ? null : entityId, range.hours);
  const { data, status, lastSeen, end } = band ?? own;
  const { entities } = useHA();
  // the "no longer kept" stretch is not one of the device's states: never in its palette (historySource.keptFrom)
  const held = data.map((p) => p.state).filter((s) => !isNoHistory(s));
  const hue = useTrendColor();
  // its states by the status table; a critical device's "needs a look" (a critical lock unlocked) in its alarm's red, as
  // its pill (its device's rule, owner 2026-11-14); its lost contact keeps the band's own grey
  const rule = useStatusRule();
  const byTable = (s: string) => { const k = statusKeyFor(s, entityId); return STATUS_COLOR[k === "warn" ? rule(k) : k]; };
  const base = colorFor ?? (palette ? paletteColorFor(held) : byTable);
  // a sensor's reading in words: its usual state in the window's family colour (trendHue); a device's band: the table's
  const paint = trend ? (s: string) => hue(base(s)) : base;
  return (
    <div className="field">
      <HistoryHeader title={range.title} note={lastReportNote(lastSeen)} picker={picker} step={aggregationWords(range.grainMs, null)}
        about={chartAbout("states", range.grainMs, Date.now() - range.hours * HOUR_MS, kept)} />
      <StateTimeline
        data={data}
        colorFor={paint}
        status={status}
        hours={range.hours}
        grainMs={range.grainMs}
        end={end}
        labelFor={words ?? stateWords(entityId, entities[entityId]?.attributes.device_class as string | undefined)}
      />
    </div>
  );
}
