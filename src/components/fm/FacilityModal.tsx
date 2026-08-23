// src/components/fm/FacilityModal.tsx
// The Facility Manager workspace — one modal, seven tabs, opened from the HUD
// by any profile holding the `manageFacility` capability (facility manager and
// owner; see auth/permissions.ts for why both).
//
// Tab order is the operator's own order of business, not a feature list:
//   Cockpit    how the villa is right now, before deciding what to do about it
//   Today      what needs doing right now (the maintenance board + open faults)
//   Readiness  is the villa fit for the next guest
//   Faults     the work queue
//   Spend      this month against the configured Minor Maintenance cap
//   Schedule   what the Today board measures against — configured, then acted on
//   Report     the operational annex for whatever monthly owner report already exists
//
// ⚠️ COCKPIT USED TO BE ITS OWN MODAL BEHIND ITS OWN HUD ICON, AND FOR AN
// OWNER THAT WAS TWO DOORS INTO ONE ROOM (2.569.0) — reported as "two distinct
// icons / modals feels redundant". It is a tab here now, and the HUD's alert
// icon lands on it. The separate modal still EXISTS, for the profiles this
// dialog is closed to: Cockpit was never gated and Facility is, so deleting it
// would have taken the villa's only status view away from a guest. See
// `cockpit/CockpitModal.tsx`.
//
// Fixed height (.modal-fixed-height) on desktop/tablet: this modal switches
// between views with wildly different content — Spend can be two rows,
// Faults a dozen — and letting the dialog resize around every tab switch was
// jarring. See that class's own comment in styles.css.

import { useMemo, useState } from "react";
import { useModalA11y } from "@/hooks/useModalA11y";
import ModalTabs from "@/components/common/ModalTabs";
import {
  ClipboardCheck, ClipboardList, ListChecks, Wrench, Wallet, FileText,
  CalendarCog, Gauge,
} from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { hasCapability } from "@/auth/permissions";
import { useFmData, useFacilityLiveView } from "@/fm/FmDataContext";
import { buildReadiness, type ReadinessCheck } from "@/fm/readiness";
import { unavailableDeviceIds, selectableDeviceIds } from "@/config/deviceGroups";
import { locksGroup, lightsGroup } from "@/config/summaryGroups";
import SummaryGroupPanel, { type SummaryGroup } from "@/components/panels/SummaryGroupPanel";
import CockpitTab from "@/components/cockpit/CockpitTab";
import { buildDeviceOptions } from "./DeviceSearchPicker";
import TodayTab from "./TodayTab";
import ReadinessTab from "./ReadinessTab";
import FaultsTab from "./FaultsTab";
import SpendTab from "./SpendTab";
import ReportTab from "./ReportTab";
import TasksTab from "@/components/reports/TasksTab";
import ScheduleEditor from "./ScheduleEditor";

export type FacilityTab =
  | "cockpit" | "today" | "readiness" | "faults" | "tasks" | "spend"
  | "schedule" | "report";

const TABS: { id: FacilityTab; label: string; icon: typeof ListChecks }[] = [
  // First, because "how is the villa" precedes "what shall I do about it" —
  // and because the HUD's alert badge lands here, so it is the tab an operator
  // arrives on most often.
  { id: "cockpit", label: "Cockpit", icon: Gauge },
  { id: "today", label: "Today", icon: ListChecks },
  { id: "readiness", label: "Readiness", icon: ClipboardCheck },
  { id: "faults", label: "Faults", icon: Wrench },
  // ⚠️ THE SAME TAB AS BRIEFINGS', AND THE SECOND ENTRY POINT IS THE POINT.
  // Acknowledging a caretaker task is the FACILITY MANAGER's job. This tab was
  // added because Briefings was gated on `editConfig`, which `ops` does not
  // hold, so the tab built for them sat behind a door only the owner could
  // open; Facility is gated on `manageFacility`, exactly the capability the
  // server requires to complete a task.
  //
  // ⚠️ BRIEFINGS OPENED TO `ops` THE SAME WEEK (2026-08-22) AND THIS TAB STAYS.
  // It is no longer the ONLY way in, which is the sentence above's original
  // justification, and keeping it is still right for a different reason: this
  // is the facility manager's home workspace — the villa's faults, readiness
  // and schedule are here — and a job list belongs beside the work it is about,
  // not only in the dialog that happens to have raised it. Deleting it now
  // would move the FM's daily task out of their daily screen.
  //
  // ⚠️ THE COMPONENT IS IMPORTED, NOT COPIED. A second implementation of the
  // list would be a second place for the "only items this system wrote may be
  // completed" rule to be got wrong, and that rule is what stops the kiosk
  // ticking off somebody's groceries.
  { id: "tasks", label: "Tasks", icon: ClipboardList },
  { id: "spend", label: "Spend", icon: Wallet },
  // Before Report: configuring the schedule is what the report and the Today
  // board both read from, so it belongs upstream of the annex that summarises
  // them, not after it.
  { id: "schedule", label: "Schedule", icon: CalendarCog },
  { id: "report", label: "Report", icon: FileText },
];

export default function FacilityModal({
  onClose, mappedEntityIds, onOpenEntity, reportFaultFor, onFaultFormOpened,
  openFaultId, openScheduleTab, openTab,
}: {
  onClose: () => void;
  mappedEntityIds: Set<string>;
  /** Open on Faults with a blank fault already pointed at this device — set
   *  when the operator came here from a device panel's fault shortcut. */
  reportFaultFor?: string;
  /** Called once the form has been filled in, so the caller can drop the
   *  request. Without it, closing and reopening Facility would spring the
   *  same half-written fault form again. */
  onFaultFormOpened?: () => void;
  /** Jump to a device's panel — lets a failing check or a fault open the
   *  actual device instead of leaving the operator to hunt for it. */
  onOpenEntity: (entityId: string) => void;
  /** Open on Faults with THIS existing ticket in the editor.
   *
   *  ⚠️ THE COUNTERPART TO `reportFaultFor`. Cockpit's "needs attention" list
   *  shows open faults, and tapping one opened the linked DEVICE's panel —
   *  because `entityId` on a fault row is the device the ticket names, and the
   *  row called `onOpenEntity` for every kind. A record row must open its
   *  record. */
  openFaultId?: string;
  /** Open on Schedule — for an overdue maintenance row, which had the same
   *  defect and is fixed with it rather than left for the next report. */
  openScheduleTab?: boolean;
  /** Land on a named tab. Set by the HUD's alert icon, which opens this dialog
   *  on Cockpit — the icon's badge counts the very rows that tab shows, so
   *  landing on Today would answer a different question from the one tapped.
   *
   *  ⚠️ LOWEST PRECEDENCE OF THE FOUR ENTRY REQUESTS. `reportFaultFor` /
   *  `openFaultId` / `openScheduleTab` each carry a RECORD the caller wants
   *  opened, and a tab hint that overrode one would drop it on the floor. */
  openTab?: FacilityTab;
}) {
  // Focus trap + Escape + focus restore (see useModalA11y).
  const dialogRef = useModalA11y(onClose);
  // Landing on Faults rather than Today when the operator arrived by tapping
  // "report a fault" on a device: they have already said what they want.
  const [tab, setTab] = useState<FacilityTab>(
    reportFaultFor || openFaultId ? "faults"
      : openScheduleTab ? "schedule"
        : openTab ?? "today");
  /** A ticket this dialog's OWN Cockpit tab asked to open. ⚠️ SEPARATE FROM
   *  THE `openFaultId` PROP: that one is a request from outside and is cleared
   *  by the caller, this one is ours and is cleared by us. Merging them would
   *  mean writing to a prop's owner from here to reset it. */
  const [ownFaultId, setOwnFaultId] = useState<string | null>(null);
  const { entities } = useHA();
  const { config, resolvedRooms } = useConfig();
  const { role } = useProfile();
  const { data, ready, saveError } = useFmData();
  // This panel is the one place facility records are actually read, so while
  // it is open the store polls on the on-screen cadence instead of the
  // background one. Without it the only way to see another device's change
  // was to minimise and restore the window (a visibilitychange) or wait out
  // the three-minute heartbeat.
  useFacilityLiveView();
  // The Readiness tab's "View doors" / "View lights" shortcuts. Deliberately
  // NOT the failing check's own (narrower) entityIds — the operator taps
  // "View doors" expecting the SAME modal the bottom-bar "Locks" tile opens
  // (every lock, not just the currently-unlocked ones), so this opens the
  // identical group locksGroup/lightsGroup already build for that tile (see
  // summaryGroups.ts) rather than a second, differently-scoped view.
  const [checkPanelGroup, setCheckPanelGroup] = useState<SummaryGroup | null>(null);
  const openCheckDevices = (check: ReadinessCheck) => {
    // ⚠️ SCOPED TO THE VILLA'S OWN DEVICES, or the panel contradicts the check
    // that opened it. Since 2.572.0 the checks count `selectableDeviceIds`, so
    // an unfiltered group answered "2 not locked" and then listed every `lock.*`
    // Home Assistant has — found by /dry-audit one release later, which is
    // exactly the drift that follows from narrowing one reader of a set and not
    // its neighbour.
    const group = check.id === "locks" ? locksGroup(entities, {}, villaDevices)
      : check.id === "lights" ? lightsGroup(entities, villaDevices)
      : null;
    if (group) setCheckPanelGroup(group);
  };

  // Shared by the Readiness tab and the Report tab, so the report can never
  // disagree with what the operator just looked at.
  const readiness = useMemo(
    () => buildReadiness(
      entities, config.entityMap, mappedEntityIds, data, config.deviceGroups,
      config.dismissedEntityIds),
    [entities, config.entityMap, mappedEntityIds, data, config.deviceGroups, config.dismissedEntityIds],
  );

  // The report's DENOMINATOR, and it has to come from the same rule its
  // numerator does. `offlineDeviceCount` below is derived from
  // unavailableDeviceIds, which filters through selectableDeviceIds — disabled
  // mappings dropped, dismissed entities dropped, entities HA does not have
  // dropped, device groups folded to one primary. This used to be
  // `mappedEntityIds.size || Object.keys(config.entityMap).length`, which
  // applies none of those, so the report divided a strictly-filtered numerator
  // by an unfiltered total and understated the offline share. deviceGroups.ts
  // already records this drift happening once before, to the fault picker.
  const totalDeviceCount = useMemo(
    () => selectableDeviceIds(config.entityMap, config.deviceGroups, mappedEntityIds,
                              entities, config.dismissedEntityIds).length,
    [config.entityMap, config.deviceGroups, mappedEntityIds, entities, config.dismissedEntityIds],
  );

  // Same list the HUD's own unavailable-devices badge shows (see
  // unavailableDeviceIds) — the Readiness tab's quick-link opens the same
  // Cockpit page that badge does, rather than a Facility-local
  // reimplementation, so there is only ever one "what needs attention" view
  // in the app to keep in sync.
  // Built ONCE here and handed to both tabs, the same way unavailableIds is
  // (see FaultsTab's prop docstring): mappedEntityIds only exists at this
  // level, and two tabs each deriving "the villa's devices" from a different
  // starting point is precisely how the picker ended up offering rows no
  // other screen would show.
  const deviceOptions = useMemo(
    () => buildDeviceOptions(config.entityMap, entities, resolvedRooms, config.deviceGroups,
                             mappedEntityIds, config.dismissedEntityIds),
    [config.entityMap, entities, resolvedRooms, config.deviceGroups, mappedEntityIds, config.dismissedEntityIds],
  );

  /** The villa's own devices — shared by the readiness drill-down below and
   *  built here because `mappedEntityIds` only exists at this level. */
  const villaDevices = useMemo(
    () => new Set(selectableDeviceIds(config.entityMap, config.deviceGroups,
                                      mappedEntityIds, entities,
                                      config.dismissedEntityIds)),
    [config.entityMap, config.deviceGroups, mappedEntityIds, entities, config.dismissedEntityIds],
  );

  const unavailableIds = useMemo(
    () => unavailableDeviceIds(
      config.entityMap, config.deviceGroups, mappedEntityIds, entities, config.dismissedEntityIds),
    [config.entityMap, config.deviceGroups, mappedEntityIds, entities, config.dismissedEntityIds],
  );
  const canControl = role != null && hasCapability(role, "controlEntities");

  return (
    // Fragment, not a shared wrapper: the Unavailable-devices panel below
    // renders its OWN .modal-backdrop (via BasePanel), and nesting it inside
    // this modal's backdrop would let a click meant to dismiss just the panel
    // bubble up and close Facility too (the panel's backdrop has no reason to
    // stopPropagation — normally it IS the outermost one). Kept as true
    // siblings, both under Dashboard's tree, so each backdrop's click-to-close
    // only ever closes its own modal.
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div
          ref={dialogRef}
          className="modal settings-modal config-editor-modal modal-fixed-height"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Facility workspace"
        >
          <div className="settings-header">
            <h2>Facility</h2>
          </div>

          {/* ⚠️ `.fm-tabs` SCROLLS HORIZONTALLY, so an entry request can land on
              a tab that is off screen with the row still showing the first one
              highlighted — an operator who tapped "report a fault" sees the
              fault form under a tab bar that appears to be on Cockpit. Seven
              tabs made that reachable on a phone where six had not; the ref
              below scrolls the active tab into view. `block: "nearest"` is what
              keeps it horizontal in practice — the row is already vertically in
              view whenever this dialog is open, and "nearest" then asks for no
              vertical movement at all. */}
          <ModalTabs
            tabs={TABS}
            active={tab}
            onSelect={setTab}
            label="Facility sections"
          />

          <div className="settings-body">
            {saveError && <div className="fm-banner warn">{saveError}</div>}
            {!ready && <p className="muted body-text">Loading the maintenance record…</p>}
            {/* ⚠️ GATED ON `ready` LIKE EVERY OTHER TAB, although it is mostly
                about live HA state: its "Needs attention" list counts open
                faults and overdue maintenance, so a Cockpit rendered before the
                facility record loads would under-report and then silently
                correct itself. */}
            {ready && tab === "cockpit" && (
              <CockpitTab
                mappedEntityIds={mappedEntityIds}
                onOpenEntity={onOpenEntity}
                onOpenGroup={setCheckPanelGroup}
                // ⚠️ THIS DIALOG IS ALREADY THE DESTINATION, so a record row
                // does not travel back out through Dashboard — it just switches
                // this tab. The standalone Cockpit has no Facility around it and
                // must ask Dashboard to open one; both end in the same place, by
                // the shortest route each has.
                onOpenRecord={(kind, recordId) => {
                  if (kind === "fault") { setOwnFaultId(recordId); setTab("faults"); }
                  else setTab("schedule");
                }}
              />
            )}
            {ready && tab === "today" && <TodayTab onOpenEntity={onOpenEntity} />}
            {ready && tab === "readiness" && (
              <ReadinessTab
                report={readiness}
                onOpenEntity={onOpenEntity}
                onOpenUnavailableDevices={() => setTab("cockpit")}
                onOpenCheckDevices={openCheckDevices}
              />
            )}
            {ready && tab === "faults" && (
              <FaultsTab onOpenEntity={onOpenEntity} unavailableIds={unavailableIds}
                deviceOptions={deviceOptions} reportFaultFor={reportFaultFor}
                onFaultFormOpened={onFaultFormOpened}
                openTicketId={openFaultId ?? ownFaultId ?? undefined}
                onTicketOpened={() => { setOwnFaultId(null); onFaultFormOpened?.(); }} />
            )}
            {ready && tab === "tasks" && <TasksTab canAck />}
            {ready && tab === "spend" && (
              <SpendTab onOpenEntity={onOpenEntity} deviceOptions={deviceOptions} />
            )}
            {ready && tab === "schedule" && <ScheduleEditor />}
            {ready && tab === "report" && (
              <ReportTab
                readiness={readiness}
                offlineDeviceCount={readiness.checks.find((c) => c.id === "devices-online")?.entityIds?.length ?? 0}
                totalDeviceCount={totalDeviceCount}
              />
            )}
          </div>

          <div className="settings-footer" style={{ justifyContent: "space-between" }}>
            <span className="muted body-text" style={{ fontSize: "var(--text-xs)" }}>
              Maintenance intervals and the spend cap are set in the Schedule tab
            </span>
            <button className="btn primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

      {/* ⚠️ ONE PANEL SLOT, TWO CALLERS. Readiness' "View doors"/"View lights"
          and the Cockpit tab's room/floor rows both land here rather than each
          rendering their own — and it is a SIBLING of the dialog above, not a
          child, because it brings its own `.modal-backdrop` and a nested one
          would let a click meant to dismiss the panel close Facility with it. */}
      {checkPanelGroup && (
        <SummaryGroupPanel
          group={checkPanelGroup}
          canControl={canControl}
          mappedEntityIds={mappedEntityIds}
          onClose={() => setCheckPanelGroup(null)}
          onOpenEntity={(id) => { setCheckPanelGroup(null); onOpenEntity(id); }}
        />
      )}
    </>
  );
}
