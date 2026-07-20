// src/components/panels/chartUtils.ts
// Shared formatters + hit-testing for the panel mini charts (Sparkline,
// DualSparkline). Kept DRY so both charts label axes and resolve the hovered
// datapoint the same way.

export function fmtChartValue(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

export function fmtChartTime(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Index of the point whose x is closest to the given plot-space x. */
export function nearestIndexByX(pts: { x: number }[], x: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.abs(pts[i].x - x);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
