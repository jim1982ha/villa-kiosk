// src/components/panels/DeviceWindowPieces.tsx
// WHAT EVERY DEVICE WINDOW SHOWS BESIDES ITS OWN CONTENT — its warning sign, Edit, Open Ticket, "Also on this
// device" (DeviceReadings) — defined once, from the open panel's actions (PanelActionsContext), and drawn by both
// frames: the card window (BasePanel) and the camera's full screen (CameraPanel). Each frame chooses WHERE a piece
// sits and its look (`className`); whether it shows, what it says and what a tap does are decided here.
//
// ⚠️ THE CAMERA WINDOW PICKED THESE BY HAND (architecture review P, 2026-10-27): it read four of the actions and drew
// none of these, so an offline camera listed in the Cockpit had no warning sign, no Edit and no wrench in its window,
// and its readings were nowhere — each piece added to BasePanel had to be copied into it, and the last few were not.

import { Pencil, TriangleAlert } from "lucide-react";
import { WorkButton } from "@/components/fm/WorkButtons";
import Button from "@/components/common/Button";
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
export function FaultsButton({ onOpen, severity, on }: {
  onOpen: () => void; severity: AttentionSeverity;
  /** Over the camera's picture; a window's header button unless said. */
  on?: "photo";
}) {
  return (
    <Button on={on} icon={<TriangleAlert size={18} aria-hidden="true" />}
      label="Open this device's issues in the Cockpit"
      className={`panel-faults-btn cockpit-attention-${severity}`} onClick={onOpen} />
  );
}

/** Edit: this device's row in Advanced Settings, for a profile that may edit devices. The card window words it; the
 *  camera's chrome, all icons over its picture, draws the pencil (`on="photo"`). */
export function EditButton({ on }: { on?: "photo" }) {
  const { may, onEdit } = usePanelActions();
  if (!may.edit) return null;
  return on
    ? <Button on={on} icon={<Pencil size={16} aria-hidden="true" />} label="Edit this device" tip="Edit this device" onClick={onEdit} />
    : <Button onClick={onEdit}>Edit</Button>;
}

/** ⚠️ THE COCKPIT'S OPEN TICKET (owner, 2026-11-06: an icon-only wrench sat beside Edit, a second look for the act the
 *  Cockpit's cards call Open Ticket): the one WorkButton, the Cockpit's icon, words and look, opening "Open a ticket"
 *  pointed at this device, in every device window (the card window's footer, the camera's header). */
export function OpenTicketButton() {
  const { may, onReportFault } = usePanelActions();
  if (!may.reportFault) return null;
  return <WorkButton kind="raiseTicket" onClick={onReportFault} />;
}
