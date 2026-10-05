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
  ClipboardCheck, ListChecks, Wrench, Wallet, FileText, CalendarCog,
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
import FaultsTab from "./FaultsTab";
import SpendTab from "./SpendTab";
import RecapTab from "./RecapTab";
import ScheduleEditor from "./ScheduleEditor";
import { useVillaModel } from "@/config/VillaModel";

export type FacilityTab = "today" | "readiness" | "faults" | "spend" | "schedule" | "recap";

/** The Facility tabs, shown in the Cockpit after its own view (2.496.273). */
export const FACILITY_TABS: ModalTab<FacilityTab>[] = [
  { id: "today", label: "Today", icon: ListChecks },
  { id: "readiness", label: "Readiness", icon: ClipboardCheck },
  { id: "faults", label: "Faults", icon: Wrench },
  { id: "spend", label: "Spend", icon: Wallet },
  // Before Recap: configuring the schedule is what the recap and the Today
  // board both read from, so it belongs upstream of the annex that summarises
  // them, not after it.
  { id: "schedule", label: "Schedule", icon: CalendarCog },
  { id: "recap", label: "Recap", icon: FileText },
];

/**
 * One Facility tab's content, inside the Cockpit (2.496.273: the Facility
 * window was merged into the Cockpit — owner, 2026-10-04: "remove 1 menu from
 * the top bar … show the same information in a single one"). Mounted only
 * while a Facility tab is open, so the maintenance record is watched live only
 * then (useFacilityLiveView).
 */
export default function FacilitySections({
  tab, onOpenEntity, reportFaultFor, onFaultFormOpened, onOpenOverview,
}: {
  tab: FacilityTab;
  /** Jump to a device's panel — a failing check or a fault opens the actual
   *  device instead of leaving the operator to hunt for it. */
  onOpenEntity: (entityId: string) => void;
  /** Faults opens with a blank fault already pointed at this device — set
   *  when the operator came from a device panel's fault shortcut. */
  reportFaultFor?: string;
  /** Called once the form has been filled in, so the request is dropped and
   *  reopening the tab later does not spring the same form again. */
  onFaultFormOpened?: () => void;
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
  const unavailableIds = devices.unavailable as string[];
  const canControl = roleCan(role, "controlEntities");

  return (
    <>
      {saveError && <div className="fm-banner warn">{saveError}</div>}
      {!ready && <p className="muted body-text">Loading the maintenance record…</p>}
      {ready && tab === "today" && <TodayTab onOpenEntity={onOpenEntity} />}
      {ready && tab === "readiness" && (
        <ReadinessTab readiness={readiness} onOpenEntity={onOpenEntity}
          onOpenUnavailableDevices={onOpenOverview} onOpenCheckDevices={openCheckDevices} />
      )}
      {ready && tab === "faults" && (
        <FaultsTab onOpenEntity={onOpenEntity} unavailableIds={unavailableIds}
          deviceOptions={deviceOptions} reportFaultFor={reportFaultFor}
          onFaultFormOpened={onFaultFormOpened} />
      )}
      {ready && tab === "spend" && <SpendTab onOpenEntity={onOpenEntity} deviceOptions={deviceOptions} />}
      {ready && tab === "schedule" && <ScheduleEditor />}
      {ready && tab === "recap" && (
        <RecapTab readiness={readiness}
          offlineDeviceCount={readiness.checks.find((c) => c.id === "devices-online")?.entityIds?.length ?? 0}
          totalDeviceCount={totalDeviceCount} />
      )}
      {checkPanelGroup && (
        <SummaryGroupPanel group={checkPanelGroup} canControl={canControl}
          onClose={() => setCheckPanelGroup(null)}
          onOpenEntity={(id) => { setCheckPanelGroup(null); onOpenEntity(id); }} />
      )}
    </>
  );
}
