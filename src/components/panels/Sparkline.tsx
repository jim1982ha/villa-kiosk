// src/components/panels/Sparkline.tsx
// Minimal dependency-free SVG sparkline.

import type { HistoryPoint } from "@/types/ha.types";

interface Props {
  data: HistoryPoint[];
  color?: string;
  height?: number;
}

export default function Sparkline({ data, color = "var(--accent-teal)", height = 60 }: Props) {
  if (data.length < 2) return <div className="muted body-text">Not enough history yet.</div>;

  const W = 320;
  const H = height;
  const xs = data.map((d) => d.t);
  const ys = data.map((d) => d.v);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const points = data
    .map((d) => {
      const x = ((d.t - minX) / spanX) * W;
      const y = H - ((d.v - minY) / spanY) * (H - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}
