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

import Window from "@/components/common/Window";
import { useMemo } from "react";
import { LayoutDashboard, RefreshCw } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import type { Doors } from "@/auth/doors";
import { updatesTip, updatesWaiting } from "@/config/updatesWaiting";
import { formatCountBadge } from "@/utils/countBadge";
import ModalFooter from "@/components/common/ModalFooter";
import ModalTabs, { type ModalTab } from "@/components/common/ModalTabs";
import FacilitySections, { FACILITY_TABS, type FacilityTab } from "@/components/fm/FacilitySections";
import { useFacilityLiveView, useFmData } from "@/fm/FmDataContext";
import { fmRecordLine, heldLine } from "@/fm/fmSave";
import CockpitOverview from "./CockpitOverview";
import Tip from "@/components/common/Tip";
import { countOf } from "@/utils/countOf";

export interface CockpitModalProps {
  onClose: () => void;
  onOpenEntity: (entityId: string) => void;
  /** What this profile may see and do (auth/doors): the updates count only with `doors.updates`. */
  doors: Doors;
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
  /** The devices whose open faults the Overview marks and scrolls to (a device window's warning). */
  focusFaults?: readonly string[];
}

/** The Cockpit's own view, then the Facility tabs (2.496.273: the Facility
 *  window merged in — one top-bar button, one window, the same workflows). */
export type CockpitTab = "overview" | FacilityTab;
const OVERVIEW_TAB: ModalTab<CockpitTab> = { id: "overview", label: "Overview", icon: LayoutDashboard };

export default function CockpitModal({
  onClose, onOpenEntity, doors, tab, onTab, reportFaultFor, onFaultFormOpened,
  editTicket, onEditTicket, onTicketEditOpened, onReportProblem, focusFaults,
}: CockpitModalProps) {
  // A profile without the Facility door sees the Cockpit's view alone, no strip.
  const tabs: ModalTab<CockpitTab>[] = doors.facility ? [OVERVIEW_TAB, ...FACILITY_TABS] : [OVERVIEW_TAB];
  const shownTab: CockpitTab = doors.facility ? tab : "overview";
  // The maintenance record is watched live WHILE THIS WINDOW IS OPEN, whichever tab shows (useFacilityLiveView: every
  // STORE_ACTIVE_MS instead of the heartbeat). ⚠️ ONE REGISTRATION, THE WINDOW'S (architecture review, 2026-10-19):
  // it was the Facility tabs' alone, so the Overview's "Open issues" — the list the (i) promised was "read again every
  // 15 seconds while it is open" — was read every three minutes until someone opened Tickets.
  useFacilityLiveView();
  // ⚠️ THE RECORD'S STATE IS SAID OVER EVERY TAB, THE OVERVIEW'S TOO (architecture review H, 2026-10-23): unread, its
  // faults are missing from "Open issues" as much as from Tickets; and a save's problem ("This fault was just changed on
  // another device") follows a button pressed on an Overview card. They were the Facility tabs' alone.
  const { ready, unreachable, saveError, heldFor } = useFmData();
  const held = heldLine(heldFor);
  const recordLine = fmRecordLine({ ready, unreachable });
  // Firmware / add-on updates waiting — Home Assistant's own `update` domain counts them, per device and per add-on.
  const { entities, hiddenInHaEntityIds } = useHA();
  // ...and WHICH, said on hover (owner, 2026-10-20) — still nothing to press (config/updatesWaiting).
  const updates = useMemo(() => (doors.updates ? updatesWaiting(entities, hiddenInHaEntityIds) : []),
    [entities, hiddenInHaEntityIds, doors.updates]);
  const updatesAvailable = updates.length;

  return (
    <Window kind="content" label="Villa Cockpit" onClose={onClose} className="settings-modal cockpit-modal">
      <div className="modal-header">
        <h2>Cockpit</h2>
        {/* Updates Home Assistant has waiting (firmware, add-ons — this one included): in the header, drawn like
            Advanced Settings' header buttons, for the profiles holding `doors.updates` (owner, 2026-10-14). It only
            SAYS so — nothing to press; it used to be a line at the bottom of the Overview. */}
        {updatesAvailable > 0 && (
          <Tip text={updatesTip(updates)}>
            <span className="icon-btn header-icon-btn header-icon-badge" role="status"
              aria-label={`${countOf(updatesAvailable, "update")} available`}>
              <RefreshCw size={18} />
              <span className="icon-btn-count" aria-hidden="true">{formatCountBadge(updatesAvailable)}</span>
            </span>
          </Tip>
        )}
      </div>
      {tabs.length > 1 && <ModalTabs tabs={tabs} active={shownTab} onSelect={onTab} label="Cockpit sections" />}

      <div className="modal-body">
        {saveError && <div className="fm-banner warn">{saveError}</div>}
        {recordLine && <p className="muted body-text">{recordLine}</p>}
        {held && <p className="muted body-text">{held}</p>}
        {shownTab !== "overview" ? (
          <FacilitySections tab={shownTab} onOpenEntity={onOpenEntity} editTicket={editTicket}
            onTicketEditOpened={onTicketEditOpened} />
        ) : (
          <CockpitOverview onOpenEntity={onOpenEntity} doors={doors} reportFaultFor={reportFaultFor}
            onFaultFormOpened={onFaultFormOpened} onEditTicket={onEditTicket} onReportProblem={onReportProblem}
            focusFaults={focusFaults} />
        )}
      </div>

      <ModalFooter onClose={onClose} />
    </Window>
  );
}
