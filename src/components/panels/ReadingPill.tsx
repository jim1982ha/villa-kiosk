// src/components/panels/ReadingPill.tsx
// A reading drawn as a pill (an on/off sensor, or anything offline): the
// warning icon for an alarm, the sensor's own icon otherwise, then its words.
// One figure for the sensor window and the grouped device window — the group's
// copy had lost the icon (architecture review 11, 2026-10-09).

import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import type { Reading } from "@/config/reading";

export default function ReadingPill({ r, icon: Icon, size, style }: {
  r: Reading;
  icon: LucideIcon;
  size: number;
  style?: CSSProperties;
}) {
  return (
    <span className={`status-pill ${r.pill}`} style={style}>
      {r.alarm ? <AlertTriangle size={size} /> : <Icon size={size} />}
      {r.value}
    </span>
  );
}
