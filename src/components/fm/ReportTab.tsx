// src/components/fm/ReportTab.tsx
// Generates the operational annex to the monthly owner report (Clause 3.11,
// due by the 10th of the following month — late reporting is a material breach
// under Appendix C §7(a)).
//
// Markdown, downloaded: it pastes into an email or WhatsApp unchanged, needs
// no viewer, and stays readable years later if it is ever pulled up in a
// dispute. The preview below renders that same Markdown FORMATTED (see
// ReportPreview) — a wall of "##"/"|" is not what an owner should have to
// read to find out if the villa is ready for a guest — but the underlying
// string, unchanged, is exactly what gets downloaded. The app deliberately
// produces only the OPERATIONAL annex — Kozystay's financial report stays
// theirs.
//
// Generation is an explicit action (the button), not a silent live re-render:
// the report is a point-in-time record of the villa's Readiness/Faults/Spend/
// Schedule status, and its own "Generated:" timestamp should mean the moment
// someone asked for it, not "whenever this component happened to re-render".

import { useState } from "react";
import { Sparkles, Download } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { resolveSiteTitle } from "@/config/AppConfig";
import { useFmData } from "@/fm/FmDataContext";
import { buildMonthlyReport } from "@/fm/fmReport";
import { monthKey } from "@/fm/fmEngine";
import type { ReadinessReport } from "@/fm/readiness";
import ReportPreview from "./ReportPreview";

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
  const { data } = useFmData();
  const { config } = useConfig();
  const { haConfig } = useHA();
  const [month, setMonth] = useState(defaultMonth());
  // A snapshot, not a live useMemo: see the module comment on why generation
  // is an explicit action. null until "Generate report" is pressed, or after
  // the period changes underneath a previously generated one — a report for
  // June must never silently keep showing on screen once July is selected.
  const [markdown, setMarkdown] = useState<string | null>(null);

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

  return (
    <div className="fm-stack">
      <p className="muted body-text">
        The operational annex to the monthly owner report — maintenance performed
        against Clause 3.7, spend against the Clause 3.3(i) cap, faults and response
        times. Due by the 10th of the following month (Clause 3.11). Financial
        reporting stays with Kozystay.
      </p>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="fm-field" style={{ maxWidth: 200 }}>
          <span>Period</span>
          <select value={month} onChange={(e) => { setMonth(e.target.value); setMarkdown(null); }}>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" onClick={generate}>
          <Sparkles size={16} /> {markdown ? "Regenerate report" : "Generate report"}
        </button>
        <button className="btn ghost" onClick={download} disabled={!markdown}>
          <Download size={16} /> Download .md
        </button>
      </div>

      {markdown ? (
        <ReportPreview markdown={markdown} />
      ) : (
        <p className="muted body-text">
          Nothing generated yet for {month} — press "Generate report" to build it from
          the villa's current Readiness, Faults, Spend and Schedule status.
        </p>
      )}
    </div>
  );
}
