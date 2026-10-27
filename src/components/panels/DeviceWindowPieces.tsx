// src/components/panels/DeviceWindowPieces.tsx
// WHAT EVERY DEVICE WINDOW SHOWS BESIDES ITS OWN CONTENT — its warning sign, Edit, the fault wrench, "Also on this
// device" (DeviceReadings) — defined once, from the open panel's actions (PanelActionsContext), and drawn by both
// frames: the card window (BasePanel) and the camera's full screen (CameraPanel). Each frame chooses WHERE a piece
// sits and its look (`className`); whether it shows, what it says and what a tap does are decided here.
//
// ⚠️ THE CAMERA WINDOW PICKED THESE BY HAND (architecture review P, 2026-10-27): it read four of the actions and drew
// none of these, so an offline camera listed in the Cockpit had no warning sign, no Edit and no wrench in its window,
// and its readings were nowhere — each piece added to BasePanel had to be copied into it, and the last few were not.

import { Pencil, TriangleAlert, Wrench } from "lucide-react";
import { usePanelActions } from "./PanelActionsContext";
import { useDeviceIssue } from "@/components/cockpit/useVillaAttention";
import type { AttentionSeverity } from "@/config/attention";

/** The device's warning while the Cockpit's Overview lists an issue for it or its linked entity (useDeviceIssue: a
 *  fault, an offline device, an alarm, late maintenance): what a tap opens and the issue's colour; null otherwise. */
export function useDeviceWarning(): { open: () => void; severity: AttentionSeverity } | null {
  const { faults } = usePanelActions();
  // the Overview's own list, live: the warning appears with the device's first issue and goes with its last
  const issue = useDeviceIssue(faults?.ids ?? []);
  return faults && issue ? { open: faults.open, severity: issue } : null;
}

/** The device window's warning (header, top right, owner 2026-10-24): the Cockpit's own sign in the colour of the
 *  most serious issue its Overview lists for the device (attention severity: .cockpit-attention-danger red, -warn
 *  amber, -lost grey, as the Overview's cards). Pure: a check draws it. */
export function FaultsButton({ onOpen, severity, className = "btn ghost icon-only" }: {
  onOpen: () => void; severity: AttentionSeverity; className?: string;
}) {
  return (
    <button type="button" className={`${className} panel-faults-btn cockpit-attention-${severity}`} onClick={onOpen}
      title="Open this device's issues in the Cockpit" aria-label="Open this device's issues in the Cockpit">
      <TriangleAlert size={18} aria-hidden="true" />
    </button>
  );
}

/** Edit: this device's row in Advanced Settings, for a profile that may edit devices. The card window words it; the
 *  camera's chrome, all icons, draws the pencil (`icon`). */
export function EditButton({ className = "btn ghost", icon = false }: { className?: string; icon?: boolean }) {
  const { may, onEdit } = usePanelActions();
  if (!may.edit) return null;
  return icon
    ? <button type="button" className={className} onClick={onEdit} title="Edit this device" aria-label="Edit this device">
        <Pencil size={16} aria-hidden="true" /></button>
    : <button type="button" className={className} onClick={onEdit}>Edit</button>;
}

/** The wrench: report a fault for this device. Icon-only beside Edit: a shortcut for a device already looked at, not a
 *  primary action (the title and label carry the meaning). */
export function ReportFaultButton({ className = "btn ghost icon-only" }: { className?: string }) {
  const { may, onReportFault } = usePanelActions();
  if (!may.reportFault) return null;
  return (
    <button type="button" className={className} onClick={onReportFault}
      title="Report a fault for this device" aria-label="Report a fault for this device">
      <Wrench size={16} aria-hidden="true" />
    </button>
  );
}
