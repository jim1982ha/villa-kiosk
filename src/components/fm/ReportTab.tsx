// src/components/fm/ReportTab.tsx
// Generates the operational annex to the monthly owner report (Clause 3.11,
// due by the 10th of the following month — late reporting is a material breach
// under Appendix C §7(a)).
//
// Markdown, copied or downloaded: it pastes into an email or WhatsApp
// unchanged, needs no viewer, and stays readable years later if it is ever
// pulled up in a dispute. The app deliberately produces only the OPERATIONAL
// annex — Kozystay's financial report stays theirs.

import { useMemo, useState } from "react";
import { Copy, Check, Download } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { resolveSiteTitle } from "@/config/AppConfig";
import { useFmData } from "@/fm/FmDataContext";
import { buildMonthlyReport } from "@/fm/fmReport";
import { monthKey } from "@/fm/fmEngine";
import type { ReadinessReport } from "@/fm/readiness";

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
  const [copied, setCopied] = useState(false);

  const villaName = resolveSiteTitle(config, haConfig?.location_name);
  const markdown = useMemo(() => buildMonthlyReport({
    fm: data, month, villaName, readiness, offlineDeviceCount, totalDeviceCount,
  }), [data, month, villaName, readiness, offlineDeviceCount, totalDeviceCount]);

  const months = [...new Set([
    defaultMonth(), monthKey(Date.now()),
    ...data.completions.map((c) => monthKey(c.at)),
    ...data.costs.map((c) => monthKey(c.at)),
  ])].sort().reverse();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      // Clipboard blocked (insecure context / kiosk lockdown / iOS) — same
      // textarea fallback the error report and telemetry panel already use.
      const ta = document.createElement("textarea");
      ta.value = markdown;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const download = () => {
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
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" onClick={() => void copy()}>
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied!" : "Copy report"}
        </button>
        <button className="btn ghost" onClick={download}>
          <Download size={16} /> Download .md
        </button>
      </div>

      <pre className="fm-report-preview">{markdown}</pre>
    </div>
  );
}
