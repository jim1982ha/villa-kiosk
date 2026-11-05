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
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { roleCan } from "@/auth/permissions";
import { useFmData } from "@/fm/FmDataContext";
import { buildReadiness, type CheckLink, type CheckTarget } from "@/fm/readiness";
import type { DocumentInputs } from "@/fm/monthlyDocument";
import { useFmTerms } from "@/fm/useFmTerms";
import { resolveSiteTitle } from "@/config/AppConfig";
import SummaryGroupPanel from "@/components/panels/SummaryGroupPanel";
import { buildDeviceOptions } from "./DeviceSearchPicker";
import TodayTab from "./TodayTab";
import ReadinessTab from "./ReadinessTab";
import TicketsTab from "./TicketsTab";
import SpendTab from "./SpendTab";
import ScheduleEditor from "./ScheduleEditor";
import { useDeviceIdentity, useVillaModel } from "@/config/VillaModel";

export type FacilityTab = "tickets" | "schedule" | "recap" | "spend";

/** The Facility tabs, shown in the Cockpit after its own view (2.496.273). Owner, 2026-10-14: Tickets right after
 *  the Overview; "Today" and "Schedule" are one tab (today's board, then the schedule it measures against). Recap is
 *  the live readiness check; the month's recap is the Spend tab's (owner, 2026-11-05: the recap and the spend
 *  statement, one document). */
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
  tab, onOpenEntity, editTicket, onTicketEditOpened, reportFaultFor, onFaultFormOpened, onTab, onOpenFaults,
}: {
  tab: FacilityTab;
  /** Another Cockpit tab (a readiness check's "tickets"). */
  onTab: (tab: "tickets" | "messages") => void;
  /** Inbox › Open issues on these devices' faults (a readiness check's "faults"). */
  onOpenFaults: (ids: string[]) => void;
  /** Jump to a device's panel — a failing check or a fault opens the actual
   *  device instead of leaving the operator to hunt for it. */
  onOpenEntity: (entityId: string) => void;
  /** Tickets opens this record's form (an open issue's "Edit ticket"). */
  editTicket?: string;
  /** Called once the form has it, so reopening the tab later does not spring it again. */
  onTicketEditOpened?: () => void;
  /** Tickets opens "Open a ticket" pointed at this device (a device's wrench, an Inbox card's Open Ticket). */
  reportFaultFor?: string;
  /** Called once the form has it. */
  onFaultFormOpened?: () => void;
}) {
  const { entities, haConfig } = useHA();
  const { config, resolvedRooms } = useConfig();
  const { role } = useProfile();
  const { data, ready } = useFmData();
  // the villa's devices, role-blind — the pickers offer every device to the people who record work
  const { devices } = useVillaModel();

  // The list a readiness check opens — its own devices (readiness.CheckTarget).
  const [checkList, setCheckList] = useState<CheckTarget | null>(null);
  // ONE profile view (useVillaAttention): the devices this profile is shown and its problems, Open issues' — so the
  // Recap counts what Open issues lists for the same person, and readiness and the top bar agree
  const view = useVillaAttention();
  const readiness = useMemo(() => buildReadiness(entities, data, view, config.entityMap),
    [entities, data, view, config.entityMap]);
  // what every document is made from, once (monthlyDocument.DocumentInputs) — the tabs only draw
  const terms = useFmTerms();
  const { deviceOfRecord } = useDeviceIdentity();
  const villaName = resolveSiteTitle(config, haConfig?.location_name);
  const inputs = useMemo((): DocumentInputs => ({ fm: data, terms, readiness, villaName, deviceOfRecord }),
    [data, terms, readiness, villaName, deviceOfRecord]);
  const deviceOptions = useMemo(
    () => buildDeviceOptions(devices, config.entityMap, entities, resolvedRooms),
    [devices, config.entityMap, entities, resolvedRooms],
  );
  const canControl = roleCan(role, "controlEntities");
  // a check's linked word: Open issues on its faults' devices (a whole-villa fault names none: Inbox as it opens), or
  // the Tickets tab
  const go = (to: CheckLink["to"]) => (to.place === "tickets" ? onTab("tickets")
    : to.ids.length ? onOpenFaults(to.ids) : onTab("messages"));

  return (
    <>
      {/* the record's save line and "Loading…" / "Can't reach…" are the Cockpit window's, over every tab */}
      {ready && tab === "schedule" && (
        <>
          <TodayTab onOpenEntity={onOpenEntity} />
          <div className="settings-section-title">Maintenance schedule</div>
          <ScheduleEditor />
        </>
      )}
      {/* ⚠️ NO "VILLA OCCUPIED SINCE …" HERE (owner, 2026-11-05: removed from this tab) */}
      {ready && tab === "recap" && (
        <ReadinessTab inputs={inputs} onOpenEntity={onOpenEntity} onOpenCheck={setCheckList} onGo={go} />
      )}
      {ready && tab === "tickets" && (
        <TicketsTab onOpenEntity={onOpenEntity} deviceOptions={deviceOptions}
          editTicket={editTicket} onEditOpened={onTicketEditOpened}
          raiseFor={reportFaultFor} onRaiseOpened={onFaultFormOpened} />
      )}
      {ready && tab === "spend" && <SpendTab onOpenEntity={onOpenEntity} deviceOptions={deviceOptions} inputs={inputs} />}

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
