// src/utils/chartHover.ts
// A chart's hover, both ends: where the pointer is across the plot (in), and
// where the tooltip goes on screen (out). Every chart in the app — the device
// panels' sparklines, the state timelines, the Weather and Energy charts —
// goes through these two rules.
//
// ⚠️ SIX COPIES OF "IN", SIX CONVENTIONS OF "OUT" (2.496.117). The pointer was
// read into px, viewBox units, a percentage or a bucket index at each chart,
// half of them without a zero-width guard; the tooltip was placed in px at
// some, a percentage at others, viewBox units passed as px at two, and flipped
// by four different rules (past half the SVG, past half the buckets, from a
// bar's left edge, past a hard-coded 160 px). A chart now says only WHERE, as
// a fraction across its plot; the tip decides its side and stays on screen.
// Pure; tests/oracles/chart_hover.mjs.

/** How far across a box a pointer is, 0–1 (clamped; a box of no size is 0). */
export function pointerFraction(client: number, start: number, size: number): number {
  if (!(size > 0)) return 0;
  return Math.min(1, Math.max(0, (client - start) / size));
}

/** The viewport margin a tooltip keeps, px. */
export const TIP_EDGE = 8;

/**
 * Where a tooltip goes, in viewport px. It hangs from its anchor — to the
 * right, or to the LEFT when the anchor is past the middle of its chart
 * (`flip`) — below it, or above it when there is no room below; and it is
 * then kept `TIP_EDGE` inside the viewport whatever it measures.
 */
export function placeTip(
  anchor: { x: number; y: number }, tip: { w: number; h: number },
  viewport: { w: number; h: number }, flip: boolean,
): { x: number; y: number } {
  let x = flip ? anchor.x - tip.w : anchor.x;
  let y = anchor.y + tip.h > viewport.h - TIP_EDGE ? anchor.y - tip.h : anchor.y;
  // The near edge wins last: a tip larger than the viewport keeps its START
  // on screen (its first rows, the ones that name what is hovered).
  x = Math.max(TIP_EDGE, Math.min(x, viewport.w - tip.w - TIP_EDGE));
  y = Math.max(TIP_EDGE, Math.min(y, viewport.h - tip.h - TIP_EDGE));
  return { x, y };
}

/** Whether a tip hangs to the left: its anchor is past the middle of the chart. */
export const tipFlips = (anchorX: number, chartLeft: number, chartWidth: number) =>
  anchorX > chartLeft + chartWidth / 2;
