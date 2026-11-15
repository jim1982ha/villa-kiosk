// src/components/panels/trendHue.tsx
// A device window's trend in its FAMILY's colour (owner, 2026-11-14: a power meter's "0 W" and its chart were the
// status table's usual colour beside its blue energy icon). The window (BasePanel) hands down the hue its own badge wears —
// the category's, or the colour picked for this badge — and the big value, its line chart (axis, line, fill, in the
// larger window too: a context reaches through the window's portal, a CSS variable would not) and its state band paint
// with it what they painted in the usual colour. Every other meaning keeps its colour, a lost stretch grey.
// No family hue (Others, a window of several devices): today's colours.

import { createContext, useContext, type ReactNode } from "react";
import { STATUS_COLOR } from "@/utils/stateColors";

export const TrendHue = createContext<string | null>(null);

/** `c`, or the window's family hue where `c` is the usual colour. */
export function useTrendColor(): (c: string) => string {
  const hue = useContext(TrendHue);
  return (c) => (hue && c === STATUS_COLOR.usual ? hue : c);
}

/** A reading printed in its colour, the family's where that is the usual colour. A component, so it reads the
 *  window's hue from INSIDE the window (a panel's own body is rendered within BasePanel's provider). */
export function TrendText({ color, className, children }: { color: string; className?: string; children: ReactNode }) {
  const trend = useTrendColor();
  return <span className={className} style={{ color: trend(color) }}>{children}</span>;
}
