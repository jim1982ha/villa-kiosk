// src/components/panels/ReadingPill.tsx
// A reading drawn as a pill (an on/off sensor, or anything offline): the
// warning icon for an alarm, the sensor's own icon otherwise, then its words.
// One figure for the sensor window and the grouped device window — the group's
// copy had lost the icon (architecture review 11, 2026-10-09). The pill itself is the windows' one (StatusPill).

import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import type { Reading } from "@/config/reading";
import StatusPill from "./StatusPill";

export default function ReadingPill({ r, icon, inline }: {
  r: Reading;
  icon: LucideIcon;
  /** One of a line of readings (a group's members): the pill alone, its line is the group's. */
  inline?: boolean;
}) {
  // only painted: its meaning, a critical device's red included, is the reading's (config/reading.readingOf, its device's rule applied)
  return (
    <StatusPill tone={r.pill ?? ""} icon={r.alarm ? AlertTriangle : icon} inline={inline}>
      {r.value}
    </StatusPill>
  );
}
