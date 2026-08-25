// src/components/fm/ReportTab.tsx
// Generates the operational annex for whatever monthly owner report cycle
// the property already runs.
//
// Markdown, downloaded: it pastes into an email or WhatsApp unchanged, needs
// no viewer, and stays readable years later if it is ever pulled up in a
// dispute. The preview below renders that same Markdown FORMATTED (see
// ReportPreview) — a wall of "##"/"|" is not what an owner should have to
// read to find out if the villa is ready for a guest — but the underlying
// string, unchanged, is exactly what gets downloaded. The app deliberately
// produces only the OPERATIONAL annex — financial reporting (revenue,
// commissions, payout) is out of scope and stays with whoever runs it.
//
// Generation is an explicit action (the button), not a silent live re-render:
// the report is a point-in-time record of the villa's Readiness/Faults/Spend/
// Schedule status, and its own "Generated:" timestamp should mean the moment
// someone asked for it, not "whenever this component happened to re-render".

import { useState } from "react";
import InfoHint from "@/components/common/InfoHint";
import { Sparkles, Download, Save } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { resolveSiteTitle } from "@/config/AppConfig";
import { useFmData } from "@/fm/FmDataContext";
import { buildMonthlyReport } from "@/fm/fmReport";
import { monthKey } from "@/fm/fmEngine";
import type { ReadinessReport } from "@/fm/readiness";
import type { FmSavedDocument } from "@/fm/fmTypes";
import ReportPreview from "./ReportPreview";
import SavedDocumentsList from "./SavedDocumentsList";

/** Previous month by default: the report is written about a month that has
 *  finished, and it is due by the 10th of the one after it. */
function defaultMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return monthKey(d);
}

export default function ReportTab({
  readiness, offlineDeviceCount, totalDeviceCount,
}: {
  readiness: ReadinessReport;
  offlineDeviceCount: number;
  totalDeviceCount: number;
}) {
  const { data, saveDocument } = useFmData();
  const { config } = useConfig();
  const { haConfig } = useHA();
  const [month, setMonth] = useState(defaultMonth());
  // A snapshot, not a live useMemo: see the module comment on why generation
  // is an explicit action. null until "Generate report" is pressed, or after
  // the period changes underneath a previously generated one — a report for
  // June must never silently keep showing on screen once July is selected.
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const villaName = resolveSiteTitle(config, haConfig?.location_name);

  const months = [...new Set([
    defaultMonth(), monthKey(Date.now()),
    ...data.completions.map((c) => monthKey(c.at)),
    ...data.costs.map((c) => monthKey(c.at)),
  ])].sort().reverse();

  const generate = () => {
    setMarkdown(buildMonthlyReport({
      fm: data, month, villaName, readiness, offlineDeviceCount, totalDeviceCount,
    }));
    setSaved(false);
  };

  const download = () => {
    if (!markdown) return;
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${villaName.replace(/\s+/g, "-").toLowerCase()}-operations-${month}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const save = async () => {
    if (!markdown) return;
    await saveDocument({ kind: "report", month, markdown });
    setSaved(true);
  };

  const reopen = (doc: FmSavedDocument) => {
    setMonth(doc.month);
    setMarkdown(doc.markdown);
    setSaved(true);
  };

  return (
    <div className="fm-stack">
      <p className="muted body-text">
          The operational annex for the monthly owner report.
          <InfoHint label="Operational annex">
            Maintenance performed against the configured schedule, spend against the
            Minor Maintenance cap, faults and response times. Financial reporting is
            out of scope and stays with whoever already handles it.
          </InfoHint>
        </p>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="fm-field" style={{ maxWidth: 200 }}>
          <span>Period</span>
          <select value={month} onChange={(e) => { setMonth(e.target.value); setMarkdown(null); setSaved(false); }}>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn primary" onClick={generate}>
          <Sparkles size={16} /> {markdown ? "Regenerate report" : "Generate report"}
        </button>
        <button className="btn ghost" onClick={() => void save()} disabled={!markdown || saved}>
          <Save size={16} /> {saved ? "Saved" : "Save report"}
        </button>
        <button className="btn ghost" onClick={download} disabled={!markdown}>
          <Download size={16} /> Download .md
        </button>
      </div>

      {/* min-height keeps this tab's OWN footprint roughly stable across the
          empty-placeholder <-> full-report swap — without it, generating a
          report (a couple lines -> a full formatted document) jumped this
          tab's content height dramatically. On the desktop/tablet breakpoint
          the family's fixed height absorbs that into a scroll, but below it the
          whole modal resizes around the user, visibly shifting the header/
          tabs row on screen between "before" and "after" (they never
          actually change style — the whole dialog just grew and re-centred
          under them). */}
      <div className="fm-report-preview-area">
        {markdown ? (
          <ReportPreview markdown={markdown} />
        ) : (
          <p className="muted body-text">
            Nothing generated yet for {month} — press "Generate report" to build it from
            the villa's current Readiness, Faults, Spend and Schedule status.
          </p>
        )}
      </div>

      <SavedDocumentsList kind="report" onOpen={reopen} />
    </div>
  );
}
