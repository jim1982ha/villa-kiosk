// src/components/fm/FacilityModal.tsx
// The Facility Manager workspace — one modal, six tabs, opened from the HUD
// by any profile holding the `manageFacility` capability (facility manager and
// owner; see auth/permissions.ts for why both).
//
// Tab order is the operator's own order of business, not a feature list:
//   Today      what needs doing right now (the maintenance board + open faults)
//   Readiness  is the villa fit for the next guest
//   Faults     the work queue
//   Spend      this month against the configured Minor Maintenance cap
//   Schedule   what the Today board measures against — configured, then acted on
//   Report     the operational annex for whatever monthly owner report already exists
//
// Fixed height (.modal-fixed-height) on desktop/tablet: this modal switches
// between views with wildly different content — Spend can be two rows,
// Faults a dozen — and letting the dialog resize around every tab switch was
// jarring. See that class's own comment in styles.css.

import { useMemo, useState } from "react";
import { useModalA11y } from "@/hooks/useModalA11y";
import {
  ClipboardCheck, ListChecks, Wrench, Wallet, FileText, CalendarCog,
} from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { hasCapability } from "@/auth/permissions";
import { useFmData, useFacilityLiveView } from "@/fm/FmDataContext";
import { buildReadiness, type ReadinessCheck } from "@/fm/readiness";
import { unavailableDeviceIds } from "@/config/deviceGroups";
import { locksGroup, lightsGroup } from "@/config/summaryGroups";
import SummaryGroupPanel, { type SummaryGroup } from "@/components/panels/SummaryGroupPanel";
import CockpitModal from "@/components/cockpit/CockpitModal";
import { buildDeviceOptions } from "./DeviceSearchPicker";
import TodayTab from "./TodayTab";
import ReadinessTab from "./ReadinessTab";
import FaultsTab from "./FaultsTab";
import SpendTab from "./SpendTab";
import ReportTab from "./ReportTab";
import ScheduleEditor from "./ScheduleEditor";

type Tab = "today" | "readiness" | "faults" | "spend" | "schedule" | "report";

const TABS: { id: Tab; label: string; icon: typeof ListChecks }[] = [
  { id: "today", label: "Today", icon: ListChecks },
  { id: "readiness", label: "Readiness", icon: ClipboardCheck },
  { id: "faults", label: "Faults", icon: Wrench },
  { id: "spend", label: "Spend", icon: Wallet },
  // Before Report: configuring the schedule is what the report and the Today
  // board both read from, so it belongs upstream of the annex that summarises
  // them, not after it.
  { id: "schedule", label: "Schedule", icon: CalendarCog },
  { id: "report", label: "Report", icon: FileText },
];

export default function FacilityModal({
  onClose, mappedEntityIds, onOpenEntity, reportFaultFor, onFaultFormOpened,
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
}) {
  // Focus trap + Escape + focus restore (see useModalA11y).
  const dialogRef = useModalA11y(onClose);
  // Landing on Faults rather than Today when the operator arrived by tapping
  // "report a fault" on a device: they have already said what they want.
  const [tab, setTab] = useState<Tab>(reportFaultFor ? "faults" : "today");
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
  // Opens Cockpit — see HUD.tsx's identical rename for why (the bare
  // unavailable-devices list is now a drill-down inside it, not opened
  // directly). Name kept close to ReadinessTab's own onOpenUnavailableDevices
  // prop, which is still accurate from ITS perspective: a "N offline" link
  // that shows those devices, however that's implemented on this end.
  const [cockpitOpen, setCockpitOpen] = useState(false);
  // The Readiness tab's "View doors" / "View lights" shortcuts. Deliberately
  // NOT the failing check's own (narrower) entityIds — the operator taps
  // "View doors" expecting the SAME modal the bottom-bar "Locks" tile opens
  // (every lock, not just the currently-unlocked ones), so this opens the
  // identical group locksGroup/lightsGroup already build for that tile (see
  // summaryGroups.ts) rather than a second, differently-scoped view.
  const [checkPanelGroup, setCheckPanelGroup] = useState<SummaryGroup | null>(null);
  const openCheckDevices = (check: ReadinessCheck) => {
    const group = check.id === "locks" ? locksGroup(entities)
      : check.id === "lights" ? lightsGroup(entities)
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

          <div className="fm-tabs" role="tablist" aria-label="Facility sections">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`fm-tab${tab === t.id ? " active" : ""}`}
                  onClick={() => setTab(t.id)}
                >
                  <Icon size={16} /><span>{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="settings-body">
            {saveError && <div className="fm-banner warn">{saveError}</div>}
            {!ready && <p className="muted body-text">Loading the maintenance record…</p>}
            {ready && tab === "today" && <TodayTab onOpenEntity={onOpenEntity} />}
            {ready && tab === "readiness" && (
              <ReadinessTab
                report={readiness}
                onOpenEntity={onOpenEntity}
                onOpenUnavailableDevices={() => setCockpitOpen(true)}
                onOpenCheckDevices={openCheckDevices}
              />
            )}
            {ready && tab === "faults" && (
              <FaultsTab onOpenEntity={onOpenEntity} unavailableIds={unavailableIds}
                deviceOptions={deviceOptions} reportFaultFor={reportFaultFor}
                onFaultFormOpened={onFaultFormOpened} />
            )}
            {ready && tab === "spend" && (
              <SpendTab onOpenEntity={onOpenEntity} deviceOptions={deviceOptions} />
            )}
            {ready && tab === "schedule" && <ScheduleEditor />}
            {ready && tab === "report" && (
              <ReportTab
                readiness={readiness}
                offlineDeviceCount={readiness.checks.find((c) => c.id === "devices-online")?.entityIds?.length ?? 0}
                totalDeviceCount={mappedEntityIds.size || Object.keys(config.entityMap).length}
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

      {cockpitOpen && (
        <CockpitModal
          canControl={canControl}
          mappedEntityIds={mappedEntityIds}
          onClose={() => setCockpitOpen(false)}
          onOpenEntity={(id) => { setCockpitOpen(false); onOpenEntity(id); }}
        />
      )}

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
