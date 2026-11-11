// src/components/panels/historyRange.tsx
// The shared "how far back" control for every history view in a device panel —
// the state timeline, the numeric line chart, and the multi-series group chart.
//
// One definition, because the three used to disagree by construction: each
// fetched a hardcoded 24 hours, so a panel showing both a timeline and a
// sparkline could not offer a range on one without the other silently staying
// on a different window. The hook hands back the chosen range AND the rendered
// picker, so a caller adds both with one line and cannot wire up half of it.
//
// ⚠️ ONE TABLE FOR EVERY HISTORY VIEW, THE WEATHER WINDOW INCLUDED. It kept a
// second one (12 h – 30 days, with the recorder's statistics period) and its
// own picker; a range is a range whichever recorder path reads it, so each
// entry here carries both resolutions and a view picks which ranges it offers.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import SegmentedGroup, { type SegmentedLayout } from "@/components/common/SegmentedGroup";
import InfoTip from "@/components/common/InfoTip";
import { villaKeptFrom } from "@/ha/HAHistoryAPI";
import { useStateHistory, type StateHistoryResult } from "@/hooks/useStateHistory";

// The table itself is pure (utils/historyRanges): an oracle reads it by value.
export { historyRange, RANGE_KEYS, type HistoryRange } from "@/utils/historyRanges";
import { DEFAULT_KEY, historyRange, RANGES, type HistoryRange, type RangeKey } from "@/utils/historyRanges";

/**
 * A segmented choice — the pill row of the history pickers — and the choice
 * it holds. ONE control for every "which period" in the app: the device
 * panels' and the Weather window's rolling ranges (useHistoryRange) and the
 * Energy window's calendar ones; both windows put it in their header.
 */
export function useSegmentedChoice<K extends string>(
  options: readonly { key: K; label: ReactNode; title?: string; disabled?: boolean }[], initial: K, ariaLabel: string,
  layout: SegmentedLayout, shared?: [K, (k: K) => void] | null,
): { key: K; picker: ReactNode } {
  const own = useState<K>(initial);
  const [picked, setPicked] = shared ?? own;
  const key = options.some((o) => o.key === picked && !o.disabled) ? picked : initial;
  const picker = <SegmentedGroup options={options} active={key} onChange={setPicked} ariaLabel={ariaLabel} layout={layout} />;
  return { key, picker };
}

/** Returns the active range plus a ready-rendered picker for it: every toggle shows the five; `greyed` are the ones
 *  this view has nothing to draw for — shown, not pressable (owner, 2026-10-20). Compact beside a chart's heading;
 *  `natural` where it stands in a window's header (Weather). */
export function useHistoryRange(
  layout: SegmentedLayout = "compact", greyed: readonly RangeKey[] = [],
): { range: HistoryRange; picker: ReactNode } {
  const { key, picker } = useSegmentedChoice(
    RANGES.map((r) => ({ key: r.key, label: r.label, title: r.title, disabled: greyed.includes(r.key) })),
    DEFAULT_KEY, "History range", layout, useContext(SharedRange));
  return { range: historyRange(key), picker };
}

/** ONE RANGE FOR A WINDOW'S BANDS (owner, 2026-10-21: a lock's door sensor band "taking the same width as the bigger
 *  bar … easy to compare states of both devices over the same scale"): inside it, every history view and every band
 *  that follows the window's range (useSharedRange) read the one choice its picker makes. */
const SharedRange = createContext<[RangeKey, (k: RangeKey) => void] | null>(null);

/** THE DEVICE'S BAND AND THE BANDS UNDER IT, ONE WINDOW (owner, 2026-10-21: "easy to compare states of both devices
 *  over the same scale"): one request reads the device and the entities that follow it (a linked sensor, a camera's
 *  motion sensor) over the device band's window — moved back with it when the device is silent (historySource
 *  stateWindow `follow`). ⚠️ Each band asked for its own and moved on its own: a dead door sensor showed the day
 *  before it died under a lock band showing today. */
interface DeviceBand { device: string; follow: readonly string[]; answer: StateHistoryResult }
const SharedBand = createContext<DeviceBand | null>(null);

export function HistoryRangeShare({ device, follow = [], children }: {
  /** The window's device, whose band the `follow` bands sit under. */
  device?: string;
  follow?: readonly string[];
  children: ReactNode;
}) {
  const pair = useState<RangeKey>(DEFAULT_KEY);
  const lead = device !== undefined && follow.length > 0;
  const answer = useStateHistory(lead ? device : null, historyRange(pair[0]).hours, follow);
  return (
    <SharedRange.Provider value={pair}>
      <SharedBand.Provider value={lead ? { device, follow, answer } : null}>{children}</SharedBand.Provider>
    </SharedRange.Provider>
  );
}

/** The window's one answer for `entityId`'s own band, when it is the window's device with bands under it; null: the
 *  band asks for itself (nothing follows it). */
export function useDeviceBand(entityId: string): StateHistoryResult | null {
  const band = useContext(SharedBand);
  return band && band.device === entityId ? band.answer : null;
}

/** A following band: its states over the device band's window, and where that window ends. Never its own window. */
export function useFollowerBand(entityId: string): Pick<StateHistoryResult, "data" | "status" | "end"> {
  const band = useContext(SharedBand);
  if (!band || !band.follow.includes(entityId)) return { data: [], status: "ready" };
  return { data: band.answer.followers?.[entityId] ?? [], status: band.answer.status, end: band.answer.end };
}

/** The window's range as its picker chose it (HistoryRangeShare); the default range outside one. */
export function useSharedRange(): HistoryRange {
  return historyRange(useContext(SharedRange)?.[0] ?? DEFAULT_KEY);
}

/** The heading row every history section uses: its title on the left, the
 *  range picker on the right. Keeps the three views visually identical.
 *  ⚠️ ALWAYS ONE LINE (owner, 2026-11-05: "it should never happen"): "LAST 24 HOURS · 5-min avg (i)" pushed the pills
 *  onto a second line. The device panel's family is wide enough for the longest range's words beside the pills
 *  (03-panels.css .panel-modal), and a narrower heading (a phone) leaves out the words the pill pressed already says
 *  ("24h"), kept for a screen reader and in its (i) (04-modals.css `.timeline-head` container). `note`: a fact under the
 *  row, never in it (the last report a moved window ends just after: historySource.lastReportNote). */
export function HistoryHeader({ title, picker, step, about, note }: { title: string; picker: ReactNode; step: string; about: string; note?: string }) {
  return (
    <>
      <div className="timeline-head">
        <label className="eyebrow"><span className="chart-range-words">{title}</span>
          <ChartStep words={step} about={`${title}, ${step}. ${about}`} /></label>
        {picker}
      </div>
      {note && <div className="chart-note">{note}</div>}
    </>
  );
}

/** The step and aggregation beside a chart's title ("· daily avg", chartUtils.aggregationWords): the same look in a
 *  device panel's header and the Weather and Energy windows' chart heads (owner, 2026-10-20). ⚠️ AND ITS (i) (owner,
 *  2026-11-05): what the chart shows and what it may not (chartUtils.chartAbout), on every chart, the app's one (i). */
export function ChartStep({ words, about }: { words: string; about: string }) {
  return <span className="chart-step"><span className="chart-step-sep"> · </span>{words}<InfoTip label="What this chart shows" className="chart-about">{about}</InfoTip></span>;
}

/** Where the villa's system's finer record begins (historySource.keptFrom, read once an hour), for a chart's (i);
 *  undefined until known. */
export function useKeptFrom(): number | undefined {
  const [kept, setKept] = useState<number | undefined>(undefined);
  useEffect(() => {
    let live = true;
    villaKeptFrom(Date.now()).then((k) => { if (live) setKept(k); }, () => {});
    return () => { live = false; };
  }, []);
  return kept;
}
