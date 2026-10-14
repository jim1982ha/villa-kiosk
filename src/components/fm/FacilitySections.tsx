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

import { useMemo, useState } from "react";
import type { ModalTab } from "@/components/common/ModalTabs";
import {
  Wrench, Wallet, FileText, CalendarCog,
} from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { roleCan } from "@/auth/permissions";
import { useFmData, useFacilityLiveView } from "@/fm/FmDataContext";
import { buildReadiness, type ReadinessCheck } from "@/fm/readiness";
import { locksGroup, lightsGroup } from "@/config/summaryGroups";
import { lockFacts, lightFacts } from "@/config/villaSummary";
import SummaryGroupPanel, { type SummaryGroup } from "@/components/panels/SummaryGroupPanel";
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
 * while a Facility tab is open, so the maintenance record is watched live only
 * then (useFacilityLiveView).
 */
export default function FacilitySections({
  tab, onOpenEntity, editTicket, onTicketEditOpened, onOpenOverview,
}: {
  tab: FacilityTab;
  /** Jump to a device's panel — a failing check or a fault opens the actual
   *  device instead of leaving the operator to hunt for it. */
  onOpenEntity: (entityId: string) => void;
  /** Tickets opens this record's form (an Overview card's "Edit ticket"). */
  editTicket?: string;
  /** Called once the form has it, so reopening the tab later does not spring it again. */
  onTicketEditOpened?: () => void;
  /** Readiness's "devices offline" — the Cockpit's own view lists them (it
   *  used to open a SECOND Cockpit over the Facility window). */
  onOpenOverview: () => void;
}) {
  const { entities } = useHA();
  const { config, resolvedRooms } = useConfig();
  const { role } = useProfile();
  const { data, ready, saveError } = useFmData();
  useFacilityLiveView();
  const { devices } = useVillaModel();
  const totalDeviceCount = devices.ids.length;

  const [checkPanelGroup, setCheckPanelGroup] = useState<SummaryGroup | null>(null);
  const openCheckDevices = (check: ReadinessCheck) => {
    const group = check.id === "locks" ? locksGroup(lockFacts(entities, devices), entities, config.entityMap)
      : check.id === "lights" ? lightsGroup(lightFacts(entities, devices))
      : null;
    if (group) setCheckPanelGroup(group);
  };
  const readiness = useMemo(() => buildReadiness(entities, data, devices), [entities, data, devices]);
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
          <ReadinessTab readiness={readiness} onOpenEntity={onOpenEntity}
            onOpenUnavailableDevices={onOpenOverview} onOpenCheckDevices={openCheckDevices} />
          <div className="settings-section-title">Monthly recap</div>
          <RecapTab readiness={readiness}
            offlineDeviceCount={readiness.checks.find((c) => c.id === "devices-online")?.entityIds?.length ?? 0}
            totalDeviceCount={totalDeviceCount} />
        </>
      )}
      {ready && tab === "tickets" && (
        <TicketsTab onOpenEntity={onOpenEntity} deviceOptions={deviceOptions}
          editTicket={editTicket} onEditOpened={onTicketEditOpened} />
      )}
      {ready && tab === "spend" && <SpendTab onOpenEntity={onOpenEntity} deviceOptions={deviceOptions} />}

      {checkPanelGroup && (
        <SummaryGroupPanel group={checkPanelGroup} canControl={canControl}
          onClose={() => setCheckPanelGroup(null)}
          onOpenEntity={(id) => { setCheckPanelGroup(null); onOpenEntity(id); }} />
      )}
    </>
  );
}
