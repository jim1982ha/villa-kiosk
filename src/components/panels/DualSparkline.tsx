// src/components/panels/DualSparkline.tsx
// Two history series sharing one 24h time axis, each on its OWN y-axis scale
// (e.g. temperature °C left, humidity % right) — for a physical sensor that
// reports as two separate HA entities (see config/deviceGroups.ts + DeviceGroupPanel).

import type { HistoryPoint } from "@/types/ha.types";

interface Series {
  data: HistoryPoint[];
  color: string;
}

interface Props {
  a: Series;
  b: Series;
  height?: number;
}

export default function DualSparkline({ a, b, height = 70 }: Props) {
  if (a.data.length < 2 && b.data.length < 2) {
    return <div className="muted body-text">Not enough history yet.</div>;
  }

  const W = 320;
  const H = height;
  const allT = [...a.data, ...b.data].map((d) => d.t);
  const minX = Math.min(...allT);
  const maxX = Math.max(...allT);
  const spanX = maxX - minX || 1;

  const yScaleOf = (data: HistoryPoint[]) => {
    const ys = data.map((d) => d.v);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanY = maxY - minY || 1;
    return (v: number) => H - ((v - minY) / spanY) * (H - 8) - 4;
  };

  const toPoints = (data: HistoryPoint[]) => {
    const y = yScaleOf(data);
    return data
      .map((d) => `${(((d.t - minX) / spanX) * W).toFixed(1)},${y(d.v).toFixed(1)}`)
      .join(" ");
  };

  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {a.data.length >= 2 && (
        <polyline points={toPoints(a.data)} fill="none" stroke={a.color} strokeWidth={2} strokeLinejoin="round" />
      )}
      {b.data.length >= 2 && (
        <polyline
          points={toPoints(b.data)} fill="none" stroke={b.color} strokeWidth={2}
          strokeLinejoin="round" strokeDasharray="4 3"
        />
      )}
    </svg>
  );
}
