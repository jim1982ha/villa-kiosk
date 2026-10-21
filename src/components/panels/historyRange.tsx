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

import { createContext, useContext, useState, type ReactNode } from "react";
import SegmentedGroup from "@/components/common/SegmentedGroup";

// The table itself is pure (utils/historyRanges): an oracle reads it by value.
export { historyRange, RANGE_KEYS, type HistoryRange, type RangeKey } from "@/utils/historyRanges";
import { DEFAULT_KEY, historyRange, RANGES, type HistoryRange, type RangeKey } from "@/utils/historyRanges";

/**
 * A segmented choice — the pill row of the history pickers — and the choice
 * it holds. ONE control for every "which period" in the app: the device
 * panels' and the Weather window's rolling ranges (useHistoryRange) and the
 * Energy window's calendar ones; both windows put it in their header.
 */
export function useSegmentedChoice<K extends string>(
  options: readonly { key: K; label: ReactNode; title?: string; disabled?: boolean }[], initial: K, ariaLabel: string,
  className: string, shared?: [K, (k: K) => void] | null,
): { key: K; picker: ReactNode } {
  const own = useState<K>(initial);
  const [picked, setPicked] = shared ?? own;
  const key = options.some((o) => o.key === picked && !o.disabled) ? picked : initial;
  const picker = <SegmentedGroup options={options} active={key} onChange={setPicked} ariaLabel={ariaLabel} className={className} />;
  return { key, picker };
}

/** Returns the active range plus a ready-rendered picker for it: every toggle shows the five; `greyed` are the ones
 *  this view has nothing to draw for — shown, not pressable (owner, 2026-10-20). */
export function useHistoryRange(
  className = "timeline-ranges", greyed: readonly RangeKey[] = [],
): { range: HistoryRange; picker: ReactNode } {
  const { key, picker } = useSegmentedChoice(
    RANGES.map((r) => ({ key: r.key, label: r.label, title: r.title, disabled: greyed.includes(r.key) })),
    DEFAULT_KEY, "History range", className, useContext(SharedRange));
  return { range: historyRange(key), picker };
}

/** ONE RANGE FOR A WINDOW'S BANDS (owner, 2026-10-21: a lock's door sensor band "taking the same width as the bigger
 *  bar … easy to compare states of both devices over the same scale"): inside it, every history view and every band
 *  that follows the window's range (useSharedRange) read the one choice its picker makes. */
const SharedRange = createContext<[RangeKey, (k: RangeKey) => void] | null>(null);

export function HistoryRangeShare({ children }: { children: ReactNode }) {
  const pair = useState<RangeKey>(DEFAULT_KEY);
  return <SharedRange.Provider value={pair}>{children}</SharedRange.Provider>;
}

/** The window's range as its picker chose it (HistoryRangeShare); the default range outside one. */
export function useSharedRange(): HistoryRange {
  return historyRange(useContext(SharedRange)?.[0] ?? DEFAULT_KEY);
}

/** The heading row every history section uses: its title on the left, the
 *  range picker on the right. Keeps the three views visually identical. */
export function HistoryHeader({ title, picker, step }: { title: string; picker: ReactNode; step: string }) {
  return (
    <div className="timeline-head">
      <label className="entity-label">{title}<ChartStep words={step} /></label>
      {picker}
    </div>
  );
}

/** The step and aggregation beside a chart's title ("· daily avg", chartUtils.aggregationWords): the same look in a
 *  device panel's header and the Weather and Energy windows' chart heads (owner, 2026-10-20). */
export function ChartStep({ words }: { words: string }) {
  return <span className="chart-step"> · {words}</span>;
}
