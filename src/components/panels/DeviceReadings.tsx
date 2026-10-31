// src/components/panels/DeviceReadings.tsx
// "Also on this device" — the same list under every device panel (BasePanel's
// frame and the camera's own), from the panel actions (Dashboard supplies the
// rows: config/deviceGroups.deviceReadings).
//
// THE FIRST FEW, THEN THE REST (2.496.271): listing every reading of a busy
// plug (power, energy, current, voltage, power factor, apparent power…) would
// push the device's own controls off a phone's screen. The rows arrive in
// order of usefulness (the device's main entity, then power, energy,
// temperature), so the first three are the ones worth a glance; the rest pages
// by ten with a way back, as every such list (common/TruncatedList).

import { ChevronRight } from "lucide-react";
import { usePanelActions } from "./PanelActionsContext";
import { ShowAll, useTruncated } from "@/components/common/TruncatedList";

export default function DeviceReadings() {
  const { readings, onOpenReading } = usePanelActions();
  // ⚠️ ANOTHER DEVICE STARTS AT THE FIRST FEW: its own "Show all" survived a switch to the next camera or reading
  const list = useTruncated(readings ?? [], undefined, (readings ?? []).map((r) => r.id).join());
  if (!readings || readings.length === 0) return null;
  return (
    <div className="panel-readings">
      <div className="panel-readings-title">Also on this device</div>
      {list.visible.map((r) => (
        <button key={r.id} type="button" className="panel-reading-row"
          onClick={onOpenReading ? () => onOpenReading(r.id) : undefined} disabled={!onOpenReading}>
          <span className="panel-reading-label" title={r.label}>{r.label}</span>
          <span className={`panel-reading-value${r.tone ? ` ${r.tone}` : ""}`}>{r.text}</span>
          {onOpenReading && <ChevronRight size={16} aria-hidden />}
        </button>
      ))}
      <ShowAll list={list} noun="reading" />
    </div>
  );
}
