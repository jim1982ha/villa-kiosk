// src/components/panels/ReadingPill.tsx
// A reading drawn as a pill (an on/off sensor, or anything offline): the
// warning icon for an alarm, the sensor's own icon otherwise, then its words.
// One figure for the sensor window and the grouped device window — the group's
// copy had lost the icon (architecture review 11, 2026-10-09).

import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { lostPillTone, type Reading } from "@/config/reading";
import { usePanelActions } from "./PanelActionsContext";

export default function ReadingPill({ r, icon: Icon, size, style }: {
  r: Reading;
  icon: LucideIcon;
  size: number;
  style?: CSSProperties;
}) {
  // a critical device that lost contact: the red of the Cockpit, not the amber (the open window's header decides)
  const critical = usePanelActions().badge?.critical ?? false;
  return (
    <span className={`status-pill ${lostPillTone(r.pill ?? "", critical)}`} style={style}>
      {r.alarm ? <AlertTriangle size={size} /> : <Icon size={size} />}
      {r.value}
    </span>
  );
}
