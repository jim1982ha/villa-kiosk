// src/components/cockpit/CockpitModal.tsx
// The villa's whole-house status report — a graceful, non-technical "how is
// everything" glance, reachable from the same alert icon that used to open a
// bare Unavailable-devices list directly (see HUD.tsx/FacilityModal.tsx —
// repointed, not a new button). That list isn't gone: Needs Attention below
// already lists every unavailable device individually (nothing is capped),
// so there is no separate drill-down any more — one that only ever showed
// the exact same rows already on screen was pure ceremony.
//
// Every section here is read-only reporting on its own face; a device opens its own window (onOpenEntity).

import { useMemo } from "react";
import { Bot, LayoutDashboard, RefreshCw } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useModalA11y } from "@/hooks/useModalA11y";
import type { Doors } from "@/auth/doors";
import { useAgent } from "@/agent/AgentContext";
import { awaitingAnswer } from "@/agent/agentView";
import { formatCountBadge } from "@/utils/countBadge";
import ModalFooter from "@/components/common/ModalFooter";
import ModalTabs, { type ModalTab } from "@/components/common/ModalTabs";
import FacilitySections, { FACILITY_TABS, type FacilityTab } from "@/components/fm/FacilitySections";
import { useFacilityLiveView } from "@/fm/FmDataContext";
import CockpitOverview from "./CockpitOverview";

export interface CockpitModalProps {
  onClose: () => void;
  onOpenEntity: (entityId: string) => void;
  /** Which windows this profile may open (auth/doors): the footer's "VESTA
   *  Agent" is drawn only with `doors.agent`, the updates count only with
   *  `doors.updates`. */
  doors: Doors;
  /** Open the VESTA Agent window. */
  onOpenAgent: () => void;
  /** The open tab: the Cockpit's own view, or one of the Facility tabs (with
   *  `doors.facility`). Held by the caller, so "Edit ticket" lands on
   *  Tickets and Back from a device returns to the tab it left. */
  tab: CockpitTab;
  onTab: (tab: CockpitTab) => void;
  /** The Overview opens "Raise a fault" pointed at this device (a device
   *  panel's wrench); the request is dropped once the form has it. */
  reportFaultFor?: string;
  onFaultFormOpened?: () => void;
  /** The Tickets tab opens this record's form (an Overview card's "Edit ticket"). */
  editTicket?: string;
  onEditTicket: (ticketId: string) => void;
  onTicketEditOpened?: () => void;
  /** A guest's "Report a problem" (the Overview). */
  onReportProblem: () => void;
}

/** The Cockpit's own view, then the Facility tabs (2.496.273: the Facility
 *  window merged in — one top-bar button, one window, the same workflows). */
export type CockpitTab = "overview" | FacilityTab;
const OVERVIEW_TAB: ModalTab<CockpitTab> = { id: "overview", label: "Overview", icon: LayoutDashboard };

export default function CockpitModal({
  onClose, onOpenEntity, doors, onOpenAgent, tab, onTab, reportFaultFor, onFaultFormOpened,
  editTicket, onEditTicket, onTicketEditOpened, onReportProblem,
}: CockpitModalProps) {
  // A profile without the Facility door sees the Cockpit's view alone, no strip.
  const tabs: ModalTab<CockpitTab>[] = doors.facility ? [OVERVIEW_TAB, ...FACILITY_TABS] : [OVERVIEW_TAB];
  const shownTab: CockpitTab = doors.facility ? tab : "overview";
  // The maintenance record is watched live WHILE THIS WINDOW IS OPEN, whichever tab shows (useFacilityLiveView: every
  // STORE_ACTIVE_MS instead of the heartbeat). ⚠️ ONE REGISTRATION, THE WINDOW'S (architecture review, 2026-10-19):
  // it was the Facility tabs' alone, so the Overview's "Open issues" — the list the (i) promised was "read again every
  // 15 seconds while it is open" — was read every three minutes until someone opened Tickets.
  useFacilityLiveView();
  // The agent's presence and what waits for this profile's answer, for the
  // footer button's label — read here, as the top bar reads them for its dot
  // (agentView.awaitingAnswer), instead of being handed across (2.496.268).
  const { status: agentStatus, messages: agentMessages } = useAgent();
  const agentOnline = agentStatus?.state === "online";
  const agentWaiting = useMemo(() => awaitingAnswer(agentMessages), [agentMessages]);
  const dialogRef = useModalA11y(onClose);
  // Firmware / add-on updates waiting — Home Assistant's own `update` domain counts them, per device and per add-on.
  const { entities } = useHA();
  const updatesAvailable = useMemo(() => (doors.updates
    ? Object.values(entities).filter((e) => e.entity_id.startsWith("update.") && e.state === "on").length : 0),
  [entities, doors.updates]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal settings-modal cockpit-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Villa Cockpit"
      >
        <div className="modal-header">
          <h2>Cockpit</h2>
          {/* Updates Home Assistant has waiting (firmware, add-ons — this one included): in the header, drawn like
              Advanced Settings' header buttons, for the profiles holding `doors.updates` (owner, 2026-10-14). It only
              SAYS so — nothing to press; it used to be a line at the bottom of the Overview. */}
          {updatesAvailable > 0 && (
            <span className="icon-btn header-icon-btn header-icon-badge" role="status"
              title={`${updatesAvailable} update${updatesAvailable === 1 ? "" : "s"} available`}
              aria-label={`${updatesAvailable} update${updatesAvailable === 1 ? "" : "s"} available`}>
              <RefreshCw size={18} />
              <span className="icon-btn-count" aria-hidden="true">{formatCountBadge(updatesAvailable)}</span>
            </span>
          )}
        </div>
        {tabs.length > 1 && <ModalTabs tabs={tabs} active={shownTab} onSelect={onTab} label="Cockpit sections" />}

        <div className="modal-body">
          {shownTab !== "overview" ? (
            <FacilitySections tab={shownTab} onOpenEntity={onOpenEntity} editTicket={editTicket}
              onTicketEditOpened={onTicketEditOpened} />
          ) : (
            <CockpitOverview onOpenEntity={onOpenEntity} doors={doors} reportFaultFor={reportFaultFor}
              onFaultFormOpened={onFaultFormOpened} onEditTicket={onEditTicket} onReportProblem={onReportProblem} />
          )}
        </div>

        {/* The VESTA Agent's door on the left when there is an agent — placed
            the way Settings places "Advanced Settings": a ghost button that
            leaves the dialog, never beside Close. */}
        {/* ONE footer on every tab (owner, 2026-10-14): the VESTA Agent's door, then Close — no tab of its own note */}
        <ModalFooter onClose={onClose}
          leading={doors.agent ? (
          <button className="btn ghost" onClick={() => { onClose(); onOpenAgent(); }}
            title={`VESTA Agent — ${agentOnline ? "online" : "offline"}`
              + (agentWaiting > 0 ? `, ${agentWaiting} message${agentWaiting === 1 ? "" : "s"} to answer` : "")}>
            <Bot size={18} /> VESTA Agent{agentWaiting > 0 ? ` (${formatCountBadge(agentWaiting)})` : ""}
          </button>
        ) : undefined} />
      </div>
    </div>
  );
}
