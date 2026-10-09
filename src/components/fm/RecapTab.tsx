// src/components/fm/RecapTab.tsx
// The month's operations RECAP: the operational annex for whatever monthly
// owner report cycle the property already runs. ⚠️ "Recap", NOT "Report"
// (owner, 2026-10-04): "report" is what the VESTA Agent sends; this tab was
// called Report until 2.496.274 and the two were confused.
//
// Markdown, downloaded: it pastes into an email or WhatsApp unchanged, needs
// no viewer, and stays readable years later if it is ever pulled up in a
// dispute. The preview below renders that same Markdown FORMATTED (see
// MarkdownPreview) — a wall of "##"/"|" is not what an owner should have to
// read to find out if the villa is ready for a guest — but the underlying
// string, unchanged, is exactly what gets downloaded. The app deliberately
// produces only the OPERATIONAL annex — financial reporting (revenue,
// commissions, payout) is out of scope and stays with whoever runs it.
//
// Generation is an explicit action (the button), not a silent live re-render:
// the recap is a point-in-time record of the villa's Readiness/Faults/Spend/
// Schedule status, and its own "Generated:" timestamp should mean the moment
// someone asked for it, not "whenever this component happened to re-render".

import { useState } from "react";
import Dropdown from "@/components/common/Dropdown";
import SaveButton from "@/components/common/SaveButton";
import { Sparkles, Download, Save } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { resolveSiteTitle } from "@/config/AppConfig";
import { useFmData } from "@/fm/FmDataContext";
import { buildMonthlyRecap } from "@/fm/fmDocuments";
import { monthKey } from "@/fm/fmEngine";
import { useFmTerms } from "@/fm/useFmTerms";
import type { ReadinessResult } from "@/fm/readiness";
import type { FmSavedDocument } from "@/fm/fmTypes";
import MarkdownPreview from "./MarkdownPreview";
import SavedDocumentsList from "./SavedDocumentsList";
import { downloadFile } from "@/utils/download";

/** Previous month by default: the recap is written about a month that has
 *  finished, and it is due by the 10th of the one after it. */
function defaultMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return monthKey(d);
}

export default function RecapTab({
  readiness, offlineDeviceCount, totalDeviceCount,
}: {
  readiness: ReadinessResult;
  offlineDeviceCount: number;
  totalDeviceCount: number;
}) {
  const { data, saveDocument } = useFmData();
  const terms = useFmTerms();
  const { config } = useConfig();
  const { haConfig } = useHA();
  const [month, setMonth] = useState(defaultMonth());
  // A snapshot, not a live useMemo: see the module comment on why generation
  // is an explicit action. null until "Generate recap" is pressed, or after
  // the period changes underneath a previously generated one — a recap for
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
    setMarkdown(buildMonthlyRecap({
      fm: data, month, villaName, readiness, offlineDeviceCount, totalDeviceCount, terms,
    }));
    setSaved(false);
  };

  const download = () => {
    if (!markdown) return;
    downloadFile(`${villaName.replace(/\s+/g, "-").toLowerCase()}-operations-${month}.md`, markdown, "text/markdown");
  };

  const save = async () => {
    if (!markdown) return;
    // "Saved" only when it was; otherwise the store's banner says why.
    if (await saveDocument({ kind: "recap", month, markdown }) === "saved") setSaved(true);
  };

  const reopen = (doc: FmSavedDocument) => {
    setMonth(doc.month);
    setMarkdown(doc.markdown);
    setSaved(true);
  };

  return (
    <div className="fm-stack">
      <p className="muted body-text">
        The month's operations recap, to attach to the owner's monthly statement —
        maintenance performed against the configured schedule, spend against the
        monthly cap, faults and response times. Revenue, commissions and payout
        are out of scope and stay with whoever already handles them.
      </p>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="fm-field" style={{ maxWidth: 200 }}>
          <span>Period</span>
          <Dropdown value={month} ariaLabel="Period" onChange={(m) => { setMonth(m); setMarkdown(null); setSaved(false); }}
            options={months.map((m) => ({ value: m, label: m }))} />
        </label>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn primary" onClick={generate}>
          <Sparkles size={16} /> {markdown ? "Regenerate recap" : "Generate recap"}
        </button>
        <SaveButton saved={saved} label="Save recap" icon={<Save size={16} />} onClick={() => void save()} disabled={!markdown} />
        <button className="btn ghost" onClick={download} disabled={!markdown}>
          <Download size={16} /> Download .md
        </button>
      </div>

      {/* min-height keeps this tab's OWN footprint roughly stable across the
          empty-placeholder <-> full-recap swap — without it, generating a
          recap (a couple lines -> a full formatted document) jumped this
          tab's content height dramatically. On the desktop/tablet breakpoint
          the settings family's fixed height absorbs that into a scroll, but below it the
          whole modal resizes around the user, visibly shifting the header/
          tabs row on screen between "before" and "after" (they never
          actually change style — the whole dialog just grew and re-centred
          under them). */}
      <div className="fm-doc-preview-area">
        {markdown ? (
          <MarkdownPreview markdown={markdown} />
        ) : (
          <p className="muted body-text">
            Nothing generated yet for {month} — press "Generate recap" to build it from
            the villa's current Readiness, Faults, Spend and Schedule status.
          </p>
        )}
      </div>

      <SavedDocumentsList kind="recap" onOpen={reopen} />
    </div>
  );
}
