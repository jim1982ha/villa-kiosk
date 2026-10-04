// src/components/cockpit/CockpitModal.tsx
// The villa's whole-house status report — a graceful, non-technical "how is
// everything" glance, reachable from the same alert icon that used to open a
// bare Unavailable-devices list directly (see HUD.tsx/FacilityModal.tsx —
// repointed, not a new button). That list isn't gone: Needs Attention below
// already lists every unavailable device individually (nothing is capped),
// so there is no separate drill-down any more — one that only ever showed
// the exact same rows already on screen was pure ceremony.
//
// Every section here is read-only reporting on its own face — the one
// exception is the room/floor pivot below, whose rows drill into
// SummaryGroupPanel (the same device-list-with-inline-controls modal every
// other "all the devices in X" view in the app already opens), rather than
// only being able to jump to one device's own panel. Everything here routes
// through selectableDeviceIds/entityMap/resolvedRooms, never a raw HA domain
// query (see cockpitData.ts's own docstring for why that matters concretely,
// not just in principle). See the villa-kiosk memory's Cockpit plan for the
// full design history and what was deliberately left out (Zigbee/Z-Wave
// radio health, HA's own Area registry for grouping, presence tracking) and
// why.

import { useMemo } from "react";
import { Bot, LayoutDashboard } from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";
import type { Doors } from "@/auth/doors";
import { useAgent } from "@/agent/AgentContext";
import { awaitingAnswer } from "@/agent/agentView";
import { formatCountBadge } from "@/utils/countBadge";
import ModalFooter from "@/components/common/ModalFooter";
import ModalTabs, { type ModalTab } from "@/components/common/ModalTabs";
import FacilitySections, { FACILITY_TABS, type FacilityTab } from "@/components/fm/FacilitySections";
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
   *  `doors.facility`). Held by the caller, so "report a fault" lands on
   *  Faults and Back from a device returns to the tab it left. */
  tab: CockpitTab;
  onTab: (tab: CockpitTab) => void;
  /** Faults opens with a blank fault pointed at this device (a device panel's
   *  "report a fault"), and the request is dropped once the form has it. */
  reportFaultFor?: string;
  onFaultFormOpened?: () => void;
}

/** The Cockpit's own view, then the Facility tabs (2.496.273: the Facility
 *  window merged in — one top-bar button, one window, the same workflows). */
export type CockpitTab = "overview" | FacilityTab;
const OVERVIEW_TAB: ModalTab<CockpitTab> = { id: "overview", label: "Overview", icon: LayoutDashboard };

export default function CockpitModal({
  onClose, onOpenEntity, doors, onOpenAgent, tab, onTab, reportFaultFor, onFaultFormOpened,
}: CockpitModalProps) {
  // A profile without the Facility door sees the Cockpit's view alone, no strip.
  const tabs: ModalTab<CockpitTab>[] = doors.facility ? [OVERVIEW_TAB, ...FACILITY_TABS] : [OVERVIEW_TAB];
  const shownTab: CockpitTab = doors.facility ? tab : "overview";
  // The agent's presence and what waits for this profile's answer, for the
  // footer button's label — read here, as the top bar reads them for its dot
  // (agentView.awaitingAnswer), instead of being handed across (2.496.268).
  const { status: agentStatus, messages: agentMessages } = useAgent();
  const agentOnline = agentStatus?.state === "online";
  const agentWaiting = useMemo(() => awaitingAnswer(agentMessages), [agentMessages]);
  const dialogRef = useModalA11y(onClose);

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
        </div>
        {tabs.length > 1 && <ModalTabs tabs={tabs} active={shownTab} onSelect={onTab} label="Cockpit sections" />}

        <div className="modal-body">
          {shownTab !== "overview" ? (
            <FacilitySections tab={shownTab} onOpenEntity={onOpenEntity} reportFaultFor={reportFaultFor}
              onFaultFormOpened={onFaultFormOpened} onOpenOverview={() => onTab("overview")} />
          ) : (
            <CockpitOverview onOpenEntity={onOpenEntity} doors={doors} />
          )}
        </div>

        {/* The VESTA Agent's door on the left when there is an agent — placed
            the way Settings places "Advanced Settings": a ghost button that
            leaves the dialog, never beside Close. */}
        <ModalFooter onClose={onClose}
          note={shownTab !== "overview" ? "Maintenance intervals are set in the Schedule tab" : undefined}
          leading={shownTab === "overview" && doors.agent ? (
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
