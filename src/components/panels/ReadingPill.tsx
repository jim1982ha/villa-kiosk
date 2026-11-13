// src/components/panels/ReadingPill.tsx
// A reading drawn as a pill (an on/off sensor, or anything offline): the
// warning icon for an alarm, the sensor's own icon otherwise, then its words.
// One figure for the sensor window and the grouped device window — the group's
// copy had lost the icon (architecture review 11, 2026-10-09). The pill itself is the windows' one (StatusPill).

import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { lostPillTone, type Reading } from "@/config/reading";
import { usePanelActions } from "./PanelActionsContext";
import StatusPill from "./StatusPill";

export default function ReadingPill({ r, icon, inline }: {
  r: Reading;
  icon: LucideIcon;
  /** One of a line of readings (a group's members): the pill alone, its line is the group's. */
  inline?: boolean;
}) {
  // a critical device that lost contact: the red of the Cockpit, not the amber (the open window's header decides)
  const critical = usePanelActions().badge?.critical ?? false;
  return (
    <StatusPill tone={lostPillTone(r.pill ?? "", critical)} icon={r.alarm ? AlertTriangle : icon} inline={inline}>
      {r.value}
    </StatusPill>
  );
}
