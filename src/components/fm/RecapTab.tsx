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

import Dropdown from "@/components/common/Dropdown";
import SaveButton from "@/components/common/SaveButton";
import { Sparkles, Download, Save } from "lucide-react";
import { useFmData } from "@/fm/FmDataContext";
import { useDeviceIdentity } from "@/config/VillaModel";
import { buildMonthlyRecap } from "@/fm/fmDocuments";
import { useFmTerms } from "@/fm/useFmTerms";
import { useMonthlyDocument } from "@/fm/useMonthlyDocument";
import type { ReadinessResult } from "@/fm/readiness";
import MarkdownPreview from "./MarkdownPreview";
import SavedDocumentsList from "./SavedDocumentsList";

export default function RecapTab({
  readiness, offlineDeviceCount, totalDeviceCount,
}: {
  readiness: ReadinessResult;
  offlineDeviceCount: number;
  totalDeviceCount: number;
}) {
  const { data } = useFmData();
  const terms = useFmTerms();
  // the open work counted per device card, as the Tickets tab counts it (fmDocuments.RecapInput.deviceOfRecord)
  const { deviceOfRecord } = useDeviceIdentity();
  // Make / save / reopen / download, and the months offered (the previous
  // month first: see monthlyDocument.defaultMonth) — useMonthlyDocument.
  const doc = useMonthlyDocument("recap", (month, villaName) => buildMonthlyRecap({
    fm: data, month, villaName, readiness, offlineDeviceCount, totalDeviceCount, terms, deviceOfRecord,
  }));
  const { month, markdown } = doc;

  return (
    <div className="fm-stack">
      <p className="muted body-text">
        The month's operations recap, to attach to the owner's monthly statement —
        maintenance performed against the configured schedule, spend against the
        monthly cap, faults and response times. Revenue, commissions and payout
        are out of scope and stay with whoever already handles them.
      </p>

      {/* The period on the same line as what it is for (owner, 2026-10-14) */}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="fm-inline-label">Period</span>
        <div style={{ minWidth: 130 }}>
          <Dropdown value={month} ariaLabel="Period" onChange={doc.setMonth}
            options={doc.months.map((m) => ({ value: m, label: m }))} />
        </div>
        <button className="btn primary" onClick={doc.generate}>
          <Sparkles size={16} /> {markdown ? "Regenerate recap" : "Generate recap"}
        </button>
        <SaveButton saved={doc.saved} label="Save recap" icon={<Save size={16} />} onClick={() => void doc.save()} disabled={!markdown} />
        <button className="btn ghost" onClick={doc.download} disabled={!markdown}>
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
            the villa's current Readiness, Tickets, Spend and Schedule status.
          </p>
        )}
      </div>

      <SavedDocumentsList kind="recap" onOpen={doc.reopen} />
    </div>
  );
}
