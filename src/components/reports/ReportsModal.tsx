// src/components/reports/ReportsModal.tsx
// The Briefings workspace — one modal, five tabs, owner only.
//
// ⚠️ LABELLED "BRIEFINGS", NOT "REPORTS", AND ON PURPOSE. Facility already has
// a tab called "Report" — a DOCUMENT the facility manager generates on demand,
// in Markdown, downloaded, a point-in-time record of readiness and spend. This
// is the AUTOMATED PERIODIC brief: scheduled, delivered by notification, built
// from the villa's own alert layer. They shipped with the same label AND the
// same `FileText` icon, which is a coin-flip for whoever opens one.
//
// The word is the product's own — the renderer titles every one of these
// "Weekly property brief" / "Weekly facility brief", so opening Briefings and
// finding a brief needs no explanation. The CODE stays `reports` throughout:
// the backend package, the four `/reports-*` endpoints, these file names. That
// is what the subsystem is; only the label a person reads is disambiguated.
//
// Tab order is the order somebody actually approaches this: read one, see what
// it can and cannot measure, decide when it arrives, then look at the record.
//
//   Preview      compose one now and read it, sending nothing
//   Coverage     what this property can be asked about, and what it cannot
//   Schedule     when it arrives, for whom, and where
//   History      what was produced and whether it was delivered
//   Diagnostics  the detection layer's own health
//
// ⚠️ THE SHELL IS COPIED FROM `FacilityModal`, NOT INVENTED. A dialog assembled
// from `.modal-backdrop` + `.modal.settings-modal` renders as a centred card on
// a tablet; one assembled any other way renders as a full-bleed top-anchored
// sheet, which is the trap both dialogs added in August 2026 had to be verified
// against on real hardware. `modal-fixed-height` is here for the same reason
// Facility has it: these tabs have wildly different content lengths and letting
// the dialog resize around every switch is jarring.
//
// ⚠️ OWNER-GATED HERE AND, INDEPENDENTLY, ON THE SERVER. Hiding this from the
// HUD is a rendering convenience; `supervisor-proxy.py` refuses a non-owner PUT
// to /reports-config and a non-owner GET of /reports-diagnostics whatever the
// browser sends. Never the only gate.

import { useCallback, useEffect, useState } from "react";
import {
  Activity, CalendarClock, FileText, History, ShieldQuestion,
} from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";
import {
  fetchReportsConfig, fetchReportsDiagnostics, fetchReportsHistory,
  runReportNow, saveReportsConfig,
  type ReportPreview, type ReportsDiagnostics,
} from "@/reports/reportsApi";
import type { ReportHistoryEntry, ReportsConfig } from "@/reports/reportsTypes";
import PreviewTab from "./PreviewTab";
import CoverageTab from "./CoverageTab";
import ScheduleTab from "./ScheduleTab";
import HistoryTab from "./HistoryTab";
import DiagnosticsTab from "./DiagnosticsTab";

type Tab = "preview" | "coverage" | "schedule" | "history" | "diagnostics";

const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: "preview", label: "Preview", icon: FileText },
  { id: "coverage", label: "Coverage", icon: ShieldQuestion },
  { id: "schedule", label: "Schedule", icon: CalendarClock },
  { id: "history", label: "History", icon: History },
  { id: "diagnostics", label: "Diagnostics", icon: Activity },
];

export default function ReportsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useModalA11y(onClose);
  const [tab, setTab] = useState<Tab>("preview");

  const [config, setConfig] = useState<ReportsConfig | null>(null);
  const [rev, setRev] = useState<string | null>(null);
  const [carryOver, setCarryOver] = useState<Record<string, unknown>>({});
  const [diagnostics, setDiagnostics] = useState<ReportsDiagnostics | null>(null);
  const [history, setHistory] = useState<ReportHistoryEntry[] | null>(null);
  const [preview, setPreview] = useState<ReportPreview | null>(null);

  // ⚠️ THREE STATES, NOT TWO. "Not loaded yet", "loaded and empty" and
  // "could not be reached" are different things, and collapsing the last two
  // shows an empty schedule list to someone whose add-on is simply down —
  // which reads as "briefings are off" and invites configuring them twice.
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    const [c, d, h] = await Promise.all([
      fetchReportsConfig(), fetchReportsDiagnostics(), fetchReportsHistory(),
    ]);
    if (c) {
      setConfig(c.config);
      setRev(c.rev);
      setCarryOver(c.raw);
    }
    setDiagnostics(d);
    setHistory(h);
    setUnreachable(c === null);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const save = useCallback(async (next: ReportsConfig) => {
    setBusy(true);
    setNotice("");
    const result = await saveReportsConfig(next, rev, carryOver);
    if (result.ok) {
      setConfig(next);
      setRev(result.rev);
      setNotice("Saved.");
    } else {
      // ⚠️ A CONFLICT RE-READS RATHER THAN RETRYING. Another device wrote in
      // the gap; overwriting it is exactly what the revision exists to stop.
      setNotice(result.conflict
        ? "Someone else changed these settings. Reloaded — please re-apply."
        : result.error);
      if (result.conflict) await reload();
    }
    setBusy(false);
  }, [rev, carryOver, reload]);

  const compose = useCallback(async () => {
    setBusy(true);
    setNotice("");
    const result = await runReportNow({ preview: true, cadence: "weekly" });
    if (result) setPreview(result);
    else setNotice("Could not compose a brief. See the add-on log.");
    setBusy(false);
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal settings-modal config-editor-modal modal-fixed-height"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Briefings"
      >
        <div className="settings-header">
          <h2>Briefings</h2>
        </div>

        <div className="fm-tabs" role="tablist" aria-label="Briefing sections">
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
          {notice && <div className="fm-banner warn">{notice}</div>}
          {unreachable && (
            <div className="fm-banner warn">
              The add-on could not be reached, so these settings are not shown.
              Nothing here has been changed.
            </div>
          )}

          {tab === "preview" && (
            <PreviewTab
              preview={preview}
              busy={busy}
              onCompose={() => void compose()}
            />
          )}
          {tab === "coverage" && <CoverageTab diagnostics={diagnostics} />}
          {tab === "schedule" && (
            <ScheduleTab
              config={config}
              diagnostics={diagnostics}
              busy={busy}
              onSave={(next) => void save(next)}
            />
          )}
          {tab === "history" && <HistoryTab entries={history} />}
          {tab === "diagnostics" && <DiagnosticsTab diagnostics={diagnostics} />}
        </div>
      </div>
    </div>
  );
}
