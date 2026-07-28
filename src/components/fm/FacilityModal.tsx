// src/components/fm/FacilityModal.tsx
// The Facility Manager workspace — one modal, five tabs, opened from the HUD
// by any profile holding the `manageFacility` capability (facility manager and
// owner; see auth/permissions.ts for why both).
//
// Tab order is the operator's own order of business, not a feature list:
//   Today      what needs doing right now (Clause 3.7 board + open faults)
//   Readiness  is the villa fit for the next guest (Clause 1.1(iii)(a))
//   Faults     the work queue (Clause 1.1(iv)(b))
//   Spend      this month against the Minor Maintenance cap (Clause 3.3(i))
//   Report     the operational annex for the monthly owner report (Clause 3.11)

import { useMemo, useState } from "react";
import { X, ClipboardCheck, ListChecks, Wrench, Wallet, FileText, CalendarCog } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useFmData } from "@/fm/FmDataContext";
import { buildReadiness } from "@/fm/readiness";
import TodayTab from "./TodayTab";
import ReadinessTab from "./ReadinessTab";
import FaultsTab from "./FaultsTab";
import SpendTab from "./SpendTab";
import ReportTab from "./ReportTab";
import ScheduleEditor from "./ScheduleEditor";

type Tab = "today" | "readiness" | "faults" | "spend" | "report" | "schedule";

const TABS: { id: Tab; label: string; icon: typeof ListChecks }[] = [
  { id: "today", label: "Today", icon: ListChecks },
  { id: "readiness", label: "Readiness", icon: ClipboardCheck },
  { id: "faults", label: "Faults", icon: Wrench },
  { id: "spend", label: "Spend", icon: Wallet },
  { id: "report", label: "Report", icon: FileText },
  // Last: configuring the schedule is a setup act, not a daily one.
  { id: "schedule", label: "Schedule", icon: CalendarCog },
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
  const { data, ready, saveError } = useFmData();

  // Shared by the Readiness tab and the Report tab, so the report can never
  // disagree with what the operator just looked at.
  const readiness = useMemo(
    () => buildReadiness(entities, config.entityMap, mappedEntityIds, data),
    [entities, config.entityMap, mappedEntityIds, data],
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal settings-modal config-editor-modal"
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
            <ReadinessTab report={readiness} onOpenEntity={onOpenEntity} />
          )}
          {ready && tab === "faults" && <FaultsTab onOpenEntity={onOpenEntity} />}
          {ready && tab === "spend" && <SpendTab />}
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
  );
}
