// src/components/panels/DeviceReadings.tsx
// "Also on this device" — the same list under every device panel (BasePanel's
// frame and the camera's own), from the panel actions (Dashboard supplies the
// rows: config/deviceGroups.deviceReadings).
//
// THE FIRST FEW, THEN "SHOW ALL" (2.496.271): listing every reading of a busy
// plug (power, energy, current, voltage, power factor, apparent power…) would
// push the device's own controls off a phone's screen. The rows arrive in
// order of usefulness (the device's main entity, then power, energy,
// temperature), so the first three are the ones worth a glance.

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { usePanelActions } from "./PanelActionsContext";

/** Rows shown before "Show all". */
export const READINGS_SHOWN = 3;

export default function DeviceReadings() {
  const { readings, onOpenReading } = usePanelActions();
  const [all, setAll] = useState(false);
  if (!readings || readings.length === 0) return null;
  const rows = all ? readings : readings.slice(0, READINGS_SHOWN);
  const more = readings.length - rows.length;
  return (
    <div className="panel-readings">
      <div className="panel-readings-title">Also on this device</div>
      {rows.map((r) => (
        <button key={r.id} type="button" className="panel-reading-row"
          onClick={onOpenReading ? () => onOpenReading(r.id) : undefined} disabled={!onOpenReading}>
          <span className="panel-reading-label" title={r.label}>{r.label}</span>
          <span className={`panel-reading-value${r.tone ? ` ${r.tone}` : ""}`}>{r.text}</span>
          {onOpenReading && <ChevronRight size={16} aria-hidden />}
        </button>
      ))}
      {more > 0 && (
        <button type="button" className="panel-readings-more" onClick={() => setAll(true)}>
          Show all ({readings.length})
        </button>
      )}
    </div>
  );
}
