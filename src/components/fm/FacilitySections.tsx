// src/components/fm/FacilitySections.tsx
// The Facility Manager workspace — six tabs inside the Cockpit, after its own
// view, for any profile holding the `manageFacility` capability (facility
// manager and owner; see auth/permissions.ts for why both). It was a window
// of its own behind a top-bar button until 2.496.273.
//
// Tab order is the operator's own order of business, not a feature list:
//   Today      what needs doing right now (the maintenance board + open faults)
//   Readiness  is the villa fit for the next guest
//   Faults     the work queue
//   Spend      this month against the owner's monthly cap
//   Schedule   what the Today board measures against — configured, then acted on
//   Recap      the month's operations recap, the annex to whatever owner report already exists
//
// Fixed height (every .settings-modal, 04-modals.css) on desktop/tablet: this modal switches
// between views with wildly different content — Spend can be two rows,
// Faults a dozen — and letting the dialog resize around every tab switch was
// jarring. See that class's own comment in styles.css.

import { useVillaAttention } from "@/components/cockpit/useVillaAttention";
import { useMemo, useState } from "react";
import type { ModalTab } from "@/components/common/ModalTabs";
import {
  Wrench, Wallet, FileText, CalendarCog,
} from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { usePresence } from "@/config/usePresence";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { roleCan } from "@/auth/permissions";
import { useFmData } from "@/fm/FmDataContext";
import { buildReadiness, type CheckTarget } from "@/fm/readiness";
import SummaryGroupPanel from "@/components/panels/SummaryGroupPanel";
import { buildDeviceOptions } from "./DeviceSearchPicker";
import TodayTab from "./TodayTab";
import ReadinessTab from "./ReadinessTab";
import TicketsTab from "./TicketsTab";
import SpendTab from "./SpendTab";
import RecapTab from "./RecapTab";
import ScheduleEditor from "./ScheduleEditor";
import { useVillaModel } from "@/config/VillaModel";

export type FacilityTab = "tickets" | "schedule" | "recap" | "spend";

/** The Facility tabs, shown in the Cockpit after its own view (2.496.273). Owner, 2026-10-14: Tickets right after
 *  the Overview; "Today" and "Schedule" are one tab (today's board, then the schedule it measures against); "Readiness"
 *  and "Recap" are one tab (the live check, then the month's recap built from it). */
export const FACILITY_TABS: ModalTab<FacilityTab>[] = [
  { id: "tickets", label: "Tickets", icon: Wrench },
  { id: "schedule", label: "Schedule", icon: CalendarCog },
  { id: "recap", label: "Recap", icon: FileText },
  { id: "spend", label: "Spend", icon: Wallet },
];

/**
 * One Facility tab's content, inside the Cockpit (2.496.273: the Facility
 * window was merged into the Cockpit — owner, 2026-10-04: "remove 1 menu from
 * the top bar … show the same information in a single one"). Mounted only
 * while a Facility tab is open; the maintenance record is watched live by the
 * Cockpit window itself, whichever tab shows (useFacilityLiveView, registered by the window).
 */
export default function FacilitySections({
  tab, onOpenEntity, editTicket, onTicketEditOpened,
}: {
  tab: FacilityTab;
  /** Jump to a device's panel — a failing check or a fault opens the actual
   *  device instead of leaving the operator to hunt for it. */
  onOpenEntity: (entityId: string) => void;
  /** Tickets opens this record's form (an Overview card's "Edit ticket"). */
  editTicket?: string;
  /** Called once the form has it, so reopening the tab later does not spring it again. */
  onTicketEditOpened?: () => void;
}) {
  const { entities } = useHA();
  const { config, resolvedRooms } = useConfig();
  // the villa's presence in the Recap, as the tile under the floors says it (owner, 2026-10-18)
  const presenceLine = usePresence()?.recap ?? null;
  const { role } = useProfile();
  const { data, ready, saveError } = useFmData();
  const { devices } = useVillaModel();
  const totalDeviceCount = devices.ids.length;

  // The list a readiness check opens — its own devices (readiness.CheckTarget).
  const [checkList, setCheckList] = useState<CheckTarget | null>(null);
  // the villa's alarms as the Cockpit lists them (one rule: attention's), so readiness and the top bar agree
  const { attentionItems } = useVillaAttention();
  const readiness = useMemo(() => buildReadiness(entities, data, devices, config.entityMap, attentionItems),
    [entities, data, devices, config.entityMap, attentionItems]);
  const deviceOptions = useMemo(
    () => buildDeviceOptions(devices, config.entityMap, entities, resolvedRooms),
    [devices, config.entityMap, entities, resolvedRooms],
  );
  const canControl = roleCan(role, "controlEntities");

  return (
    <>
      {saveError && <div className="fm-banner warn">{saveError}</div>}
      {!ready && <p className="muted body-text">Loading the maintenance record…</p>}
      {ready && tab === "schedule" && (
        <>
          <TodayTab onOpenEntity={onOpenEntity} />
          <div className="settings-section-title">Maintenance schedule</div>
          <ScheduleEditor />
        </>
      )}
      {ready && tab === "recap" && (
        <>
          <ReadinessTab readiness={readiness} onOpenEntity={onOpenEntity} onOpenCheck={setCheckList} />
          {presenceLine && <p className="body-text recap-presence">{presenceLine}</p>}
          <div className="settings-section-title">Monthly recap</div>
          <RecapTab readiness={readiness} offlineDeviceCount={devices.unavailable.length}
            totalDeviceCount={totalDeviceCount} />
        </>
      )}
      {ready && tab === "tickets" && (
        <TicketsTab onOpenEntity={onOpenEntity} deviceOptions={deviceOptions}
          editTicket={editTicket} onEditOpened={onTicketEditOpened} />
      )}
      {ready && tab === "spend" && <SpendTab onOpenEntity={onOpenEntity} deviceOptions={deviceOptions} />}

      {checkList && (
        // A health list keeps every device it names (hidden and diagnostic ones too) and offers no "turn all".
        <SummaryGroupPanel group={checkList.group} canControl={canControl}
          hideBulkToggle={checkList.health} filterSuppressed={!checkList.health}
          onClose={() => setCheckList(null)}
          onOpenEntity={(id) => { setCheckList(null); onOpenEntity(id); }} />
      )}
    </>
  );
}
