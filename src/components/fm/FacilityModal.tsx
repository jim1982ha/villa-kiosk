// src/components/fm/FacilityModal.tsx
// The Facility Manager workspace — one modal, six tabs, opened from the HUD
// by any profile holding the `manageFacility` capability (facility manager and
// owner; see auth/permissions.ts for why both).
//
// Tab order is the operator's own order of business, not a feature list:
//   Today      what needs doing right now (Clause 3.7 board + open faults)
//   Readiness  is the villa fit for the next guest (Clause 1.1(iii)(a))
//   Faults     the work queue (Clause 1.1(iv)(b))
//   Spend      this month against the Minor Maintenance cap (Clause 3.3(i))
//   Schedule   what the Today board measures against — configured, then acted on
//   Report     the operational annex for the monthly owner report (Clause 3.11)
//
// Fixed height (.modal-fixed-height) on desktop/tablet: this modal switches
// between views with wildly different content — Spend can be two rows,
// Faults a dozen — and letting the dialog resize around every tab switch was
// jarring. See that class's own comment in styles.css.

import { useMemo, useState } from "react";
import {
  X, ClipboardCheck, ListChecks, Wrench, Wallet, FileText, CalendarCog, TriangleAlert,
} from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { hasCapability } from "@/auth/permissions";
import { useFmData } from "@/fm/FmDataContext";
import { buildReadiness, type ReadinessCheck } from "@/fm/readiness";
import { unavailableDeviceIds } from "@/config/deviceGroups";
import { locksGroup, lightsGroup } from "@/config/summaryGroups";
import SummaryGroupPanel, { type SummaryGroup } from "@/components/panels/SummaryGroupPanel";
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
  onClose, mappedEntityIds, onOpenEntity,
}: {
  onClose: () => void;
  mappedEntityIds: Set<string>;
  /** Jump to a device's panel — lets a failing check or a fault open the
   *  actual device instead of leaving the operator to hunt for it. */
  onOpenEntity: (entityId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("today");
  const { entities } = useHA();
  const { config } = useConfig();
  const { role } = useProfile();
  const { data, ready, saveError } = useFmData();
  const [unavailableOpen, setUnavailableOpen] = useState(false);
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
    () => buildReadiness(entities, config.entityMap, mappedEntityIds, data, config.deviceGroups),
    [entities, config.entityMap, mappedEntityIds, data, config.deviceGroups],
  );

  // Same list the HUD's own unavailable-devices badge shows (see
  // unavailableDeviceIds) — the Readiness tab's quick-link opens this exact
  // panel rather than a Facility-local reimplementation, so there is only
  // ever one "unavailable devices" view in the app to keep in sync.
  const unavailableIds = useMemo(
    () => unavailableDeviceIds(config.entityMap, config.deviceGroups, mappedEntityIds, entities),
    [config.entityMap, config.deviceGroups, mappedEntityIds, entities],
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
          className="modal settings-modal config-editor-modal modal-fixed-height"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="settings-header">
            <h2>Facility</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
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
                onOpenUnavailableDevices={() => setUnavailableOpen(true)}
                onOpenCheckDevices={openCheckDevices}
              />
            )}
            {ready && tab === "faults" && <FaultsTab onOpenEntity={onOpenEntity} />}
            {ready && tab === "spend" && <SpendTab onOpenEntity={onOpenEntity} />}
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
            <span className="muted body-text" style={{ fontSize: 12 }}>
              Maintenance intervals follow Clause 3.7 · cap follows Clause 3.3(i)
            </span>
            <button className="btn primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

      {unavailableOpen && (
        <SummaryGroupPanel
          group={{ title: "Unavailable devices", icon: TriangleAlert, entityIds: unavailableIds }}
          canControl={canControl}
          mappedEntityIds={mappedEntityIds}
          onClose={() => setUnavailableOpen(false)}
          onOpenEntity={(id) => { setUnavailableOpen(false); onOpenEntity(id); }}
          hideBulkToggle
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
